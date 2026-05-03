// api/admin-errors.js // FragValue
// Admin-only : liste, groupe et resout les erreurs trackees.
//
// GET  /api/admin-errors                       → 50 dernieres erreurs non resolues
// GET  /api/admin-errors?all=1                 → inclut resolues
// GET  /api/admin-errors?grouped=1             → groupe par fingerprint (top 50)
// POST /api/admin-errors { id, resolved: true }→ marque comme resolu
// POST /api/admin-errors { fingerprint, resolved: true } → marque tout le groupe
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

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await getAdminUser(req.headers.authorization);
  if (!admin) return res.status(403).json({ error: 'Admin only' });

  const s = sb();

  if (req.method === 'GET') {
    const { all, grouped, limit } = req.query || {};
    const max = Math.min(200, parseInt(limit, 10) || 50);

    if (grouped === '1') {
      // Group by fingerprint : on calcule count + premiere/derniere + 1 sample
      const { data, error } = await s
        .from('error_logs')
        .select('id, created_at, fingerprint, message, route, source, level, resolved, user_id')
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) return res.status(500).json({ error: error.message });

      const groups = new Map();
      for (const row of data || []) {
        const fp = row.fingerprint || row.message.slice(0, 60);
        if (!groups.has(fp)) {
          groups.set(fp, {
            fingerprint: fp,
            count: 0,
            first_seen: row.created_at,
            last_seen: row.created_at,
            sample: row,
            resolved: row.resolved,
            source: row.source,
            level: row.level,
          });
        }
        const g = groups.get(fp);
        g.count++;
        if (row.created_at > g.last_seen) g.last_seen = row.created_at;
        if (row.created_at < g.first_seen) g.first_seen = row.created_at;
        // Considerer le groupe comme non-resolu si au moins 1 occurrence non-resolue
        if (!row.resolved) g.resolved = false;
      }
      const out = [...groups.values()]
        .sort((a, b) => (a.resolved === b.resolved ? b.count - a.count : (a.resolved ? 1 : -1)))
        .slice(0, max);
      return res.status(200).json({ groups: out, total_events: data.length });
    }

    let q = s.from('error_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(max);
    if (all !== '1') q = q.eq('resolved', false);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ errors: data || [] });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const resolved = body.resolved === true;
    if (body.id) {
      const { error } = await s.from('error_logs')
        .update({ resolved, resolved_at: resolved ? new Date().toISOString() : null })
        .eq('id', body.id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    if (body.fingerprint) {
      const { error } = await s.from('error_logs')
        .update({ resolved, resolved_at: resolved ? new Date().toISOString() : null })
        .eq('fingerprint', body.fingerprint);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'id ou fingerprint requis' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
