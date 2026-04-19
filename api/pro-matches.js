// api/pro-matches.js
// Liste paginée des matchs pros avec filtres.
//
// GET /api/pro-matches
//   ?event=<short_name>     filtre par tournoi
//   ?team=<team_name>       filtre par équipe (team_a OR team_b, case-insensitive)
//   ?map=<map_name>         filtre sur les matchs ayant au moins 1 map = map_name
//   ?limit=30               default 30, max 100
//   ?offset=0
//
// Returns:
//   { matches: [...], total: <int>, events: [...(pour UI filter)] }
//
// Pas d'auth requise : la liste est publique, le paywall se fait sur la
// page match individuelle (2D replay pro-only).

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const s = sb();
    const { event, team, map, limit, offset } = req.query || {};
    const lim = Math.min(Math.max(parseInt(limit || '30', 10), 1), 100);
    const off = Math.max(parseInt(offset || '0', 10), 0);

    // Base query avec jointure event pour récupérer short_name
    let query = s
      .from('pro_matches')
      .select(`
        id, stage, format, team_a, team_b, team_a_logo, team_b_logo,
        team_a_score, team_b_score, winner, best_player, best_rating,
        match_date, demo_available,
        pro_events!inner (id, name, short_name, tier)
      `, { count: 'exact' })
      .order('match_date', { ascending: false });

    if (event) query = query.eq('pro_events.short_name', event);
    // Sanitize team input avant interpolation dans le filtre .or()
    // PostgREST ne parametere pas le contenu de .or(), on whitelist [\w\s\-%] uniquement
    if (team) {
      const safeTeam = String(team).replace(/[^\w\s\-%.]/g, '').slice(0, 60);
      if (safeTeam) query = query.or(`team_a.ilike.${safeTeam},team_b.ilike.${safeTeam}`);
    }

    query = query.range(off, off + lim - 1);
    const { data: matches, count, error } = await query;
    if (error) throw error;

    // Si filtre map, on récupère en plus les maps jouées et on filtre les matchs
    let filtered = matches || [];
    if (map && filtered.length) {
      const ids = filtered.map(m => m.id);
      const { data: maps } = await s
        .from('pro_match_maps')
        .select('match_id')
        .in('match_id', ids)
        .ilike('map_name', map);
      const withMap = new Set((maps || []).map(m => m.match_id));
      filtered = filtered.filter(m => withMap.has(m.id));
    }

    // Attache les maps jouées (pour afficher les chips "Mirage 16·13")
    let mapsByMatch = {};
    if (filtered.length) {
      const { data: allMaps } = await s
        .from('pro_match_maps')
        .select('match_id, map_order, map_name, team_a_score, team_b_score')
        .in('match_id', filtered.map(m => m.id))
        .order('map_order');
      (allMaps || []).forEach(m => {
        if (!mapsByMatch[m.match_id]) mapsByMatch[m.match_id] = [];
        mapsByMatch[m.match_id].push(m);
      });
    }

    // Événements distincts (pour le dropdown filter côté front)
    const { data: events } = await s
      .from('pro_events')
      .select('id, name, short_name, tier')
      .order('start_date', { ascending: false });

    const result = filtered.map(m => ({
      id: m.id,
      stage: m.stage,
      format: m.format,
      team_a: m.team_a,
      team_b: m.team_b,
      team_a_logo: m.team_a_logo,
      team_b_logo: m.team_b_logo,
      team_a_score: m.team_a_score,
      team_b_score: m.team_b_score,
      winner: m.winner,
      best_player: m.best_player,
      best_rating: m.best_rating ? Number(m.best_rating) : null,
      match_date: m.match_date,
      demo_available: m.demo_available,
      event: m.pro_events ? {
        name: m.pro_events.name,
        short_name: m.pro_events.short_name,
        tier: m.pro_events.tier,
      } : null,
      maps: (mapsByMatch[m.id] || []).map(mm => ({
        order: mm.map_order,
        name: mm.map_name,
        score_a: mm.team_a_score,
        score_b: mm.team_b_score,
      })),
    }));

    // Cache CDN léger (les matchs changent peu)
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');

    return res.status(200).json({
      matches: result,
      total: count || result.length,
      events: events || [],
    });
  } catch (e) {
    console.error('pro-matches error', e);
    return res.status(500).json({ error: 'Erreur serveur', detail: e.message?.slice(0, 200) });
  }
};
