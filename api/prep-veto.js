// api/prep-veto.js
// Prep Veto Elite : analyse les maps de l'equipe adverse + ton equipe
// pour preparer le veto BO1/BO3/BO5. Accepte des URLs FACEIT ou HLTV
// pour resolver les rosters automatiquement.
//
// POST /api/prep-veto
// Body :
//   - { opponent: ['nick1', ..., 'nick5'] }       (legacy, opponent only)
//   - { opponentUrl, yourTeamUrl }                (URLs FACEIT / HLTV)
//   - { opponent: [...], yourTeam: [...] }        (mix nicks)
//   - { opponentUrl, yourTeam: [...] }            (mix URL + nicks)
// Auth: Bearer token (Elite plan required)
//
// URL formats supportes :
//   - https://www.faceit.com/<lang>/teams/<team_id>      (FACEIT premade team)
//   - https://www.faceit.com/<lang>/players/<nickname>   (1 player FACEIT)
//   - https://www.hltv.org/team/<id>/<slug>              (HLTV team page)
//   - https://www.hltv.org/matches/<id>/<teamA-vs-teamB> (HLTV match page → 2 teams)
//
// Strategie HLTV : pas d'API officielle. On utilise PLAYER_METADATA local
// (60+ pros verifies) pour matcher le slug HLTV au team name -> liste de
// nicks connus. Pour les equipes pas dans nos metadata, retourne erreur
// avec suggestion de paste les nicks manuellement.
//
// Response (mode opponent only, retro-compat) :
// { team, maps, recommendations, lastUpdated }
//
// Response (mode head-to-head si yourTeam fournie) :
// { opponent: { team, maps }, yourTeam: { team, maps }, recommendations, h2h }
//
// ENV : FACEIT_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

const { requireElite } = require('./_lib/subscription');

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
const FACEIT_BASE = 'https://open.faceit.com/data/v4';

// ── HLTV team slug -> liste de nicknames FACEIT ────────────────────────────
// Index inverse base sur PLAYER_METADATA (api/pro-benchmarks.js). Mis a jour
// avril 2026. Le slug HLTV est extrait de l'URL (ex: 'natus-vincere',
// 'team-vitality', 'falcons').
//
// Pour les equipes pas dans cet index (tier 3, equipes amateurs), l'user
// devra paste les nicks manuellement comme fallback.
const HLTV_TEAM_ROSTERS = {
  'team-vitality':    ['ZywOo', 'apEX', 'ropz', 'flameZ', 'mezii'],
  'vitality':         ['ZywOo', 'apEX', 'ropz', 'flameZ', 'mezii'],
  'team-spirit':      ['donk', 'sh1ro', 'magixx', 'zont1x', 'tn1r'],
  'spirit':           ['donk', 'sh1ro', 'magixx', 'zont1x', 'tn1r'],
  'team-falcons':     ['m0NESY', 'NiKo', 'karrigan', 'TeSeS', 'kyousuke'],
  'falcons':          ['m0NESY', 'NiKo', 'karrigan', 'TeSeS', 'kyousuke'],
  'faze-clan':        ['frozen', 'Twistzz', 'broky', 'jcobbb', 'rain'], // rain may be 100T now
  'faze':             ['frozen', 'Twistzz', 'broky', 'jcobbb'],
  'mouz':             ['Spinx', 'xertioN', 'torzsi', 'jL', 'xelex'],
  'natus-vincere':    ['aleksib', 'iM', 'b1t', 'w0nderful', 'jL'],
  'navi':             ['aleksib', 'iM', 'b1t', 'w0nderful'],
  'furia':            ['molodoy', 'KSCERATO', 'yuurih', 'YEKINDAR', 'FalleN'],
  'furia-esports':    ['molodoy', 'KSCERATO', 'yuurih', 'YEKINDAR', 'FalleN'],
  'g2-esports':       ['huNter-', 'NertZ', 'SunPayus', 'HeavyGod', 'matys'],
  'g2':               ['huNter-', 'NertZ', 'SunPayus', 'HeavyGod', 'matys'],
  'team-liquid':      ['siuhy', 'NAF', 'EliGE', 'ultimate', 'malbsmd'],
  'liquid':           ['siuhy', 'NAF', 'EliGE', 'ultimate', 'malbsmd'],
  'aurora-gaming':    ['XANTARES', 'woxic', 'maj3r', 'Soulfly', 'wicadia'],
  'aurora':           ['XANTARES', 'woxic', 'maj3r', 'Soulfly', 'wicadia'],
  'the-mongolz':      ['blitz', '910', 'mzinho', 'Senzu', 'Techno4K'],
  'mongolz':          ['blitz', '910', 'mzinho', 'Senzu', 'Techno4K'],
  'eternal-fire':     ['MisteM', 'Rigon', 'demqq', 'Regali', 'Jottaaa'],
  '3dmax':            ['lucky', 'maka', 'Misutaaa', 'Ex3rcice', 'Graviti'],
  'astralis':         ['HooXi', 'jabbi', 'phzy', 'staehr', 'Ryu'],
  'big':              ['BlameF', 'tabseN', 'JDC', 'faveN', 'gr1ks'],
  'ence':             ['F1KU', 'krasnal'],
  'nip':              ['Snappi', 'stavn', 'sjuush'],
  'ninjas-in-pyjamas':['Snappi', 'stavn', 'sjuush'],
  '100-thieves':      ['rain', 'device'],
  '100t':             ['rain', 'device'],
  'flyquest':         ['jks'],
  'heroic':           ['chr1zn', 'Susp', 'xfl0ud', 'NiloVK', 'AlkareN'],
};

function getCache() {
  const g = globalThis;
  if (!g.__fvPrepVetoCache) g.__fvPrepVetoCache = { entries: new Map() };
  return g.__fvPrepVetoCache;
}

// ── URL parsing ─────────────────────────────────────────────────────────────
// Extrait le type + identifiant depuis une URL FACEIT ou HLTV.
function parseTeamUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  // FACEIT team page : /teams/<team_id>
  const ftm = u.match(/faceit\.com\/[a-z]{2}\/teams\/([a-z0-9-]+)/i);
  if (ftm) return { source: 'faceit_team', id: ftm[1] };
  // FACEIT player page : /players/<nickname>
  const fpm = u.match(/faceit\.com\/[a-z]{2}\/players\/([^/?#]+)/i);
  if (fpm) return { source: 'faceit_player', nickname: decodeURIComponent(fpm[1]) };
  // HLTV team page : /team/<id>/<slug>
  const htm = u.match(/hltv\.org\/team\/(\d+)\/([a-z0-9-]+)/i);
  if (htm) return { source: 'hltv_team', id: htm[1], slug: htm[2].toLowerCase() };
  // HLTV match page : /matches/<id>/<teamA>-vs-<teamB>-...
  const hmm = u.match(/hltv\.org\/matches\/(\d+)\/([a-z0-9-]+)/i);
  if (hmm) return { source: 'hltv_match', id: hmm[1], slug: hmm[2].toLowerCase() };
  return null;
}

// Resout les nicks d'une equipe a partir d'une URL parsee.
// Retourne { nicks: [...], teamName, source } ou null si echec.
async function resolveTeamMembers(parsed, apiKey) {
  if (!parsed) return null;

  if (parsed.source === 'faceit_team') {
    try {
      const headers = { Authorization: `Bearer ${apiKey}` };
      const r = await fetch(`${FACEIT_BASE}/teams/${parsed.id}`, { headers });
      if (!r.ok) return null;
      const data = await r.json();
      const nicks = (data.members || []).map(m => m.nickname).filter(Boolean);
      if (nicks.length === 0) return null;
      return { nicks: nicks.slice(0, 5), teamName: data.name || parsed.id, source: 'faceit_team' };
    } catch (e) {
      console.warn('[prep-veto] FACEIT team fetch failed:', e.message);
      return null;
    }
  }

  if (parsed.source === 'faceit_player') {
    return { nicks: [parsed.nickname], teamName: parsed.nickname, source: 'faceit_player' };
  }

  if (parsed.source === 'hltv_team') {
    const nicks = HLTV_TEAM_ROSTERS[parsed.slug];
    if (!nicks) return null;
    return { nicks, teamName: parsed.slug.replace(/-/g, ' '), source: 'hltv_team' };
  }

  if (parsed.source === 'hltv_match') {
    // Les matchs HLTV ont 2 teams dans le slug : 'teamA-vs-teamB-event'.
    // On extrait juste les 2 noms et on retourne la 1re equipe trouvee.
    // Pour l'analyse des 2 equipes, l'user devra utiliser yourTeamUrl + opponentUrl.
    const m = parsed.slug.match(/^([a-z0-9-]+?)-vs-([a-z0-9-]+?)(?:-|$)/);
    if (!m) return null;
    const teamASlug = m[1];
    const nicks = HLTV_TEAM_ROSTERS[teamASlug];
    if (!nicks) return null;
    return { nicks, teamName: teamASlug.replace(/-/g, ' '), source: 'hltv_match', secondTeam: m[2] };
  }

  return null;
}

// Fetch stats des 20 derniers matchs FACEIT pour 1 nickname.
async function fetchPlayerMatchStats(nickname, apiKey) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    const playerRes = await fetch(`${FACEIT_BASE}/players?nickname=${encodeURIComponent(nickname)}`, { headers });
    if (!playerRes.ok) return null;
    const player = await playerRes.json();
    const playerId = player.player_id;
    if (!playerId) return null;

    const statsRes = await fetch(`${FACEIT_BASE}/players/${playerId}/games/cs2/stats?limit=20`, { headers });
    if (!statsRes.ok) return null;
    const data = await statsRes.json();
    const items = data.items || [];

    const matches = items.map(it => {
      const s = it.stats || {};
      return {
        map: (s['Map'] || '').toLowerCase(),
        result: parseInt(s['Result']) || 0,
        rounds: parseInt(s['Rounds']) || 0,
        kd: parseFloat(s['K/D Ratio']) || 0,
        adr: parseFloat(s['ADR']) || 0,
        kast: parseFloat(s['KAST %']) || parseFloat(s['KAST']) || 0,
        ctRounds: parseInt(s['Final Score Counter-Terrorist'] || s['CT Rounds'] || 0),
        tRounds:  parseInt(s['Final Score Terrorist'] || s['T Rounds'] || 0),
      };
    }).filter(m => m.map);

    return { nickname: player.nickname, playerId, matches };
  } catch (e) {
    console.warn(`[prep-veto] fetch ${nickname} failed:`, e.message);
    return null;
  }
}

// Agrege les matchs des N joueurs en stats team-level par map.
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
    const totalRounds = m.ctRounds + m.tRounds;
    if (totalRounds > 0 && m.result === 1) {
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
  })).sort((a, b) => b.matches - a.matches);
}

// Recommandations basees sur opponent stats SEULES.
function generateRecommendationsOppOnly(opponentMaps) {
  const played = opponentMaps.filter(m => m.matches >= 3);
  const sortedByWin = [...played].sort((a, b) => b.winRate - a.winRate);
  return {
    forceBan: sortedByWin.slice(0, 2).map(m => ({
      map: m.displayName, winRate: m.winRate, matches: m.matches,
      reason: `Leur meilleure map (${m.winRate}% sur ${m.matches} matchs).`,
    })),
    forcePick: sortedByWin.slice(-2).reverse().map(m => ({
      map: m.displayName, winRate: m.winRate, matches: m.matches,
      reason: `Map faible pour eux (${m.winRate}% sur ${m.matches} matchs).`,
    })),
  };
}

// Recommandations head-to-head : croise opponent + ton equipe.
// Logique :
//   - forceBan = leurs maps fortes ET tes maps faibles (gap negatif eleve)
//   - forcePick = tes maps fortes ET leurs maps faibles (gap positif eleve)
function generateRecommendationsH2H(opponentMaps, yourMaps) {
  const oppByMap = Object.fromEntries(opponentMaps.map(m => [m.map, m]));
  const yourByMap = Object.fromEntries(yourMaps.map(m => [m.map, m]));
  const all = [...new Set([...Object.keys(oppByMap), ...Object.keys(yourByMap)])];
  const h2h = all.map(map => {
    const opp = oppByMap[map];
    const you = yourByMap[map];
    if (!opp || !you || opp.matches < 3 || you.matches < 3) return null;
    return {
      map, displayName: MAP_DISPLAY[map] || map,
      yourWinRate: you.winRate,
      oppWinRate: opp.winRate,
      gap: you.winRate - opp.winRate, // positif = avantage toi
      yourMatches: you.matches,
      oppMatches: opp.matches,
    };
  }).filter(Boolean);

  // Force ban = gap negatif eleve (eux > toi)
  const sortedByGap = [...h2h].sort((a, b) => a.gap - b.gap);
  const forceBan = sortedByGap.slice(0, 2).map(h => ({
    map: h.displayName, winRate: h.oppWinRate, matches: h.oppMatches,
    yourWinRate: h.yourWinRate, gap: h.gap,
    reason: `Eux ${h.oppWinRate}% vs toi ${h.yourWinRate}% (gap ${h.gap > 0 ? '+' : ''}${h.gap}pts).`,
  }));
  // Force pick = gap positif eleve (toi > eux)
  const forcePick = sortedByGap.slice(-2).reverse().map(h => ({
    map: h.displayName, winRate: h.yourWinRate, matches: h.yourMatches,
    oppWinRate: h.oppWinRate, gap: h.gap,
    reason: `Toi ${h.yourWinRate}% vs eux ${h.oppWinRate}% (gap +${h.gap}pts).`,
  }));
  return { forceBan, forcePick, h2h: sortedByGap };
}

// Aggregate complet : URL/nicks -> resolve roster -> fetch stats -> aggregate.
async function processTeam(input, apiKey) {
  let nicks = [];
  let teamName = null;
  let sourceLabel = null;

  if (input.url) {
    const parsed = parseTeamUrl(input.url);
    if (!parsed) return { error: 'URL invalide. Formats supportes : faceit.com/<lang>/teams/<id>, hltv.org/team/<id>/<slug>' };
    const resolved = await resolveTeamMembers(parsed, apiKey);
    if (!resolved) return { error: `Impossible de resoudre l'equipe depuis ${input.url}. Verifie l'URL ou paste les nicks manuellement.` };
    nicks = resolved.nicks;
    teamName = resolved.teamName;
    sourceLabel = resolved.source;
  } else if (Array.isArray(input.nicks) && input.nicks.length > 0) {
    nicks = input.nicks.filter(n => typeof n === 'string' && n.trim()).slice(0, 5);
    sourceLabel = 'manual_nicks';
  } else {
    return { error: 'Fournis une URL FACEIT/HLTV ou une liste de pseudos FACEIT.' };
  }

  if (nicks.length === 0) return { error: 'Aucun pseudo a analyser.' };

  const playerData = await Promise.all(nicks.map(n => fetchPlayerMatchStats(n.trim(), apiKey)));
  const validPlayers = playerData.filter(Boolean);
  if (validPlayers.length === 0) {
    return { error: 'Aucun joueur trouve sur FACEIT.', tried: nicks };
  }

  const totalMatches = validPlayers.reduce((s, p) => s + p.matches.length, 0);
  const maps = aggregateByMap(validPlayers);

  return {
    team: {
      teamName,
      sourceLabel,
      nicknames: validPlayers.map(p => p.nickname),
      validPlayers: validPlayers.length,
      totalMatches,
      invalidNames: nicks.filter(n => !validPlayers.find(p => p.nickname.toLowerCase() === n.toLowerCase())),
    },
    maps,
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

  // Auth + plan check (admin bypass + grants gere par requireElite)
  const gate = await requireElite(req, res);
  if (!gate) return;

  // Parse body
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  // Normalise les inputs : les 2 equipes peuvent etre URL ou nicks
  const opponentInput = {
    url: body.opponentUrl || null,
    nicks: Array.isArray(body.opponent) ? body.opponent : null,
  };
  const yourTeamInput = {
    url: body.yourTeamUrl || null,
    nicks: Array.isArray(body.yourTeam) ? body.yourTeam : null,
  };

  if (!opponentInput.url && !opponentInput.nicks) {
    return res.status(400).json({ error: 'Equipe adverse manquante (opponentUrl ou opponent[]).' });
  }

  // Cache lookup : cle base sur les inputs canonicalises
  const cacheKey = 'h2h:v1:'
    + (opponentInput.url || (opponentInput.nicks || []).map(n => n.toLowerCase().trim()).sort().join(','))
    + '|'
    + (yourTeamInput.url || (yourTeamInput.nicks || []).map(n => n.toLowerCase().trim()).sort().join(','));
  const cache = getCache();
  const cached = cache.entries.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    return res.status(200).json({ ...cached.data, cached: true });
  }

  try {
    // Process opponent (toujours)
    const opponentResult = await processTeam(opponentInput, apiKey);
    if (opponentResult.error) {
      return res.status(400).json({ error: opponentResult.error, tried: opponentResult.tried });
    }

    // Process yourTeam (optionnel)
    let yourTeamResult = null;
    const hasYourTeam = !!(yourTeamInput.url || (yourTeamInput.nicks && yourTeamInput.nicks.length));
    if (hasYourTeam) {
      yourTeamResult = await processTeam(yourTeamInput, apiKey);
      if (yourTeamResult.error) {
        // Erreur sur ton equipe : on continue avec opponent only + warning
        yourTeamResult = null;
      }
    }

    let payload;
    if (yourTeamResult) {
      // Mode head-to-head
      const reco = generateRecommendationsH2H(opponentResult.maps, yourTeamResult.maps);
      payload = {
        mode: 'h2h',
        opponent: opponentResult,
        yourTeam: yourTeamResult,
        recommendations: { forceBan: reco.forceBan, forcePick: reco.forcePick },
        h2h: reco.h2h,
        lastUpdated: new Date().toISOString(),
      };
    } else {
      // Mode opponent-only (legacy compat)
      payload = {
        mode: 'opponent_only',
        team: opponentResult.team,
        maps: opponentResult.maps,
        recommendations: generateRecommendationsOppOnly(opponentResult.maps),
        lastUpdated: new Date().toISOString(),
      };
    }

    cache.entries.set(cacheKey, { data: payload, ts: Date.now() });
    if (cache.entries.size > 200) {
      const oldest = [...cache.entries.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
      if (oldest) cache.entries.delete(oldest[0]);
    }

    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    return res.status(200).json(payload);
  } catch (e) {
    console.error('[prep-veto] processing failed:', e.message);
    return res.status(500).json({ error: 'Erreur agregation stats' });
  }
};
