// api/referral.js // FragValue
// Gestion du programme de parrainage.
//
// GET  /api/referral                 → { code, link, stats: { total, last_30d, recent: [...] }, grant }
// POST /api/referral { code }        → attribue un parrain a l'user courant (1x max)
//                                       + cree 2 pro_grants (7j pour parrain ET filleul)
//                                       + cree 2 notifications in-app
//
// Auth : Bearer JWT Supabase obligatoire.
// Regles : un user ne peut pas se parrainer lui-meme. L'attribution est
// permanente (pas de changement apres le 1er parrain enregistre).
// Recompense : +7 jours Pro offerts aux 2 parties (parrain + filleul).

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const REWARD_DAYS = 7;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Insert un grant Pro non-bloquant (swallow errors pour ne pas casser le flow)
async function grantProDays(s, userId, days, reason, metadata) {
  if (!userId || !days) return null;
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  try {
    const { data, error } = await s.from('pro_grants').insert({
      user_id: userId,
      plan: 'pro',
      reason,
      expires_at: expires,
      metadata: metadata || null,
    }).select().single();
    if (error) {
      console.warn('[referral] grant failed:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[referral] grant exception:', e.message);
    return null;
  }
}

// Notif in-app non-bloquante
async function insertNotification(s, { user_id, type, title, message, action_url, icon, metadata }) {
  if (!user_id) return;
  try {
    await s.from('notifications').insert({
      user_id,
      type: type || 'info',
      title: String(title || '').slice(0, 200),
      message: String(message || '').slice(0, 500),
      action_url: action_url ? String(action_url).slice(0, 500) : null,
      icon: icon || null,
      metadata: metadata || null,
      read: false,
    });
  } catch (e) {
    console.warn('[referral] notification insert failed:', e.message);
  }
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

    // Grant Pro actif (parrainage ou autre) pour l'user courant
    const { data: activeGrant } = await s
      .from('pro_grants')
      .select('plan, reason, expires_at')
      .eq('user_id', user.id)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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
      grant: activeGrant,
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

    // Attribution du parrain
    const nowIso = new Date().toISOString();
    const { error } = await s
      .from('profiles')
      .update({
        referred_by: referrer.id,
        referred_at: nowIso,
      })
      .eq('id', user.id);
    if (error) return res.status(500).json({ error: error.message });

    // Recompense : +7j Pro aux 2 parties
    const refereeNickname = profile.referral_code ? 'Un ami' : 'Un nouveau joueur';
    const { data: refereeProfile } = await s
      .from('profiles')
      .select('faceit_nickname')
      .eq('id', user.id)
      .maybeSingle();
    const refereeNick = refereeProfile?.faceit_nickname || 'Un nouveau joueur';

    const [refereeGrant, referrerGrant] = await Promise.all([
      // Filleul : +7j Pro
      grantProDays(s, user.id, REWARD_DAYS, 'referral_referee', {
        referrer_id: referrer.id,
        code,
      }),
      // Parrain : +7j Pro
      grantProDays(s, referrer.id, REWARD_DAYS, 'referral_referrer', {
        referee_id: user.id,
        code: profile.referral_code,
      }),
    ]);

    // Notifications in-app
    const expiresStr = new Date(Date.now() + REWARD_DAYS * 86400000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' });

    await Promise.all([
      // Filleul : "Ton parrain a ete enregistre, +7j Pro offerts"
      insertNotification(s, {
        user_id: user.id,
        type: 'referral_welcome',
        title: `Bienvenue ! ${REWARD_DAYS} jours Pro offerts`,
        message: `Ton parrainage a ete valide. Tu as ${REWARD_DAYS} jours Pro gratuits jusqu'au ${expiresStr}. Teste toutes les features premium sans restriction.`,
        action_url: '/account.html',
        icon: 'trophy',
        metadata: { referrer_id: referrer.id, grant_id: refereeGrant?.id },
      }),
      // Parrain : "X s'est inscrit avec ton code, +7j Pro offerts"
      insertNotification(s, {
        user_id: referrer.id,
        type: 'referral_reward',
        title: `${refereeNick} a utilise ton code`,
        message: `Tu viens de recevoir ${REWARD_DAYS} jours Pro offerts jusqu'au ${expiresStr}. Continue de partager ton lien pour cumuler les recompenses.`,
        action_url: '/account.html#settings',
        icon: 'trophy',
        metadata: { referee_id: user.id, grant_id: referrerGrant?.id },
      }),
    ]);

    return res.status(200).json({
      ok: true,
      message: 'Parrain enregistre',
      reward: {
        days: REWARD_DAYS,
        expires_at: refereeGrant?.expires_at || new Date(Date.now() + REWARD_DAYS * 86400000).toISOString(),
      },
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
