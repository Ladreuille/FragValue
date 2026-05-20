// api/account-stats.js · FragValue
//
// GET /api/account-stats
//
// Retourne les stats globales d'un user pour affichage dans /account.html :
//   - demos_total      : count cumulatif depuis l'inscription
//   - demos_last_30d   : count sur les 30 derniers jours
//   - fv_rating_avg    : moyenne sur les 20 dernieres demos (FV Rating)
//   - fv_rating_delta  : variation entre les 10 dernieres et les 10 precedentes
//   - ai_diagnostics   : count des diagnostics IA generes
//   - member_since     : ISO date d'inscription
//   - days_active      : jours depuis l'inscription (sunk-cost reinforcement)
//
// Auth : JWT Supabase requis.
// Cache : 60s (les stats changent peu).

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth requise' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  try {
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

    // Parallel fetch : profile (created_at) + demos counts + ratings + ai count
    const [profileRes, demosTotalRes, demosRecentRes, ratingsRes, aiCountRes] = await Promise.all([
      sb.from('profiles').select('created_at').eq('id', user.id).maybeSingle(),
      sb.from('demos').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      sb.from('demos').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('analysed_at', monthAgo),
      // On recupere les 20 dernieres demos avec leur FV Rating pour calculer
      // la moyenne + delta (10 recentes vs 10 precedentes).
      sb.from('demos').select('fv_rating, analysed_at').eq('user_id', user.id)
        .not('fv_rating', 'is', null)
        .order('analysed_at', { ascending: false })
        .limit(20),
      // Diagnostics IA generes : table diagnostic_history (1 row par
      // diagnostic Coach IA refresh par match).
      sb.from('diagnostic_history').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    ]);

    const memberSince = profileRes.data?.created_at || null;
    const daysActive = memberSince
      ? Math.floor((Date.now() - new Date(memberSince).getTime()) / 86400000)
      : 0;
    const demosTotal = demosTotalRes.count || 0;
    const demosLast30 = demosRecentRes.count || 0;
    const ratings = (ratingsRes.data || []).map(d => parseFloat(d.fv_rating)).filter(x => !isNaN(x));

    let fvRatingAvg = null;
    let fvRatingDelta = null;
    if (ratings.length >= 1) {
      fvRatingAvg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
    }
    if (ratings.length >= 6) {
      // Delta : moyenne(10 plus recentes) vs moyenne(10 precedentes) si dispo,
      // sinon moitie sup vs moitie inf (sur les ratings tries DESC par analysed_at).
      const half = Math.floor(ratings.length / 2);
      const recent = ratings.slice(0, half);
      const older  = ratings.slice(half);
      const avgRecent = recent.reduce((s, r) => s + r, 0) / recent.length;
      const avgOlder  = older.reduce((s, r) => s + r, 0) / older.length;
      if (avgOlder > 0) {
        fvRatingDelta = ((avgRecent - avgOlder) / avgOlder) * 100;
      }
    }

    return res.status(200).json({
      demos_total:     demosTotal,
      demos_last_30d:  demosLast30,
      fv_rating_avg:   fvRatingAvg != null ? Number(fvRatingAvg.toFixed(2)) : null,
      fv_rating_delta: fvRatingDelta != null ? Number(fvRatingDelta.toFixed(1)) : null,
      ai_diagnostics:  aiCountRes.count || 0,
      member_since:    memberSince,
      days_active:     daysActive,
    });
  } catch (err) {
    console.error('[account-stats] error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
