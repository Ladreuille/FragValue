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

// Active Duty CS2 avril 2026 (7 maps, post-Vertigo retire)
const ACTIVE_MAPS = ['de_mirage', 'de_inferno', 'de_dust2', 'de_nuke', 'de_anubis', 'de_ancient', 'de_overpass'];
const MAP_DISPLAY = {
  de_mirage:   'Mirage',
  de_inferno:  'Inferno',
  de_dust2:    'Dust2',
  de_nuke:     'Nuke',
  de_anubis:   'Anubis',
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
        kills: parseInt(s['Kills']) || 0,
        ctRounds: parseInt(s['Final Score Counter-Terrorist'] || s['CT Rounds'] || 0),
        tRounds:  parseInt(s['Final Score Terrorist'] || s['T Rounds'] || 0),
        // Tag avec le nickname pour pouvoir attribuer les matchs aux joueurs
        // dans aggregateByMap (necessaire pour calculer les top players par map)
        nickname: player.nickname,
      };
    }).filter(m => m.map);

    return { nickname: player.nickname, playerId, matches };
  } catch (e) {
    console.warn(`[prep-veto] fetch ${nickname} failed:`, e.message);
    return null;
  }
}

// Confidence d'une map basee sur le sample size :
//   high   = >= 10 matchs joues cumules par l'equipe (statistiquement solide)
//   medium = 5-9 matchs (indicatif)
//   low    = 1-4 matchs (anecdotique, exclu des recommandations)
function confidenceLevel(matches) {
  if (matches >= 10) return 'high';
  if (matches >= 5)  return 'medium';
  return 'low';
}

// Agrege les matchs des N joueurs en stats team-level par map.
// Tracking par-player necessaire pour calculer les top fragger / awper par map.
function aggregateByMap(playersData) {
  const allMatches = playersData.flatMap(p => p.matches);
  const byMap = {};

  for (const m of allMatches) {
    if (!ACTIVE_MAPS.includes(m.map)) continue;
    if (!byMap[m.map]) {
      byMap[m.map] = {
        matches: 0, wins: 0,
        kdSum: 0, adrSum: 0, kastSum: 0,
        ctRoundsSum: 0, tRoundsSum: 0, ctWinSum: 0, tWinSum: 0,
        // Tracking par player pour identifier les top performers
        playerStats: {}, // nickname -> { matches, kdSum, adrSum, killsSum }
      };
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
    // Player tracking
    if (m.nickname) {
      if (!b.playerStats[m.nickname]) {
        b.playerStats[m.nickname] = { nickname: m.nickname, matches: 0, kdSum: 0, adrSum: 0, killsSum: 0 };
      }
      const ps = b.playerStats[m.nickname];
      ps.matches += 1;
      ps.kdSum += m.kd;
      ps.adrSum += m.adr;
      ps.killsSum += m.kills;
    }
  }

  return Object.entries(byMap).map(([map, b]) => {
    // Top 2 players par avgKd (avec >= 2 matchs minimum sur la map)
    const players = Object.values(b.playerStats)
      .filter(p => p.matches >= 2)
      .map(p => ({
        nickname: p.nickname,
        matches: p.matches,
        avgKd: +(p.kdSum / p.matches).toFixed(2),
        avgAdr: Math.round(p.adrSum / p.matches),
        avgKills: +(p.killsSum / p.matches).toFixed(1),
      }))
      .sort((a, b) => b.avgKd - a.avgKd)
      .slice(0, 2);

    return {
      map,
      displayName: MAP_DISPLAY[map] || map,
      matches: b.matches,
      wins: b.wins,
      winRate: b.matches > 0 ? Math.round((b.wins / b.matches) * 100) : 0,
      ctWinRate: b.matches > 0 ? Math.round((b.ctWinSum / b.matches) * 100) : null,
      tWinRate:  b.matches > 0 ? Math.round((b.tWinSum  / b.matches) * 100) : null,
      avgKd:   b.matches > 0 ? +(b.kdSum / b.matches).toFixed(2)   : 0,
      avgAdr:  b.matches > 0 ? Math.round(b.adrSum / b.matches)    : 0,
      avgKast: b.matches > 0 ? Math.round(b.kastSum / b.matches)   : 0,
      confidence: confidenceLevel(b.matches),
      topPlayers: players,
    };
  }).sort((a, b) => b.matches - a.matches);
}

// Garantit qu'on retourne TOUTES les maps actives, meme avec 0 datapoints
// (les maps absentes apparaissent comme "no_data" dans le frontend).
function fillMissingMaps(maps) {
  const present = new Set(maps.map(m => m.map));
  const missing = ACTIVE_MAPS.filter(m => !present.has(m)).map(m => ({
    map: m, displayName: MAP_DISPLAY[m] || m,
    matches: 0, wins: 0, winRate: 0,
    ctWinRate: null, tWinRate: null,
    avgKd: 0, avgAdr: 0, avgKast: 0,
    confidence: 'none', topPlayers: [],
  }));
  return [...maps, ...missing];
}

// Seuil minimal de matchs pour qu'une map entre dans les recommandations.
// 5 = compromis entre exhaustivite (toutes les maps actives) et fiabilite
// statistique (sous 5 matchs, le winrate est tres bruite).
const MIN_MATCHES_FOR_RECO = 5;

// Recommandations basees sur opponent stats SEULES.
function generateRecommendationsOppOnly(opponentMaps) {
  const played = opponentMaps.filter(m => m.matches >= MIN_MATCHES_FOR_RECO);
  const sortedByWin = [...played].sort((a, b) => b.winRate - a.winRate);
  return {
    forceBan: sortedByWin.slice(0, 2).map(m => ({
      map: m.displayName, winRate: m.winRate, matches: m.matches,
      confidence: m.confidence,
      reason: `Leur meilleure map (${m.winRate}% sur ${m.matches} matchs).`,
    })),
    forcePick: sortedByWin.slice(-2).reverse().map(m => ({
      map: m.displayName, winRate: m.winRate, matches: m.matches,
      confidence: m.confidence,
      reason: `Map faible pour eux (${m.winRate}% sur ${m.matches} matchs).`,
    })),
  };
}

// Recommandations head-to-head : croise opponent + ton equipe.
function generateRecommendationsH2H(opponentMaps, yourMaps) {
  const oppByMap = Object.fromEntries(opponentMaps.map(m => [m.map, m]));
  const yourByMap = Object.fromEntries(yourMaps.map(m => [m.map, m]));
  const all = [...new Set([...Object.keys(oppByMap), ...Object.keys(yourByMap)])];
  const h2h = all.map(map => {
    const opp = oppByMap[map];
    const you = yourByMap[map];
    if (!opp || !you) return null;
    // Calcul confidence H2H = min des 2 confidences
    let confidence = 'high';
    if (you.matches < MIN_MATCHES_FOR_RECO || opp.matches < MIN_MATCHES_FOR_RECO) confidence = 'low';
    else if (you.matches < 10 || opp.matches < 10) confidence = 'medium';
    return {
      map, displayName: MAP_DISPLAY[map] || map,
      yourWinRate: you.winRate,
      oppWinRate: opp.winRate,
      gap: you.winRate - opp.winRate,
      yourMatches: you.matches,
      oppMatches: opp.matches,
      yourCtWinRate: you.ctWinRate, yourTWinRate: you.tWinRate,
      oppCtWinRate: opp.ctWinRate, oppTWinRate: opp.tWinRate,
      yourTopPlayers: you.topPlayers,
      oppTopPlayers: opp.topPlayers,
      confidence,
    };
  }).filter(Boolean);

  // Filtre confidence pour les recos uniquement (la grille montre tout)
  const reliable = h2h.filter(h => h.confidence !== 'low');
  const sortedByGap = [...reliable].sort((a, b) => a.gap - b.gap);

  const forceBan = sortedByGap.slice(0, 2).map(h => ({
    map: h.displayName, winRate: h.oppWinRate, matches: h.oppMatches,
    yourWinRate: h.yourWinRate, gap: h.gap, confidence: h.confidence,
    reason: `Eux ${h.oppWinRate}% vs toi ${h.yourWinRate}% (gap ${h.gap > 0 ? '+' : ''}${h.gap}pts sur ${h.oppMatches} matchs).`,
  }));
  const forcePick = sortedByGap.slice(-2).reverse().map(h => ({
    map: h.displayName, winRate: h.yourWinRate, matches: h.yourMatches,
    oppWinRate: h.oppWinRate, gap: h.gap, confidence: h.confidence,
    reason: `Toi ${h.yourWinRate}% vs eux ${h.oppWinRate}% (gap +${h.gap}pts sur ${h.yourMatches} matchs).`,
  }));

  // h2h tri pour le frontend : tous les maps (pas de filtre confidence)
  // mais avec le flag pour dimmer les low-confidence cards.
  const allSortedByGap = [...h2h].sort((a, b) => a.gap - b.gap);
  return { forceBan, forcePick, h2h: allSortedByGap };
}

// Calcul win probability cumulative pour un BO sur N maps choisies.
// Formule simplifiee : pour chaque map, P(win map) = yourWinRate / 100.
// P(win BO3) = P(win >= 2 maps sur 3) via somme binomiale.
// Hypothese : maps independantes (pas de momentum effect).
function computeWinProbability(mapsToPlay, h2hMaps) {
  const winRates = mapsToPlay.map(m => {
    const h = h2hMaps.find(x => x.map === m.map);
    return h ? h.yourWinRate / 100 : 0.5;
  });
  if (winRates.length === 0) return null;
  // Pour BO1 : P(win) = winRate de la map jouee
  if (winRates.length === 1) return Math.round(winRates[0] * 100);
  // Pour BO3 : P(win 2 ou 3 sur 3) - cas distincts
  if (winRates.length === 3) {
    const [p1, p2, p3] = winRates;
    const win3 = p1 * p2 * p3;
    const win2 = (p1 * p2 * (1 - p3)) + (p1 * (1 - p2) * p3) + ((1 - p1) * p2 * p3);
    return Math.round((win3 + win2) * 100);
  }
  // Pour BO5 : P(win 3, 4 ou 5 sur 5)
  if (winRates.length === 5) {
    // Approximation via Monte Carlo simple : proba moyenne (suffisant pour preview)
    const avgP = winRates.reduce((s, v) => s + v, 0) / winRates.length;
    // P(win >= 3 sur 5) avec proba moyenne avgP
    let total = 0;
    for (let k = 3; k <= 5; k++) {
      // C(5, k) * p^k * (1-p)^(5-k)
      const binom = [1,5,10,10,5,1][k];
      total += binom * Math.pow(avgP, k) * Math.pow(1 - avgP, 5 - k);
    }
    return Math.round(total * 100);
  }
  // Fallback : moyenne simple
  const avg = winRates.reduce((s, v) => s + v, 0) / winRates.length;
  return Math.round(avg * 100);
}

// Templates ordonnes de veto (FACEIT / ESEA standard, pool 7 maps).
// Le decider final (1 map restante) est ajoute automatiquement.
// L'alternance toi/eux est implicite par la parite de l'index :
//   index pair = team starter, impair = team adverse.
// Si youStart=true : index 0 = toi. Si youStart=false : index 0 = eux.
const SEQUENCE_TEMPLATES = {
  bo1: ['ban', 'ban', 'ban', 'ban', 'ban', 'ban'],         // 6 bans → 1 decider
  bo3: ['ban', 'ban', 'pick', 'pick', 'ban', 'ban'],       // 2-2-2 interleaved
  bo5: ['ban', 'ban', 'pick', 'pick', 'pick', 'pick'],     // 2 bans, 4 picks
};

// Construit la sequence pour 1 format donne.
// pool : maps disponibles (avec gap calcule), youStart : qui commence.
function buildSequence(template, youStart, pool) {
  const remaining = new Set(pool.map(m => m.map));
  const sequence = [];

  template.forEach((action, i) => {
    // youStart=true → index 0 = toi. youStart=false → index 0 = eux.
    const isYou = (i % 2 === 0) === youStart;
    const candidates = pool.filter(m => remaining.has(m.map));
    if (candidates.length === 0) return;
    if (action === 'ban') {
      // Toi : ban leur meilleure map (gap le plus negatif pour toi).
      // Eux : ban ta meilleure map (gap le plus positif).
      candidates.sort(isYou ? (a, b) => a.gap - b.gap : (a, b) => b.gap - a.gap);
    } else {
      // Toi : pick ta meilleure (gap le plus positif).
      // Eux : pick leur meilleure (gap le plus negatif).
      candidates.sort(isYou ? (a, b) => b.gap - a.gap : (a, b) => a.gap - b.gap);
    }
    const target = candidates[0];
    sequence.push({
      action,
      team: isYou ? 'you' : 'opp',
      map: target.displayName,
      gap: target.gap,
    });
    remaining.delete(target.map);
  });

  // Decider = la map qui reste
  const deciderMaps = pool.filter(m => remaining.has(m.map));
  if (deciderMaps.length === 1) {
    sequence.push({
      action: 'decider', team: 'auto',
      map: deciderMaps[0].displayName, gap: deciderMaps[0].gap,
    });
  }

  // Maps jouees = picks + decider (les bans sont eliminees)
  const mapsToPlay = sequence.filter(s => s.action !== 'ban').map(s => {
    const m = pool.find(p => p.displayName === s.map);
    return m ? { map: m.map, displayName: m.displayName } : null;
  }).filter(Boolean);

  return { sequence, mapsToPlay };
}

// Genere les sequences de veto BO1/BO3/BO5 + maps suggerees + win prob.
// youStart : true si toi commences le veto, false si l'adversaire commence.
function generateVetoFormats(h2hMaps, youStart = true) {
  const reliable = h2hMaps.filter(h => h.confidence !== 'low');
  const pool = (reliable.length >= 5 ? reliable : h2hMaps);
  if (pool.length < 5) return null;

  const bo1 = buildSequence(SEQUENCE_TEMPLATES.bo1, youStart, pool);
  const bo3 = buildSequence(SEQUENCE_TEMPLATES.bo3, youStart, pool);
  const bo5 = buildSequence(SEQUENCE_TEMPLATES.bo5, youStart, pool);

  return {
    starter: youStart ? 'you' : 'opp',
    bo1: { ...bo1, winProbability: computeWinProbability(bo1.mapsToPlay, h2hMaps) },
    bo3: { ...bo3, winProbability: computeWinProbability(bo3.mapsToPlay, h2hMaps) },
    bo5: { ...bo5, winProbability: computeWinProbability(bo5.mapsToPlay, h2hMaps) },
  };
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
  // Aggregate puis remplit les maps absentes avec 'no_data' pour que le
  // frontend les affiche en mode "pas joue" plutot que de les omettre.
  const maps = fillMissingMaps(aggregateByMap(validPlayers));

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
  // v3 : invalide apres fix sequences interleaved + dual starter formats
  const cacheKey = 'h2h:v3:'
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
      // Mode head-to-head : on calcule les sequences BO1/BO3/BO5 pour
      // les 2 cas de starter (toi commences vs eux commencent). Le client
      // toggle entre les 2 sans re-call API.
      const reco = generateRecommendationsH2H(opponentResult.maps, yourTeamResult.maps);
      const formatsYouStart  = generateVetoFormats(reco.h2h, true);
      const formatsOppStart  = generateVetoFormats(reco.h2h, false);
      payload = {
        mode: 'h2h',
        opponent: opponentResult,
        yourTeam: yourTeamResult,
        recommendations: { forceBan: reco.forceBan, forcePick: reco.forcePick },
        h2h: reco.h2h,
        // Sequences pour les 2 starters : { youStart: { bo1, bo3, bo5 }, oppStart: ... }
        formatsByStarter: {
          you: formatsYouStart,
          opp: formatsOppStart,
        },
        // Map pool pour le simulateur manuel cote frontend
        activeMapsList: ACTIVE_MAPS.map(m => ({ map: m, displayName: MAP_DISPLAY[m] })),
        activeMaps: ACTIVE_MAPS.length,
        minMatchesForReco: MIN_MATCHES_FOR_RECO,
        lastUpdated: new Date().toISOString(),
      };
    } else {
      payload = {
        mode: 'opponent_only',
        team: opponentResult.team,
        maps: opponentResult.maps,
        recommendations: generateRecommendationsOppOnly(opponentResult.maps),
        activeMaps: ACTIVE_MAPS.length,
        minMatchesForReco: MIN_MATCHES_FOR_RECO,
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
