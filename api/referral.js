// api/referral.js // FragValue
// Gestion du programme de parrainage.
//
// GET  /api/referral                 → { code, link, stats: { total, last_30d, recent: [...] } }
// POST /api/referral { code }        → attribue un parrain a l'user courant (1x max)
//
// Auth : Bearer JWT Supabase obligatoire.
// Regles : un user ne peut pas se parrainer lui-meme. L'attribution est
// permanente (pas de changement apres le 1er parrain enregistre).

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getAuthUser(authHeader) {
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await sb().auth.getUser(token);
  return data?.user || null;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = await getAuthUser(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Auth requise' });

  const s = sb();

  if (req.method === 'GET') {
    // Recupere code du user + stats
    const { data: profile } = await s
      .from('profiles')
      .select('referral_code, faceit_nickname, referred_by')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile) return res.status(404).json({ error: 'Profil introuvable' });

    // Stats : total de filleuls + derniers 30j + liste recente (3)
    const { count: total } = await s
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', user.id);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const { count: last30 } = await s
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', user.id)
      .gte('referred_at', thirtyDaysAgo);

    const { data: recent } = await s
      .from('profiles')
      .select('faceit_nickname, referred_at')
      .eq('referred_by', user.id)
      .order('referred_at', { ascending: false })
      .limit(5);

    // Le parrain de l'user (si parraine)
    let referrer = null;
    if (profile.referred_by) {
      const { data } = await s
        .from('profiles')
        .select('faceit_nickname, referral_code')
        .eq('id', profile.referred_by)
        .maybeSingle();
      if (data) referrer = { nickname: data.faceit_nickname };
    }

    const code = profile.referral_code || null;
    const link = code ? `https://fragvalue.com/login.html?ref=${code}` : null;

    return res.status(200).json({
      code,
      link,
      stats: {
        total: total || 0,
        last_30d: last30 || 0,
        recent: recent || [],
      },
      referrer,
    });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const code = String(body.code || '').trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{6,10}$/.test(code)) {
      return res.status(400).json({ error: 'Code invalide' });
    }

    // Profil de l'user : a-t-il deja un parrain ?
    const { data: profile } = await s
      .from('profiles')
      .select('id, referred_by, referral_code')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile) return res.status(404).json({ error: 'Profil introuvable' });
    if (profile.referred_by) return res.status(400).json({ error: 'Tu as deja un parrain' });
    if (profile.referral_code === code) return res.status(400).json({ error: 'Tu ne peux pas te parrainer toi-meme' });

    // Trouve le parrain
    const { data: referrer } = await s
      .from('profiles')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();
    if (!referrer) return res.status(404).json({ error: 'Code inconnu' });
    if (referrer.id === user.id) return res.status(400).json({ error: 'Tu ne peux pas te parrainer toi-meme' });

    // Attribution
    const { error } = await s
      .from('profiles')
      .update({
        referred_by: referrer.id,
        referred_at: new Date().toISOString(),
      })
      .eq('id', user.id);
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ ok: true, message: 'Parrain enregistre' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
