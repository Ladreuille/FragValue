// api/admin-pro-scorecard.js
// Admin-only : ajoute des scorecards par joueur sur un match existant.
//
// POST /api/admin-pro-scorecard
//   Body: {
//     match_id: uuid,
//     scorecards: [
//       {
//         map_order: 1,
//         team_a_players: [
//           { nickname, kills, deaths, assists, adr, kast_pct, hltv_rating },
//           ...
//         ],
//         team_b_players: [ ... ]
//       },
//       ...
//     ]
//   }
//
// Les donnees sont saisies via un formulaire structure cote admin UI
// (5 joueurs par equipe par map avec champs explicites). Le parsing
// TSV/HLTV a ete retire car trop fragile (HLTV HTML varie trop).

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

// Sanitize un player object envoye par le formulaire.
// Garde seulement les champs attendus, coerce les types.
function sanitizePlayer(p, team) {
  if (!p || !p.nickname) return null;
  const toInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
  const toFloat = (v) => { const n = parseFloat(String(v).replace('%', '').replace(',', '.')); return isNaN(n) ? null : n; };
  return {
    nickname: String(p.nickname).trim().slice(0, 40),
    team,
    country: p.country ? String(p.country).trim().slice(0, 3).toUpperCase() : null,
    kills: toInt(p.kills),
    deaths: toInt(p.deaths),
    assists: toInt(p.assists),
    adr: toFloat(p.adr),
    kast_pct: toFloat(p.kast_pct),
    hltv_rating: toFloat(p.hltv_rating),
    first_kills: p.first_kills != null ? toInt(p.first_kills) : null,
    first_deaths: p.first_deaths != null ? toInt(p.first_deaths) : null,
  };
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAdminUser(req.headers.authorization);
  if (!admin) return res.status(403).json({ error: 'Admin only' });

  const body = await readBody(req);
  const { match_id, scorecards } = body;
  if (!match_id || !Array.isArray(scorecards) || !scorecards.length) {
    return res.status(400).json({ error: 'match_id + scorecards[] requis' });
  }

  const s = sb();

  // Fetch les map rows pour mapper map_order -> match_map_id
  const { data: maps, error: mapsErr } = await s
    .from('pro_match_maps')
    .select('id, map_order')
    .eq('match_id', match_id);
  if (mapsErr || !maps?.length) return res.status(404).json({ error: 'Match ou maps introuvable' });
  const mapIdByOrder = {};
  maps.forEach(m => { mapIdByOrder[m.map_order] = m.id; });

  // Traite chaque scorecard
  let inserted = 0, skipped = 0;
  const results = [];
  for (const sc of scorecards) {
    const mapId = mapIdByOrder[sc.map_order];
    if (!mapId) { skipped++; results.push({ map_order: sc.map_order, error: 'map non trouvee' }); continue; }

    // Remove les players existants de cette map (reset pour permettre re-import propre)
    await s.from('pro_match_players').delete().eq('match_map_id', mapId);

    const teamAPlayers = (sc.team_a_players || [])
      .map(p => sanitizePlayer(p, 'a'))
      .filter(Boolean);
    const teamBPlayers = (sc.team_b_players || [])
      .map(p => sanitizePlayer(p, 'b'))
      .filter(Boolean);

    const rows = [...teamAPlayers, ...teamBPlayers].map(p => ({ ...p, match_map_id: mapId }));

    if (rows.length) {
      const { error } = await s.from('pro_match_players').insert(rows);
      if (error) {
        results.push({ map_order: sc.map_order, error: error.message });
        skipped++;
      } else {
        inserted += rows.length;
        results.push({ map_order: sc.map_order, team_a: teamAPlayers.length, team_b: teamBPlayers.length });
      }
    } else {
      skipped++;
      results.push({ map_order: sc.map_order, error: 'aucun joueur fourni' });
    }
  }

  return res.status(200).json({ ok: true, inserted, skipped, results });
};
