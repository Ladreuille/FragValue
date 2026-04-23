#!/usr/bin/env node
/* eslint-disable */
// scripts/import-pandascore.js
// Import des matchs CS2 pros recents depuis l'API PandaScore vers les tables
// pro_matches / pro_match_maps / pro_match_players.
//
// Pourquoi PandaScore et non HLTV :
// - HLTV bloque via Cloudflare Turnstile (CAPTCHA interactif impossible a bypass)
// - PandaScore : API officielle, 1000 req/mois gratuit, data structuree
//
// Usage :
//   node scripts/import-pandascore.js [limit]        # default 20, max 100
//   npm run import:pandascore -- 50
//
// Env requis :
//   PANDASCORE_API_TOKEN   (token free tier sur https://pandascore.co)
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

const fs = require('node:fs');
const path = require('node:path');

// ── Load .env.local si present ──────────────────────────────────────────
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) {
      const val = m[2].replace(/^["']|["']$/g, '');
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  }
}

const TOKEN = process.env.PANDASCORE_API_TOKEN;
const SB_URL = process.env.SUPABASE_URL || 'https://xmyruycvvkmcwysfygcq.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!TOKEN) {
  console.error('× PANDASCORE_API_TOKEN manquant dans .env.local ou env');
  console.error('   Recupere un token gratuit sur https://pandascore.co');
  process.exit(1);
}
if (!SB_KEY) {
  console.error('× SUPABASE_SERVICE_KEY manquant');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const s = createClient(SB_URL, SB_KEY);

const PS_BASE = 'https://api.pandascore.co';

// ── Fetch PandaScore (rate limit auto : 1 req toutes les 500ms) ─────────
let _lastRequest = 0;
async function psGet(path, params = {}) {
  const now = Date.now();
  const wait = Math.max(0, 500 - (now - _lastRequest));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _lastRequest = Date.now();

  const qs = new URLSearchParams(params).toString();
  const url = `${PS_BASE}${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PandaScore ${path} : ${res.status} ${res.statusText} ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── Helpers ──────────────────────────────────────────────────────────────
function cleanMapName(n) {
  if (!n) return 'Unknown';
  const stripped = String(n).replace(/^de_/i, '').replace(/_/g, ' ');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
}

// Upsert event (tournament) et retourne l'UUID
async function upsertEvent(tournament) {
  if (!tournament) return null;
  const name = tournament.name || 'Unknown';
  const short = tournament.slug || tournament.name?.slice(0, 60) || 'unk';
  const tier = tournament.tier || null;

  // Essaye de trouver l'event par slug
  const { data: existing } = await s
    .from('pro_events')
    .select('id')
    .eq('short_name', short)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: inserted } = await s
    .from('pro_events')
    .insert({
      name,
      short_name: short,
      tier: tier ? String(tier) : null,
      start_date: tournament.begin_at ? tournament.begin_at.slice(0, 10) : null,
      end_date: tournament.end_at ? tournament.end_at.slice(0, 10) : null,
    })
    .select('id')
    .single();
  return inserted?.id || null;
}

// Normalise un match PandaScore pour insertion
function normalizeMatch(psMatch) {
  const teamA = psMatch.opponents?.[0]?.opponent?.name || 'TBD';
  const teamB = psMatch.opponents?.[1]?.opponent?.name || 'TBD';
  const teamALogo = psMatch.opponents?.[0]?.opponent?.image_url || null;
  const teamBLogo = psMatch.opponents?.[1]?.opponent?.image_url || null;
  const resultA = psMatch.results?.find(r => r.team_id === psMatch.opponents?.[0]?.opponent?.id)?.score ?? 0;
  const resultB = psMatch.results?.find(r => r.team_id === psMatch.opponents?.[1]?.opponent?.id)?.score ?? 0;

  let winner = null;
  if (psMatch.winner_id === psMatch.opponents?.[0]?.opponent?.id) winner = 'a';
  else if (psMatch.winner_id === psMatch.opponents?.[1]?.opponent?.id) winner = 'b';
  else if (resultA > resultB) winner = 'a';
  else if (resultB > resultA) winner = 'b';

  return {
    pandascore_match_id: psMatch.id,
    source: 'pandascore',
    team_a: teamA,
    team_b: teamB,
    team_a_logo: teamALogo,
    team_b_logo: teamBLogo,
    team_a_score: resultA,
    team_b_score: resultB,
    winner,
    stage: psMatch.match_type || null,
    format: psMatch.number_of_games ? `BO${psMatch.number_of_games}` : null,
    match_date: psMatch.begin_at || psMatch.scheduled_at || null,
    tournament: psMatch.tournament || null,
    games: psMatch.games || [],
  };
}

// Supprime match existant (PandaScore ID) pour re-import propre
async function deleteExistingByPandascoreId(psId) {
  const { data: existing } = await s
    .from('pro_matches')
    .select('id')
    .eq('pandascore_match_id', psId)
    .maybeSingle();
  if (!existing) return false;
  // pro_match_maps et pro_match_players cascadent via FK
  await s.from('pro_matches').delete().eq('id', existing.id);
  return true;
}

// Insert match + maps + players
async function insertMatch(normalized, gamesDetailed) {
  const eventId = await upsertEvent(normalized.tournament);

  // MVP : on calcule apres avoir insere les players
  const { data: match, error: mErr } = await s
    .from('pro_matches')
    .insert({
      event_id: eventId,
      stage: normalized.stage,
      format: normalized.format,
      team_a: normalized.team_a,
      team_b: normalized.team_b,
      team_a_logo: normalized.team_a_logo,
      team_b_logo: normalized.team_b_logo,
      team_a_score: normalized.team_a_score,
      team_b_score: normalized.team_b_score,
      winner: normalized.winner,
      match_date: normalized.match_date,
      pandascore_match_id: normalized.pandascore_match_id,
      source: 'pandascore',
      demo_available: false, // PandaScore ne fournit pas de demo URL
    })
    .select('id')
    .single();
  if (mErr) throw new Error('Insert match : ' + mErr.message);
  const matchId = match.id;

  let mapsInserted = 0;
  let totalPlayers = 0;
  let bestPlayer = null;
  let bestRating = 0;

  for (let i = 0; i < gamesDetailed.length; i++) {
    const g = gamesDetailed[i];
    if (!g || !g.finished) continue;

    const mapName = cleanMapName(g.map?.name);
    const teamAScore = g.results?.find(r => r.team_id === g.winner_id || r.score > 0)?.score;
    // PandaScore game : winner + results by team_id
    const gTeamAScore = g.results?.find(r => r.team_id === normalized.tournament?.opponents?.[0]?.opponent?.id)?.score ?? 0;
    const gTeamBScore = g.results?.find(r => r.team_id === normalized.tournament?.opponents?.[1]?.opponent?.id)?.score ?? 0;

    // Fallback : on iterate on results and assign to team a/b based on position
    const resA = g.results?.[0]?.score ?? 0;
    const resB = g.results?.[1]?.score ?? 0;

    const { data: mapRow, error: mapErr } = await s
      .from('pro_match_maps')
      .insert({
        match_id: matchId,
        map_order: i + 1,
        map_name: mapName,
        team_a_score: resA,
        team_b_score: resB,
        duration_min: g.length ? Math.round(g.length / 60) : null,
        pandascore_game_id: g.id,
      })
      .select('id')
      .single();
    if (mapErr) {
      console.warn(`  ! map ${mapName} insert failed : ${mapErr.message}`);
      continue;
    }
    mapsInserted++;

    // Players stats
    // PandaScore game detail contient players[] avec stats par joueur
    const players = g.players || [];
    for (const p of players) {
      if (!p.player) continue;
      const stats = p.stats || {};
      // Determine team a ou b selon l'opposition
      const opponentId = p.opponent_id || p.team_id;
      const isTeamA = opponentId === normalized.tournament?.opponents?.[0]?.opponent?.id;
      const team = isTeamA ? 'a' : 'b';
      const rating = computeRating(stats);

      await s.from('pro_match_players').insert({
        match_map_id: mapRow.id,
        nickname: p.player.name || 'unknown',
        team,
        country: p.player.nationality || null,
        kills: stats.kills || 0,
        deaths: stats.deaths || 0,
        assists: stats.assists || 0,
        adr: null, // PandaScore ne fournit pas ADR directement
        kast_pct: null,
        hltv_rating: rating,
        first_kills: stats.first_kills || 0,
        first_deaths: stats.first_deaths || 0,
      });
      totalPlayers++;
      if (rating > bestRating) {
        bestRating = rating;
        bestPlayer = p.player.name;
      }
    }
  }

  // Update best_player / best_rating
  if (bestPlayer) {
    await s.from('pro_matches').update({
      best_player: bestPlayer,
      best_rating: bestRating,
    }).eq('id', matchId);
  }

  return { matchId, mapsInserted, totalPlayers, bestPlayer, bestRating };
}

// Rating simple : (kills + assists * 0.5 - deaths * 0.5) / rounds approximatif
// A defaut d'ADR/KAST de PandaScore, on calcule un score relatif.
function computeRating(stats) {
  if (!stats) return 0;
  const k = stats.kills || 0;
  const d = stats.deaths || 0;
  const a = stats.assists || 0;
  const impact = k + (a * 0.5) - (d * 0.5);
  // Normalise approximativement : un bon joueur a 25-30 kills, impact ~25+
  // Rating proche de 1.0 pour impact ~20, 1.3 pour impact ~30, etc.
  return Math.max(0, Math.min(2.5, parseFloat((impact / 20).toFixed(2))));
}

// ── Main ────────────────────────────────────────────────────────────────
async function importOne(psMatchId) {
  console.log(`\n→ PandaScore match #${psMatchId} : fetch detail...`);
  const psMatch = await psGet(`/csgo/matches/${psMatchId}`);
  const normalized = normalizeMatch(psMatch);
  console.log(`  ${normalized.team_a} vs ${normalized.team_b} @ ${psMatch.tournament?.name || '?'}`);
  console.log(`  Score ${normalized.team_a_score}-${normalized.team_b_score} (winner: ${normalized.winner || '-'})`);

  // Fetch games (maps) avec stats detaillees
  const gamesDetailed = [];
  for (const g of normalized.games) {
    if (!g.finished) continue;
    try {
      const detail = await psGet(`/csgo/games/${g.id}`);
      // On attache les opponents du match pour le mapping team a/b
      detail._opponents = psMatch.opponents;
      gamesDetailed.push({ ...detail, _opponents: psMatch.opponents });
    } catch (e) {
      console.warn(`  ! game ${g.id} fetch failed : ${e.message.slice(0, 80)}`);
      gamesDetailed.push(g); // fallback sur la data basique
    }
  }
  // On stash les opponents sur normalized.tournament pour le mapping team a/b
  normalized.tournament = { ...(normalized.tournament || {}), opponents: psMatch.opponents };

  // Delete existant + insert
  const replaced = await deleteExistingByPandascoreId(psMatchId);
  if (replaced) console.log(`  ↻ match existant supprime pour re-import`);

  const result = await insertMatch(normalized, gamesDetailed);
  console.log(`✓ match ${result.matchId} · ${result.mapsInserted} maps · ${result.totalPlayers} joueurs · MVP ${result.bestPlayer || '-'} (rating ${result.bestRating || '-'})`);
  return result;
}

(async () => {
  const args = process.argv.slice(2);
  const limit = Math.min(100, Math.max(1, parseInt(args[0], 10) || 20));

  console.log(`→ Discovery : fetch les ${limit} derniers matchs CS2 termines...`);
  const recentMatches = await psGet('/csgo/matches/past', {
    per_page: Math.min(100, limit * 2),
    sort: '-begin_at',
    'filter[status]': 'finished',
  });
  console.log(`  ${recentMatches.length} matchs recus`);

  // Filtre ceux deja en DB
  const ids = recentMatches.map(m => m.id);
  const { data: existing } = await s
    .from('pro_matches')
    .select('pandascore_match_id')
    .in('pandascore_match_id', ids);
  const existingSet = new Set((existing || []).map(r => parseInt(r.pandascore_match_id, 10)));
  const toImport = recentMatches.filter(m => !existingSet.has(m.id)).slice(0, limit);

  console.log(`  ${existingSet.size} deja en DB, ${toImport.length} a importer`);
  if (!toImport.length) {
    console.log('\nTout est deja a jour.');
    process.exit(0);
  }

  let ok = 0, fail = 0;
  for (const m of toImport) {
    try {
      await importOne(m.id);
      ok++;
    } catch (e) {
      console.error(`× Match ${m.id} echoue : ${e.message.slice(0, 120)}`);
      fail++;
    }
  }

  console.log(`\nTermine : ${ok} reussi(s), ${fail} echoue(s)`);
  process.exit(fail > 0 ? 1 : 0);
})();
