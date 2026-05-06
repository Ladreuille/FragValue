// api/refund-request.js
//
// Self-service refund 14j (garantie commerciale FragValue).
//
// Route :
//   GET  /api/refund-request -> retourne l'eligibilite + meta du dernier charge
//   POST /api/refund-request -> declenche le refund + cancel immediat
//
// Auth : Bearer Supabase (l'user doit etre logge).
//
// Le user a renonce a son droit de retractation legal au moment de la
// souscription (L221-28-13, checkbox confirmTermsModal). Mais FragValue
// honore quand meme la promesse commerciale "satisfait ou rembourse 14j"
// pour les paiements < 14j. Au-dela, refund manuel via support uniquement.
//
// Effets :
// - stripe.refunds.create : refund total du dernier charge (full).
// - stripe.subscriptions.update : cancel immediat (acces coupe).
// - INSERT refund_requests + UPDATE status apres Stripe success.
// - Email confirmation au user.
// - Le webhook customer.subscription.deleted sync le profile -> tier='free'.

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const REFUND_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function setCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function hashIp(req) {
  try {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
            || req.socket?.remoteAddress || '';
    if (!ip) return null;
    const crypto = require('crypto');
    const salt = process.env.IP_HASH_SALT || 'fv-default-salt-change-me';
    return crypto.createHash('sha256').update(salt + ip).digest('hex').slice(0, 16);
  } catch (_) { return null; }
}

// Trouve le dernier charge eligible (paye, non rembourse, < 14j) du customer.
// Retourne null si rien d'eligible.
async function findEligibleCharge(stripe, customerId) {
  const cutoff = Math.floor((Date.now() - REFUND_WINDOW_MS) / 1000);
  const charges = await stripe.charges.list({
    customer: customerId,
    limit: 20,
    created: { gte: cutoff },
  });
  for (const c of charges.data) {
    if (c.status !== 'succeeded') continue;
    if (c.refunded) continue;
    if (c.amount_refunded > 0) continue;
    return c;
  }
  return null;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({ error: 'STRIPE_SECRET_KEY non configure' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Variables Supabase manquantes' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const Stripe = (await import('stripe')).default;
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

    const token = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Session invalide' });

    // Rate limit POST : 1 demande max / 24h par user. Empeche le spam de
    // double-refund en cas de bug ou clic frenetique. GET (eligibility check)
    // reste autorise sans limite.
    if (req.method === 'POST') {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('refund_requests')
        .select('id, status, created_at')
        .eq('user_id', user.id)
        .gte('created_at', since)
        .limit(1)
        .maybeSingle();
      if (recent) {
        return res.status(429).json({
          error: 'rate_limited',
          message: 'Tu as deja fait une demande de remboursement dans les dernieres 24h. Si elle a echoue, contacte le support a contact@fragvalue.com.',
          retry_after_hours: 24,
        });
      }
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id, stripe_subscription_id, subscription_tier')
      .eq('id', user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return res.status(404).json({
        eligible: false,
        reason: 'no_subscription',
        message: 'Aucun abonnement Stripe lie a ce compte.',
      });
    }

    const charge = await findEligibleCharge(stripe, profile.stripe_customer_id);
    if (!charge) {
      return res.status(200).json({
        eligible: false,
        reason: 'window_expired',
        message: 'Aucun paiement eligible au remboursement (fenetre 14j depassee ou deja rembourse).',
      });
    }

    const chargeDate = new Date(charge.created * 1000);
    const expiresAt = new Date(charge.created * 1000 + REFUND_WINDOW_MS);
    const daysLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 86400000));

    // GET : eligibility check seulement.
    if (req.method === 'GET') {
      return res.status(200).json({
        eligible: true,
        charge_id: charge.id,
        amount_cents: charge.amount,
        currency: charge.currency,
        charged_at: chargeDate.toISOString(),
        expires_at: expiresAt.toISOString(),
        days_left: daysLeft,
      });
    }

    // POST : execute le refund.
    const reason = String(req.body?.reason || '').slice(0, 500) || null;

    // Insert pending row (idempotency : index unique sur charge_id status=completed).
    const { data: rr, error: insertErr } = await supabase
      .from('refund_requests')
      .insert({
        user_id: user.id,
        stripe_customer_id: profile.stripe_customer_id,
        stripe_charge_id: charge.id,
        stripe_subscription_id: profile.stripe_subscription_id || null,
        amount_refunded_cents: charge.amount,
        currency: charge.currency,
        reason,
        status: 'pending',
        ip_hash: hashIp(req),
        user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      })
      .select('id')
      .single();
    if (insertErr) {
      console.error('[refund-request] insert error', insertErr);
      return res.status(500).json({ error: 'Impossible de creer la demande.' });
    }

    let refundId = null;
    let cancelAtPeriodEnd = false;

    try {
      // 1. Refund total du charge.
      const refund = await stripe.refunds.create({
        charge: charge.id,
        reason: 'requested_by_customer',
        metadata: { user_id: user.id, refund_request_id: rr.id, source: 'self-service' },
      });
      refundId = refund.id;

      // 2. Cancel sub immediate. Si pas de sub_id en DB, fallback : list les
      //    subs Stripe du customer et cancel la 1ere active.
      let subId = profile.stripe_subscription_id;
      if (!subId) {
        const subs = await stripe.subscriptions.list({
          customer: profile.stripe_customer_id,
          status: 'active',
          limit: 1,
        });
        subId = subs.data[0]?.id || null;
      }
      if (subId) {
        await stripe.subscriptions.cancel(subId);
      }

      // 3. Update refund_requests row.
      await supabase
        .from('refund_requests')
        .update({
          stripe_refund_id: refundId,
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', rr.id);

      // 4. Email de confirmation (best-effort).
      try {
        const tpl = require('./_lib/email-templates.js');
        const { sendEmail } = await import('./_lib/email.js');
        if (tpl.refundProcessed && sendEmail) {
          const mail = tpl.refundProcessed({
            email: user.email,
            amount_eur: (charge.amount / 100).toFixed(2),
            currency: (charge.currency || 'eur').toUpperCase(),
            refund_id: refundId,
          });
          await sendEmail({
            to: user.email,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          }).catch((e) => console.warn('[refund-request] email send failed:', e?.message));
        }
      } catch (e) {
        console.warn('[refund-request] email module load failed:', e?.message);
      }

      return res.status(200).json({
        ok: true,
        refund_id: refundId,
        amount_cents: charge.amount,
        currency: charge.currency,
        message: 'Remboursement en cours. Tu recois la confirmation par email sous quelques minutes.',
      });

    } catch (stripeErr) {
      console.error('[refund-request] Stripe error:', stripeErr?.message);
      await supabase
        .from('refund_requests')
        .update({
          status: 'failed',
          error_message: String(stripeErr?.message || 'unknown').slice(0, 500),
        })
        .eq('id', rr.id);

      // Alerte ops pour traitement manuel.
      try {
        const { sendAlert } = require('./_lib/alert.js');
        await sendAlert({
          severity: 'error',
          title: 'Refund self-service Stripe failed',
          source: 'refund-request',
          details: {
            user_id: user.id,
            email: user.email,
            charge_id: charge.id,
            error: stripeErr?.message,
            refund_request_id: rr.id,
          },
        });
      } catch (_) {}

      return res.status(502).json({
        error: 'Le remboursement a echoue cote Stripe. Le support a ete notifie.',
      });
    }

  } catch (err) {
    console.error('[refund-request] fatal:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
