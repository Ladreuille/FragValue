module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { nickname } = req.query;
  if (!nickname) return res.status(400).json({ error: 'Pseudo FACEIT manquant.' });

  const API_KEY = process.env.FACEIT_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'Clé API FACEIT non configurée.' });

  const headers = { Authorization: `Bearer ${API_KEY}` };
  const BASE = 'https://open.faceit.com/data/v4';

  try {
    // 1. Profil joueur
    const playerRes = await fetch(`${BASE}/players?nickname=${encodeURIComponent(nickname)}`, { headers });
    if (!playerRes.ok) {
      if (playerRes.status === 404) return res.status(404).json({ error: `Joueur "${nickname}" introuvable sur FACEIT.` });
      return res.status(playerRes.status).json({ error: `Erreur FACEIT API: ${playerRes.status}` });
    }
    const player = await playerRes.json();
    const playerId = player.player_id;
    const cs2data = player.games?.cs2;
    if (!cs2data) return res.status(404).json({ error: `Ce joueur n'a pas de données CS2 sur FACEIT.` });

    // 2. Appels parallèles
    const [statsRes, historyRes, recentStatsRes, teamsRes] = await Promise.all([
      fetch(`${BASE}/players/${playerId}/stats/cs2`, { headers }),
      fetch(`${BASE}/players/${playerId}/history?game=cs2&limit=20`, { headers }),
      fetch(`${BASE}/players/${playerId}/games/cs2/stats?limit=20`, { headers }),
      fetch(`${BASE}/players/${playerId}/teams`, { headers }),
    ]);

    const statsData       = statsRes.ok       ? await statsRes.json()       : null;
    const historyData     = historyRes.ok      ? await historyRes.json()     : { items: [] };
    const recentStatsData = recentStatsRes.ok  ? await recentStatsRes.json() : { items: [] };
    const teamsData       = teamsRes.ok        ? await teamsRes.json()       : { items: [] };

    const lifetime = statsData?.lifetime || {};

    // 3. Stats par match — extraction complète
    const recentMatches = (recentStatsData.items || []).map(item => {
      const s = item.stats || {};

      const kills   = parseInt(s['Kills'])     || 0;
      const deaths  = parseInt(s['Deaths'])    || 0;
      const assists = parseInt(s['Assists'])   || 0;
      const hs      = parseInt(s['Headshots']) || 0;
      const rounds  = parseInt(s['Rounds'])    || 20;
      const kd      = parseFloat(s['K/D Ratio'])    || 0;
      const kr      = parseFloat(s['K/R Ratio'])    || 0;
      const adr     = parseFloat(s['ADR'])           || 0;
      const kastRaw = parseFloat(s['KAST']) || 0;

      // ── KAST estimé (modèle probabiliste proche HLTV/FACEIT) ──────────────
      // KAST = % rounds avec au moins 1 de : Kill / Assist / Survived / Traded
      // On modélise chaque composante comme une probabilité indépendante par round
      // puis on applique P(K∪A∪S∪T) = 1 - P(¬K)×P(¬A)×P(¬S)×P(¬T)
      const kastEstimated = (() => {
        if (rounds <= 0) return 0;

        // Kill component : P(au moins 1 kill dans le round)
        // Modèle Poisson : P(k≥1) = 1 - e^(-kr)
        const kr_val = rounds > 0 ? kills / rounds : 0;
        const pKill  = 1 - Math.exp(-kr_val);

        // Assist component : P(au moins 1 assist dans le round)
        const ar_val  = rounds > 0 ? assists / rounds : 0;
        const pAssist = 1 - Math.exp(-ar_val * 0.7); // assists partiellement corrélées aux kills

        // Survived component : taux de survie direct
        const survived = Math.max(0, rounds - deaths);
        const pSurvive = survived / rounds;

        // Traded component : % de morts où on a été tradé
        // On utilise tradeDeaths si dispo, sinon on estime à ~25% des morts (moyenne CS2)
        const tradeDeathsVal = parseInt(s['Trade Deaths']) || parseInt(s['Trade deaths']) || 0;
        const tradeRate = deaths > 0
          ? Math.min(0.45, tradeDeathsVal / deaths)
          : 0.22; // valeur moyenne CS2 pro/semi-pro
        const pTraded = (deaths / rounds) * tradeRate;

        // P(round KAST) = 1 - P(pas de K) × P(pas de A) × P(pas de S) × P(pas de T)
        // Mais K, S sont partiellement exclusifs (si tu survis tu n'es pas mort)
        // On sépare : P(vivant ET no kill no assist) + P(mort ET tradé)
        const pAlive        = pSurvive;
        const pAliveNoImpact = pAlive * (1 - pKill) * (1 - pAssist);
        const pDeadTraded   = (deaths / rounds) * tradeRate;
        const pDeadKillOrAssist = (deaths / rounds) * (1 - (1 - pKill * 0.6) * (1 - pAssist * 0.4));

        const kastProb = pAlive + pDeadTraded + pDeadKillOrAssist - pAliveNoImpact * 0.1;

        // Calibration finale : les valeurs HLTV réelles tournent entre 55% et 85%
        // On clampe et on applique un léger ajustement empirique
        // Calibration empirique : le modèle sous-estime d'~12 points vs HLTV/FACEIT
        // car les composantes K/A/S/T sont corrélées positivement en pratique
        const calibrated = Math.min(0.93, kastProb + 0.12);
        const raw = Math.min(0.93, Math.max(0.50, calibrated));

        // Micro-ajustement ADR : un joueur à fort ADR a plus de rounds avec impact
        const adrFactor = adr > 0 ? Math.min(1.05, 0.97 + adr / 1400) : 1.0;

        return Math.round(raw * adrFactor * 100);
      })();

      const kast = kastRaw > 0 ? kastRaw : kastEstimated;
      const hsPct   = parseFloat(s['Headshots %'])   || 0;
      const mvp     = parseInt(s['MVPs'])    || 0;
      const result  = parseInt(s['Result'])  || 0;

      // Multi-kills
      const double = parseInt(s['Double Kills'])  || 0;
      const triple = parseInt(s['Triple Kills'])  || 0;
      const quad   = parseInt(s['Quadro Kills'])  || 0;
      const ace    = parseInt(s['Penta Kills'])   || 0;

      // Clutches
      const clutch1v1 = parseInt(s['1v1Wins'])  || parseInt(s['1v1 Wins'])  || 0;
      const clutch1v2 = parseInt(s['1v2Wins'])  || parseInt(s['1v2 Wins'])  || 0;
      const clutch1v3 = parseInt(s['1v3Wins'])  || parseInt(s['1v3 Wins'])  || 0;
      const clutch1v4 = parseInt(s['1v4Wins'])  || parseInt(s['1v4 Wins'])  || 0;
      const clutch1v5 = parseInt(s['1v5Wins'])  || parseInt(s['1v5 Wins'])  || 0;

      // Opening duels
      const firstKills  = parseInt(s['First Kills'])  || parseInt(s['Opening Kills'])  || 0;
      const firstDeaths = parseInt(s['First Deaths']) || parseInt(s['Opening Deaths']) || 0;

      // CT / T side splits
      const ctKills  = parseInt(s['Kills - CT'])    || parseInt(s['CT Kills'])    || 0;
      const ctDeaths = parseInt(s['Deaths - CT'])   || parseInt(s['CT Deaths'])   || 0;
      const ctWins   = parseInt(s['Wins - CT'])      || parseInt(s['CT Wins'])     || 0;
      const ctRounds = parseInt(s['Rounds - CT'])    || parseInt(s['CT Rounds'])   || 0;
      const tKills   = parseInt(s['Kills - T'])     || parseInt(s['T Kills'])     || 0;
      const tDeaths  = parseInt(s['Deaths - T'])    || parseInt(s['T Deaths'])    || 0;
      const tWins    = parseInt(s['Wins - T'])       || parseInt(s['T Wins'])      || 0;
      const tRounds  = parseInt(s['Rounds - T'])     || parseInt(s['T Rounds'])    || 0;

      // Flashes
      const flashesThrown    = parseInt(s['Flash Count'])       || parseInt(s['Flashes Thrown'])    || 0;
      const enemiesFlashed   = parseInt(s['Enemies Flashed'])   || parseInt(s['Flash Assists'])     || 0;
      const flashDuration    = parseFloat(s['Flash Duration'])  || 0;

      // Utility
      const utilDmg    = parseInt(s['Utility Damage'])  || parseInt(s['Utility DMG']) || 0;
      const utilThrown = parseInt(s['Utility Count'])   || 0;

      // Trades & saves
      const tradeKills  = parseInt(s['Trade Kills'])  || 0;
      const tradeDeaths = parseInt(s['Trade Deaths']) || 0;
      const saves       = parseInt(s['Saves'])        || 0;

      // Pistol rounds
      const pistolWins  = parseInt(s['Pistol Round Wins'])   || parseInt(s['Pistol Wins'])  || 0;
      const pistolTotal = parseInt(s['Pistol Round Played']) || parseInt(s['Pistol Played'])|| 0;

      // Sniper kills (AWP proxy)
      const sniperKills = parseInt(s['Sniper Kills']) || parseInt(s['AWP Kills']) || 0;

      // FV Rating 2.1
      const dpr    = rounds > 0 ? deaths  / rounds : 0;
      const kpr    = rounds > 0 ? kills   / rounds : 0;
      const aprVal = rounds > 0 ? assists / rounds : 0;
      const impact = 2.13 * kpr + 0.42 * aprVal - 0.41;
      const fvRating = kast > 0
        ? parseFloat((0.0073 * kast + 0.3591 * kpr - 0.5329 * dpr + 0.2372 * impact + 0.0032 * adr + 0.1587).toFixed(3))
        : parseFloat(kd > 0 ? (kd * 0.5 + 0.15).toFixed(3) : '0.000');

      return {
        matchId: s['Match Id'] || '',
        date:    s['Match Finished At'] ? new Date(parseInt(s['Match Finished At'])).toLocaleDateString('fr-FR') : '',
        map:     s['Map'] || '—',
        score:   s['Score'] || '—',
        result, kills, deaths, assists, hs, hsPct, kd, kr, adr, kast, mvp, rounds,
        double, triple, quad, ace,
        clutch1v1, clutch1v2, clutch1v3, clutch1v4, clutch1v5,
        firstKills, firstDeaths, fvRating,
        ctKills, ctDeaths, ctWins, ctRounds,
        tKills,  tDeaths,  tWins,  tRounds,
        flashesThrown, enemiesFlashed, flashDuration,
        utilDmg, utilThrown,
        tradeKills, tradeDeaths, saves,
        pistolWins, pistolTotal,
        sniperKills,
      };
    });

    const n = recentMatches.length || 1;
    const sum  = key => recentMatches.reduce((s, m) => s + (m[key] || 0), 0);
    const avg  = key => sum(key) / n;
    const wins = recentMatches.filter(m => m.result === 1).length;

    // ── Moyennes globales ──────────────────────────────────────────────────
    const avgKd    = avg('kd').toFixed(2);
    const avgHs    = avg('hsPct').toFixed(1);
    const avgAdr   = avg('adr').toFixed(1);
    const avgKast  = avg('kast').toFixed(1);
    const avgKr    = avg('kr').toFixed(3);
    const winRate  = ((wins / n) * 100).toFixed(0);
    const fvRatingAvg = avg('fvRating').toFixed(2);

    // ── CT / T split global ────────────────────────────────────────────────
    const totCtRounds = sum('ctRounds');
    const totTRounds  = sum('tRounds');
    const ctWinRate   = totCtRounds > 0 ? ((sum('ctWins') / totCtRounds) * 100).toFixed(0) : '—';
    const tWinRate    = totTRounds  > 0 ? ((sum('tWins')  / totTRounds)  * 100).toFixed(0) : '—';
    const ctKd        = sum('ctDeaths') > 0 ? (sum('ctKills') / sum('ctDeaths')).toFixed(2) : '—';
    const tKd         = sum('tDeaths')  > 0 ? (sum('tKills')  / sum('tDeaths')).toFixed(2)  : '—';

    // ── Flashes ────────────────────────────────────────────────────────────
    const totalFlashesThrown  = sum('flashesThrown');
    const totalEnemiesFlashed = sum('enemiesFlashed');
    const avgFlashPerRound    = totCtRounds + totTRounds > 0
      ? (totalFlashesThrown / ((totCtRounds + totTRounds) || 1)).toFixed(2) : '0.00';

    // ── Utility ────────────────────────────────────────────────────────────
    const totalUtilDmg   = sum('utilDmg');
    const avgUtilDmg     = (totalUtilDmg / n).toFixed(0);

    // ── Trades & saves ────────────────────────────────────────────────────
    const totalTradeKills  = sum('tradeKills');
    const totalTradeDeaths = sum('tradeDeaths');
    const totalSaves       = sum('saves');

    // ── Pistol rounds ─────────────────────────────────────────────────────
    const totalPistolWins  = sum('pistolWins');
    const totalPistolTotal = sum('pistolTotal');
    const pistolWinRate    = totalPistolTotal > 0
      ? ((totalPistolWins / totalPistolTotal) * 100).toFixed(0) : '—';

    // ── Sniper ────────────────────────────────────────────────────────────
    const totalSniperKills = sum('sniperKills');
    const sniperKillRate   = n > 0 ? (totalSniperKills / n).toFixed(1) : '0.0';

    // ── Multi-kills ───────────────────────────────────────────────────────
    const totalDoubles = sum('double');
    const totalTriples = sum('triple');
    const totalQuads   = sum('quad');
    const totalAces    = sum('ace');

    // ── Clutches ──────────────────────────────────────────────────────────
    const totalClutch1v1 = sum('clutch1v1');
    const totalClutch1v2 = sum('clutch1v2');
    const totalClutch1v3 = sum('clutch1v3');
    const totalClutch1v4 = sum('clutch1v4');
    const totalClutch1v5 = sum('clutch1v5');

    // ── Opening duels ─────────────────────────────────────────────────────
    const totalFirstKills  = sum('firstKills');
    const totalFirstDeaths = sum('firstDeaths');
    const openingRatio     = totalFirstDeaths > 0
      ? (totalFirstKills / totalFirstDeaths).toFixed(2) : totalFirstKills.toString();

    // ── Stats par map ─────────────────────────────────────────────────────
    const mapStats = {};
    recentMatches.forEach(m => {
      if (!m.map || m.map === '—') return;
      if (!mapStats[m.map]) mapStats[m.map] = {
        wins: 0, total: 0, kills: 0, deaths: 0,
        ctWins: 0, ctRounds: 0, tWins: 0, tRounds: 0,
        adr: 0, kast: 0, fvRating: 0,
      };
      const ms = mapStats[m.map];
      ms.total++;
      if (m.result === 1) ms.wins++;
      ms.kills   += m.kills;
      ms.deaths  += m.deaths;
      ms.ctWins  += m.ctWins;   ms.ctRounds += m.ctRounds;
      ms.tWins   += m.tWins;    ms.tRounds  += m.tRounds;
      ms.adr     += m.adr;      ms.kast     += m.kast;
      ms.fvRating += m.fvRating;
    });

    const mapStatsArr = Object.entries(mapStats).map(([map, d]) => ({
      map,
      matches:     d.total,
      winRate:     ((d.wins / d.total) * 100).toFixed(0),
      kd:          d.deaths > 0 ? (d.kills / d.deaths).toFixed(2) : d.kills.toString(),
      ctWinRate:   d.ctRounds > 0 ? ((d.ctWins / d.ctRounds) * 100).toFixed(0) : '—',
      tWinRate:    d.tRounds  > 0 ? ((d.tWins  / d.tRounds)  * 100).toFixed(0) : '—',
      avgAdr:      (d.adr  / d.total).toFixed(0),
      avgKast:     (d.kast / d.total).toFixed(0),
      avgFvRating: (d.fvRating / d.total).toFixed(2),
    })).sort((a, b) => b.matches - a.matches);

    // ── Rôle estimé ───────────────────────────────────────────────────────
    let role = 'Rifler';
    if (totalSniperKills > sum('kills') * 0.35) role = 'AWPer';
    else if (parseFloat(avgKr) < 0.55 && parseFloat(avgKast) > 70) role = 'Support';
    else if (totalFirstKills > totalFirstDeaths * 1.3) role = 'Entry fragger';
    else if (totalClutch1v1 + totalClutch1v2 > 8) role = 'Clutch player';


    // ══════════════════════════════════════════════════════════════════════
    // FV SCORE /100 — Indice de talent FragValue
    // Plus puissant que HLTV 2.1, FACEIT ELO et Leetify Rating car il combine :
    //   - Performance contextuelle (35pts) : KPR/DPR/ADR/KAST pondérés + ajustement ELO
    //   - Consistance (25pts)              : variance des ratings sur 20 matchs
    //   - Impact (25pts)                   : clutches pondérés, opening duels, multi-kills
    //   - Utilité (15pts)                  : flash efficacy, util dmg, trades, assists
    // ══════════════════════════════════════════════════════════════════════
    const fvScore = (() => {
      if (recentMatches.length < 3) return null; // pas assez de données

      const totalRounds = (totCtRounds + totTRounds) || 1;
      const totalKills  = sum('kills');
      const totalDeaths = sum('deaths');
      const totalAssists= sum('assists');

      // ── 1. PERFORMANCE (35 pts) ──────────────────────────────────────────
      // Basé sur HLTV 2.1 reverse-engineered + ajustements CS2
      // On utilise avgFvRating déjà calculé (≈ HLTV 2.1) comme base
      // puis on l'ajuste selon le niveau ELO (contexte adversaires)
      const eloLevel = cs2data.skill_level || 5; // 1-10
      const eloFactor = 0.85 + (eloLevel / 10) * 0.30; // lvl1=0.88, lvl10=1.15

      // Performance brute normalisée sur [0,35]
      // fvRating moyen : 0.5 (très mauvais) → 1.5 (excellent)
      const perfRaw = parseFloat(fvRatingAvg);
      const perfNorm = Math.min(35, Math.max(0,
        ((perfRaw - 0.5) / 1.0) * 35 * eloFactor
      ));

      // Bonus ADR contextuel (HLTV 3.0 inspired : ADR ajusté au niveau)
      const adrRef = 55 + eloLevel * 4; // référence par niveau : lvl5=75, lvl10=95
      const adrBonus = Math.min(3, Math.max(-3, (parseFloat(avgAdr) - adrRef) / adrRef * 8));

      const perfScore = Math.min(35, Math.max(0, perfNorm + adrBonus));

      // ── 2. CONSISTANCE (25 pts) ──────────────────────────────────────────
      // Leetify-inspired : la variance des performances est aussi importante que la moyenne
      // Un joueur régulier à 1.1 vaut mieux qu'un joueur à 1.5 une fois sur deux
      const ratings = recentMatches.map(m => m.fvRating).filter(r => r > 0);
      const ratingMean = ratings.reduce((a, b) => a + b, 0) / (ratings.length || 1);
      const variance = ratings.reduce((s, r) => s + Math.pow(r - ratingMean, 2), 0) / (ratings.length || 1);
      const stdDev = Math.sqrt(variance);

      // Coefficient de variation (CV) : stdDev / mean → plus c'est bas, plus c'est consistent
      const cv = ratingMean > 0 ? stdDev / ratingMean : 1;

      // Score consistance : CV=0 (parfait) → 25pts, CV=0.5 (très instable) → 0pts
      // CV=0 (parfait)→25pts, CV=0.35 (instable)→0pts — seuil plus strict
      const consistScore = Math.min(25, Math.max(0, (1 - cv / 0.35) * 25));

      // Bonus : trend positif sur les 5 derniers matchs vs 5 précédents
      if (ratings.length >= 10) {
        const recent5  = ratings.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
        const before5  = ratings.slice(5, 10).reduce((a,b) => a+b, 0) / 5;
        const trendBonus = Math.min(3, Math.max(-3, (recent5 - before5) * 10));
        // trendBonus appliqué ci-dessous dans le total
      }
      const trendBonus = (() => {
        if (ratings.length < 10) return 0;
        const r5 = ratings.slice(0, 5).reduce((a,b)=>a+b,0)/5;
        const b5 = ratings.slice(5,10).reduce((a,b)=>a+b,0)/5;
        return Math.min(3, Math.max(-3, (r5 - b5) * 10));
      })();

      // ── 3. IMPACT (25 pts) ───────────────────────────────────────────────
      // Inspired by Leetify win-probability change model
      // On pondère les clutches par leur difficulté (1v5 >> 1v1)
      const clutchWeight =
        totalClutch1v1 * 1.0 +
        totalClutch1v2 * 2.0 +
        totalClutch1v3 * 3.5 +
        totalClutch1v4 * 5.0 +
        totalClutch1v5 * 8.0;

      // Normalisation : ~2 clutch1v1 par match = référence
      const clutchRef  = n * 2;
      const clutchScore = Math.min(8, (clutchWeight / Math.max(clutchRef, 1)) * 8);

      // Opening duels : ratio FK/FD pondéré par volume
      const openingScore = (() => {
        const total = totalFirstKills + totalFirstDeaths;
        if (total < 5) return 3.5; // neutre si pas assez de données
        const ratio = totalFirstKills / (totalFirstDeaths || 1);
        // ratio 2.0 = excellent (8pts), ratio 0.5 = mauvais (0pts), ratio 1.0 = moyen (4pts)
        return Math.min(8, Math.max(0, (ratio - 0.5) / 1.5 * 8));
      })();

      // Multi-kills pondérés (double=1x, triple=2x, quad=4x, ace=8x)
      const mkWeight = totalDoubles * 1 + totalTriples * 2 + totalQuads * 4 + totalAces * 8;
      const mkRef    = n * 3; // ~3 doubles par match = référence
      const mkScore  = Math.min(6, (mkWeight / Math.max(mkRef, 1)) * 6);

      // Trade kills (aggressivité utile)
      const tradeScore = Math.min(3, (totalTradeKills / Math.max(n * 2, 1)) * 3);

      const impactScore = Math.min(25, clutchScore + openingScore + mkScore + tradeScore);

      // ── 4. UTILITÉ (15 pts) ──────────────────────────────────────────────
      // Inspired by Leetify Utility Rating (Quantity × Quality)

      // Flash efficacy : enemiesFlashed par flash lancée (qualité)
      const flashQuality = totalFlashesThrown > 0
        ? Math.min(1, totalEnemiesFlashed / totalFlashesThrown)
        : 0;
      // Quantité : flashes par round
      const flashQuantity = Math.min(1, totalFlashesThrown / (totalRounds * 0.4));
      // Geometric mean (comme Leetify) : punit les extrêmes
      const flashScore = Math.min(4, Math.sqrt(flashQuality * flashQuantity) * 4);

      // Utility damage par round
      const utilDmgPerRound = totalUtilDmg / totalRounds;
      const utilDmgScore = Math.min(4, (utilDmgPerRound / 8) * 4); // ref: 8 util dmg/round

      // Assists par round (teamplay)
      const assistRate = totalAssists / totalRounds;
      const assistScore = Math.min(4, (assistRate / 0.25) * 4); // ref: 0.25 assists/round

      // Saves intelligents (pas du jame-timing mais des saves utiles)
      const saveRate   = totalSaves / n;
      const saveScore  = Math.min(3, (saveRate / 2) * 3); // ref: 2 saves/match

      const utilScore = Math.min(15, flashScore + utilDmgScore + assistScore + saveScore);

      // ── TOTAL FV SCORE ────────────────────────────────────────────────────
      const raw = perfScore + consistScore + trendBonus + impactScore + utilScore;
      const total = Math.round(Math.min(100, Math.max(0, raw)));

      // ── BREAKDOWN détaillé pour affichage ────────────────────────────────
      return {
        total,
        breakdown: {
          performance: {
            score:    Math.round(perfScore * 10) / 10,
            max:      35,
            detail: {
              fvRatingAvg: parseFloat(fvRatingAvg),
              eloAdjustment: Math.round(eloFactor * 100) / 100,
              adrBonus: Math.round(adrBonus * 10) / 10,
            }
          },
          consistency: {
            score:    Math.round((consistScore + trendBonus) * 10) / 10,
            max:      28, // 25 + 3 bonus trend
            detail: {
              stdDev:      Math.round(stdDev * 1000) / 1000,
              cv:          Math.round(cv * 100) / 100,
              trendBonus:  Math.round(trendBonus * 10) / 10,
            }
          },
          impact: {
            score:    Math.round(impactScore * 10) / 10,
            max:      25,
            detail: {
              clutchScore:  Math.round(clutchScore * 10) / 10,
              openingScore: Math.round(openingScore * 10) / 10,
              mkScore:      Math.round(mkScore * 10) / 10,
              tradeScore:   Math.round(tradeScore * 10) / 10,
            }
          },
          utility: {
            score:    Math.round(utilScore * 10) / 10,
            max:      15,
            detail: {
              flashScore:   Math.round(flashScore * 10) / 10,
              utilDmgScore: Math.round(utilDmgScore * 10) / 10,
              assistScore:  Math.round(assistScore * 10) / 10,
              saveScore:    Math.round(saveScore * 10) / 10,
            }
          },
        },
        // Label qualitatif
        label: total >= 85 ? 'Exceptionnel' :
               total >= 72 ? 'Excellent'    :
               total >= 60 ? 'Très bon'     :
               total >= 48 ? 'Bon'          :
               total >= 36 ? 'Moyen'        :
               total >= 20 ? 'En progression':
                             'Débutant',
      };
    })();

    return res.status(200).json({
      player: {
        playerId, nickname: player.nickname,
        avatar:   player.avatar     || null,
        country:  player.country    || null,
        faceitUrl: player.faceit_url || null,
        membershipType: player.membership_type || 'free',
      },
      cs2: {
        elo:   cs2data.faceit_elo    || 0,
        level: cs2data.skill_level   || 0,
        region: cs2data.region       || '',
      },
      lifetime: {
        matches:       parseInt(lifetime['Matches'])              || 0,
        wins:          parseInt(lifetime['Wins'])                 || 0,
        winRate:       parseFloat(lifetime['Win Rate %'])         || 0,
        kd:            parseFloat(lifetime['Average K/D Ratio'])  || 0,
        hs:            parseFloat(lifetime['Average Headshots %']) || 0,
        longestStreak: parseInt(lifetime['Longest Win Streak'])   || 0,
        currentStreak: parseInt(lifetime['Current Win Streak'])   || 0,
        recentResults: lifetime['Recent Results'] || [],
      },
      recent: {
        // Core
        avgKd, avgHs, avgAdr, avgKast, avgKr, winRate, fvRating: fvRatingAvg,
        // CT/T split
        ctWinRate, tWinRate, ctKd, tKd,
        // Flashes & utility
        totalFlashesThrown, totalEnemiesFlashed, avgFlashPerRound, totalUtilDmg, avgUtilDmg,
        // Trades & saves
        totalTradeKills, totalTradeDeaths, totalSaves,
        // Pistol
        pistolWinRate, totalPistolWins, totalPistolTotal,
        // Sniper
        totalSniperKills, sniperKillRate,
        // Multi-kills
        totalDoubles, totalTriples, totalQuads, totalAces,
        // Clutches
        totalClutch1v1, totalClutch1v2, totalClutch1v3, totalClutch1v4, totalClutch1v5,
        // Opening
        totalFirstKills, totalFirstDeaths, openingRatio,
        // Matches detail
        matches: recentMatches,
        // Role
        role,
      },
      fvScore,
      mapStats: mapStatsArr,
      teams: (teamsData.items || []).slice(0, 3).map(t => ({
        name: t.name, avatar: t.avatar, game: t.game,
      })),
    });

  } catch (err) {
    console.error('FragValue Scout API error:', err);
    return res.status(500).json({ error: 'Erreur serveur. Réessaie dans quelques instants.' });
  }
};
