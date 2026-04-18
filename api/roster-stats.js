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

    // Top performer du roster (par FV Rating)
    const ranked = results.map(r => ({
      nickname: r.scout.player?.nickname,
      fvRating: parseFloat(r.scout.recent?.fvRating) || 0,
      kd:       parseFloat(r.scout.recent?.avgKd) || 0,
      role:     r.player.team_role,
      level:    r.scout.cs2?.level || 0,
      elo:      r.scout.cs2?.elo || 0,
    })).sort((a, b) => b.fvRating - a.fvRating);
    const topPerformer = ranked[0];

    // Team composite score (0-100) : moyenne ponderee FV + KAST + Win rate
    const teamScore = Math.round(
      Math.min(100, Math.max(0,
        (parseFloat(avgFvRating) - 0.7) / 0.6 * 50 +   // 50pts pour FV 0.7→1.3
        (parseFloat(avgKast)) / 100 * 25 +             // 25pts pour KAST 0→100
        (avgWinRate) / 100 * 25                        // 25pts pour WR 0→100
      ))
    );
    const teamRank = teamScore >= 75 ? 'Elite' : teamScore >= 60 ? 'Solide' : teamScore >= 45 ? 'En progression' : 'Débutant';

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
        role_distribution: roleDist,
        top_performer: topPerformer,
        map_pool: topMaps,
        best_map: bestMap,
        worst_map: worstMap,
      },
    };

    _cache.set(rosterId, { ts: Date.now(), data });
    return res.status(200).json(data);
  } catch (err) {
    console.error('roster-stats error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
