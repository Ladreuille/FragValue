// api/stripe-checkout.js // FragValue
// Cree une Stripe Checkout Session pour l'abonnement Pro ou Team

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

  const missing = [];
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!process.env.STRIPE_PRICE_PRO_MONTHLY) missing.push('STRIPE_PRICE_PRO_MONTHLY');
  if (!process.env.STRIPE_PRICE_PRO_ANNUEL) missing.push('STRIPE_PRICE_PRO_ANNUEL');
  if (!process.env.STRIPE_PRICE_TEAM_MONTHLY) missing.push('STRIPE_PRICE_TEAM_MONTHLY');
  if (missing.length > 0) return res.status(503).json({ error: 'Variables manquantes : ' + missing.join(', ') });

  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

    const PLANS = {
      pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY,
      pro_yearly: process.env.STRIPE_PRICE_PRO_ANNUEL,
      team_monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY,
    };

    const body = req.body || {};
    const plan = body.plan;
    if (!plan || !PLANS[plan]) return res.status(400).json({ error: 'Plan invalide : ' + (plan || 'undefined') });

    const siteOrigin = originFrom(req);
    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: PLANS[plan], quantity: 1 }],
      success_url: siteOrigin + '/account.html?checkout=success',
      cancel_url: siteOrigin + '/pricing.html',
      allow_promotion_codes: true,
      // 7 jours d'essai gratuit sur les plans Pro (claim marketing sur pricing.html).
      // Pendant le trial, aucun prelevement. L'abonnement commence automatiquement
      // apres 7 jours si l'utilisateur n'a pas annule (cancel en 1 clic depuis Stripe).
      subscription_data: {
        trial_period_days: 7,
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
        }
      } catch (_) { /* proceed without customer */ }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    return res.status(200).json({ url: session.url });
  } catch (err) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
