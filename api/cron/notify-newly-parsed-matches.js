// api/cron/notify-newly-parsed-matches.js
//
// Worker cron qui detecte les matchs frais (status='parsed' depuis le dernier
// run) et envoie au user :
//   1) une notification in-app (table `notifications`, badge nav.js .fv-bell)
//   2) un email transactionnel "Diagnostic IA pret" (template demoAnalysisReady)
//
// POURQUOI CE CRON :
//   Avec l'auto-sync FACEIT (webhook DEMO_READY -> cron 5 min -> parser Railway),
//   le parsing se termine ASYNCHRONEMENT et l'user n'est pas forcement sur le
//   site quand status passe a 'parsed'. Sans ce cron, le user ne saurait
//   jamais qu'une analyse est dispo (le frontend notify-demo-analyzed.js ne
//   tire que quand il ouvre heatmap-results.html).
//
// SCHEDULE : toutes les 5 min (aligne sur faceit-process-events pour rester
//   reactif sans burner du quota Vercel function-invocation).
//
// IDEMPOTENCE :
//   On dedup en checkant si une notification 'demo_analyzed' existe deja
//   pour ce match (metadata.demo_id = match.id). Pas atomique mais OK pour
//   notre volume : un meme match ne peut pas etre process en parallele car
//   le cron tourne 1 instance a la fois sur Vercel.
//
// LIMITE :
//   Batch 50 matchs/run (timeout Vercel 60s, budget ~1s/match pour fetch
//   profile + email). Si la queue grossit, augmenter BATCH ou la frequence.

const { createClient } = require('@supabase/supabase-js');

const BATCH_SIZE = 50;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async function handler(req, res) {
  // Auth cron : Vercel Cron envoie un header `Authorization: Bearer <CRON_SECRET>`.
  // En manuel, on accepte aussi ?secret=<CRON_SECRET> dans la query.
  const auth = req.headers.authorization || '';
  const expectedSecret = process.env.CRON_SECRET;
  const querySecret = (req.query?.secret) || '';
  const valid =
    (expectedSecret && auth === `Bearer ${expectedSecret}`) ||
    (expectedSecret && querySecret === expectedSecret);
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = sb();
  const startedAt = Date.now();
  const stats = { fetched: 0, notified: 0, skipped: 0, failed: 0, errors: [] };

  try {
    // 1. Recupere les matchs parses dans la derniere fenetre raisonnable
    //    (7 jours pour rattraper d'eventuels backlogs sans risquer de spammer
    //    des matchs anciens). On filtre les status='parsed' uniquement.
    //    NB : on ne tire PAS demo_data ici car payload massif (jsonb avec
    //    rawEvents + roundsDebug) ; les stats user-specifiques sont dans
    //    match_players (1 row par joueur, dont l'user).
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const { data: matches, error: queryErr } = await supabase
      .from('matches')
      .select('id, user_id, map, parsed_at')
      .eq('status', 'parsed')
      .gte('parsed_at', sevenDaysAgo)
      .order('parsed_at', { ascending: false })
      .limit(BATCH_SIZE * 4);  // overscan : on filtre les deja-notifies cote JS

    if (queryErr) {
      console.error('[notify-newly-parsed] query error:', queryErr);
      return res.status(500).json({ error: queryErr.message });
    }
    stats.fetched = matches?.length || 0;
    if (!matches || matches.length === 0) {
      return res.status(200).json({ ok: true, ...stats, took_ms: Date.now() - startedAt });
    }

    // 2. Filtrer ceux qui n'ont PAS deja une notification 'demo_analyzed' dispatchee
    const matchIds = matches.map(m => m.id);
    const { data: existingNotifs } = await supabase
      .from('notifications')
      .select('metadata')
      .eq('type', 'demo_analyzed')
      .in('user_id', [...new Set(matches.map(m => m.user_id))]);

    const notifiedDemoIds = new Set(
      (existingNotifs || [])
        .map(n => n.metadata?.demo_id)
        .filter(Boolean)
    );
    const toProcess = matches
      .filter(m => !notifiedDemoIds.has(m.id))
      .slice(0, BATCH_SIZE);

    if (toProcess.length === 0) {
      return res.status(200).json({ ok: true, ...stats, took_ms: Date.now() - startedAt });
    }

    // 3. Fetch les emails + nicknames des users impactes en 1 query
    const userIds = [...new Set(toProcess.map(m => m.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, faceit_nickname, subscription_tier')
      .in('id', userIds);
    const profileMap = new Map((profiles || []).map(p => [p.id, p]));

    // Fetch les stats user-specifiques depuis match_players (1 row par
    // (match_id, user_id) du user lui-meme dans le scoreboard).
    const matchIdsToProcess = toProcess.map(m => m.id);
    const { data: mpRows } = await supabase
      .from('match_players')
      .select('match_id, user_id, fv_rating, kast, adr, hs_pct, kills, deaths')
      .in('match_id', matchIdsToProcess)
      .in('user_id', userIds);
    const statsKey = (mid, uid) => `${mid}|${uid}`;
    const statsMap = new Map((mpRows || []).map(r => [statsKey(r.match_id, r.user_id), r]));

    // Recuperer les emails via auth.users (service_role peut)
    const { data: { users: authUsers } = {} } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const emailMap = new Map((authUsers || []).map(u => [u.id, u.email]));

    // 4. Lazy-load helpers email (evite cost de boot si batch vide)
    const tpl = require('../_lib/email-templates.js');
    const { sendEmail } = await import('../_lib/email.js');

    // 5. Process chaque match : insert notification + envoi email (best-effort)
    for (const m of toProcess) {
      try {
        const profile = profileMap.get(m.user_id);
        const email = emailMap.get(m.user_id);
        const userStats = statsMap.get(statsKey(m.id, m.user_id)) || {};
        const fvRating = userStats.fv_rating != null ? userStats.fv_rating : null;
        const kast = userStats.kast != null ? Math.round(userStats.kast) : null;
        const adr = userStats.adr != null ? Math.round(userStats.adr) : null;
        const map = m.map || 'de_cs2';
        const mapShort = String(map).replace(/^de_/, '').toUpperCase();
        const fvRatingFmt = fvRating != null ? parseFloat(fvRating).toFixed(2) : null;

        // ── Title/message contextualises (meme logique que notify-demo-analyzed.js)
        let title, message;
        if (fvRatingFmt != null) {
          const r = parseFloat(fvRatingFmt);
          if (r >= 1.30) {
            title = 'Match excellent';
            message = `FV ${fvRatingFmt} sur ${mapShort}. Tes heatmaps et ton diagnostic Coach IA sont prets a etre consultes.`;
          } else if (r >= 1.10) {
            title = 'Belle performance';
            message = `FV ${fvRatingFmt} sur ${mapShort}. Decouvre tes 3 forces et tes axes d'amelioration.`;
          } else if (r >= 0.90) {
            title = 'Analyse terminee';
            message = `FV ${fvRatingFmt} sur ${mapShort}. Vois tes positions risquees et le plan d'action 7 jours.`;
          } else {
            title = 'Match difficile, tu as des pistes';
            message = `FV ${fvRatingFmt} sur ${mapShort}. Le Coach IA a identifie 4 actions concretes pour rebondir.`;
          }
        } else {
          title = 'Diagnostic pret';
          message = `Ta demo ${mapShort} est analysee. Heatmaps, KPIs et plan d'action te attendent.`;
        }

        // ── Insert notification in-app (bell badge)
        const { error: notifErr } = await supabase.from('notifications').insert({
          user_id: m.user_id,
          type: 'demo_analyzed',
          title: title.slice(0, 200),
          message: message.slice(0, 500),
          action_url: `/heatmap-results.html?id=${m.id}`,
          icon: 'chart',
          metadata: { map, fv_rating: fvRatingFmt, demo_id: m.id, source: 'faceit_auto' },
          read: false,
        });
        if (notifErr) {
          stats.failed++;
          stats.errors.push({ match_id: m.id, error: `notif insert: ${notifErr.message}` });
          continue;
        }

        // ── Send email (best-effort, ne pas fail si plante)
        if (email) {
          try {
            const t = tpl.demoAnalysisReady({
              nickname: profile?.faceit_nickname || email.split('@')[0],
              demoId: m.id,
              map,
              fvRating: fvRatingFmt ? parseFloat(fvRatingFmt) : null,
              kast,
              adr,
              mainAxis: null,
            });
            await sendEmail({ to: email, subject: t.subject, html: t.html, text: t.text });
          } catch (emailErr) {
            console.warn(`[notify-newly-parsed] email failed for match ${m.id}:`, emailErr?.message);
            // On compte quand meme comme notified (notif in-app a marche)
          }
        }

        stats.notified++;
      } catch (err) {
        stats.failed++;
        stats.errors.push({ match_id: m.id, error: err.message });
        console.error(`[notify-newly-parsed] failed for ${m.id}:`, err.message);
      }
    }

    stats.skipped = stats.fetched - stats.notified - stats.failed;
    return res.status(200).json({ ok: true, ...stats, took_ms: Date.now() - startedAt });
  } catch (err) {
    console.error('[notify-newly-parsed] cron error:', err);
    try {
      const { sendAlert } = require('../_lib/alert.js');
      await sendAlert({
        severity: 'high',
        title: 'Cron notify-newly-parsed-matches crashed',
        details: { error: err.message, stack: err.stack?.slice(0, 600), stats },
        source: 'cron/notify-newly-parsed-matches',
      });
    } catch (_) {}
    return res.status(500).json({ error: err.message, ...stats });
  }
};
