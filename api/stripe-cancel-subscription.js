// api/stripe-cancel-subscription.js // FragValue
// Resiliation native d'abonnement (BLOCKER LEGAL #3 cf. ultrareview Trust/Legal)
//
// Loi Beroud-Lemoyne (16 aout 2022, en vigueur 1er juin 2023), art. L215-1-1
// Code de la consommation : la resiliation doit etre possible directement sur
// le site de l'editeur, en 3 clics maximum, sans redirection vers un tiers.
// Sanction : 15 000 EUR par contrat concerne (DGCCRF).
//
// Ce endpoint :
// 1. Verifie l'auth Supabase (session valide).
// 2. Recupere la subscription Stripe active du user.
// 3. Appelle stripe.subscriptions.update({cancel_at_period_end: true}) pour
//    resilier proprement a la fin de la periode courante (le user garde l'acces
//    jusqu'a la fin du mois/annee deja paye, conforme aux pratiques SaaS).
// 4. Met a jour le profile Supabase (cancel_at_period_end=true + cancel_at)
//    pour refleter immediatement le statut dans l'UI.
//
// Le webhook customer.subscription.updated traite par api/stripe-webhook.js
// recevra ensuite l'event et synchronisera le statut. Mais on update aussi ici
// directement pour eviter les delais de propagation.

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validations env vars
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Variable manquante : STRIPE_SECRET_KEY' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Variables Supabase manquantes' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authentification requise' });

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Session invalide' });

    // Recupere le stripe_customer_id du user
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, plan')
      .eq('id', user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(404).json({ error: 'Aucun abonnement Stripe trouve pour ce compte.' });
    }

    if (!profile.plan || profile.plan === 'free') {
      return res.status(400).json({ error: 'Aucun abonnement actif a resilier.' });
    }

    // Recupere les subscriptions actives du customer
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
    const subs = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'active',
      limit: 5,
    });

    if (!subs.data || subs.data.length === 0) {
      // Peut-etre deja resilie en mode trialing ou canceled : on tolere
      const allSubs = await stripe.subscriptions.list({
        customer: profile.stripe_customer_id,
        limit: 5,
      });
      const trialing = allSubs.data?.find(s => s.status === 'trialing');
      if (!trialing) {
        return res.status(404).json({ error: 'Aucun abonnement actif trouve.' });
      }
      // Cancel le trial
      await stripe.subscriptions.update(trialing.id, { cancel_at_period_end: true });
    } else {
      // Cancel a la fin de la periode pour les subs actives
      await Promise.all(subs.data.map(sub =>
        stripe.subscriptions.update(sub.id, { cancel_at_period_end: true })
      ));
    }

    // Update le profile pour refleter le statut immediatement (le webhook
    // synchronisera de toute facon mais on evite les delais)
    const sub = subs.data[0];
    if (sub) {
      await supabase
        .from('profiles')
        .update({
          cancel_at_period_end: true,
          cancel_at: new Date(sub.current_period_end * 1000).toISOString(),
        })
        .eq('id', user.id);
    }

    // Log evenement pour audit DGCCRF (preuve de resiliation conforme)
    try {
      await supabase.from('subscription_events').insert({
        user_id: user.id,
        event_type: 'cancel_requested',
        plan: profile.plan,
        stripe_customer_id: profile.stripe_customer_id,
        ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
        user_agent: (req.headers['user-agent'] || '').slice(0, 200),
      });
    } catch (logErr) {
      // Table optionnelle, on swallow l'erreur
      console.warn('[stripe-cancel] subscription_events log failed:', logErr?.message);
    }

    return res.status(200).json({
      ok: true,
      message: 'Abonnement resilie. Acces conserve jusqu\'a la fin de la periode courante.',
    });
  } catch (err) {
    console.error('[stripe-cancel-subscription] error:', {
      name: err?.name,
      type: err?.type,
      code: err?.code,
      message: err?.message,
      stripeRequestId: err?.requestId,
    });
    return res.status(500).json({ error: 'Erreur serveur. Reessaie ou contacte le support.' });
  }
}
