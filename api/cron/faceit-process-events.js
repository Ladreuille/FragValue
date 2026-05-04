// api/cron/faceit-process-events.js
//
// Worker async qui consomme les events FACEIT entrants (table
// faceit_webhook_events) non encore traites et lance les analyses
// correspondantes.
//
// Strategie :
// 1. Pull les events DEMO_READY / match_demo_ready non-processed (max 20/run).
// 2. Pour chaque event :
//    - Resoudre le user_id FragValue depuis le faceit_player_id (table profiles)
//    - Skip si pas d'utilisateur lie OU pas Pro/Elite (auto-analyse = feature payante)
//    - Demander une signed URL via Downloads API
//    - Upsert match en DB (status='parsing')
//    - Fire le parser Railway
//    - Marquer event.processed_at
// 3. Logger les erreurs par event sans bloquer les autres.
//
// Schedule recommande : toutes les 5 min via vercel.json crons.
//   "crons": [{ "path": "/api/cron/faceit-process-events", "schedule": "*/5 * * * *" }]
//
// Idempotence : la combinaison (event_id UNIQUE) + (matches.faceit_match_id UNIQUE)
// + (event.processed_at != null) garantit qu'un meme event ne sera pas traite 2x.
//
// Limite : max 20 events/run (Vercel timeout 60s, ~3s/event budget). Si la queue
// grossit, on peut augmenter la frequence du cron ou le batch size.

const { createClient } = require('@supabase/supabase-js');

const PARSER_URL = process.env.PARSER_URL || 'https://fragvalue-demo-parser-production.up.railway.app';
const PARSER_SECRET = process.env.PARSER_SECRET || process.env.FACEIT_WEBHOOK_SECRET || '';
const BATCH_SIZE = 20;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async function handler(req, res) {
  // Auth cron : Vercel Cron envoie un header `Authorization: Bearer <CRON_SECRET>`
  // (configure dans vercel.json + env var). En manuel, on accepte aussi
  // ?secret=<CRON_SECRET> dans la query.
  const auth = req.headers.authorization || '';
  const expectedSecret = process.env.CRON_SECRET;
  const querySecret = (req.query?.secret) || '';
  const valid =
    (expectedSecret && auth === `Bearer ${expectedSecret}`) ||
    (expectedSecret && querySecret === expectedSecret);
  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const {
    requestSignedDownloadUrl,
    getMatchDemoUrls,
    FaceitDownloadsError,
  } = require('../_lib/faceit-downloads.js');

  const supabase = sb();
  const startedAt = Date.now();
  const stats = { fetched: 0, processed: 0, skipped: 0, failed: 0, errors: [] };

  try {
    // 1. Pull les events non-processed lies a une demo prete.
    const { data: events, error: queryErr } = await supabase
      .from('faceit_webhook_events')
      .select('id, event_id, event_type, match_id, payload, retry_count')
      .or('event_type.eq.MATCH_DEMO_READY,event_type.eq.match_demo_ready,event_type.eq.DEMO_READY')
      .is('processed_at', null)
      .lt('retry_count', 5)  // skip les events qui ont deja foire 5 fois
      .order('received_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (queryErr) {
      console.error('[faceit-process-events] query error:', queryErr);
      return res.status(500).json({ error: queryErr.message });
    }

    stats.fetched = events?.length || 0;
    if (!events || events.length === 0) {
      return res.status(200).json({ ok: true, ...stats, took_ms: Date.now() - startedAt });
    }

    // 2. Process chaque event (sequentiel pour ne pas saturer le parser Railway).
    for (const ev of events) {
      const matchId = ev.match_id || ev.payload?.payload?.match_id || ev.payload?.match_id;
      if (!matchId) {
        stats.skipped++;
        await markProcessed(supabase, ev.id, 'no match_id in payload');
        continue;
      }

      try {
        // Resolution user_id : d'abord chercher si un user FragValue est lie au player FACEIT.
        // Le payload FACEIT inclut typiquement le faceit_player_id dans
        // payload.players[] ou payload.payload.player_id selon l'event.
        const faceitPlayerId =
          ev.payload?.payload?.player_id ||
          ev.payload?.player_id ||
          ev.payload?.payload?.players?.[0]?.id ||
          null;

        let userId = null;
        if (faceitPlayerId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id, plan')
            .eq('faceit_player_id', faceitPlayerId)
            .maybeSingle();
          // Auto-analyse = feature payante (Pro / Elite). Free users skip
          // pour ne pas burn leur quota sans leur consentement.
          if (profile && (profile.plan === 'pro' || profile.plan === 'elite' || profile.plan === 'team')) {
            userId = profile.id;
          }
        }

        if (!userId) {
          // Aucun user FragValue lie -> on enregistre le match comme "available
          // for re-processing if user signs up later" mais on ne fire pas le parser.
          stats.skipped++;
          await markProcessed(supabase, ev.id, 'no linked Pro/Elite user');
          continue;
        }

        // Verifie si le match a deja ete analyse (idempotence cross-source :
        // l'user a peut-etre deja upload manuellement le .dem)
        const { data: existing } = await supabase
          .from('matches')
          .select('id, status')
          .eq('faceit_match_id', matchId)
          .maybeSingle();
        if (existing && (existing.status === 'completed' || existing.status === 'parsing')) {
          stats.skipped++;
          await markProcessed(supabase, ev.id, `already ${existing.status}`);
          continue;
        }

        // Resolve demo_url + signed URL.
        const meta = await getMatchDemoUrls(matchId);
        const resourceUrl = meta.demo_urls?.[0];
        if (!resourceUrl) {
          stats.skipped++;
          await markProcessed(supabase, ev.id, 'no demo_url available yet');
          continue;
        }

        const signedUrl = await requestSignedDownloadUrl(resourceUrl);

        // Upsert match en DB.
        const { error: upsertErr } = await supabase
          .from('matches')
          .upsert({
            id: matchId,
            faceit_match_id: matchId,
            user_id: userId,
            status: 'parsing',
            demo_url: signedUrl,
            map: meta.map || null,
            error_message: null,
          }, { onConflict: 'faceit_match_id' });
        if (upsertErr) throw new Error(`DB upsert failed: ${upsertErr.message}`);

        // Fire parser Railway.
        const parserRes = await fetch(`${PARSER_URL}/process-match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${PARSER_SECRET}`,
          },
          body: JSON.stringify({ matchId, demoUrl: signedUrl }),
        });
        if (!parserRes.ok) {
          const txt = await parserRes.text().catch(() => '');
          console.warn(`[faceit-process-events] parser non-200 for ${matchId}: ${parserRes.status} ${txt.slice(0, 200)}`);
          // On ne fail pas l'event : le row est 'parsing', l'user verra le retry button
        }

        // Track source = auto (vs user manual) pour analytics.
        await supabase.from('match_source_log').insert({
          user_id: userId,
          match_id: matchId,
          source: 'faceit_webhook_auto',
          created_at: new Date().toISOString(),
        }).catch(() => {});

        await markProcessed(supabase, ev.id, null);
        stats.processed++;
      } catch (err) {
        stats.failed++;
        const errMsg = err instanceof FaceitDownloadsError
          ? `[${err.code || err.status}] ${err.message}`
          : err.message;
        stats.errors.push({ event_id: ev.event_id, match_id: matchId, error: errMsg });
        console.error(`[faceit-process-events] event ${ev.event_id} failed:`, errMsg);

        // Increment retry_count et ne pas marquer processed_at (will retry next run).
        // Si retry_count >= 5, le filtre du SELECT exclura cet event aux prochains runs.
        await supabase
          .from('faceit_webhook_events')
          .update({
            retry_count: (ev.retry_count || 0) + 1,
            error_message: errMsg.slice(0, 500),
          })
          .eq('id', ev.id)
          .catch(() => {});
      }
    }

    return res.status(200).json({ ok: true, ...stats, took_ms: Date.now() - startedAt });
  } catch (err) {
    console.error('[faceit-process-events] cron error:', err);
    return res.status(500).json({ error: err.message, ...stats });
  }
};

async function markProcessed(supabase, eventId, errorMessage) {
  await supabase
    .from('faceit_webhook_events')
    .update({
      processed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq('id', eventId)
    .catch((e) => {
      console.warn('[faceit-process-events] markProcessed failed:', e?.message);
    });
}
