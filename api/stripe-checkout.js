// api/stripe-checkout.js // FragValue
// Cree une Stripe Checkout Session pour l'abonnement Pro ou Elite

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

// Origine logique pour construire les success_url / cancel_url Stripe.
// En prod on veut fragvalue.com ; en preview Vercel on veut le host courant.
function originFrom(req) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) return origin;
  const host = req.headers.host || '';
  if (host && ALLOWED_ORIGIN_RE.test('https://' + host)) return 'https://' + host;
  return 'https://fragvalue.com';
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Variables manquantes : STRIPE_SECRET_KEY' });
  }

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

    // Mapping plan logique → env vars. Chaque plan peut etre resolu par
    // plusieurs env vars (dans l'ordre), ce qui permet de migrer les anciens
    // noms STRIPE_PRICE_TEAM_* vers STRIPE_PRICE_ELITE_* sans casser la prod
    // pendant la transition. La premiere env var definie gagne.
    const PLAN_ENV = {
      pro_monthly:    ['STRIPE_PRICE_PRO_MONTHLY'],
      pro_yearly:     ['STRIPE_PRICE_PRO_ANNUEL'],
      elite_monthly:  ['STRIPE_PRICE_ELITE_MONTHLY', 'STRIPE_PRICE_TEAM_MONTHLY'],
      elite_yearly:   ['STRIPE_PRICE_ELITE_ANNUEL',  'STRIPE_PRICE_TEAM_ANNUEL'],
    };
    // Alias legacy pour backward-compat : le front peut encore envoyer team_*
    PLAN_ENV.team_monthly = PLAN_ENV.elite_monthly;
    PLAN_ENV.team_yearly  = PLAN_ENV.elite_yearly;

    const body = req.body || {};
    const plan = body.plan;
    if (!plan || !PLAN_ENV[plan]) return res.status(400).json({ error: 'Plan invalide : ' + (plan || 'undefined') });

    // Normalise le plan team_* -> elite_* pour les metadata Stripe
    const normalizedPlan = plan.startsWith('team_') ? plan.replace('team_', 'elite_') : plan;

    const envNames = PLAN_ENV[plan];
    const priceId = envNames.map(n => process.env[n]).find(v => !!v);
    if (!priceId) return res.status(503).json({ error: 'Variable manquante : ' + envNames.join(' / ') });

    const siteOrigin = originFrom(req);
    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: siteOrigin + '/account.html?checkout=success',
      cancel_url: siteOrigin + '/pricing.html',
      allow_promotion_codes: true,
      // Metadata pour le webhook : sans supabase_user_id, le checkout.session.completed
      // ne peut pas associer la subscription au bon user en DB.
      metadata: { plan: normalizedPlan },
      // 7 jours d'essai gratuit sur les plans Pro (claim marketing sur pricing.html).
      // Pendant le trial, aucun prelevement. L'abonnement commence automatiquement
      // apres 7 jours si l'utilisateur n'a pas annule (cancel en 1 clic depuis Stripe).
      subscription_data: {
        trial_period_days: 7,
        // Propage le plan sur la subscription pour les webhooks de renew/update
        // (subscription.updated ne contient pas la metadata de session).
        metadata: { plan: normalizedPlan },
      },
    };

    const authHeader = req.headers.authorization;
    if (authHeader && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          const { data: profile } = await supabase.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
          if (profile?.stripe_customer_id) {
            sessionParams.customer = profile.stripe_customer_id;
          } else {
            const customer = await stripe.customers.create({ email: user.email, metadata: { supabase_uid: user.id } });
            await supabase.from('profiles').upsert({ id: user.id, stripe_customer_id: customer.id }, { onConflict: 'id' });
            sessionParams.customer = customer.id;
          }
          // Critical : sans supabase_user_id, le webhook ne peut pas peupler la DB.
          sessionParams.metadata.supabase_user_id = user.id;
          sessionParams.subscription_data.metadata.supabase_user_id = user.id;
        }
      } catch (_) { /* proceed without customer */ }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    // Log cote Vercel (visible dans les Vercel Logs) + detail dans la reponse
    // pour debug rapide. A retirer une fois le flow valide en prod.
    console.error('[stripe-checkout] error:', {
      name: err?.name,
      type: err?.type,
      code: err?.code,
      message: err?.message,
      stripeRequestId: err?.requestId,
      planRequested: req.body?.plan,
    });
    return res.status(500).json({
      error: 'Erreur serveur',
      diagnostic: {
        type: err?.type || err?.name || 'unknown',
        code: err?.code,
        message: err?.message,
        stripeRequestId: err?.requestId,
      },
    });
  }
}
