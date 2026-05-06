// api/cron/free-day3-followup.js
//
// Email lifecycle : Day 3 follow-up pour les Free users actifs (au moins
// 1 demo analysee) qui n'ont pas upgrade. Levier conversion principal.
//
// Logique :
//   1. SELECT profiles
//      WHERE subscription_tier = 'free'
//        AND created_at BETWEEN NOW() - 4 days AND NOW() - 3 days
//        AND marketing_opt_out = false
//   2. Pour chaque user :
//      - Compte ses demos (si 0 -> skip, pas engage assez)
//      - Recupere son FV Rating moyen depuis demos.fv_rating
//      - Send email day3FollowupFree
//   3. Idempotence via auth.users.user_metadata.day3_followup_sent_at
//      pour eviter renvoi si le cron tourne 2x sur la meme fenetre
//
// Schedule : 1x/jour a 10h CET (`0 10 * * *`)
// Auth : header Authorization: Bearer CRON_SECRET (Vercel cron auto)
//
// Best-effort : logue les fails, ne rate-limite pas Resend (max 30 envois
// /jour vu le volume signups actuel, largement sous le 5/sec ceiling).

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  // Auth header-only (cf. autres crons). Pas de query string pour eviter le
  // leak du token dans les logs.
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase env vars missing' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const startedAt = Date.now();
  const stats = { eligible: 0, sent: 0, skipped_no_demos: 0, skipped_already_sent: 0, failed: 0, errors: [] };

  try {
    // Fenetre J+3 : on cible les users qui se sont inscrits entre
    // NOW - 4j et NOW - 3j (24h de marge pour rattraper les loupés du cron).
    const now = Date.now();
    const minIso = new Date(now - 4 * 86400000).toISOString();
    const maxIso = new Date(now - 3 * 86400000).toISOString();

    const { data: candidates, error: profErr } = await supabase
      .from('profiles')
      .select('id, faceit_nickname, created_at, marketing_opt_out')
      .eq('subscription_tier', 'free')
      .eq('marketing_opt_out', false)
      .gte('created_at', minIso)
      .lt('created_at', maxIso);

    if (profErr) throw new Error(`profiles query: ${profErr.message}`);
    if (!candidates || candidates.length === 0) {
      return res.status(200).json({ ok: true, ...stats, message: 'no candidates in J+3 window', took_ms: Date.now() - startedAt });
    }

    stats.eligible = candidates.length;

    const { sendEmail } = await import('../_lib/email.js');
    const tpl = require('../_lib/email-templates.js');
    const { makeUnsubUrl } = require('../_lib/email-unsub.js');

    for (const profile of candidates) {
      try {
        // Fetch demos count + FV rating moyen
        const { data: demos } = await supabase
          .from('demos')
          .select('fv_rating')
          .eq('user_id', profile.id);

        const demosCount = demos?.length || 0;
        if (demosCount === 0) {
          // Pas de demo = user inscrit mais inactif. On le skip pour pas spammer.
          // Lui envoyer un mail "tu as pas commence" est trop pushy J+3.
          stats.skipped_no_demos++;
          continue;
        }

        // FV Rating moyen (filtre les NULL)
        const ratings = (demos || []).map(d => d.fv_rating).filter(r => typeof r === 'number');
        const fvRating = ratings.length > 0
          ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)
          : null;

        // Idempotence : check user_metadata
        const { data: userData } = await supabase.auth.admin.getUserById(profile.id);
        const userEmail = userData?.user?.email;
        const meta = userData?.user?.user_metadata || {};
        if (meta.day3_followup_sent_at) {
          stats.skipped_already_sent++;
          continue;
        }
        if (!userEmail) {
          stats.skipped_already_sent++; // edge case, on compte pareil
          continue;
        }

        // Build + send email
        const t = tpl.day3FollowupFree({
          nickname: profile.faceit_nickname || userEmail.split('@')[0],
          demosCount,
          fvRating,
        });
        const unsubUrl = makeUnsubUrl(profile.id, 'https://fragvalue.com');

        const result = await sendEmail({
          to: userEmail,
          subject: t.subject,
          html: t.html,
          text: t.text,
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });

        if (result?.error) throw new Error(result.error);

        // Mark sent dans user_metadata pour idempotence
        await supabase.auth.admin.updateUserById(profile.id, {
          user_metadata: { ...meta, day3_followup_sent_at: new Date().toISOString() },
        });

        stats.sent++;
        // Rate limit Resend safe : 200ms entre chaque (5/sec)
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        stats.failed++;
        if (stats.errors.length < 5) {
          stats.errors.push({ user_id: profile.id, error: err?.message });
        }
      }
    }

    const took_ms = Date.now() - startedAt;
    console.log(`[free-day3-followup] eligible=${stats.eligible} sent=${stats.sent} skipped_no_demos=${stats.skipped_no_demos} skipped_already_sent=${stats.skipped_already_sent} failed=${stats.failed} took_ms=${took_ms}`);
    return res.status(200).json({ ok: true, ...stats, took_ms });
  } catch (err) {
    console.error('[free-day3-followup] fatal:', err);
    try {
      const { sendAlert } = require('../_lib/alert.js');
      await sendAlert({
        severity: 'critical',
        title: 'free-day3-followup cron crash',
        source: 'cron/free-day3-followup',
        details: { error: err?.message, stack: (err?.stack || '').slice(0, 600), stats },
      });
    } catch (_) { /* best-effort */ }
    return res.status(500).json({ error: err.message, ...stats });
  }
};
