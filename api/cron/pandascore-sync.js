// api/cron/pandascore-sync.js
// Cron Vercel quotidien qui importe les derniers matchs CS2 pros depuis PandaScore.
// Schedule : 0 6 * * *  (6h UTC = 7h/8h Paris)
//
// Securise par Vercel CRON_SECRET : Vercel envoie automatiquement un header
// Authorization: Bearer <CRON_SECRET> lors de l'execution des crons.
//
// Config env requise :
//   PANDASCORE_API_TOKEN  (token PandaScore, free tier 1000 req/mois)
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   CRON_SECRET           (auto-genere par Vercel pour secu)

const { createClient } = require('@supabase/supabase-js');

const PS_BASE = 'https://api.pandascore.co';
const DEFAULT_LIMIT = 20;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Rate-limit doux : 500ms entre 2 requetes PandaScore (respecte leur quota)
let _lastReq = 0;
async function psGet(path, params = {}) {
  const now = Date.now();
  const wait = Math.max(0, 500 - (now - _lastReq));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastReq = Date.now();

  const qs = new URLSearchParams(params).toString();
  const url = `${PS_BASE}${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${process.env.PANDASCORE_API_TOKEN}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PandaScore ${path} : ${res.status} ${body.slice(0, 100)}`);
  }
  return res.json();
}

function cleanMapName(n) {
  if (!n) return 'Unknown';
  const stripped = String(n).replace(/^de_/i, '').replace(/_/g, ' ');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
}

function computeRating(stats) {
  if (!stats) return 0;
  const k = stats.kills || 0;
  const d = stats.deaths || 0;
  const a = stats.assists || 0;
  return Math.max(0, Math.min(2.5, parseFloat(((k + a * 0.5 - d * 0.5) / 20).toFixed(2))));
}

async function upsertEvent(s, tournament) {
  if (!tournament) return null;
  const name = tournament.name || 'Unknown';
  const short = tournament.slug || tournament.name?.slice(0, 60) || 'unk';
  const { data: existing } = await s.from('pro_events').select('id').eq('short_name', short).maybeSingle();
  if (existing) return existing.id;
  const { data: inserted } = await s.from('pro_events').insert({
    name, short_name: short,
    tier: tournament.tier ? String(tournament.tier) : null,
    start_date: tournament.begin_at ? tournament.begin_at.slice(0, 10) : null,
    end_date: tournament.end_at ? tournament.end_at.slice(0, 10) : null,
  }).select('id').single();
  return inserted?.id || null;
}

async function importMatch(s, psMatchId) {
  const psMatch = await psGet(`/csgo/matches/${psMatchId}`);
  const opponents = psMatch.opponents || [];
  const teamA = opponents[0]?.opponent?.name || 'TBD';
  const teamB = opponents[1]?.opponent?.name || 'TBD';
  const teamAId = opponents[0]?.opponent?.id;
  const teamBId = opponents[1]?.opponent?.id;
  const resultA = psMatch.results?.find(r => r.team_id === teamAId)?.score ?? 0;
  const resultB = psMatch.results?.find(r => r.team_id === teamBId)?.score ?? 0;

  let winner = null;
  if (psMatch.winner_id === teamAId) winner = 'a';
  else if (psMatch.winner_id === teamBId) winner = 'b';
  else if (resultA > resultB) winner = 'a';
  else if (resultB > resultA) winner = 'b';

  const eventId = await upsertEvent(s, psMatch.tournament);

  // Supprime si existant
  const { data: existing } = await s.from('pro_matches').select('id').eq('pandascore_match_id', psMatchId).maybeSingle();
  if (existing) await s.from('pro_matches').delete().eq('id', existing.id);

  const { data: match } = await s.from('pro_matches').insert({
    event_id: eventId,
    stage: psMatch.match_type || null,
    format: psMatch.number_of_games ? `BO${psMatch.number_of_games}` : null,
    team_a: teamA, team_b: teamB,
    team_a_logo: opponents[0]?.opponent?.image_url || null,
    team_b_logo: opponents[1]?.opponent?.image_url || null,
    team_a_score: resultA, team_b_score: resultB, winner,
    match_date: psMatch.begin_at || psMatch.scheduled_at || null,
    pandascore_match_id: psMatchId, source: 'pandascore',
    demo_available: false,
  }).select('id').single();
  if (!match) throw new Error('Insert match failed');

  let bestPlayer = null, bestRating = 0, mapsInserted = 0, totalPlayers = 0;

  for (let i = 0; i < (psMatch.games || []).length; i++) {
    const g = psMatch.games[i];
    if (!g.finished) continue;
    let gameDetail;
    try { gameDetail = await psGet(`/csgo/games/${g.id}`); }
    catch (e) { console.warn('  game fetch failed', g.id, e.message); continue; }

    const resA = gameDetail.results?.find(r => r.team_id === teamAId)?.score ?? gameDetail.results?.[0]?.score ?? 0;
    const resB = gameDetail.results?.find(r => r.team_id === teamBId)?.score ?? gameDetail.results?.[1]?.score ?? 0;
    const mapName = cleanMapName(gameDetail.map?.name);

    const { data: mapRow } = await s.from('pro_match_maps').insert({
      match_id: match.id,
      map_order: i + 1,
      map_name: mapName,
      team_a_score: resA, team_b_score: resB,
      duration_min: gameDetail.length ? Math.round(gameDetail.length / 60) : null,
      pandascore_game_id: gameDetail.id,
    }).select('id').single();
    if (!mapRow) continue;
    mapsInserted++;

    for (const p of (gameDetail.players || [])) {
      if (!p.player) continue;
      const stats = p.stats || {};
      const rating = computeRating(stats);
      const isTeamA = (p.opponent_id || p.team_id) === teamAId;
      await s.from('pro_match_players').insert({
        match_map_id: mapRow.id,
        nickname: p.player.name || 'unknown',
        team: isTeamA ? 'a' : 'b',
        country: p.player.nationality || null,
        kills: stats.kills || 0,
        deaths: stats.deaths || 0,
        assists: stats.assists || 0,
        adr: null, kast_pct: null,
        hltv_rating: rating,
        first_kills: stats.first_kills || 0,
        first_deaths: stats.first_deaths || 0,
      });
      totalPlayers++;
      if (rating > bestRating) { bestRating = rating; bestPlayer = p.player.name; }
    }
  }

  if (bestPlayer) {
    await s.from('pro_matches').update({ best_player: bestPlayer, best_rating: bestRating }).eq('id', match.id);
  }
  return { matchId: match.id, mapsInserted, totalPlayers, bestPlayer };
}

module.exports = async function handler(req, res) {
  // Auth : Vercel Cron envoie Authorization: Bearer <CRON_SECRET>
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (expected && auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.PANDASCORE_API_TOKEN) {
    return res.status(503).json({ error: 'PANDASCORE_API_TOKEN non configure' });
  }

  const startedAt = Date.now();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));

  try {
    const s = sb();

    // Fetch les N derniers matchs termines
    const recent = await psGet('/csgo/matches/past', {
      per_page: Math.min(100, limit * 2),
      sort: '-begin_at',
      'filter[status]': 'finished',
    });

    // Filtre ceux deja en DB
    const ids = recent.map(m => m.id);
    const { data: existing } = await s
      .from('pro_matches').select('pandascore_match_id')
      .in('pandascore_match_id', ids);
    const existingSet = new Set((existing || []).map(r => parseInt(r.pandascore_match_id, 10)));
    const toImport = recent.filter(m => !existingSet.has(m.id)).slice(0, limit);

    const results = { imported: 0, failed: 0, errors: [] };
    for (const m of toImport) {
      try {
        const r = await importMatch(s, m.id);
        results.imported++;
        console.log(`[cron] ✓ ${r.matchId} (${r.mapsInserted} maps, ${r.totalPlayers} players)`);
      } catch (e) {
        results.failed++;
        results.errors.push({ id: m.id, error: e.message.slice(0, 200) });
        console.error(`[cron] × ${m.id} : ${e.message}`);
      }
    }

    const durationMs = Date.now() - startedAt;
    return res.status(200).json({
      ok: true,
      duration_ms: durationMs,
      discovered: recent.length,
      already_in_db: existingSet.size,
      imported: results.imported,
      failed: results.failed,
      errors: results.errors,
    });
  } catch (err) {
    console.error('[cron] fatal :', err.message);
    return res.status(500).json({ error: 'Erreur serveur', message: err.message });
  }
};
