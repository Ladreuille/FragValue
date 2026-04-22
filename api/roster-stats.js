// api/roster-stats.js // FragValue
// Agrege les stats FACEIT des membres d'un roster pour donner une vue
// collective (FV Rating moyen, K/D moyen, best/worst map, map pool, role
// distribution).
//
// GET /api/roster-stats?roster_id=xxx
//
// Cache memoire simple (60s) pour eviter le spam scout API.

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const CACHE_TTL_MS = 60 * 1000;
const _cache = new Map();

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rosterId = req.query.roster_id;
  if (!rosterId) return res.status(400).json({ error: 'roster_id requis' });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  // Cache
  const cached = _cache.get(rosterId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return res.status(200).json(cached.data);
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data: roster } = await supabase
      .from('rosters').select('id, team_name, tag, region, visibility')
      .eq('id', rosterId).maybeSingle();
    if (!roster) return res.status(404).json({ error: 'Roster introuvable' });

    const { data: players } = await supabase
      .from('roster_players').select('faceit_nickname, team_role, is_captain, is_sub')
      .eq('roster_id', rosterId);
    if (!players || players.length === 0) {
      return res.status(200).json({ roster, players: [], aggregated: null });
    }

    // Fetch scout data pour chaque membre en parallele (reuse /api/scout logic
    // via fetch interne). Si un pseudo manque ou echoue on continue.
    const host = req.headers.host ? `https://${req.headers.host}` : 'https://fragvalue.com';
    const statsPromises = players
      .filter(p => p.faceit_nickname)
      .map(async p => {
        try {
          const res = await fetch(`${host}/api/scout?nickname=${encodeURIComponent(p.faceit_nickname)}`, {
            headers: { 'x-internal-roster-stats': '1' },
          });
          if (!res.ok) return null;
          const d = await res.json();
          if (!d.player) return null;
          return { player: p, scout: d };
        } catch { return null; }
      });
    const results = (await Promise.all(statsPromises)).filter(Boolean);

    const n = results.length;
    if (n === 0) return res.status(200).json({ roster, players, aggregated: null });

    // ── Aggregates ────────────────────────────────────────────────────────
    const sum = (fn) => results.reduce((s, r) => s + (parseFloat(fn(r)) || 0), 0);
    const avg = (fn) => sum(fn) / n;

    const avgKd      = avg(r => r.scout.recent?.avgKd).toFixed(2);
    const avgAdr     = avg(r => r.scout.recent?.avgAdr).toFixed(1);
    const avgHs      = avg(r => r.scout.recent?.avgHs).toFixed(1);
    const avgKast    = avg(r => r.scout.recent?.avgKast).toFixed(1);
    const avgFvRating= avg(r => r.scout.recent?.fvRating).toFixed(2);
    const avgWinRate = Math.round(avg(r => r.scout.recent?.winRate));
    const avgElo     = Math.round(avg(r => r.scout.cs2?.elo));
    const avgLevel   = (avg(r => r.scout.cs2?.level)).toFixed(1);

    // Side split (CT/T) : moyenne des win rates de chaque membre
    const ctRates = results.map(r => parseFloat(r.scout.recent?.ctWinRate)).filter(v => !isNaN(v) && v > 0);
    const tRates  = results.map(r => parseFloat(r.scout.recent?.tWinRate)).filter(v => !isNaN(v) && v > 0);
    const avgCtWinRate = ctRates.length > 0 ? Math.round(ctRates.reduce((a, b) => a + b, 0) / ctRates.length) : null;
    const avgTWinRate  = tRates.length  > 0 ? Math.round(tRates.reduce((a, b) => a + b, 0) / tRates.length) : null;
    const sideGap = (avgCtWinRate != null && avgTWinRate != null) ? avgCtWinRate - avgTWinRate : null;

    // Role distribution depuis roster_players.team_role
    const roleDist = {};
    players.forEach(p => {
      const role = p.team_role || 'unknown';
      roleDist[role] = (roleDist[role] || 0) + 1;
    });

    // Map pool agrege : somme des matchs par map sur tous les membres, garde top 5
    const mapPool = {};
    results.forEach(r => {
      (r.scout.mapStats || []).forEach(m => {
        if (!mapPool[m.map]) mapPool[m.map] = { map: m.map, matches: 0, wins: 0, fvSum: 0, fvCount: 0 };
        mapPool[m.map].matches += (m.matches || 0);
        mapPool[m.map].wins    += Math.round((m.winRate / 100) * m.matches);
        mapPool[m.map].fvSum   += parseFloat(m.avgFvRating || 0) * (m.matches || 0);
        mapPool[m.map].fvCount += m.matches || 0;
      });
    });
    const topMaps = Object.values(mapPool)
      .map(m => ({
        map: m.map,
        total_matches: m.matches,
        team_win_rate: m.matches > 0 ? Math.round((m.wins / m.matches) * 100) : 0,
        team_avg_fv: m.fvCount > 0 ? parseFloat((m.fvSum / m.fvCount).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.total_matches - a.total_matches)
      .slice(0, 5);

    // Best / worst map (min 3 matchs collectifs cumules)
    const qualifiedMaps = topMaps.filter(m => m.total_matches >= 3);
    const bestMap  = qualifiedMaps.length > 0 ? qualifiedMaps.reduce((b, m) => m.team_win_rate > b.team_win_rate ? m : b) : null;
    const worstMap = qualifiedMaps.length > 0 ? qualifiedMaps.reduce((w, m) => m.team_win_rate < w.team_win_rate ? m : w) : null;

    // Top performer du roster (par FV Score) + tous les membres detailles
    // fvScore.total est le score 0-100 du dashboard. On l'expose ici pour
    // unifier le scoring individuel / collectif (pas de formule parallele).
    const members = results.map(r => ({
      nickname:    r.scout.player?.nickname || r.player.faceit_nickname,
      avatar:      r.scout.player?.avatar || null,
      role:        r.player.team_role || 'unknown',
      is_captain:  !!r.player.is_captain,
      is_sub:      !!r.player.is_sub,
      level:       r.scout.cs2?.level || 0,
      elo:         r.scout.cs2?.elo || 0,
      fvRating:    parseFloat(r.scout.recent?.fvRating) || 0,
      fvScore:     r.scout.fvScore?.total ?? null,
      fvScoreLabel: r.scout.fvScore?.label || null,
      kd:          parseFloat(r.scout.recent?.avgKd) || 0,
      adr:         parseFloat(r.scout.recent?.avgAdr) || 0,
      hs:          parseFloat(r.scout.recent?.avgHs) || 0,
      kast:        parseFloat(r.scout.recent?.avgKast) || 0,
      winRate:     parseFloat(r.scout.recent?.winRate) || 0,
      ctWinRate:   parseFloat(r.scout.recent?.ctWinRate) || null,
      tWinRate:    parseFloat(r.scout.recent?.tWinRate)  || null,
      firstKills:  parseInt(r.scout.recent?.totalFirstKills) || 0,
      firstDeaths: parseInt(r.scout.recent?.totalFirstDeaths) || 0,
      clutch1v1:   parseInt(r.scout.recent?.totalClutch1v1) || 0,
      clutch1v2:   parseInt(r.scout.recent?.totalClutch1v2) || 0,
      openingRatio: parseFloat(r.scout.recent?.openingRatio) || 0,
      sniperKillRate: parseFloat(r.scout.recent?.sniperKillRate) || 0,
      currentStreak: parseInt(r.scout.lifetime?.currentStreak) || 0,
    }));
    const ranked = [...members].sort((a, b) => (b.fvScore ?? b.fvRating * 50) - (a.fvScore ?? a.fvRating * 50));
    const topPerformer = ranked[0];

    // ── Collective insights : heuristiques actionnables ────────────────────
    const insights = [];
    const fvNum = parseFloat(avgFvRating);
    const kastNum = parseFloat(avgKast);

    // Top / bottom performer
    if (ranked.length >= 2) {
      const best = ranked[0]; const worst = ranked[ranked.length - 1];
      if (best.fvRating - worst.fvRating > 0.25) {
        insights.push({ type: 'warning', icon: 'gap', title: 'Ecart de niveau notable',
          message: `${best.nickname} (FV ${best.fvRating.toFixed(2)}) porte l'equipe vs ${worst.nickname} (FV ${worst.fvRating.toFixed(2)}). Renforcer les bas niveaux ou reequilibrer les roles.` });
      }
    }

    // Side balance
    if (sideGap != null && Math.abs(sideGap) >= 8) {
      if (sideGap > 0) {
        insights.push({ type: 'info', icon: 'side', title: 'Equipe CT-sided',
          message: `${avgCtWinRate}% en CT vs ${avgTWinRate}% en T (+${sideGap}pts). Forcer les gun-rounds en CT start, anti-eco plus serieux en T start.` });
      } else {
        insights.push({ type: 'info', icon: 'side', title: 'Equipe T-sided',
          message: `${avgTWinRate}% en T vs ${avgCtWinRate}% en CT (${sideGap}pts). Prioriser les maps a T-side fort (Mirage, Dust2, Inferno). Travailler le setup CT.` });
      }
    }

    // Map best/worst
    if (bestMap && bestMap.team_win_rate >= 60) {
      const mapName = (bestMap.map || '').replace('de_', '').replace(/^\w/, c => c.toUpperCase());
      insights.push({ type: 'success', icon: 'map', title: `${mapName} = ta map signature`,
        message: `${bestMap.team_win_rate}% de WR collectif sur ${bestMap.total_matches} matchs. A pick systematiquement en BO3.` });
    }
    if (worstMap && worstMap.team_win_rate <= 40 && worstMap.total_matches >= 5) {
      const mapName = (worstMap.map || '').replace('de_', '').replace(/^\w/, c => c.toUpperCase());
      insights.push({ type: 'danger', icon: 'map', title: `${mapName} = map a eviter`,
        message: `${worstMap.team_win_rate}% de WR sur ${worstMap.total_matches} matchs. Ban prioritaire ou gros travail d'entrainement.` });
    }

    // Role coverage
    const hasIgl = members.some(m => m.role === 'igl');
    const hasAwp = members.some(m => m.role === 'awp' || m.role === 'awper');
    if (!hasIgl) {
      insights.push({ type: 'warning', icon: 'role', title: 'Pas d\'IGL designe',
        message: 'Aucun membre n\'a le role IGL. Designer un joueur pour appeler les rounds ameliore la coherence tactique.' });
    }
    if (!hasAwp) {
      insights.push({ type: 'warning', icon: 'role', title: 'Pas d\'AWPer designe',
        message: 'Aucun membre n\'a le role AWP. L\'AWP est un role crucial en CS2 pro, surtout en CT side.' });
    }

    // Opening potential
    const bestOpener = [...members].sort((a, b) => (b.firstKills - b.firstDeaths) - (a.firstKills - a.firstDeaths))[0];
    if (bestOpener && bestOpener.firstKills > 0 && (bestOpener.firstKills - bestOpener.firstDeaths) >= 5) {
      insights.push({ type: 'success', icon: 'opening', title: 'Entry fragger identifie',
        message: `${bestOpener.nickname} a ${bestOpener.firstKills} opening kills vs ${bestOpener.firstDeaths} deaths. Il doit prendre les first duels prio.` });
    }

    // Team score context
    if (fvNum >= 1.10) {
      insights.push({ type: 'success', icon: 'trophy', title: 'Niveau competitif',
        message: `FV Rating collectif ${avgFvRating}. Vous avez le niveau pour viser des tournois amateurs serieux.` });
    } else if (fvNum < 0.85) {
      insights.push({ type: 'danger', icon: 'trophy', title: 'Fondations a solidifier',
        message: `FV Rating collectif ${avgFvRating}. Focus sur les fondamentaux (crosshair placement, utility lineups, communication) avant les strats complexes.` });
    }

    // Team Score (0-100) : moyenne des FV Score individuels des membres.
    // C'est la MEME formule que le dashboard /api/scout.fvScore.total, donc
    // un roster de 1 membre a un Team Score = au FV Score de ce membre.
    // Fallback si aucun fvScore dispo (< 3 matchs) : ancienne formule
    // FV Rating + KAST + WR.
    const scores = members.map(m => m.fvScore).filter(v => v != null);
    let teamScore;
    if (scores.length > 0) {
      teamScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    } else {
      teamScore = Math.round(
        Math.min(100, Math.max(0,
          (parseFloat(avgFvRating) - 0.7) / 0.6 * 50 +
          (parseFloat(avgKast)) / 100 * 25 +
          (avgWinRate) / 100 * 25
        ))
      );
    }
    // Label aligne sur celui du fvScore (Debutant → Challenger).
    const teamRank = teamScore >= 90 ? 'Challenger'
      : teamScore >= 80 ? 'Elite+'
      : teamScore >= 70 ? 'Elite'
      : teamScore >= 58 ? 'Tres bon'
      : teamScore >= 46 ? 'Bon'
      : teamScore >= 34 ? 'Moyen'
      : teamScore >= 20 ? 'En progression'
                         : 'Debutant';

    const data = {
      roster,
      members_with_stats: n,
      total_members: players.length,
      aggregated: {
        team_score: teamScore,
        team_rank: teamRank,
        avg_fv_rating: avgFvRating,
        avg_kd: avgKd,
        avg_adr: avgAdr,
        avg_hs: avgHs,
        avg_kast: avgKast,
        avg_win_rate: avgWinRate,
        avg_elo: avgElo,
        avg_level: avgLevel,
        avg_ct_win_rate: avgCtWinRate,
        avg_t_win_rate: avgTWinRate,
        side_gap: sideGap,
        role_distribution: roleDist,
        top_performer: topPerformer,
        map_pool: topMaps,
        best_map: bestMap,
        worst_map: worstMap,
        members,              // Stats detaillees par membre (pour comparaison client-side)
        insights,             // Heuristiques actionnables
      },
    };

    _cache.set(rosterId, { ts: Date.now(), data });
    return res.status(200).json(data);
  } catch (err) {
    console.error('roster-stats error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
