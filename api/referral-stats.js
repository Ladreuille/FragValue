// api/referral-stats.js · FragValue
//
// Endpoint user : retourne les stats parrainage de l'user.
//   GET /api/referral-stats
//   -> {
//        code,                    // referral_code de l'user
//        share_url,               // URL pre-formattee a partager
//        filleuls: {
//          total,                 // count des users referred_by = code
//          recent_30d,            // count filleuls signups dans 30j
//          paying,                // count filleuls qui ont une sub Pro/Elite active
//        },
//        rewards: {
//          months_earned,         // = paying * 1 (1 mois par filleul payant)
//          months_applied,        // applied via Stripe coupon (manuel pour MVP)
//          months_pending,        // earned - applied = a appliquer
//        }
//      }
//
// Auth : JWT Supabase requis.

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const BASE_URL = 'https://fragvalue.com';

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth required' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    // 1. Get user's own referral_code (trigger set_referral_code l'a auto-genere)
    const { data: profile } = await supabase
      .from('profiles')
      .select('referral_code')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.referral_code) {
      return res.status(200).json({
        code: null,
        share_url: null,
        filleuls: { total: 0, recent_30d: 0, paying: 0 },
        rewards: { months_earned: 0, months_applied: 0, months_pending: 0 },
        error: 'Code parrainage non genere (relancer signup ou support).',
      });
    }

    const code = profile.referral_code;
    const shareUrl = `${BASE_URL}/?ref=${code}`;

    // 2. Count filleuls : profiles.referred_by = user.id
    const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const [totalRes, recentRes, filleulsListRes] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', user.id),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('referred_by', user.id).gte('referred_at', monthAgo),
      supabase.from('profiles').select('id').eq('referred_by', user.id),
    ]);

    const filleulsList = filleulsListRes.data || [];
    const filleulsIds = filleulsList.map(p => p.id);

    // 3. Count filleuls payants : ceux qui ont une subscription active
    let payingCount = 0;
    if (filleulsIds.length > 0) {
      const { count } = await supabase
        .from('subscriptions')
        .select('user_id', { count: 'exact', head: true })
        .in('user_id', filleulsIds)
        .eq('status', 'active');
      payingCount = count || 0;
    }

    // 4. Rewards : 1 mois Pro gratuit par filleul payant.
    // months_applied : track via DB column profiles.referral_months_applied
    // (a creer si pas la). MVP : on retourne 0 applied = tout est pending,
    // l'admin applique manuellement via Stripe pour l'instant.
    const monthsEarned = payingCount;
    const monthsApplied = 0;  // MVP : manuel pour l'instant
    const monthsPending = Math.max(0, monthsEarned - monthsApplied);

    return res.status(200).json({
      code,
      share_url: shareUrl,
      filleuls: {
        total: totalRes.count || 0,
        recent_30d: recentRes.count || 0,
        paying: payingCount,
      },
      rewards: {
        months_earned: monthsEarned,
        months_applied: monthsApplied,
        months_pending: monthsPending,
      },
    });
  } catch (err) {
    console.error('[referral-stats] error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
