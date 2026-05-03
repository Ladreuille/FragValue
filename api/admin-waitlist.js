// api/admin-waitlist.js
// Admin-only endpoint pour lister les interests et exporter en CSV.
//
// GET  /api/admin-waitlist                   → { features: [{slug, total, users, anons}], interests: [...] }
// GET  /api/admin-waitlist?format=csv        → CSV text/csv attachment
// GET  /api/admin-waitlist?feature=<slug>    → filtre par feature
//
// Auth : Bearer JWT Supabase + email dans ADMIN_EMAILS

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const { ADMIN_EMAILS } = require('./_lib/subscription');

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getAdminUser(authHeader) {
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await sb().auth.getUser(token);
  const u = data?.user;
  if (!u?.email || !ADMIN_EMAILS.includes(u.email)) return null;
  return u;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAdminUser(req.headers.authorization);
  if (!admin) return res.status(403).json({ error: 'Admin only' });

  const { format, feature } = req.query || {};
  const s = sb();

  // Aggregate counts via RPC (la function deja ordonnee par total desc)
  const { data: featuresAgg } = await s
    .rpc('feature_interest_counts', { slug: null });

  // Detailed rows (interests + user emails si auth)
  let q = s
    .from('feature_interests')
    .select('id, feature_slug, user_id, anon_id, source, created_at, notified_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (feature) q = q.eq('feature_slug', feature);
  const { data: interests } = await q;

  // Resolve user emails + nicknames en batch (1 query profiles + 1 listUsers)
  const userIds = (interests || []).map(i => i.user_id).filter(Boolean);
  const wantedIds = new Set(userIds);
  let usersById = {};
  if (userIds.length) {
    // profiles pour le nickname + stripe_customer_id (proxy plan)
    const { data: profiles } = await s
      .from('profiles')
      .select('id, faceit_nickname, stripe_customer_id')
      .in('id', userIds);
    (profiles || []).forEach(p => { usersById[p.id] = p; });

    // auth.users emails via un seul listUsers (pagine si >1000 users au total)
    try {
      const { data: listData } = await s.auth.admin.listUsers({ page: 1, perPage: 1000 });
      (listData?.users || []).forEach(u => {
        if (wantedIds.has(u.id)) {
          usersById[u.id] = { ...(usersById[u.id] || {}), email: u.email };
        }
      });
    } catch (e) { console.warn('admin listUsers failed', e.message); }
  }

  const enriched = (interests || []).map(i => ({
    ...i,
    email: i.user_id ? (usersById[i.user_id]?.email || null) : null,
    nickname: i.user_id ? (usersById[i.user_id]?.faceit_nickname || null) : null,
    is_paying: i.user_id ? !!usersById[i.user_id]?.stripe_customer_id : false,
  }));

  if (format === 'csv') {
    const header = ['feature_slug', 'type', 'email', 'nickname', 'is_paying', 'source', 'created_at', 'notified_at'];
    const lines = [header.join(',')];
    for (const r of enriched) {
      lines.push([
        r.feature_slug,
        r.user_id ? 'user' : 'anon',
        r.email || '',
        r.nickname || '',
        r.is_paying ? 'yes' : 'no',
        r.source || '',
        r.created_at,
        r.notified_at || '',
      ].map(csvEscape).join(','));
    }
    const filename = feature ? `waitlist-${feature}-${Date.now()}.csv` : `waitlist-all-${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(lines.join('\n'));
  }

  return res.status(200).json({
    features: featuresAgg || [],
    interests: enriched,
  });
};
