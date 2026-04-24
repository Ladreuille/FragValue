// api/cron/trial-expiring.js
// Cron quotidien : envoie un email aux users dont le trial Stripe expire
// dans 3 jours (J-3). Aide la retention en rappelant l'option d'annulation
// et en proposant le plan annuel.
//
// Schedule recommande : 9h UTC tous les jours
//   "crons": [{ "path": "/api/cron/trial-expiring", "schedule": "0 9 * * *" }]
//
// Securite : Vercel envoie automatiquement Authorization: Bearer <CRON_SECRET>
// On accepte aussi un appel manuel admin (pour test) avec ?secret=...
//
// Idempotence : on flag dans subscriptions.trial_alert_sent_at pour ne pas
// renvoyer si le cron tourne 2x dans la meme journee.

const { createClient } = require('@supabase/supabase-js');

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async function handler(req, res) {
  // Auth : Vercel Cron envoie Authorization: Bearer <CRON_SECRET>
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

    // Cible : subscriptions en trialing dont current_period_end (= fin du trial)
    // tombe dans une fenetre [J+2, J+3] (24h slot pour ne rater aucun cas).
    const now = Date.now();
    const j2 = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
    const j3 = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();

    const { data: subs, error } = await s
      .from('subscriptions')
      .select('user_id, plan, current_period_end, trial_alert_sent_at')
      .eq('status', 'trialing')
      .gte('current_period_end', j2)
      .lte('current_period_end', j3);

    if (error) throw error;
    if (!subs || subs.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, message: 'Aucun trial expire J-3' });
    }

    const tpl = require('../_lib/email-templates.js');
    const { sendEmail } = await import('../_lib/email.js');

    let sent = 0;
    let failed = 0;
    const errors = [];

    for (const sub of subs) {
      // Skip si deja envoye dans les dernieres 48h
      if (sub.trial_alert_sent_at) {
        const ageH = (Date.now() - new Date(sub.trial_alert_sent_at).getTime()) / (1000 * 60 * 60);
        if (ageH < 48) continue;
      }

      try {
        // Fetch profile + email
        const { data: profile } = await s
          .from('profiles')
          .select('faceit_nickname')
          .eq('id', sub.user_id)
          .maybeSingle();
        const { data: userData } = await s.auth.admin.getUserById(sub.user_id);
        const email = userData?.user?.email;
        if (!email) continue;

        const planLabel = sub.plan?.startsWith('elite') ? 'Elite'
                        : sub.plan?.startsWith('pro') ? 'Pro'
                        : 'Premium';
        const t = tpl.trialExpiringJ3({
          nickname: profile?.faceit_nickname || email.split('@')[0],
          planLabel,
          trialEndIso: sub.current_period_end,
        });
        const result = await sendEmail({ to: email, subject: t.subject, html: t.html, text: t.text });
        if (result.error) throw new Error(result.error);

        // Flag idempotence (best-effort, ne fail pas le batch)
        await s.from('subscriptions')
          .update({ trial_alert_sent_at: new Date().toISOString() })
          .eq('user_id', sub.user_id)
          .catch(() => {});

        sent++;
      } catch (e) {
        failed++;
        errors.push({ user_id: sub.user_id, error: e.message });
        console.error('[trial-expiring] failed for', sub.user_id, e.message);
      }
    }

    return res.status(200).json({ ok: true, candidates: subs.length, sent, failed, errors: errors.slice(0, 5) });
  } catch (err) {
    console.error('[trial-expiring] cron error:', err);
    return res.status(500).json({ error: err.message });
  }
};
