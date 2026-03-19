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
      const kast    = parseFloat(s['KAST'])           || 0;
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
