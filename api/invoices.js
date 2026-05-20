// api/invoices.js · FragValue
//
// GET /api/invoices?limit=10
//
// Retourne les N dernieres factures Stripe + LTD purchases pour l'user
// courant, dans un format unifie pour affichage dans /account.html
// (tableau "Mes factures").
//
// Format de retour :
//   {
//     invoices: [
//       {
//         id:         'in_xxx' | 'ltd_xxx',
//         date:       ISO string,
//         amount_eur: number (e.g. 9.00),
//         currency:   'EUR',
//         plan:       'Pro mensuel' | 'Pro annuel' | 'Elite mensuel' | ... | 'Lifetime Pro',
//         status:     'paid' | 'open' | 'failed' | 'refunded',
//         pdf_url:    string | null,
//         hosted_url: string | null,
//         source:     'stripe' | 'lifetime'
//       }
//     ],
//     total_paid_eur: number (lifetime total),
//   }
//
// Auth : JWT Supabase requis.
// Cache : 60s (les factures bougent rarement).

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const PLAN_LABELS = {
  pro_monthly:    'Pro mensuel',
  pro_yearly:     'Pro annuel',
  elite_monthly:  'Elite mensuel',
  elite_yearly:   'Elite annuel',
  team_monthly:   'Elite mensuel',
  team_yearly:    'Elite annuel',
  lifetime_pro:   'Lifetime Pro',
};

function labelForLineItem(li) {
  // Stripe invoice line items : on essaie de deduire le plan via metadata
  // (deja set au checkout) puis fallback sur description.
  const meta = li?.price?.metadata || li?.metadata || {};
  const planKey = meta.plan || meta.plan_key || null;
  if (planKey && PLAN_LABELS[planKey]) return PLAN_LABELS[planKey];
  // Fallback : description Stripe brute (ex. "FragValue Pro").
  return li?.description || li?.price?.nickname || 'Abonnement';
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth requise' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'Stripe non configure' });
  }

  const limit = Math.min(parseInt(req.query.limit || '10', 10) || 10, 50);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  try {
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    // Lookup stripe_customer_id pour la query Stripe
    const { data: profile } = await sb.from('profiles')
      .select('stripe_customer_id').eq('id', user.id).maybeSingle();

    const invoices = [];
    let totalPaidCents = 0;

    // 1. Stripe invoices (recurrent subs)
    if (profile?.stripe_customer_id) {
      const Stripe = (await import('stripe')).default;
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
      try {
        const list = await stripe.invoices.list({
          customer: profile.stripe_customer_id,
          limit: limit,
          status: 'paid',
        });
        for (const inv of list.data) {
          // Best-effort : recupere le premier line_item pour le label plan
          const firstLi = inv.lines?.data?.[0] || null;
          invoices.push({
            id: inv.id,
            date: new Date(inv.created * 1000).toISOString(),
            amount_eur: (inv.amount_paid || inv.amount_due || 0) / 100,
            currency: (inv.currency || 'eur').toUpperCase(),
            plan: labelForLineItem(firstLi),
            status: inv.status === 'paid' ? 'paid' : (inv.status || 'open'),
            pdf_url:    inv.invoice_pdf || null,
            hosted_url: inv.hosted_invoice_url || null,
            source: 'stripe',
          });
          totalPaidCents += inv.amount_paid || 0;
        }
      } catch (e) {
        console.warn('[invoices] Stripe list failed:', e.message);
      }
    }

    // 2. Lifetime purchases (one-time payment, separate table)
    const { data: ltds } = await sb
      .from('lifetime_purchases')
      .select('id, stripe_session_id, stripe_payment_intent_id, amount_cents, currency, status, purchased_at, refunded_at')
      .eq('user_id', user.id)
      .in('status', ['completed', 'refunded'])
      .order('purchased_at', { ascending: false });
    for (const ltd of (ltds || [])) {
      invoices.push({
        id: 'ltd_' + ltd.id,
        date: ltd.purchased_at,
        amount_eur: (ltd.amount_cents || 0) / 100,
        currency: (ltd.currency || 'eur').toUpperCase(),
        plan: PLAN_LABELS.lifetime_pro,
        status: ltd.status,
        pdf_url: null, // on n'a pas de PDF natif pour les LTD
        hosted_url: null,
        source: 'lifetime',
      });
      if (ltd.status === 'completed') {
        totalPaidCents += ltd.amount_cents || 0;
      }
    }

    // Sort by date DESC, applique limit final
    invoices.sort((a, b) => new Date(b.date) - new Date(a.date));
    const trimmed = invoices.slice(0, limit);

    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json({
      invoices: trimmed,
      total_paid_eur: totalPaidCents / 100,
      currency: 'EUR',
    });
  } catch (err) {
    console.error('[invoices] error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
