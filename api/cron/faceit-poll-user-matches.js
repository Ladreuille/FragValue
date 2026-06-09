// api/cron/faceit-poll-user-matches.js
//
// Cron multi-user qui poll la FACEIT Data API pour chaque utilisateur Pro/Elite
// avec un faceit_id lie, et inject les nouveaux matchs comme events synthetiques
// dans faceit_webhook_events. Le cron existant faceit-process-events.js prend
// le relais (download via Downloads API, fire parser, etc.).
//
// Pourquoi ce cron ?
//   Le webhook FACEIT (User scope = "My user") n'envoie que les matchs du
//   proprietaire de l'App. Pour couvrir les matchs des autres users
//   FragValue, soit on ajoute chaque GUID dans le scope "Static list of
//   other users" (admin manuel), soit on poll. Le polling est plus
//   scalable et ne depend pas de l'add-user-to-webhook API FACEIT.
//
// Latence : ~5-10 min (vs <1s pour le webhook). Acceptable pour du coaching
// async, pas pour du real-time matchmaking.
//
// Schedule recommande : */10 * * * * (toutes les 10 min). 100 users = ~10s
// d'execution sequentielle, large dans le budget Vercel cron 60s.
//
// Idempotency :
//   - event_id synthetique : 'synth_<match_id>_<finished_at>' (deterministe)
//   - faceit_webhook_events.event_id est UNIQUE → ON CONFLICT DO NOTHING
//   - Si un vrai webhook arrive aussi pour le meme match, on aura 2 events
//     (event_id different : webhook FACEIT vs synth) mais faceit-process-events
//     skip via matches.faceit_match_id UNIQUE check. Pas de double parse.
//
// Securite :
//   - Auth cron via header Bearer CRON_SECRET (idem autres crons)
//   - FACEIT_API_KEY est le token Data API (gratuit, deja set)
//   - Pas besoin de FACEIT_DOWNLOADS_TOKEN ici (ce cron ne download pas
//     la demo, juste detecte les nouveaux matchs)

const { createClient } = require('@supabase/supabase-js');

const FACEIT_DATA_BASE = 'https://open.faceit.com/data/v4';
const BATCH_SIZE = 100;        // max users polled per run
const HISTORY_LIMIT = 10;      // max matches fetched per user (recents)
const INITIAL_BACKFILL_HOURS = 24; // si jamais polled : ne prend que les 24h
const MAX_PARALLEL = 5;        // requests FACEIT API concurrentes (rate-limit safe)

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function getDataApiKey() {
  const k = process.env.FACEIT_API_KEY;
  if (!k) throw new Error('FACEIT_API_KEY not configured');
  return k;
}

// Fetch l'historique de matchs CS2 d'un joueur via Data API.
// Doc : https://docs.faceit.com/getting-started/Guides/data-api/
// Retourne : { items: [{ match_id, finished_at, status, ... }], ... }
async function fetchPlayerHistory(faceitId, fromTimestamp) {
  const apiKey = getDataApiKey();
  // ?from=<unix_ts> filtre les matchs apres ce timestamp (server-side filter
  // qui economise le bandwidth + simplifie la logique cote nous).
  const params = new URLSearchParams({
    game: 'cs2',
    offset: '0',
    limit: String(HISTORY_LIMIT),
  });
  if (fromTimestamp) params.set('from', String(fromTimestamp));

  const url = `${FACEIT_DATA_BASE}/players/${encodeURIComponent(faceitId)}/history?${params.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });

  if (res.status === 404) {
    // Player FACEIT introuvable : le faceit_id stocke est probablement obsolete
    // (compte supprime, renomme, etc.). On log et on skip, pas de retry brutal.
    return { items: [], error: 'player_not_found' };
  }
  if (res.status === 429) {
    // Rate-limited : on skip ce user pour ce run, retry au prochain
    return { items: [], error: 'rate_limited' };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Data API ${res.status}: ${body.slice(0, 200)}`);
  }
  return await res.json();
}

// Insert un event synthetique MATCH_DEMO_READY dans faceit_webhook_events.
// Idempotent : si event_id existe deja, no-op.
async function insertSyntheticEvent(supabase, match, faceitPlayerId) {
  const matchId = match.match_id;
  const finishedAt = match.finished_at || Math.floor(Date.now() / 1000);
  // event_id deterministe pour idempotency cross-runs
  const eventId = `synth_${matchId}_${finishedAt}`;

  const { error } = await supabase
    .from('faceit_webhook_events')
    .insert({
      event_id: eventId,
      event_type: 'MATCH_DEMO_READY',
      match_id: matchId,
      payload: {
        synthetic: true,
        source: 'data_api_polling',
        player_id: faceitPlayerId,
        match: {
          match_id: matchId,
          finished_at: finishedAt,
          status: match.status,
          game_mode: match.game_mode,
          competition_name: match.competition_name,
        },
      },
      signature_valid: true,
      received_at: new Date().toISOString(),
    });

  if (error) {
    // Duplicate key (event_id UNIQUE conflict) = no-op silencieux.
    // Toute autre erreur = log mais ne crash pas le cron.
    if (String(error.message).includes('duplicate key')) return { inserted: false, reason: 'duplicate' };
    console.warn('[faceit-poll] insert synthetic event failed:', error.message);
    return { inserted: false, reason: 'error', error: error.message };
  }
  return { inserted: true };
}

// Poll un user et inject ses nouveaux matchs.
// Retourne { polled: boolean, newMatches: number, error: string|null }
async function pollUser(supabase, profile) {
  const fromTs = profile.faceit_last_polled_at
    ? Math.floor(new Date(profile.faceit_last_polled_at).getTime() / 1000)
    : Math.floor((Date.now() - INITIAL_BACKFILL_HOURS * 3600 * 1000) / 1000);

  let history;
  try {
    history = await fetchPlayerHistory(profile.faceit_id, fromTs);
  } catch (err) {
    return { polled: false, newMatches: 0, error: err.message };
  }

  if (history.error === 'player_not_found') {
    // Marque le poll comme done pour ne pas re-tenter ce user infiniment.
    // (TODO : ajouter une colonne faceit_id_invalid_at pour skip ces users
    // sans les bombarder.)
    await supabase
      .from('profiles')
      .update({ faceit_last_polled_at: new Date().toISOString() })
      .eq('id', profile.id)
      .catch(() => {});
    return { polled: true, newMatches: 0, error: 'player_not_found' };
  }
  if (history.error === 'rate_limited') {
    // N'avance pas le high-water mark : on re-tente au prochain run
    return { polled: false, newMatches: 0, error: 'rate_limited' };
  }

  const items = history.items || [];
  // Filtre client-side : status='finished' uniquement (le Data API retourne
  // parfois 'ongoing' / 'cancelled' meme avec from= filter).
  const finished = items.filter(
    (m) => m.status === 'finished' || m.status === 'FINISHED'
  );

  let newMatches = 0;
  for (const match of finished) {
    // Skip si match deja dans matches table (deja parsed ou en cours)
    const { data: existing } = await supabase
      .from('matches')
      .select('id, status')
      .eq('faceit_match_id', match.match_id)
      .maybeSingle();
    if (existing) continue;

    const result = await insertSyntheticEvent(supabase, match, profile.faceit_id);
    if (result.inserted) newMatches++;
  }

  // Avance le high-water mark a NOW() pour ce user.
  await supabase
    .from('profiles')
    .update({ faceit_last_polled_at: new Date().toISOString() })
    .eq('id', profile.id)
    .catch((e) => console.warn('[faceit-poll] update last_polled_at failed:', e?.message));

  return { polled: true, newMatches, error: null };
}

// Process N users en parallel par chunks de MAX_PARALLEL.
async function processBatched(supabase, profiles) {
  const results = [];
  for (let i = 0; i < profiles.length; i += MAX_PARALLEL) {
    const chunk = profiles.slice(i, i + MAX_PARALLEL);
    const chunkResults = await Promise.all(chunk.map((p) => pollUser(supabase, p)));
    results.push(...chunkResults);
  }
  return results;
}

module.exports = async function handler(req, res) {
  // Auth cron : Bearer header (Vercel Cron) ou ?secret= (manual)
  const auth = req.headers.authorization || '';
  const expectedSecret = process.env.CRON_SECRET;
  const querySecret = (req.query?.secret) || '';
  const valid =
    (expectedSecret && auth === `Bearer ${expectedSecret}`) ||
    (expectedSecret && querySecret === expectedSecret);
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = sb();
  const startedAt = Date.now();
  const stats = { users_polled: 0, users_skipped: 0, new_matches: 0, errors: [] };

  try {
    // 1. Pull les profiles eligibles : Pro/Elite/Team avec faceit_id lie.
    //    On priorise ceux jamais polled (NULL) puis ordre ascending par
    //    faceit_last_polled_at pour eviter qu'un user actif monopolise.
    const { data: profiles, error: profilesErr } = await supabase
      .from('profiles')
      .select('id, faceit_id, subscription_tier, faceit_last_polled_at, faceit_nickname')
      .not('faceit_id', 'is', null)
      .in('subscription_tier', ['pro', 'elite', 'team'])
      .order('faceit_last_polled_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);

    if (profilesErr) {
      console.error('[faceit-poll] profiles query failed:', profilesErr);
      return res.status(500).json({ error: profilesErr.message });
    }

    if (!profiles || profiles.length === 0) {
      return res.status(200).json({ ok: true, ...stats, message: 'no eligible users', took_ms: Date.now() - startedAt });
    }

    const results = await processBatched(supabase, profiles);

    results.forEach((r, i) => {
      if (r.polled) stats.users_polled++;
      else stats.users_skipped++;
      stats.new_matches += r.newMatches;
      if (r.error && r.error !== 'player_not_found') {
        stats.errors.push({ faceit_nickname: profiles[i].faceit_nickname, error: r.error });
      }
    });

    return res.status(200).json({
      ok: true,
      ...stats,
      total_users_eligible: profiles.length,
      took_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[faceit-poll] cron error:', err);
    try {
      const { sendAlert } = require('../_lib/alert.js');
      await sendAlert({
        severity: 'high',
        title: 'Cron faceit-poll-user-matches crashed',
        details: { error: err.message, stack: err.stack?.slice(0, 600), stats },
        source: 'cron/faceit-poll-user-matches',
      });
    } catch (_) {}
    return res.status(500).json({ error: err.message, ...stats });
  }
};
