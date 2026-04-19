#!/usr/bin/env node
/* eslint-disable */
// scripts/import-hltv.js
// CLI local pour ingérer des matchs HLTV en DB (meta + scorecards complets).
//
// Pourquoi en local et pas dans Vercel :
// - HLTV bloque les IPs datacenter via Cloudflare (dont Vercel)
// - Les IPs residentielles (ton Mac, ton VPN perso) passent beaucoup mieux
// - Ce script fait tout : fetch match + fetch stats per-map + insert DB
//
// Usage :
//   1. Configure .env.local avec SUPABASE_URL et SUPABASE_SERVICE_KEY
//      (récupère les valeurs depuis Vercel → Settings → Environment Variables)
//   2. node scripts/import-hltv.js <match_id_ou_url> [...]
//
// Exemples :
//   node scripts/import-hltv.js 2393243
//   node scripts/import-hltv.js https://www.hltv.org/matches/2393243/furia-vs-vitality
//   node scripts/import-hltv.js 2393243 2393244 2393245
//   npm run import:hltv -- 2393243

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

const SB_URL = process.env.SUPABASE_URL || 'https://xmyruycvvkmcwysfygcq.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_KEY) {
  console.error('❌ SUPABASE_SERVICE_KEY manquant.');
  console.error('   Option 1 : cree un fichier .env.local a la racine avec :');
  console.error('     SUPABASE_SERVICE_KEY=eyJ...');
  console.error('   Option 2 : export SUPABASE_SERVICE_KEY=... avant de lancer le script');
  console.error('   Recupere la valeur sur Vercel → Settings → Env Vars');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const HLTV = require('hltv').default;

const s = createClient(SB_URL, SB_KEY);

// ── Helpers ──────────────────────────────────────────────────────────────
function parseIdFromArg(arg) {
  if (/^\d+$/.test(arg)) return parseInt(arg, 10);
  const m = String(arg).match(/\/matches\/(\d+)\//);
  return m ? parseInt(m[1], 10) : null;
}

function cleanMapName(n) {
  if (!n) return 'Unknown';
  const stripped = String(n).replace(/^de_/i, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
}

function normalizeMatch(data, hltvId) {
  const teamA = data.team1?.name || 'Team A';
  const teamB = data.team2?.name || 'Team B';
  const mapsRaw = data.maps || [];
  const playedMaps = mapsRaw.filter(m => m.result && !isNaN(m.result.team1TotalRounds));
  const scoreA = playedMaps.filter(m => m.result.team1TotalRounds > m.result.team2TotalRounds).length;
  const scoreB = playedMaps.filter(m => m.result.team2TotalRounds > m.result.team1TotalRounds).length;

  let winner = null;
  if (data.winnerTeam?.name === teamA) winner = 'a';
  else if (data.winnerTeam?.name === teamB) winner = 'b';
  else if (scoreA > scoreB) winner = 'a';
  else if (scoreB > scoreA) winner = 'b';

  const vetoesByMap = new Map();
  (data.vetoes || []).forEach(v => {
    if (v.type === 'picked' && v.map && v.team?.name) {
      const pickedBy = v.team.name === teamA ? 'a' : v.team.name === teamB ? 'b' : null;
      vetoesByMap.set(v.map, pickedBy);
    } else if (v.type === 'leftover' && v.map) {
      vetoesByMap.set(v.map, 'decider');
    }
  });

  const maps = playedMaps.map((mp, i) => ({
    map_order: i + 1,
    map_name: cleanMapName(mp.name),
    team_a_score: mp.result.team1TotalRounds || 0,
    team_b_score: mp.result.team2TotalRounds || 0,
    picked_by: vetoesByMap.get(mp.name) || null,
    duration_min: null,
    stats_id: mp.statsId || null,
  }));

  const formatStr = String(data.format?.type || '').toUpperCase()
    || (maps.length === 1 ? 'BO1' : maps.length <= 3 ? 'BO3' : 'BO5');

  return {
    event_name: data.event?.name || 'Event inconnu',
    stage: (data.title && data.title.length < 80) ? data.title : null,
    format: formatStr,
    team_a: teamA,
    team_b: teamB,
    team_a_score: scoreA,
    team_b_score: scoreB,
    winner,
    best_player: data.playerOfTheMatch?.name || null,
    best_rating: null,
    match_date: data.date ? new Date(Number(data.date)).toISOString() : new Date().toISOString(),
    hltv_match_id: hltvId,
    maps,
  };
}

async function upsertEvent(eventName) {
  const { data: existing } = await s
    .from('pro_events')
    .select('id')
    .eq('name', eventName)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;
  const shortName = eventName.length > 30 ? eventName.slice(0, 27) + '...' : eventName;
  const { data } = await s
    .from('pro_events')
    .insert({ name: eventName, short_name: shortName, tier: 'A' })
    .select('id').single();
  return data?.id;
}

async function deleteExistingMatch(hltvId) {
  const { data: existing } = await s.from('pro_matches').select('id').eq('hltv_match_id', hltvId).maybeSingle();
  if (existing?.id) {
    await s.from('pro_matches').delete().eq('id', existing.id);
    return true;
  }
  return false;
}

async function insertMatch(normalized) {
  const eventId = await upsertEvent(normalized.event_name);
  if (!eventId) throw new Error('upsertEvent failed');

  const { data: match, error } = await s.from('pro_matches').insert({
    event_id: eventId,
    stage: normalized.stage,
    format: normalized.format,
    team_a: normalized.team_a,
    team_b: normalized.team_b,
    team_a_score: normalized.team_a_score,
    team_b_score: normalized.team_b_score,
    winner: normalized.winner,
    best_player: normalized.best_player,
    best_rating: normalized.best_rating,
    match_date: normalized.match_date,
    hltv_match_id: normalized.hltv_match_id,
    demo_available: false,
  }).select('id').single();
  if (error || !match) throw new Error('insert match: ' + error?.message);

  for (const m of normalized.maps) {
    const { data: mapRow } = await s.from('pro_match_maps').insert({
      match_id: match.id,
      map_order: m.map_order,
      map_name: m.map_name,
      team_a_score: m.team_a_score,
      team_b_score: m.team_b_score,
      picked_by: m.picked_by || null,
      duration_min: m.duration_min || null,
    }).select('id').single();

    if (mapRow && m.players_stats) {
      const rows = [];
      for (const p of (m.players_stats.team1 || [])) {
        rows.push({
          match_map_id: mapRow.id,
          nickname: p.player?.name || 'unknown',
          team: 'a',
          country: null,
          kills: p.kills || 0,
          deaths: p.deaths || 0,
          assists: p.assists || 0,
          adr: p.ADR || null,
          kast_pct: p.KAST || null,
          hltv_rating: p.rating2 || p.rating1 || null,
          first_kills: null,
          first_deaths: null,
        });
      }
      for (const p of (m.players_stats.team2 || [])) {
        rows.push({
          match_map_id: mapRow.id,
          nickname: p.player?.name || 'unknown',
          team: 'b',
          country: null,
          kills: p.kills || 0,
          deaths: p.deaths || 0,
          assists: p.assists || 0,
          adr: p.ADR || null,
          kast_pct: p.KAST || null,
          hltv_rating: p.rating2 || p.rating1 || null,
          first_kills: null,
          first_deaths: null,
        });
      }
      if (rows.length) await s.from('pro_match_players').insert(rows);
    }
  }

  return { matchId: match.id, mapsCount: normalized.maps.length };
}

async function importOne(hltvId) {
  console.log(`\n→ HLTV #${hltvId} : fetch meta...`);
  const match = await HLTV.getMatch({ id: hltvId });
  console.log(`  ${match.team1?.name} vs ${match.team2?.name} · ${match.event?.name} · ${match.maps?.length || 0} maps`);

  const normalized = normalizeMatch(match, hltvId);
  console.log(`  Score : ${normalized.team_a_score}-${normalized.team_b_score} (winner: ${normalized.winner || '-'})`);

  // Fetch stats per-map en parallele
  console.log(`  Fetching scorecards for ${normalized.maps.length} maps...`);
  const statsResults = await Promise.all(
    normalized.maps.map(m =>
      m.stats_id
        ? HLTV.getMatchMapStats({ id: m.stats_id }).catch(e => {
            console.warn(`    ⚠ map ${m.map_name} stats failed: ${e.message.slice(0, 80)}`);
            return null;
          })
        : null
    )
  );
  let totalPlayers = 0;
  normalized.maps.forEach((m, i) => {
    m.players_stats = statsResults[i]?.playerStats || null;
    if (m.players_stats) totalPlayers += (m.players_stats.team1?.length || 0) + (m.players_stats.team2?.length || 0);
  });
  console.log(`  ${totalPlayers} joueurs fetches`);

  // MVP rating si trouve dans les stats
  if (normalized.best_player && statsResults.some(Boolean)) {
    for (const st of statsResults) {
      if (!st?.playerStats) continue;
      const all = [...(st.playerStats.team1 || []), ...(st.playerStats.team2 || [])];
      const mvp = all.find(p => p.player?.name === normalized.best_player);
      if (mvp) {
        const r = mvp.rating2 || mvp.rating1;
        if (r && (!normalized.best_rating || r > normalized.best_rating)) {
          normalized.best_rating = r;
        }
      }
    }
  }

  // Supprime match existant (permet re-import propre)
  const replaced = await deleteExistingMatch(hltvId);
  if (replaced) console.log(`  ↻ match existant supprime pour re-import`);

  const { matchId, mapsCount } = await insertMatch(normalized);
  console.log(`✓ inseré match ${matchId} · ${mapsCount} maps · MVP ${normalized.best_player || '-'} (rating ${normalized.best_rating || '-'})`);
  return { ok: true, matchId };
}

// ── Main ────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log('Usage : node scripts/import-hltv.js <match_id_ou_url> [...]');
    console.log('');
    console.log('Exemples :');
    console.log('  node scripts/import-hltv.js 2393243');
    console.log('  node scripts/import-hltv.js https://www.hltv.org/matches/2393243/furia-vs-vitality');
    console.log('  node scripts/import-hltv.js 2393243 2393244 2393245');
    console.log('  npm run import:hltv -- 2393243');
    process.exit(0);
  }

  let ok = 0, fail = 0;
  for (let i = 0; i < args.length; i++) {
    const id = parseIdFromArg(args[i]);
    if (!id) {
      console.error(`✗ ID invalide : ${args[i]}`);
      fail++;
      continue;
    }
    try {
      await importOne(id);
      ok++;
    } catch (e) {
      console.error(`✗ Match ${id} échoué : ${e.message}`);
      fail++;
    }
    // Rate limit respectueux si plusieurs matchs
    if (i < args.length - 1) {
      console.log('  (attente 2s avant le prochain...)');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\nTerminé : ${ok} réussi(s), ${fail} échoué(s)`);
  process.exit(fail > 0 ? 1 : 0);
})();
