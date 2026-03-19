module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { nickname } = req.query;

  if (!nickname) {
    return res.status(400).json({ error: 'Pseudo FACEIT manquant.' });
  }

  const API_KEY = process.env.FACEIT_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'Clé API FACEIT non configurée.' });
  }

  const headers = { Authorization: `Bearer ${API_KEY}` };
  const BASE = 'https://open.faceit.com/data/v4';

  try {
    // 1. Récupère le profil joueur par nickname
    const playerRes = await fetch(`${BASE}/players?nickname=${encodeURIComponent(nickname)}`, { headers });
    if (!playerRes.ok) {
      if (playerRes.status === 404) return res.status(404).json({ error: `Joueur "${nickname}" introuvable sur FACEIT.` });
      return res.status(playerRes.status).json({ error: `Erreur FACEIT API: ${playerRes.status}` });
    }
    const player = await playerRes.json();
    const playerId = player.player_id;

    // Vérifie que le joueur a CS2
    const cs2data = player.games?.cs2;
    if (!cs2data) {
      return res.status(404).json({ error: `Ce joueur n'a pas de données CS2 sur FACEIT.` });
    }

    // 2. Stats globales CS2
    const statsRes = await fetch(`${BASE}/players/${playerId}/stats/cs2`, { headers });
    const statsData = statsRes.ok ? await statsRes.json() : null;

    // 3. Historique des 20 derniers matchs
    const historyRes = await fetch(`${BASE}/players/${playerId}/history?game=cs2&limit=20`, { headers });
    const historyData = historyRes.ok ? await historyRes.json() : { items: [] };

    // 4. Stats des 20 derniers matchs (pour graphiques)
    const recentStatsRes = await fetch(`${BASE}/players/${playerId}/games/cs2/stats?limit=20`, { headers });
    const recentStatsData = recentStatsRes.ok ? await recentStatsRes.json() : { items: [] };

    // 5. Équipes du joueur
    const teamsRes = await fetch(`${BASE}/players/${playerId}/teams`, { headers });
    const teamsData = teamsRes.ok ? await teamsRes.json() : { items: [] };

    // ── Extraction des stats lifetime ──────────────────────────────────────
    const lifetime = statsData?.lifetime || {};

    // ── Stats par match récent (pour graphiques de progression) ───────────
    const recentMatches = (recentStatsData.items || []).map(item => {
      const s = item.stats || {};
      return {
        matchId:  s['Match Id']        || '',
        date:     s['Match Finished At'] ? new Date(parseInt(s['Match Finished At'])).toLocaleDateString('fr-FR') : '',
        kills:    parseInt(s['Kills'])   || 0,
        deaths:   parseInt(s['Deaths'])  || 0,
        assists:  parseInt(s['Assists']) || 0,
        hs:       parseInt(s['Headshots']) || 0,
        hsPct:    parseFloat(s['Headshots %']) || 0,
        kd:       parseFloat(s['K/D Ratio'])   || 0,
        kr:       parseFloat(s['K/R Ratio'])   || 0,
        mvp:      parseInt(s['MVPs'])    || 0,
        result:   parseInt(s['Result'])  || 0,
        map:      s['Map'] || '',
        kast:     parseFloat(s['KAST'])  || 0,
        adr:      parseFloat(s['ADR'])   || 0,
        score:    s['Score'] || '',
      };
    });

    // ── Calculs moyennes ───────────────────────────────────────────────────
    const avgKd  = recentMatches.length > 0
      ? (recentMatches.reduce((s, m) => s + m.kd, 0) / recentMatches.length).toFixed(2)
      : (parseFloat(lifetime['Average K/D Ratio']) || 0).toFixed(2);

    const avgHs  = recentMatches.length > 0
      ? (recentMatches.reduce((s, m) => s + m.hsPct, 0) / recentMatches.length).toFixed(1)
      : (parseFloat(lifetime['Average Headshots %']) || 0).toFixed(1);

    const avgKast = recentMatches.length > 0 && recentMatches[0].kast > 0
      ? (recentMatches.reduce((s, m) => s + m.kast, 0) / recentMatches.length).toFixed(1)
      : null;

    const avgAdr = recentMatches.length > 0 && recentMatches[0].adr > 0
      ? (recentMatches.reduce((s, m) => s + m.adr, 0) / recentMatches.length).toFixed(1)
      : null;

    const winRate = recentMatches.length > 0
      ? ((recentMatches.filter(m => m.result === 1).length / recentMatches.length) * 100).toFixed(0)
      : (parseFloat(lifetime['Win Rate %']) || 0).toFixed(0);

    // ── ELO progression (pour graphique) ──────────────────────────────────
    const eloHistory = (historyData.items || []).slice(0, 20).reverse().map((m, i) => ({
      index: i + 1,
      matchId: m.match_id,
      result: m.results?.winner,
    }));

    // ── Réponse finale ─────────────────────────────────────────────────────
    return res.status(200).json({
      player: {
        playerId,
        nickname:    player.nickname,
        avatar:      player.avatar      || null,
        country:     player.country     || null,
        faceitUrl:   player.faceit_url  || null,
        membershipType: player.membership_type || 'free',
      },
      cs2: {
        elo:        cs2data.faceit_elo    || 0,
        level:      cs2data.skill_level   || 0,
        levelLabel: cs2data.skill_level_label || '',
        region:     cs2data.region        || '',
      },
      lifetime: {
        matches:    parseInt(lifetime['Matches'])          || 0,
        wins:       parseInt(lifetime['Wins'])             || 0,
        winRate:    parseFloat(lifetime['Win Rate %'])     || 0,
        kd:         parseFloat(lifetime['Average K/D Ratio']) || 0,
        hs:         parseFloat(lifetime['Average Headshots %']) || 0,
        longestStreak: parseInt(lifetime['Longest Win Streak']) || 0,
        recentResults: lifetime['Recent Results'] || [],
      },
      recent: {
        avgKd,
        avgHs,
        avgKast,
        avgAdr,
        winRate,
        matches: recentMatches,
      },
      teams: (teamsData.items || []).slice(0, 3).map(t => ({
        name:   t.name,
        avatar: t.avatar,
        game:   t.game,
      })),
    });

  } catch (err) {
    console.error('FragValue Scout API error:', err);
    return res.status(500).json({ error: 'Erreur serveur. Réessaie dans quelques instants.' });
  }
};
