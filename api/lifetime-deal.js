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
//   - Hard cap 50 ventes (seulement les rows COMPLETED comptent dans le compteur)
//   - 1 LTD per user (UNIQUE par status='completed'; un user peut retry apres abandon)
//   - Auth required (pas de guest LTD : on veut savoir qui est l'early adopter)
//
// Comportement du compteur :
//   - GET retourne sold = count(status='completed')   -> reflete les VRAIES ventes
//   - POST seat check = count(completed) + count(pending recent 60min)
//     -> bloque seulement si capacite reellement saturee (sessions Stripe actives)
//   - Si user clique "Reserver" puis revient sans payer, son row pending reste
//     en DB mais N'EST PAS compte dans le compteur public au-dela de 60 min.

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const LTD_TOTAL_SEATS = 50;
const LTD_PRICE_CENTS = 9900;  // 99 EUR
const PENDING_GRACE_MINUTES = 60;  // window pendant lequel un pending compte dans le seat-check

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
  // BUG FIX : on ne compte QUE les `completed` ici. Avant on comptait aussi
  // les `pending` -> un user qui cliquait "Reserver" puis revenait sans
  // payer faisait quand meme decrementer le compteur public (vu sur la
  // banner /pricing.html#ltd). Maintenant le compteur reflete les vraies
  // ventes uniquement.
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    try {
      const { count, error } = await supabase
        .from('lifetime_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed');
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

      // Check 1 : l'user a-t-il deja un LTD COMPLETE (=paye) ?
      // On ne bloque PLUS sur pending : sinon un user qui a clique puis
      // abandonne ne pourrait plus retry. On bloque uniquement si deja paye.
      const { data: alreadyPaid } = await supabase
        .from('lifetime_purchases')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'completed')
        .maybeSingle();
      if (alreadyPaid) {
        return res.status(409).json({
          error: 'Tu as deja un Lifetime Deal complete sur ce compte',
          status: 'completed',
        });
      }

      // Check 2 : reste-t-il des places ?
      // On compte les `completed` + les `pending` recents (60 min) pour
      // anti-oversold pendant un surge launch (sessions Stripe actives).
      // Les pending plus vieux que 60 min sont consideres abandonnes.
      const graceCutoff = new Date(Date.now() - PENDING_GRACE_MINUTES * 60 * 1000).toISOString();
      const [{ count: soldCompleted }, { count: soldRecentPending }] = await Promise.all([
        supabase.from('lifetime_purchases')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'completed'),
        supabase.from('lifetime_purchases')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .gte('purchased_at', graceCutoff),
      ]);
      const seatsTaken = (soldCompleted || 0) + (soldRecentPending || 0);
      if (seatsTaken >= LTD_TOTAL_SEATS) {
        return res.status(410).json({ error: 'Lifetime Deal complet (50/50 places vendues)', soldOut: true });
      }

      // Cleanup : si l'user a un pending non-paye qui traine, on le marque
      // 'expired' AVANT de creer le nouveau. Evite d'accumuler des rows
      // pending fantomes par user.
      await supabase.from('lifetime_purchases')
        .update({ status: 'expired' })
        .eq('user_id', user.id)
        .eq('status', 'pending');

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
