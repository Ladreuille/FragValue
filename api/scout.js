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

    // 2. Stats globales lifetime
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

    // 3. Stats par match récent
    const recentMatches = (recentStatsData.items || []).map(item => {
      const s = item.stats || {};
      const kills   = parseInt(s['Kills'])    || 0;
      const deaths  = parseInt(s['Deaths'])   || 0;
      const assists = parseInt(s['Assists'])  || 0;
      const hs      = parseInt(s['Headshots']) || 0;
      const rounds  = parseInt(s['Rounds'])   || 20;
      const kd      = parseFloat(s['K/D Ratio'])   || 0;
      const kr      = parseFloat(s['K/R Ratio'])   || 0;
      const adr     = parseFloat(s['ADR'])          || 0;
      const kast    = parseFloat(s['KAST'])          || 0;
      const hsPct   = parseFloat(s['Headshots %'])  || 0;
      const mvp     = parseInt(s['MVPs'])    || 0;
      const result  = parseInt(s['Result'])  || 0;

      // Multi-kills
      const double  = parseInt(s['Double Kills'])  || 0;
      const triple  = parseInt(s['Triple Kills'])  || 0;
      const quad    = parseInt(s['Quadro Kills'])  || 0;
      const ace     = parseInt(s['Penta Kills'])   || 0;

      // Clutches
      const clutch1v1 = parseInt(s['1v1Wins']) || parseInt(s['1v1 Wins']) || 0;
      const clutch1v2 = parseInt(s['1v2Wins']) || parseInt(s['1v2 Wins']) || 0;

      // Opening
      const firstKills  = parseInt(s['First Kills'])  || 0;
      const firstDeaths = parseInt(s['First Deaths']) || 0;

      // FV Rating 2.1 par match
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
        double, triple, quad, ace, clutch1v1, clutch1v2, firstKills, firstDeaths, fvRating,
      };
    });

    const n = recentMatches.length || 1;
    const avg = key => recentMatches.length > 0
      ? (recentMatches.reduce((s, m) => s + (m[key] || 0), 0) / n)
      : 0;

    // Moyennes récentes
    const avgKd       = avg('kd').toFixed(2);
    const avgHs       = avg('hsPct').toFixed(1);
    const avgAdr      = avg('adr').toFixed(1);
    const avgKast     = avg('kast').toFixed(1);
    const avgKr       = avg('kr').toFixed(3);
    const winRate     = recentMatches.length > 0
      ? ((recentMatches.filter(m => m.result === 1).length / n) * 100).toFixed(0)
      : (parseFloat(lifetime['Win Rate %']) || 0).toFixed(0);

    // Multi-kills totaux récents
    const totalDoubles = recentMatches.reduce((s, m) => s + m.double, 0);
    const totalTriples = recentMatches.reduce((s, m) => s + m.triple, 0);
    const totalQuads   = recentMatches.reduce((s, m) => s + m.quad,   0);
    const totalAces    = recentMatches.reduce((s, m) => s + m.ace,    0);

    // Clutches totaux récents
    const totalClutch1v1 = recentMatches.reduce((s, m) => s + m.clutch1v1, 0);
    const totalClutch1v2 = recentMatches.reduce((s, m) => s + m.clutch1v2, 0);

    // Opening duels
    const totalFirstKills  = recentMatches.reduce((s, m) => s + m.firstKills,  0);
    const totalFirstDeaths = recentMatches.reduce((s, m) => s + m.firstDeaths, 0);
    const openingRatio = totalFirstDeaths > 0
      ? (totalFirstKills / totalFirstDeaths).toFixed(2)
      : totalFirstKills.toString();

    // FV Rating global (moyenne des 20 matchs)
    const fvRatingAvg = recentMatches.length > 0
      ? (recentMatches.reduce((s, m) => s + m.fvRating, 0) / n).toFixed(2)
      : '0.00';

    // Stats par map
    const mapStats = {};
    recentMatches.forEach(m => {
      if (!m.map || m.map === '—') return;
      if (!mapStats[m.map]) mapStats[m.map] = { wins: 0, total: 0, kills: 0, deaths: 0 };
      mapStats[m.map].total++;
      if (m.result === 1) mapStats[m.map].wins++;
      mapStats[m.map].kills  += m.kills;
      mapStats[m.map].deaths += m.deaths;
    });
    const mapStatsArr = Object.entries(mapStats).map(([map, d]) => ({
      map,
      winRate:    ((d.wins / d.total) * 100).toFixed(0),
      kd:         d.deaths > 0 ? (d.kills / d.deaths).toFixed(2) : d.kills.toString(),
      matches:    d.total,
    })).sort((a, b) => b.matches - a.matches);

    return res.status(200).json({
      player: {
        playerId, nickname: player.nickname,
        avatar:   player.avatar     || null,
        country:  player.country    || null,
        faceitUrl: player.faceit_url || null,
        membershipType: player.membership_type || 'free',
      },
      cs2: {
        elo:        cs2data.faceit_elo    || 0,
        level:      cs2data.skill_level   || 0,
        levelLabel: cs2data.skill_level_label || '',
        region:     cs2data.region        || '',
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
        avgKd, avgHs, avgAdr, avgKast, avgKr, winRate, fvRating: fvRatingAvg,
        totalDoubles, totalTriples, totalQuads, totalAces,
        totalClutch1v1, totalClutch1v2,
        totalFirstKills, totalFirstDeaths, openingRatio,
        matches: recentMatches,
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
