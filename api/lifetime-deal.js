// api/lifetime-deal.js · FragValue
//
// Gere le Lifetime Deal launch (50 places, 99 EUR one-time).
//
// GET  /api/lifetime-deal           -> { sold, available, total, soldOut }
// POST /api/lifetime-deal/checkout  -> Stripe Checkout Session (one-time payment)
//
// Le webhook stripe-webhook.js gere ensuite checkout.session.completed et :
//   1. Insert lifetime_purchases row (status=completed)
//   2. Update profiles.subscription_tier = 'lifetime_pro'
//   3. Email lifetimeDealPurchased au user
//
// Anti-abuse :
//   - Hard cap 50 ventes
//   - 1 LTD per user (UNIQUE index sur user_id + status IN pending/completed)
//   - Auth required (pas de guest LTD : on veut savoir qui est l'early adopter)

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const LTD_TOTAL_SEATS = 50;
const LTD_PRICE_CENTS = 9900;  // 99 EUR

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'DB non configuree' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET : counter status (public, no auth required) ──────────────────
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    try {
      const { count, error } = await supabase
        .from('lifetime_purchases')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'completed']);
      if (error) throw error;
      const sold = count || 0;
      const available = Math.max(0, LTD_TOTAL_SEATS - sold);
      return res.status(200).json({
        sold,
        available,
        total: LTD_TOTAL_SEATS,
        soldOut: available === 0,
        price_eur: LTD_PRICE_CENTS / 100,
      });
    } catch (err) {
      console.error('[lifetime-deal] GET error:', err);
      return res.status(500).json({ error: 'DB error' });
    }
  }

  // ── POST : create Stripe Checkout session ────────────────────────────
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Authentification requise pour le Lifetime Deal' });

    try {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

      // Check : l'user a-t-il deja un LTD pending ou completed ?
      const { data: existing } = await supabase
        .from('lifetime_purchases')
        .select('id, status')
        .eq('user_id', user.id)
        .in('status', ['pending', 'completed'])
        .maybeSingle();
      if (existing) {
        return res.status(409).json({
          error: 'Tu as deja un Lifetime Deal en cours ou complete',
          status: existing.status,
        });
      }

      // Check : reste-t-il des places ?
      const { count: sold } = await supabase
        .from('lifetime_purchases')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'completed']);
      if ((sold || 0) >= LTD_TOTAL_SEATS) {
        return res.status(410).json({ error: 'Lifetime Deal complet (50/50 places vendues)', soldOut: true });
      }

      // Stripe Checkout one-time payment
      const Stripe = (await import('stripe')).default;
      if (!process.env.STRIPE_SECRET_KEY) {
        return res.status(503).json({ error: 'Stripe non configure' });
      }
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

      const ltdPriceId = process.env.STRIPE_PRICE_LIFETIME_PRO;
      if (!ltdPriceId) {
        return res.status(503).json({ error: 'STRIPE_PRICE_LIFETIME_PRO non configure' });
      }

      // Lookup ou cree le Stripe customer
      const { data: profile } = await supabase.from('profiles')
        .select('stripe_customer_id').eq('id', user.id).single();
      let stripeCustomerId = profile?.stripe_customer_id;
      if (!stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { supabase_uid: user.id },
        });
        stripeCustomerId = customer.id;
        await supabase.from('profiles').upsert(
          { id: user.id, stripe_customer_id: stripeCustomerId },
          { onConflict: 'id' }
        );
      }

      const siteOrigin = origin || 'https://fragvalue.com';
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer: stripeCustomerId,
        line_items: [{ price: ltdPriceId, quantity: 1 }],
        success_url: siteOrigin + '/account.html?lifetime=success',
        cancel_url: siteOrigin + '/pricing.html',
        locale: 'fr',
        metadata: {
          plan: 'lifetime_pro',
          supabase_uid: user.id,
        },
        payment_intent_data: {
          metadata: {
            plan: 'lifetime_pro',
            supabase_uid: user.id,
          },
        },
      });

      // Insert pending row (sera updated par le webhook a completed)
      await supabase.from('lifetime_purchases').insert({
        user_id: user.id,
        stripe_session_id: session.id,
        amount_cents: LTD_PRICE_CENTS,
        currency: 'eur',
        status: 'pending',
        metadata: { source: 'launch_2026', email: user.email },
      });

      return res.status(200).json({ url: session.url });
    } catch (err) {
      console.error('[lifetime-deal] POST error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
