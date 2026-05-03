// api/cron/dunning-retry.js
// Cf. ultrareview Email lifecycle P0 #2 (Cash recovery 38-45% du MRR a risque).
//
// Le webhook stripe envoie le J+0 immediat a invoice.payment_failed. Ce cron
// gere les relances J+3 / J+5 / J+7 jusqu'a ce que :
// - L'invoice soit paye (status='active' a nouveau, le webhook reset)
// - Ou le user reste 'past_due' apres J+7, alors Stripe basculera la sub
//   automatiquement (selon les retry rules configurees dans le dashboard Stripe).
//
// Schedule recommande : tous les jours a 10h UTC (1h apres trial-expiring pour
// eviter de saturer Resend en burst).
//   "crons": [{ "path": "/api/cron/dunning-retry", "schedule": "0 10 * * *" }]
//
// Idempotence via subscriptions.dunning_sent_at (concat "j0,j3,j5,j7").

const { createClient } = require('@supabase/supabase-js');

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const MILESTONES = [
  { key: 'j3', daysMin: 3, daysMax: 4 },
  { key: 'j5', daysMin: 5, daysMax: 6 },
  { key: 'j7', daysMin: 7, daysMax: 9 },
];

module.exports = async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const expectedSecret = process.env.CRON_SECRET;
  const querySecret = (req.query?.secret) || '';
  const valid =
    (expectedSecret && auth === `Bearer ${expectedSecret}`) ||
    (expectedSecret && querySecret === expectedSecret);
  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const s = sb();
    const tpl = require('../_lib/email-templates.js');
    const { sendEmail } = await import('../_lib/email.js');
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

    const now = Date.now();
    const results = { milestones: {}, totalSent: 0, totalFailed: 0 };

    for (const m of MILESTONES) {
      const dMin = new Date(now - m.daysMax * 86400000).toISOString();
      const dMax = new Date(now - m.daysMin * 86400000).toISOString();

      // Cible : subs en 'past_due' avec payment_failed_at dans la fenetre + ce
      // milestone PAS encore envoye dans dunning_sent_at.
      const { data: subs, error } = await s
        .from('subscriptions')
        .select('user_id, plan, current_period_end, stripe_subscription_id, payment_failed_at, dunning_sent_at')
        .eq('status', 'past_due')
        .gte('payment_failed_at', dMin)
        .lte('payment_failed_at', dMax);

      if (error) {
        console.error('[dunning-retry] db error', m.key, error);
        results.milestones[m.key] = { error: error.message };
        continue;
      }
      if (!subs || subs.length === 0) {
        results.milestones[m.key] = { candidates: 0, sent: 0 };
        continue;
      }

      let sent = 0, skipped = 0, failed = 0;

      for (const sub of subs) {
        // Idempotence
        const sentMilestones = (sub.dunning_sent_at || '').split(',').filter(Boolean);
        if (sentMilestones.includes(m.key)) { skipped++; continue; }

        try {
          const { data: userData } = await s.auth.admin.getUserById(sub.user_id);
          const email = userData?.user?.email;
          if (!email) { skipped++; continue; }

          // Recupere la derniere invoice failed pour avoir le montant exact
          let amount = '9 EUR'; // fallback
          try {
            const invoices = await stripe.invoices.list({
              subscription: sub.stripe_subscription_id,
              status: 'open', // failed = unpaid + past_due = "open"
              limit: 1,
            });
            const inv = invoices.data?.[0];
            if (inv) {
              amount = `${(inv.amount_due / 100).toFixed(2)} ${(inv.currency || 'eur').toUpperCase()}`;
            }
          } catch (_) {}

          const planLabel = sub.plan?.startsWith('elite') ? 'Elite' : 'Pro';
          const t = tpl.paymentFailed({
            nickname: email.split('@')[0],
            planLabel,
            milestone: m.key,
            amount,
            periodEndIso: sub.current_period_end,
            portalUrl: `${process.env.PUBLIC_URL || 'https://fragvalue.com'}/account.html`,
          });
          const result = await sendEmail({ to: email, subject: t.subject, html: t.html, text: t.text });
          if (result.error) throw new Error(result.error);

          // Append milestone au flag d'idempotence
          const newFlag = [...sentMilestones, m.key].join(',');
          await s.from('subscriptions')
            .update({ dunning_sent_at: newFlag })
            .eq('stripe_subscription_id', sub.stripe_subscription_id)
            .catch(() => {});

          sent++;
        } catch (e) {
          failed++;
          console.error(`[dunning-retry] ${m.key} failed for`, sub.user_id, e.message);
        }
      }

      results.milestones[m.key] = { candidates: subs.length, sent, skipped, failed };
      results.totalSent += sent;
      results.totalFailed += failed;
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('[dunning-retry] cron error:', err);
    return res.status(500).json({ error: err.message });
  }
};
