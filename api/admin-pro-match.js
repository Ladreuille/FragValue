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
const ADMIN_EMAILS = ['qdreuillet@gmail.com'];

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getAdminUser(authHeader) {
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await sb().auth.getUser(token);
  const u = data?.user;
  if (!u?.email || !ADMIN_EMAILS.includes(u.email)) return null;
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
// (package retourne {team1, team2, maps: [{name, result: '16-13'}], ...})
function normalizeHltvMatch(data, hltvMatchId, hltvUrl) {
  const teamA = data.team1?.name;
  const teamB = data.team2?.name;
  const scoreA = parseInt(data.team1?.result || 0, 10);
  const scoreB = parseInt(data.team2?.result || 0, 10);
  const winner = scoreA > scoreB ? 'a' : (scoreB > scoreA ? 'b' : null);

  // Parse maps
  const maps = (data.maps || []).map((mp, i) => {
    let a = 0, b = 0;
    if (typeof mp.result === 'string') {
      const parts = mp.result.split(/[-\s]/).filter(Boolean).map(n => parseInt(n, 10));
      a = parts[0] || 0; b = parts[1] || 0;
    }
    return {
      map_order: i + 1,
      map_name: mp.name || 'Unknown',
      team_a_score: a,
      team_b_score: b,
      picked_by: mp.pickedBy === 1 ? 'a' : (mp.pickedBy === 2 ? 'b' : 'decider'),
      duration_min: null,
    };
  });

  return {
    event_name: data.event?.name || 'Event inconnu',
    stage: data.title || null,
    format: data.format?.type || (maps.length === 1 ? 'BO1' : maps.length <= 3 ? 'BO3' : 'BO5'),
    team_a: teamA,
    team_b: teamB,
    team_a_score: scoreA,
    team_b_score: scoreB,
    winner,
    best_player: null,
    best_rating: null,
    match_date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
    hltv_match_id: hltvMatchId,
    maps,
  };
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

async function insertMatch(s, payload) {
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

  // Insert maps
  if (payload.maps?.length) {
    const mapsRows = payload.maps.map(m => ({
      match_id: match.id,
      map_order: m.map_order,
      map_name: m.map_name,
      team_a_score: m.team_a_score,
      team_b_score: m.team_b_score,
      picked_by: m.picked_by || null,
      duration_min: m.duration_min || null,
    }));
    await s.from('pro_match_maps').insert(mapsRows);
  }

  return match.id;
}

async function tryFetchHltv(hltvMatchId) {
  // Le package hltv utilise fetch avec User-Agent browser. Peut etre bloque
  // par Cloudflare selon l'IP. On timeout court pour eviter de bloquer le user.
  try {
    const HLTV = (await import('hltv')).default;
    const timeoutMs = 12000;
    const result = await Promise.race([
      HLTV.getMatch({ id: hltvMatchId }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    return { ok: true, data: result };
  } catch (e) {
    return {
      ok: false,
      error: e.message || 'fetch failed',
      blocked: /cloudflare|403|access denied/i.test(e.message || ''),
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

    // Normalise + insert
    try {
      const normalized = normalizeHltvMatch(fetchResult.data, hltvId, body.hltvUrl);
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
