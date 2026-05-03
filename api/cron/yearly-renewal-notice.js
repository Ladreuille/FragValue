// api/cron/yearly-renewal-notice.js
// BLOCKER LEGAL P0 (cf. ultrareview Trust/Legal + Email lifecycle).
//
// Loi : art. L215-1-1 du Code de la consommation (Loi du 28 janvier 2005,
// renforcee par la Loi Beroud-Lemoyne du 16 aout 2022). Pour les abonnements
// annuels (et plus generalement reconductibles tacitement avec une duree
// >= 1 an), l'editeur DOIT informer le consommateur de la possibilite de ne
// pas reconduire **entre 3 mois et 1 mois avant la date d'echeance**.
// Sanction : 15 000 EUR par contrat non-notifie (DGCCRF).
//
// Schedule recommande : tous les jours a 9h UTC
//   "crons": [{ "path": "/api/cron/yearly-renewal-notice", "schedule": "0 9 * * *" }]
//
// Logique :
// - On envoie 3 emails J-30 / J-7 / J-1 pour cumuler les rappels et reduire
//   les chargebacks (les chargebacks proviennent souvent de "j'avais oublie").
// - Idempotence via subscriptions.renewal_notice_sent_at (ts du dernier envoi
//   par milestone, on stocke la concatenation "j30,j7,j1" des envois deja faits).
//
// Securite : Vercel envoie Authorization: Bearer <CRON_SECRET>.

const { createClient } = require('@supabase/supabase-js');

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

const MILESTONES = [
  { key: 'j30', daysMin: 29, daysMax: 31 },
  { key: 'j7',  daysMin: 6,  daysMax: 8  },
  { key: 'j1',  daysMin: 0,  daysMax: 2  },
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

    const now = Date.now();
    const results = { milestones: {}, totalSent: 0, totalFailed: 0 };

    for (const m of MILESTONES) {
      const dMin = new Date(now + m.daysMin * 86400000).toISOString();
      const dMax = new Date(now + m.daysMax * 86400000).toISOString();

      // Cible : subscriptions actives sur plans annuels (pro_yearly, elite_yearly)
      // dont la fin de periode tombe dans la fenetre milestone.
      const { data: subs, error } = await s
        .from('subscriptions')
        .select('user_id, plan, current_period_end, renewal_notice_sent_at')
        .eq('status', 'active')
        .in('plan', ['pro_yearly', 'elite_yearly'])
        .gte('current_period_end', dMin)
        .lte('current_period_end', dMax);

      if (error) {
        console.error('[yearly-renewal-notice] db error', m.key, error);
        results.milestones[m.key] = { error: error.message };
        continue;
      }
      if (!subs || subs.length === 0) {
        results.milestones[m.key] = { candidates: 0, sent: 0 };
        continue;
      }

      let sent = 0;
      let skipped = 0;
      let failed = 0;

      for (const sub of subs) {
        // Idempotence : verifie si ce milestone a deja ete envoye
        const sentMilestones = (sub.renewal_notice_sent_at || '').split(',').filter(Boolean);
        if (sentMilestones.includes(m.key)) {
          skipped++;
          continue;
        }

        try {
          const { data: profile } = await s
            .from('profiles')
            .select('faceit_nickname')
            .eq('id', sub.user_id)
            .maybeSingle();
          const { data: userData } = await s.auth.admin.getUserById(sub.user_id);
          const email = userData?.user?.email;
          if (!email) { skipped++; continue; }

          const planLabel = sub.plan?.startsWith('elite') ? 'Elite' : 'Pro';
          const amount = sub.plan === 'elite_yearly' ? '290 EUR TTC' : '79 EUR TTC';
          const renewDate = new Date(sub.current_period_end).toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric',
          });
          const daysLeft = Math.ceil((new Date(sub.current_period_end).getTime() - now) / 86400000);

          const t = tpl.yearlyRenewalNotice({
            nickname: profile?.faceit_nickname || email.split('@')[0],
            planLabel, renewDate, daysLeft, amount,
          });
          const result = await sendEmail({ to: email, subject: t.subject, html: t.html, text: t.text });
          if (result.error) throw new Error(result.error);

          // Flag idempotence : append ce milestone
          const newFlag = [...sentMilestones, m.key].join(',');
          await s.from('subscriptions')
            .update({ renewal_notice_sent_at: newFlag })
            .eq('user_id', sub.user_id)
            .catch(() => {});

          sent++;
        } catch (e) {
          failed++;
          console.error(`[yearly-renewal-notice] ${m.key} failed for`, sub.user_id, e.message);
        }
      }

      results.milestones[m.key] = { candidates: subs.length, sent, skipped, failed };
      results.totalSent += sent;
      results.totalFailed += failed;
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('[yearly-renewal-notice] cron error:', err);
    return res.status(500).json({ error: err.message });
  }
};
