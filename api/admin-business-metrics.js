// api/admin-business-metrics.js
// FragValue admin : metriques business (DAU/WAU/MAU + funnel + churn)
//
// Output JSON :
//   {
//     active_users: { dau, wau, mau, dau_wau_ratio },
//     funnel: { signups, faceit_linked, first_demo, first_diag, pro_users, conversion_pct },
//     churn: { cancel_30d, cancel_pct, active_pro, active_elite },
//     trends: { signups_7d, signups_30d, conversions_30d },
//     window_days: 30,
//   }
//
// Auth : JWT + admin email check (idem admin-dashboard).
// Latence : ~300-600ms (8 queries en parallele).

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

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
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });
    if (!getAdminEmails().includes((user.email || '').toLowerCase())) {
      return res.status(403).json({ error: 'Forbidden, admin only' });
    }

    const now = Date.now();
    const dayMs = 86400000;
    const dayIso  = new Date(now - 1  * dayMs).toISOString();
    const weekIso = new Date(now - 7  * dayMs).toISOString();
    const monthIso= new Date(now - 30 * dayMs).toISOString();

    // ── Active Users (DAU/WAU/MAU)
    // Definition "active" = a fait une action tracee (notification recue,
    // demo analysee, diagnostic genere, ou coach msg envoye) dans la fenetre.
    // On unifie via SELECT DISTINCT user_id depuis 4 tables source.
    const activeUsersInWindow = async (sinceIso) => {
      const tables = [
        { table: 'notifications', col: 'user_id', date: 'created_at' },
        { table: 'matches',       col: 'user_id', date: 'created_at' },
        { table: 'diagnostic_history', col: 'user_id', date: 'generated_at' },
        { table: 'coach_messages', col: 'conversation_id', date: 'created_at' }, // indirect via conv -> user
      ];
      const ids = new Set();
      // 3 directes
      for (const t of tables.slice(0, 3)) {
        const { data } = await sb.from(t.table).select(t.col).gte(t.date, sinceIso);
        (data || []).forEach(r => { if (r[t.col]) ids.add(r[t.col]); });
      }
      // coach_messages : resolve via coach_conversations
      const { data: msgs } = await sb.from('coach_messages').select('conversation_id').gte('created_at', sinceIso);
      if (msgs && msgs.length) {
        const convIds = [...new Set(msgs.map(m => m.conversation_id).filter(Boolean))];
        if (convIds.length) {
          const { data: convs } = await sb.from('coach_conversations').select('id, user_id').in('id', convIds);
          (convs || []).forEach(c => { if (c.user_id) ids.add(c.user_id); });
        }
      }
      return ids.size;
    };

    // ── Funnel (cumulative counts)
    const funnelQueries = Promise.all([
      sb.from('profiles').select('id', { count: 'exact', head: true }),  // signups total
      sb.from('profiles').select('id', { count: 'exact', head: true }).not('faceit_id', 'is', null),
      sb.from('profiles').select('id', { count: 'exact', head: true }).not('faceit_nickname', 'is', null),
      sb.from('matches').select('user_id', { count: 'exact', head: true }).eq('status', 'parsed'),
      sb.from('diagnostic_history').select('user_id', { count: 'exact', head: true }),
      sb.from('subscriptions').select('user_id', { count: 'exact', head: true }).eq('status', 'active'),
    ]);

    // ── Churn (last 30 days)
    const churnQueries = Promise.all([
      sb.from('subscriptions').select('user_id, plan, status, current_period_end, cancel_at_period_end').gte('current_period_end', monthIso),
      sb.from('subscriptions').select('user_id, plan').eq('status', 'active'),
    ]);

    // ── Recent signups
    const trendsQueries = Promise.all([
      sb.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', weekIso),
      sb.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', monthIso),
      sb.from('subscriptions').select('user_id', { count: 'exact', head: true }).gte('current_period_start', monthIso).eq('status', 'active'),
    ]);

    const [dau, wau, mau, funnel, churn, trends] = await Promise.all([
      activeUsersInWindow(dayIso),
      activeUsersInWindow(weekIso),
      activeUsersInWindow(monthIso),
      funnelQueries,
      churnQueries,
      trendsQueries,
    ]);

    // Funnel counts
    const [
      signupsRes,
      faceitIdRes,
      faceitNickRes,
      firstDemoRes,
      firstDiagRes,
      activeSubsRes,
    ] = funnel;
    const signups = signupsRes.count || 0;
    const faceitLinked = Math.max(faceitIdRes.count || 0, faceitNickRes.count || 0);
    const firstDemo = firstDemoRes.count || 0;
    const firstDiag = firstDiagRes.count || 0;
    const proUsers = activeSubsRes.count || 0;
    const conversionPct = signups > 0 ? (proUsers / signups) * 100 : 0;

    // Churn breakdown
    const [recentSubsRes, allActiveSubsRes] = churn;
    const recentSubs = recentSubsRes.data || [];
    const allActiveSubs = allActiveSubsRes.data || [];
    const cancelledLast30 = recentSubs.filter(s => s.cancel_at_period_end === true || s.status === 'canceled').length;
    const churnPct = (recentSubs.length + cancelledLast30) > 0 ? (cancelledLast30 / (recentSubs.length + cancelledLast30)) * 100 : 0;
    const activePro = allActiveSubs.filter(s => (s.plan || '').toLowerCase().includes('pro')).length;
    const activeElite = allActiveSubs.filter(s => /elite|team/i.test(s.plan || '')).length;

    // Trends
    const [signups7Res, signups30Res, conv30Res] = trends;

    return res.status(200).json({
      active_users: {
        dau,
        wau,
        mau,
        dau_wau_ratio: wau > 0 ? Math.round((dau / wau) * 1000) / 10 : 0,  // % stickiness
      },
      funnel: {
        signups,
        faceit_linked: faceitLinked,
        first_demo: firstDemo,
        first_diag: firstDiag,
        pro_users: proUsers,
        conversion_pct: Math.round(conversionPct * 100) / 100,
        // Drop-off rates entre etapes (calcul cote frontend si besoin)
        link_rate: signups > 0 ? Math.round((faceitLinked / signups) * 10000) / 100 : 0,
        activation_rate: faceitLinked > 0 ? Math.round((firstDemo / faceitLinked) * 10000) / 100 : 0,
        diag_rate: firstDemo > 0 ? Math.round((firstDiag / firstDemo) * 10000) / 100 : 0,
      },
      churn: {
        cancel_30d: cancelledLast30,
        churn_pct: Math.round(churnPct * 100) / 100,
        active_pro: activePro,
        active_elite: activeElite,
        active_total: activePro + activeElite,
      },
      trends: {
        signups_7d: signups7Res.count || 0,
        signups_30d: signups30Res.count || 0,
        conversions_30d: conv30Res.count || 0,
      },
      window_days: 30,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin-business-metrics] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
