// api/prep-veto.js
// Prep Veto Elite : agrege les stats par map des 5 joueurs adverses
// pour preparer le veto BO1/BO3/BO5.
//
// POST /api/prep-veto
// Body: { opponent: ['nick1', 'nick2', 'nick3', 'nick4', 'nick5'] }
// Auth: Bearer token (Elite plan required)
//
// Response:
// {
//   team: { nicknames: [...], totalMatches: 100, validPlayers: 5 },
//   maps: [
//     {
//       map: 'de_mirage',
//       displayName: 'Mirage',
//       matches: 25,        // nb de matchs joues sur cette map (cumule 5 joueurs)
//       wins: 16,
//       winRate: 64,        // %
//       ctWinRate: 60,
//       tWinRate: 70,
//       avgKd: 1.05,
//       avgAdr: 78,
//       avgKast: 71,
//     },
//     ...
//   ],
//   recommendations: {
//     forceBan: [{ map, reason }, ...],   // leurs meilleures maps a ban
//     forcePick: [{ map, reason }, ...],  // leurs maps faibles a picker
//   }
// }
//
// Strategie : appelle FACEIT API en parallele pour les 5 joueurs (history
// + per-match stats), agrege par map, calcule winrate cumule + side splits.
// Cache 6h en memoire (les rosters bougent vite mais pas les stats des
// joueurs sur les 20 derniers matchs).
//
// ENV REQUIRED : FACEIT_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

const ACTIVE_MAPS = ['de_mirage', 'de_inferno', 'de_dust2', 'de_nuke', 'de_anubis', 'de_vertigo', 'de_ancient', 'de_overpass'];
const MAP_DISPLAY = {
  de_mirage:   'Mirage',
  de_inferno:  'Inferno',
  de_dust2:    'Dust2',
  de_nuke:     'Nuke',
  de_anubis:   'Anubis',
  de_vertigo:  'Vertigo',
  de_ancient:  'Ancient',
  de_overpass: 'Overpass',
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function getCache() {
  const g = globalThis;
  if (!g.__fvPrepVetoCache) g.__fvPrepVetoCache = { entries: new Map() };
  return g.__fvPrepVetoCache;
}

async function resolveUserAndPlan(authHeader) {
  if (!authHeader) return { user: null, plan: 'anon' };
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return { user: null, plan: 'anon' };
    const { data: sub } = await sb.from('subscriptions').select('plan, status').eq('user_id', user.id).single();
    let plan = 'free';
    if (sub && sub.status === 'active') {
      plan = (sub.plan === 'elite' || sub.plan === 'team') ? 'elite' : sub.plan === 'pro' ? 'pro' : 'free';
    }
    return { user, plan };
  } catch (e) {
    console.warn('[prep-veto] auth resolve failed:', e.message);
    return { user: null, plan: 'anon' };
  }
}

// Fetch un joueur : profil (pour playerId) + stats des 20 derniers matchs.
// Retourne null si player introuvable, sinon { nickname, playerId, matches: [...] }.
async function fetchPlayerMatchStats(nickname, apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const BASE = 'https://open.faceit.com/data/v4';
  try {
    const playerRes = await fetch(`${BASE}/players?nickname=${encodeURIComponent(nickname)}`, { headers });
    if (!playerRes.ok) return null;
    const player = await playerRes.json();
    const playerId = player.player_id;
    if (!playerId) return null;

    const statsRes = await fetch(`${BASE}/players/${playerId}/games/cs2/stats?limit=20`, { headers });
    if (!statsRes.ok) return null;
    const data = await statsRes.json();
    const items = data.items || [];

    // Extrait uniquement les champs utiles pour l'agregation
    const matches = items.map(it => {
      const s = it.stats || {};
      return {
        map: (s['Map'] || '').toLowerCase(),       // 'de_mirage'
        result: parseInt(s['Result']) || 0,         // 1 = win, 0 = loss
        rounds: parseInt(s['Rounds']) || 0,
        kd: parseFloat(s['K/D Ratio']) || 0,
        adr: parseFloat(s['ADR']) || 0,
        kast: parseFloat(s['KAST %']) || parseFloat(s['KAST']) || 0,
        // Side rounds : essaye plusieurs cles (FACEIT a varie le naming)
        ctRounds: parseInt(s['Final Score Counter-Terrorist'] || s['CT Rounds'] || 0),
        tRounds:  parseInt(s['Final Score Terrorist'] || s['T Rounds'] || 0),
        // Win contribution side : approximation basee sur Result
        // (on ne sait pas precisement combien de rounds gagnes par side
        // sans payload plus detaille, donc on utilise win/loss + ratio)
      };
    }).filter(m => m.map);

    return { nickname: player.nickname, playerId, matches };
  } catch (e) {
    console.warn(`[prep-veto] fetch ${nickname} failed:`, e.message);
    return null;
  }
}

// Agrege les matchs des 5 joueurs en stats team-level par map.
// Strategy : un match d'un joueur = 1 datapoint pour cette map de l'equipe.
// (Si 2 joueurs jouent ensemble, ca compte 2x mais la moyenne est correcte.)
function aggregateByMap(playersData) {
  const allMatches = playersData.flatMap(p => p.matches);
  const byMap = {};
  for (const m of allMatches) {
    if (!ACTIVE_MAPS.includes(m.map)) continue;
    if (!byMap[m.map]) {
      byMap[m.map] = { matches: 0, wins: 0, kdSum: 0, adrSum: 0, kastSum: 0, ctRoundsSum: 0, tRoundsSum: 0, ctWinSum: 0, tWinSum: 0 };
    }
    const b = byMap[m.map];
    b.matches += 1;
    b.wins += m.result;
    b.kdSum += m.kd;
    b.adrSum += m.adr;
    b.kastSum += m.kast;
    b.ctRoundsSum += m.ctRounds;
    b.tRoundsSum += m.tRounds;
    // Approx side win contribution : on ne peut pas savoir exactement,
    // donc on suppose que les rounds gagnes sont distribues
    // proportionnellement entre les 2 sides selon ctRounds/tRounds.
    // Si match gagne (result=1), on assume ~16 rounds gagnes total.
    const totalRounds = m.ctRounds + m.tRounds;
    if (totalRounds > 0 && m.result === 1) {
      // Win share par side (approximatif, mieux que rien)
      b.ctWinSum += (m.ctRounds / totalRounds);
      b.tWinSum  += (m.tRounds  / totalRounds);
    }
  }
  return Object.entries(byMap).map(([map, b]) => ({
    map,
    displayName: MAP_DISPLAY[map] || map,
    matches: b.matches,
    wins: b.wins,
    winRate: b.matches > 0 ? Math.round((b.wins / b.matches) * 100) : 0,
    ctWinRate: b.ctRoundsSum > 0 ? Math.round((b.ctWinSum / b.matches) * 100) : null,
    tWinRate:  b.tRoundsSum > 0  ? Math.round((b.tWinSum  / b.matches) * 100) : null,
    avgKd:   b.matches > 0 ? +(b.kdSum / b.matches).toFixed(2)   : 0,
    avgAdr:  b.matches > 0 ? Math.round(b.adrSum / b.matches)    : 0,
    avgKast: b.matches > 0 ? Math.round(b.kastSum / b.matches)   : 0,
  })).sort((a, b) => b.matches - a.matches); // tri par maps les plus jouees
}

// Genere les recommandations veto basees sur les stats agregees.
// Logique :
//   - forceBan = leurs 2 meilleures maps (winrate + matches >= 5)
//   - forcePick = leurs 2 maps faibles (winrate < 50% ou peu jouees)
function generateRecommendations(maps) {
  const played = maps.filter(m => m.matches >= 3); // exclure les maps quasi non jouees
  const sortedByWin = [...played].sort((a, b) => b.winRate - a.winRate);
  const top2 = sortedByWin.slice(0, 2);
  const bottom2 = sortedByWin.slice(-2).reverse();
  return {
    forceBan: top2.map(m => ({
      map: m.displayName,
      winRate: m.winRate,
      matches: m.matches,
      reason: `Leur meilleure map (${m.winRate}% sur ${m.matches} matchs).`,
    })),
    forcePick: bottom2.map(m => ({
      map: m.displayName,
      winRate: m.winRate,
      matches: m.matches,
      reason: `Map faible pour eux (${m.winRate}% sur ${m.matches} matchs).`,
    })),
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

  const apiKey = process.env.FACEIT_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FACEIT API non configuree' });

  // ── Auth + plan check ──
  const { user, plan } = await resolveUserAndPlan(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Auth requise' });
  if (plan !== 'elite') {
    return res.status(403).json({
      error: 'Plan Elite requis pour Prep Veto',
      code: 'elite_required',
      currentPlan: plan,
      upgradeUrl: '/pricing.html',
    });
  }

  // ── Validation input ──
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const opponent = Array.isArray(body.opponent) ? body.opponent.filter(n => typeof n === 'string' && n.trim()) : [];
  if (opponent.length < 1) {
    return res.status(400).json({ error: 'Liste opponent vide. Fournis au moins 1 nickname FACEIT.' });
  }
  if (opponent.length > 5) {
    return res.status(400).json({ error: 'Maximum 5 nicknames par equipe adverse.' });
  }

  // ── Cache lookup ──
  const cacheKey = 'opp:v1:' + opponent.map(n => n.toLowerCase().trim()).sort().join(',');
  const cache = getCache();
  const cached = cache.entries.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    return res.status(200).json({ ...cached.data, cached: true });
  }

  // ── Fetch stats des joueurs en parallele ──
  try {
    const playerData = await Promise.all(opponent.map(n => fetchPlayerMatchStats(n.trim(), apiKey)));
    const validPlayers = playerData.filter(Boolean);
    if (validPlayers.length === 0) {
      return res.status(404).json({ error: 'Aucun joueur trouve sur FACEIT.', tried: opponent });
    }

    const totalMatches = validPlayers.reduce((s, p) => s + p.matches.length, 0);
    if (totalMatches < 10) {
      return res.status(200).json({
        team: {
          nicknames: validPlayers.map(p => p.nickname),
          totalMatches,
          validPlayers: validPlayers.length,
        },
        maps: [],
        recommendations: { forceBan: [], forcePick: [] },
        warning: 'Donnees insuffisantes : moins de 10 matchs cumules trouves. Joueurs inactifs ou trop nouveaux.',
      });
    }

    const maps = aggregateByMap(validPlayers);
    const recommendations = generateRecommendations(maps);

    const payload = {
      team: {
        nicknames: validPlayers.map(p => p.nickname),
        totalMatches,
        validPlayers: validPlayers.length,
        invalidNames: opponent.filter(n => !validPlayers.find(p => p.nickname.toLowerCase() === n.toLowerCase())),
      },
      maps,
      recommendations,
      lastUpdated: new Date().toISOString(),
    };

    cache.entries.set(cacheKey, { data: payload, ts: Date.now() });
    // GC : limit cache to 200 entries
    if (cache.entries.size > 200) {
      const oldest = [...cache.entries.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) cache.entries.delete(oldest[0]);
    }

    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    return res.status(200).json(payload);
  } catch (e) {
    console.error('[prep-veto] aggregation failed:', e.message);
    return res.status(500).json({ error: 'Erreur agregation stats' });
  }
};
