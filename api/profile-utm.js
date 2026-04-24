// api/profile-utm.js - FragValue
// Persiste les attributions UTM capturees cote client au moment du signup.
// Idempotent : si deja set (signup_at != null), on ne touche pas (la 1re
// attribution gagne pour le tracking ROI).
//
// Auth : JWT Supabase obligatoire.
// Body : { source, medium, campaign, term, content, referrer, landing }

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth requise' });

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    // Idempotence : si signup_at deja set, on garde la 1re attribution
    const { data: existing } = await sb
      .from('profiles').select('signup_at').eq('id', user.id).maybeSingle();
    if (existing?.signup_at) {
      return res.status(200).json({ ok: true, alreadyAttributed: true });
    }

    const body = req.body || {};
    const truncate = (v) => (v == null ? null : String(v).slice(0, 200));

    const update = {
      id: user.id,
      signup_utm_source:   truncate(body.source),
      signup_utm_medium:   truncate(body.medium),
      signup_utm_campaign: truncate(body.campaign),
      signup_utm_term:     truncate(body.term),
      signup_utm_content:  truncate(body.content),
      signup_referrer:     truncate(body.referrer),
      signup_landing_url:  truncate(body.landing),
      signup_at:           new Date().toISOString(),
    };
    await sb.from('profiles').upsert(update, { onConflict: 'id' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[profile-utm] error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
