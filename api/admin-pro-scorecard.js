// api/admin-pro-scorecard.js
// Admin-only : ajoute des scorecards par joueur sur un match existant.
// Prend en entree le texte brut copie depuis la page stats HLTV
// (table scoreboard) et parse les stats par joueur.
//
// POST /api/admin-pro-scorecard
//   Body: {
//     match_id: uuid,
//     scorecards: [
//       {
//         map_order: 1,
//         team_a_text: "ZywOo\t30 (17)\t3 (1)\t14\t+16\t95.2\t85.2%\t1.75\n...",
//         team_b_text: "KSCERATO\t25\t..."
//       },
//       ...
//     ]
//   }
//
// Format HLTV scoreboard attendu (chaque ligne = 1 joueur) :
// nickname  K(HS)  A(F)  D  +/-  ADR  KAST%  Rating
// Les flags pays sont optionnels (prefix avant le nickname).

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

// ── Parser scorecard HLTV (TSV copie depuis la page stats) ──────────────
// Accepte :
//   - TSV (tab-separated, ce que tu obtiens en copiant la table depuis Chrome)
//   - Lignes avec 2+ spaces entre colonnes
// Retourne : [{nickname, kills, deaths, assists, adr, kast_pct, hltv_rating}, ...]
function parseScorecard(text) {
  if (!text || !text.trim()) return [];
  const lines = String(text).split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const players = [];

  // Strip header line si detecte (mots-cles K, D, A, ADR, KAST, Rating)
  const headerRe = /^(player|joueur)?.*\bK\b.*\b(D|ADR|KAST|Rating)\b/i;

  for (const line of lines) {
    if (headerRe.test(line)) continue; // skip header

    // Split par tab ou 2+ espaces
    const cols = line.split(/\t|\s{2,}/).map(c => c.trim()).filter(Boolean);
    if (cols.length < 6) continue; // pas assez de colonnes pour un scorecard

    // Parse : col 0 = nickname (avec eventuellement flag pays en prefixe)
    // On isole le nickname : dernier mot avant la zone stats (numerique)
    // HLTV ajoute parfois un flag emoji ou texte "de" avant le nom
    let nickname = cols[0];
    // Si la "colonne 0" contient plusieurs mots (genre "🇫🇷 ZywOo"), prendre le dernier
    const nickParts = nickname.split(/\s+/).filter(Boolean);
    nickname = nickParts[nickParts.length - 1];

    // Extract le premier nombre (kills parfois formate "30 (17)")
    const firstNum = (s) => {
      const m = String(s).match(/(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    };

    const kills = firstNum(cols[1]);
    const assists = firstNum(cols[2]);
    const deaths = firstNum(cols[3]);
    // cols[4] = +/- (on skip)

    // Les 3 dernieres colonnes sont ADR, KAST, Rating dans cet ordre
    const adr = parseFloat(String(cols[5]).replace(/[^\d.]/g, '')) || null;
    const kast = parseFloat(String(cols[6]).replace(/[^\d.]/g, '')) || null;
    const rating = parseFloat(String(cols[cols.length - 1]).replace(/[^\d.]/g, '')) || null;

    if (nickname && (kills > 0 || deaths > 0)) {
      players.push({
        nickname,
        kills,
        deaths,
        assists,
        adr,
        kast_pct: kast,
        hltv_rating: rating,
      });
    }
  }

  return players;
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

    const teamAPlayers = parseScorecard(sc.team_a_text || '');
    const teamBPlayers = parseScorecard(sc.team_b_text || '');

    const rows = [
      ...teamAPlayers.map(p => ({ ...p, match_map_id: mapId, team: 'a' })),
      ...teamBPlayers.map(p => ({ ...p, match_map_id: mapId, team: 'b' })),
    ];

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
      results.push({ map_order: sc.map_order, error: 'parsing a produit 0 joueur' });
    }
  }

  return res.status(200).json({ ok: true, inserted, skipped, results });
};
