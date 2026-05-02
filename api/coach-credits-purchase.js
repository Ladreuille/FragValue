// api/coach-credits-purchase.js · FragValue · POST /api/coach-credits-purchase
//
// Cree une session Stripe Checkout one-shot pour acheter un pack de credits
// Coach IA (50 credits = 4€ ou 200 credits = 12€).
//
// FLOW :
//   1. User Pro/Elite POST { pack: 'pack_50' | 'pack_200' }
//   2. On cree une Stripe Checkout Session avec metadata { user_id, pack }
//   3. On retourne l'URL Stripe Checkout
//   4. User paye -> Stripe envoie webhook 'checkout.session.completed'
//   5. Le webhook (api/stripe-webhook.js) lit metadata + appelle addCredits()
//
// AUTH : require Pro ou Elite (Free pas concerne).

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const { requirePro } = require('./_lib/subscription');
const { PACKS } = require('./_lib/coach-credits');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

// Stripe Price IDs : a creer dans le Dashboard Stripe avant deploy.
// Le user remplace ces IDs par les vrais via env vars.
const STRIPE_PRICE_IDS = {
  pack_50:  process.env.STRIPE_PRICE_COACH_PACK_50  || '',
  pack_200: process.env.STRIPE_PRICE_COACH_PACK_200 || '',
};

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

let _stripe = null;
function stripe() {
  if (_stripe) return _stripe;
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY manquant');
  _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return _stripe;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Plan check
  const gate = await requirePro(req, res);
  if (!gate) return;
  const { user } = gate;

  // Parse body
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const packKey = body.pack || 'pack_50';
  const pack = PACKS[packKey];
  if (!pack) return res.status(400).json({ error: 'Pack invalide', valid: Object.keys(PACKS) });

  const priceId = STRIPE_PRICE_IDS[packKey];
  if (!priceId) {
    return res.status(503).json({
      error: 'Pack pas encore configure',
      hint: `Creer le Price Stripe pour ${packKey} et set env var STRIPE_PRICE_COACH_${packKey.toUpperCase()}.`,
    });
  }

  try {
    // Tente de retrouver/creer un Stripe Customer pour cet user.
    // On reutilise l'eventuel customer existant via la table subscriptions.
    const supabase = sb();
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);
    let customerId = subs?.[0]?.stripe_customer_id || null;

    if (!customerId) {
      // Pas de subscription -> on cree un customer ad-hoc pour le checkout
      const customer = await stripe().customers.create({
        email: user.email,
        metadata: { user_id: user.id, source: 'coach_credits_purchase' },
      });
      customerId = customer.id;
    }

    // Cree la Checkout Session
    const baseUrl = origin || 'https://fragvalue.com';
    const session = await stripe().checkout.sessions.create({
      mode: 'payment', // one-shot, pas un abonnement
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/account.html?credits_added=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/pricing.html#credits`,
      metadata: {
        user_id:    user.id,
        purchase_type: 'coach_credits',
        pack:       packKey,
        credits:    String(pack.credits),
      },
      allow_promotion_codes: true,
      automatic_tax:         { enabled: true },
    });

    return res.status(200).json({
      ok: true,
      session_id: session.id,
      url: session.url,
      pack: { key: packKey, ...pack },
    });
  } catch (e) {
    console.error('[coach-credits-purchase] error:', e.message);
    return res.status(500).json({
      error: 'Erreur creation Checkout',
      hint: e.message?.slice(0, 120),
    });
  }
};
