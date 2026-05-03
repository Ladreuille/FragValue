// api/admin-pro-match.js
// Admin-only : ingestion de matchs pros pour Pro Demos Viewer.
//
// POST /api/admin-pro-match
//   Body options :
//     1. { hltvUrl: "https://www.hltv.org/matches/2383803/..." }
//        → Tente auto-fetch via hltv npm package (peut echouer : Cloudflare)
//     2. { manual: true, event, stage, format, team_a, team_b, scores,
//          winner, match_date, maps: [...], best_player, best_rating }
//        → Insertion manuelle
//
// GET /api/admin-pro-match
//   ?limit=50 → Liste les derniers matchs + jobs d'ingestion
//
// DELETE /api/admin-pro-match?id=<match_uuid>
//   Supprime un match (cascade sur maps/players/jobs)

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const { ADMIN_EMAILS } = require('./_lib/subscription');

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getAdminUser(authHeader) {
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await sb().auth.getUser(token);
  const u = data?.user;
  if (!u?.email || !ADMIN_EMAILS.includes((u.email||"").toLowerCase().trim())) return null;
  return u;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// Extrait l'ID depuis une URL HLTV : /matches/2383803/...
function parseHltvId(url) {
  if (!url) return null;
  const m = String(url).match(/\/matches\/(\d+)\//);
  return m ? parseInt(m[1], 10) : null;
}

// Mapping hltv package → notre schema DB
// Structure reelle du package :
// {
//   team1: {name, id, rank}, team2: {...}, winnerTeam: {name, id},
//   maps: [{name, result: {team1TotalRounds, team2TotalRounds, halfResults}, statsId}],
//   event: {name, id}, date: unix_ms, format: {type: 'bo3'|...},
//   players: {team1: [{name, id}], team2: [...]},  // roster uniquement
//   playerOfTheMatch, vetoes, ...
// }
function normalizeHltvMatch(data, hltvMatchId, hltvUrl) {
  const teamA = data.team1?.name || 'Team A';
  const teamB = data.team2?.name || 'Team B';

  // Score series = count maps won par equipe
  const mapsRaw = data.maps || [];
  const playedMaps = mapsRaw.filter(m => m.result && !isNaN(m.result.team1TotalRounds));
  const scoreA = playedMaps.filter(m => m.result.team1TotalRounds > m.result.team2TotalRounds).length;
  const scoreB = playedMaps.filter(m => m.result.team2TotalRounds > m.result.team1TotalRounds).length;

  // Winner : si le package fournit winnerTeam, on l'utilise
  let winner = null;
  if (data.winnerTeam?.name === teamA) winner = 'a';
  else if (data.winnerTeam?.name === teamB) winner = 'b';
  else if (scoreA > scoreB) winner = 'a';
  else if (scoreB > scoreA) winner = 'b';

  // Maps normalisees
  const vetoesByMap = new Map();
  (data.vetoes || []).forEach(v => {
    if (v.type === 'picked' && v.map && v.team?.name) {
      const pickedBy = v.team.name === teamA ? 'a' : v.team.name === teamB ? 'b' : null;
      vetoesByMap.set(v.map, pickedBy);
    } else if (v.type === 'leftover' && v.map) {
      vetoesByMap.set(v.map, 'decider');
    }
  });

  // Strip le prefixe "de_" que le package retourne (ex: "de_overpass" -> "Overpass")
  const cleanMapName = (n) => {
    if (!n) return 'Unknown';
    const stripped = String(n).replace(/^de_/i, '');
    return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
  };
  const maps = playedMaps.map((mp, i) => {
    return {
      map_order: i + 1,
      map_name: cleanMapName(mp.name),
      team_a_score: mp.result.team1TotalRounds || 0,
      team_b_score: mp.result.team2TotalRounds || 0,
      picked_by: vetoesByMap.get(mp.name) || null,
      duration_min: null,
      stats_id: mp.statsId || null, // pour le fetch per-map apres
    };
  });

  // Format : 'bo1' | 'bo3' | 'bo5' → 'BO1' | 'BO3' | 'BO5'
  const formatStr = String(data.format?.type || '').toUpperCase()
    || (maps.length === 1 ? 'BO1' : maps.length <= 3 ? 'BO3' : 'BO5');

  // Date : package retourne unix ms
  const matchDate = data.date ? new Date(Number(data.date)).toISOString() : new Date().toISOString();

  // MVP
  const mvp = data.playerOfTheMatch?.name || null;

  // Stage (title) : peut etre "Grand Final", "Upper Bracket Semi", etc.
  const stage = (data.title && data.title.length < 80) ? data.title : null;

  return {
    event_name: data.event?.name || 'Event inconnu',
    stage,
    format: formatStr,
    team_a: teamA,
    team_b: teamB,
    team_a_score: scoreA,
    team_b_score: scoreB,
    winner,
    best_player: mvp,
    best_rating: null, // rempli apres via getMatchMapStats si dispo
    match_date: matchDate,
    hltv_match_id: hltvMatchId,
    maps,
  };
}

// Fetch per-map stats pour populer pro_match_players
async function fetchMapStats(HLTV, statsId) {
  if (!statsId) return null;
  try {
    const data = await Promise.race([
      HLTV.getMatchMapStats({ id: statsId }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout after 12s')), 12000)),
    ]);
    // Log succes avec nb de players trouves pour diagnostic
    const t1Count = data?.playerStats?.team1?.length || 0;
    const t2Count = data?.playerStats?.team2?.length || 0;
    console.log('fetchMapStats ok statsId=' + statsId + ' team1=' + t1Count + ' team2=' + t2Count);
    return data;
  } catch (e) {
    // Log verbeux explicite avec status et type d'erreur
    const msg = e.message || String(e);
    console.warn('fetchMapStats FAIL statsId=' + statsId + ' error=' + msg.slice(0, 300));
    return null;
  }
}

async function upsertEvent(s, eventName) {
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

async function insertMatch(s, payload, teamsA, teamsB) {
  const eventId = await upsertEvent(s, payload.event_name);
  if (!eventId) throw new Error('Impossible de créer/trouver l\'event');

  const { data: match, error: matchErr } = await s.from('pro_matches').insert({
    event_id: eventId,
    stage: payload.stage,
    format: payload.format,
    team_a: payload.team_a,
    team_b: payload.team_b,
    team_a_score: payload.team_a_score,
    team_b_score: payload.team_b_score,
    winner: payload.winner,
    best_player: payload.best_player,
    best_rating: payload.best_rating,
    match_date: payload.match_date,
    hltv_match_id: payload.hltv_match_id,
    demo_available: false,
  }).select('id').single();
  if (matchErr || !match) throw new Error('Insert match failed: ' + (matchErr?.message || 'unknown'));

  // Insert maps (chacune avec stats per-player si dispo)
  const mapIds = [];
  if (payload.maps?.length) {
    for (const m of payload.maps) {
      const { data: mapRow, error: mapErr } = await s.from('pro_match_maps').insert({
        match_id: match.id,
        map_order: m.map_order,
        map_name: m.map_name,
        team_a_score: m.team_a_score,
        team_b_score: m.team_b_score,
        picked_by: m.picked_by || null,
        duration_min: m.duration_min || null,
      }).select('id').single();
      if (mapErr || !mapRow) continue;
      mapIds.push({ id: mapRow.id, map_order: m.map_order, stats: m.players_stats });

      // Insert players per map si on a les stats fetchees via getMatchMapStats
      if (m.players_stats?.team1?.length || m.players_stats?.team2?.length) {
        const playerRows = [];
        for (const p of (m.players_stats.team1 || [])) {
          playerRows.push({
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
          playerRows.push({
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
        if (playerRows.length) await s.from('pro_match_players').insert(playerRows);
      }
    }
  }

  return match.id;
}

async function tryFetchHltv(hltvMatchId) {
  // Le package hltv utilise fetch avec User-Agent browser. Peut etre bloque
  // par Cloudflare selon l'IP. On timeout court pour eviter de bloquer le user.
  try {
    // Le module est CJS avec exports.default = hltvInstance.
    // require().default nous donne directement l'instance avec getMatch.
    const HLTV = require('hltv').default;
    if (!HLTV || typeof HLTV.getMatch !== 'function') {
      return { ok: false, error: 'package hltv mal charge : getMatch indisponible' };
    }
    const timeoutMs = 12000;
    const result = await Promise.race([
      HLTV.getMatch({ id: hltvMatchId }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    return { ok: true, data: result };
  } catch (e) {
    const msg = e.message || String(e) || 'fetch failed';
    return {
      ok: false,
      error: msg,
      blocked: /cloudflare|403|access denied|restrict/i.test(msg),
    };
  }
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await getAdminUser(req.headers.authorization);
  if (!admin) return res.status(403).json({ error: 'Admin only' });

  const s = sb();

  // ─────── DELETE : supprime un match ──────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query?.id;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'id requis' });
    const { error } = await s.from('pro_matches').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ─────── GET : liste matchs + jobs ───────────────────────────────────
  if (req.method === 'GET') {
    const { data: matches } = await s
      .from('pro_matches')
      .select(`
        id, team_a, team_b, team_a_score, team_b_score, match_date,
        stage, hltv_match_id, pro_events (name, short_name)
      `)
      .order('created_at', { ascending: false })
      .limit(50);
    const { data: jobs } = await s
      .from('pro_ingest_jobs')
      .select('id, hltv_url, hltv_match_id, status, error_msg, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    return res.status(200).json({ matches: matches || [], jobs: jobs || [] });
  }

  // ─────── POST : ingestion ────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await readBody(req);

  // Mode 1 : auto-fetch via HLTV
  if (body.hltvUrl && !body.manual) {
    const hltvId = parseHltvId(body.hltvUrl);
    if (!hltvId) return res.status(400).json({ error: 'URL HLTV invalide (format attendu /matches/<id>/...)' });

    // Crée le job
    const { data: job } = await s
      .from('pro_ingest_jobs')
      .insert({
        hltv_url: body.hltvUrl,
        hltv_match_id: hltvId,
        status: 'fetching',
        created_by: admin.id,
      })
      .select('id').single();

    // Tente le fetch
    const fetchResult = await tryFetchHltv(hltvId);

    if (!fetchResult.ok) {
      // Update job avec l'erreur
      if (job?.id) {
        await s.from('pro_ingest_jobs').update({
          status: 'failed',
          error_msg: fetchResult.error,
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
      return res.status(200).json({
        ok: false,
        jobId: job?.id,
        blocked: fetchResult.blocked,
        error: fetchResult.error,
        message: fetchResult.blocked
          ? 'HLTV bloque les requêtes auto (Cloudflare). Passe en mode manuel ci-dessous.'
          : 'Erreur fetch : ' + fetchResult.error,
      });
    }

    // Normalise + fetch per-map stats + insert
    try {
      const normalized = normalizeHltvMatch(fetchResult.data, hltvId, body.hltvUrl);

      // Fetch stats per map en parallele (plus rapide qu'en sequentiel)
      const HLTV = require('hltv').default;
      const mapStatsResults = await Promise.all(
        normalized.maps.map(m => fetchMapStats(HLTV, m.stats_id))
      );
      // Attache les player stats a chaque map
      normalized.maps.forEach((m, i) => {
        m.players_stats = mapStatsResults[i]?.playerStats || null;
      });

      // Extract best rating du MVP si on l'a dans les stats
      if (normalized.best_player) {
        for (const st of mapStatsResults) {
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

      const matchId = await insertMatch(s, normalized);
      if (job?.id) {
        await s.from('pro_ingest_jobs').update({
          status: 'parsed',
          match_id: matchId,
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
      return res.status(200).json({ ok: true, matchId, preview: normalized });
    } catch (e) {
      if (job?.id) {
        await s.from('pro_ingest_jobs').update({
          status: 'failed',
          error_msg: e.message,
          completed_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
      return res.status(500).json({ error: 'Insert failed', detail: e.message });
    }
  }

  // Mode 2 : insertion manuelle
  if (body.manual) {
    const required = ['event_name', 'team_a', 'team_b', 'match_date'];
    for (const f of required) {
      if (!body[f]) return res.status(400).json({ error: `Champ manquant : ${f}` });
    }
    try {
      const matchId = await insertMatch(s, {
        event_name: body.event_name,
        stage: body.stage || null,
        format: body.format || (body.maps?.length === 1 ? 'BO1' : body.maps?.length <= 3 ? 'BO3' : 'BO5'),
        team_a: body.team_a,
        team_b: body.team_b,
        team_a_score: parseInt(body.team_a_score || 0, 10),
        team_b_score: parseInt(body.team_b_score || 0, 10),
        winner: body.winner || null,
        best_player: body.best_player || null,
        best_rating: body.best_rating ? parseFloat(body.best_rating) : null,
        match_date: body.match_date,
        hltv_match_id: body.hltv_match_id || null,
        maps: body.maps || [],
      });
      // Log job manuel
      await s.from('pro_ingest_jobs').insert({
        hltv_url: body.hltv_url || 'manual',
        hltv_match_id: body.hltv_match_id || null,
        status: 'manual',
        match_id: matchId,
        source: 'admin',
        created_by: admin.id,
        completed_at: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, matchId });
    } catch (e) {
      return res.status(500).json({ error: 'Insert failed', detail: e.message });
    }
  }

  return res.status(400).json({ error: 'Body doit contenir hltvUrl ou manual:true' });
};
