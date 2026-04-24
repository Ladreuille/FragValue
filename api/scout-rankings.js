// api/scout-rankings.js // FragValue
// Retourne les leaderboards scout (global, entry, awp, clutch, support, etc.)
// Lit depuis player_rankings (calcule par un cron separe) + gate par tier/threshold.

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const VALID_TYPES = ['global','entry','awp','clutch','support','igl','rising','consistent','rookie','freeagent'];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  const type = (req.query.type || 'global').toLowerCase();
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: 'Type invalide' });
  const limit = Math.min(100, parseInt(req.query.limit) || 50);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Check waitlist status (unlock ou teaser) via RPC SECURITY DEFINER
    const { data: progressArr } = await supabase.rpc('scout_waitlist_progress');
    const progress = progressArr?.[0];
    const unlocked = !!(progress && progress.unlocked);

    // Determine le tier du user (pour post-launch gating)
    let userTier = 'anon';
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          userId = user.id;
          const { data: sub } = await supabase.from('subscriptions').select('plan, status').eq('user_id', user.id).single();
          if (sub && sub.status === 'active') {
            userTier = (sub.plan === 'elite' || sub.plan === 'team') ? 'elite' : sub.plan === 'pro' ? 'pro' : 'free';
          } else {
            userTier = 'free';
          }
        }
      } catch (_) {}
    }

    // Avant le launch : renvoyer uniquement le teaser (compte + threshold) + top 3 blurred par type
    if (!unlocked) {
      const { data: topRows } = await supabase
        .from('player_rankings')
        .select('nickname, rank, score')
        .eq('ranking_type', type)
        .order('rank', { ascending: true })
        .limit(3);
      return res.status(200).json({
        unlocked: false,
        progress: progress || { total_users: 0, opted_in_users: 0, threshold: 1000 },
        type,
        teaser_top3: (topRows || []).map(r => ({ rank: r.rank, nickname: '●●●●●●', score: r.score })),
      });
    }

    // Post-launch : gate par tier
    // Free : voit que sa propre position + top 10 du classement demande
    // Pro : voit tout (top 100 paginé)
    // Elite : voit tout + metadata complete
    if (userTier === 'free' || userTier === 'anon') {
      const { data: topRows } = await supabase
        .from('player_rankings')
        .select('nickname, rank, score')
        .eq('ranking_type', type)
        .order('rank', { ascending: true })
        .limit(10);
      // Position de l'user courant (si opt-in et present dans ce ranking)
      let ownRow = null;
      if (userId) {
        const { data: profile } = await supabase.from('profiles').select('faceit_nickname').eq('id', userId).single();
        if (profile && profile.faceit_nickname) {
          const { data: own } = await supabase
            .from('player_rankings')
            .select('nickname, rank, score')
            .eq('ranking_type', type)
            .ilike('nickname', profile.faceit_nickname)
            .single();
          ownRow = own || null;
        }
      }
      return res.status(200).json({
        unlocked: true,
        tier: userTier,
        type,
        rankings: topRows || [],
        own_position: ownRow,
        upgrade_cta: 'Passe Pro pour voir les classements complets',
      });
    }

    // Pro / Elite : top N avec metadata
    const { data: rows, count } = await supabase
      .from('player_rankings')
      .select('nickname, rank, score, metadata, player_id', { count: 'exact' })
      .eq('ranking_type', type)
      .order('rank', { ascending: true })
      .range(offset, offset + limit - 1);

    return res.status(200).json({
      unlocked: true,
      tier: userTier,
      type,
      total: count || 0,
      rankings: (rows || []).map(r => ({
        rank: r.rank,
        nickname: r.nickname,
        score: r.score,
        // Elite : metadata complete. Pro : subset des stats publiques.
        metadata: userTier === 'elite' ? r.metadata : sanitizeMetadata(r.metadata),
      })),
    });

  } catch (err) {
    console.error('scout-rankings error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

function sanitizeMetadata(meta) {
  if (!meta) return null;
  // Pour Pro : expose les stats publiques (pas de details sensibles)
  const { kd, adr, hsPct, fvRating, level, elo, role } = meta;
  return { kd, adr, hsPct, fvRating, level, elo, role };
}
