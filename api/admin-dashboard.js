// api/admin-dashboard.js
// Endpoint admin qui agrège les KPIs business pour le dashboard interne.
//
// Auth (defense en profondeur) :
//   1. JWT Supabase valide
//   2. user.email DOIT etre dans ADMIN_EMAILS (env var)
//
// Output : JSON avec users, subscriptions, MRR, demos, Discord, broadcasts,
// feedback, errors, last 24h activity.
//
// Toutes les queries en parallele (Promise.all). Pas de cache : admin only,
// faible trafic. Latence typique ~200-500ms selon taille DB.

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

// Tarifs en EUR/mois pour estimation MRR.
// Pour les plans yearly, on divise par 12 (MRR equivalent mensuel).
const PRICE_MONTHLY = {
  pro_monthly:   9,
  pro_yearly:    79 / 12,    // ~6.58
  elite_monthly: 29,
  elite_yearly:  290 / 12,   // ~24.17
};

function getAdminEmails() {
  const fromEnv = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const FALLBACK = ['qdreuillet@gmail.com', 'valuefrag@gmail.com'];
  return Array.from(new Set([...fromEnv, ...FALLBACK]));
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth required' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    const adminEmails = getAdminEmails();
    if (!adminEmails.includes((user.email || '').toLowerCase())) {
      return res.status(403).json({ error: 'Forbidden, admin only' });
    }

    const now = new Date();
    const dayMs = 86400000;
    const todayIso  = new Date(now.getTime() - dayMs).toISOString();
    const sevenIso  = new Date(now.getTime() - 7  * dayMs).toISOString();
    const thirtyIso = new Date(now.getTime() - 30 * dayMs).toISOString();

    // Toutes les queries Supabase en parallele pour minimiser latence
    const [
      profilesAll,
      profilesNew24h,
      profilesNew7d,
      profilesNew30d,
      profilesByTier,
      profilesOptOut,
      subsAll,
      discordLinks,
      demosAll,
      demosToday,
      demos7d,
      demos30d,
      matchesAll,
      coachMsgsToday,
      coachMsgs7d,
      broadcastsRecent,
      feedbackRecent,
      featureInterests,
      errorsLast24h,
      unsubLast30d,
    ] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', sevenIso),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', thirtyIso),
      supabase.from('profiles').select('subscription_tier'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('marketing_opt_out', true),
      supabase.from('subscriptions').select('user_id, plan, status, current_period_end, cancel_at_period_end'),
      supabase.from('discord_links').select('user_id, linked_at'),
      supabase.from('demos').select('id', { count: 'exact', head: true }),
      supabase.from('demos').select('id', { count: 'exact', head: true }).gte('analysed_at', todayIso),
      supabase.from('demos').select('id', { count: 'exact', head: true }).gte('analysed_at', sevenIso),
      supabase.from('demos').select('id', { count: 'exact', head: true }).gte('analysed_at', thirtyIso),
      supabase.from('matches').select('id', { count: 'exact', head: true }),
      supabase.from('coach_messages').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
      supabase.from('coach_messages').select('id', { count: 'exact', head: true }).gte('created_at', sevenIso),
      supabase.from('email_broadcast_log').select('id, slug, subject, audience, sent_count, failed_count, recipients_count, triggered_by, triggered_at, completed_at').order('triggered_at', { ascending: false }).limit(5),
      supabase.from('user_feedback').select('id, created_at, rating, message').order('created_at', { ascending: false }).limit(5),
      supabase.from('feature_interests').select('id, feature_key, count'),
      supabase.from('error_logs').select('id', { count: 'exact', head: true }).gte('created_at', todayIso),
      supabase.from('email_unsubscribe_log').select('id', { count: 'exact', head: true }).eq('action', 'unsubscribed').gte('created_at', thirtyIso),
    ]);

    // Aggregation tier breakdown
    const tierCounts = { free: 0, pro: 0, elite: 0 };
    (profilesByTier.data || []).forEach(p => {
      const t = (p.subscription_tier || 'free').toLowerCase();
      if (t === 'pro') tierCounts.pro++;
      else if (t === 'elite') tierCounts.elite++;
      else tierCounts.free++;
    });

    // Subscriptions stats + MRR estimation
    const subs = subsAll.data || [];
    const subsByStatus = subs.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});
    const activeAndTrialing = subs.filter(s => s.status === 'active' || s.status === 'trialing');
    const mrrEur = activeAndTrialing.reduce((sum, s) => sum + (PRICE_MONTHLY[s.plan] || 0), 0);
    const arrEur = mrrEur * 12;
    const cancelScheduled = subs.filter(s => s.cancel_at_period_end).length;

    // Discord linked rate
    const discordCount = (discordLinks.data || []).length;
    const profilesTotal = profilesAll.count || 0;
    const discordRate = profilesTotal > 0 ? (discordCount / profilesTotal) : 0;

    // Conversion rate Free -> Paid (active+trialing / total profiles)
    const paidCount = activeAndTrialing.length;
    const conversionRate = profilesTotal > 0 ? (paidCount / profilesTotal) : 0;

    // Average demos per user (engagement metric)
    const demosPerUser = profilesTotal > 0 ? ((demosAll.count || 0) / profilesTotal) : 0;

    return res.status(200).json({
      ok: true,
      generated_at: now.toISOString(),
      users: {
        total: profilesTotal,
        new_24h: profilesNew24h.count || 0,
        new_7d:  profilesNew7d.count  || 0,
        new_30d: profilesNew30d.count || 0,
        by_tier: tierCounts,
        marketing_opt_out: profilesOptOut.count || 0,
      },
      revenue: {
        mrr_eur: Math.round(mrrEur * 100) / 100,
        arr_eur: Math.round(arrEur * 100) / 100,
        active_subs: activeAndTrialing.length,
        cancel_scheduled: cancelScheduled,
        subs_by_status: subsByStatus,
        conversion_rate: Math.round(conversionRate * 10000) / 100, // %
      },
      product: {
        demos_total: demosAll.count || 0,
        demos_today: demosToday.count || 0,
        demos_7d:    demos7d.count    || 0,
        demos_30d:   demos30d.count   || 0,
        matches_total: matchesAll.count || 0,
        demos_per_user: Math.round(demosPerUser * 100) / 100,
        coach_messages_today: coachMsgsToday.count || 0,
        coach_messages_7d:    coachMsgs7d.count    || 0,
      },
      discord: {
        linked_count: discordCount,
        link_rate: Math.round(discordRate * 10000) / 100, // %
      },
      email: {
        unsubscribed_30d: unsubLast30d.count || 0,
        recent_broadcasts: (broadcastsRecent.data || []).map(b => ({
          slug: b.slug,
          subject: b.subject,
          audience: b.audience,
          recipients: b.recipients_count,
          sent: b.sent_count,
          failed: b.failed_count,
          triggered_by: b.triggered_by,
          triggered_at: b.triggered_at,
          completed_at: b.completed_at,
        })),
      },
      health: {
        errors_24h: errorsLast24h.count || 0,
      },
      feedback: {
        recent: (feedbackRecent.data || []).map(f => ({
          id: f.id,
          rating: f.rating,
          message: (f.message || '').slice(0, 240),
          created_at: f.created_at,
        })),
        feature_interests: (featureInterests.data || []).sort((a, b) => (b.count || 0) - (a.count || 0)),
      },
    });
  } catch (err) {
    console.error('[admin-dashboard] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
