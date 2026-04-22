// api/referral.js // FragValue
// Gestion du programme de parrainage.
//
// GET  /api/referral                 → { code, link, stats, grant, referrer, tier_progress }
// POST /api/referral { code }        → attribue un parrain a l'user courant (1x max)
//                                       + filleul : +7j Pro welcome (immediat)
//                                       + parrain : grant selon palier FRANCHI (si cumul atteint un seuil)
//                                       + notifications in-app
//
// Auth : Bearer JWT Supabase obligatoire.
// Regles : un user ne peut pas se parrainer lui-meme. L'attribution est
// permanente (pas de changement apres le 1er parrain enregistre).
//
// ── Systeme de recompenses ─────────────────────────────────────────────
// Filleul : +7 jours Pro a l'inscription (welcome bonus, unique).
// Parrain : paliers cumulatifs sur le nombre total de filleuls.
//   Palier 1 :  15 filleuls  → Pro  1 an  (365 jours)
//   Palier 2 :  50 filleuls  → Elite 1 an (365 jours)
//   Palier 3 : 100 filleuls  → Pro  a vie (expires_at = NULL)
//   Palier 4 : 500 filleuls  → Elite a vie (expires_at = NULL)
// Le grant est cree une seule fois au franchissement du palier. Chaque
// palier supplante les precedents (Elite > Pro, lifetime > temporaire).

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const REFEREE_WELCOME_DAYS = 7;

// Paliers de recompense pour le parrain (ordre croissant de exigence)
const REFERRAL_TIERS = [
  { threshold:  15, plan: 'pro',  days: 365,  label: 'Pro 1 an',    reason: 'referral_tier_pro_1y'    },
  { threshold:  50, plan: 'team', days: 365,  label: 'Elite 1 an',  reason: 'referral_tier_elite_1y'  },
  { threshold: 100, plan: 'pro',  days: null, label: 'Pro a vie',   reason: 'referral_tier_pro_life'  },
  { threshold: 500, plan: 'team', days: null, label: 'Elite a vie', reason: 'referral_tier_elite_life'},
];

// Retourne le palier qui vient d'etre franchi (ou null si aucun).
// previousCount = count AVANT l'attribution courante. currentCount = count APRES.
function findCrossedTier(previousCount, currentCount) {
  for (const tier of REFERRAL_TIERS) {
    if (previousCount < tier.threshold && currentCount >= tier.threshold) {
      return tier;
    }
  }
  return null;
}

// Retourne le prochain palier a atteindre pour l'UI de progression.
function findNextTier(currentCount) {
  for (const tier of REFERRAL_TIERS) {
    if (currentCount < tier.threshold) return tier;
  }
  return null;
}

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Insert un grant Pro/Team non-bloquant (swallow errors pour ne pas casser le flow).
// Si days est null, le grant est a vie (expires_at = NULL).
async function grantPlan(s, userId, plan, days, reason, metadata) {
  if (!userId) return null;
  const expires = (days == null)
    ? null
    : new Date(Date.now() + days * 86400000).toISOString();
  try {
    const { data, error } = await s.from('pro_grants').insert({
      user_id: userId,
      plan: plan || 'pro',
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

    // Progression vers le prochain palier
    const totalCount = total || 0;
    const nextTier = findNextTier(totalCount);
    const tier_progress = nextTier ? {
      current: totalCount,
      target: nextTier.threshold,
      remaining: nextTier.threshold - totalCount,
      next_label: nextTier.label,
      next_plan: nextTier.plan === 'team' ? 'elite' : nextTier.plan,
      next_lifetime: nextTier.days == null,
      percent: Math.min(100, Math.round((totalCount / nextTier.threshold) * 100)),
    } : {
      current: totalCount,
      maxed: true, // Tous les paliers atteints
    };

    // Liste des paliers pour l'UI (avec status reached / next / locked)
    const tiers_status = REFERRAL_TIERS.map(t => ({
      threshold: t.threshold,
      plan: t.plan === 'team' ? 'elite' : t.plan,
      lifetime: t.days == null,
      label: t.label,
      reached: totalCount >= t.threshold,
    }));

    return res.status(200).json({
      code,
      link,
      stats: {
        total: totalCount,
        last_30d: last30 || 0,
        recent: recent || [],
      },
      referrer,
      grant: activeGrant,
      tier_progress,
      tiers: tiers_status,
    });
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const code = String(body.code || '').trim().toUpperCase();
    if (!code || !/^[A-Z0-9]{6,10}$/.test(code)) {
      return res.status(400).json({ error: 'Code invalide' });
    }

    // Contrainte : 1 seul code utilise par compte (profile.referred_by est
    // set au 1er usage et ne peut plus bouger). Validation explicite ci-dessous.
    const { data: profile } = await s
      .from('profiles')
      .select('id, referred_by, referral_code')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile) return res.status(404).json({ error: 'Profil introuvable' });
    if (profile.referred_by) {
      return res.status(400).json({
        error: 'Tu as deja utilise un code de parrainage sur ce compte. Un seul code par compte.',
        code: 'already_referred',
      });
    }
    if (profile.referral_code === code) {
      return res.status(400).json({
        error: 'Tu ne peux pas utiliser ton propre code de parrainage.',
        code: 'self_referral',
      });
    }

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

    // Recupere les nicknames des 2 parties pour personnaliser les notifs
    const { data: refereeProfile } = await s
      .from('profiles')
      .select('faceit_nickname')
      .eq('id', user.id)
      .maybeSingle();
    const { data: referrerProfile } = await s
      .from('profiles')
      .select('faceit_nickname')
      .eq('id', referrer.id)
      .maybeSingle();
    const refereeNick = refereeProfile?.faceit_nickname || null;
    const referrerNick = referrerProfile?.faceit_nickname || null;

    // Compte cumulative des filleuls du parrain APRES cette attribution
    const { count: newCount } = await s
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', referrer.id);
    const currentCount = newCount || 0;
    const previousCount = currentCount - 1; // l'user courant vient d'etre ajoute

    // ── RECOMPENSE FILLEUL : +7j Pro welcome bonus (inchange) ──────────
    const refereeGrant = await grantPlan(
      s, user.id, 'pro', REFEREE_WELCOME_DAYS, 'referral_referee',
      { referrer_id: referrer.id, referrer_nick: referrerNick, code }
    );

    // ── RECOMPENSE PARRAIN : uniquement si un palier vient d'etre franchi ──
    const crossedTier = findCrossedTier(previousCount, currentCount);
    let referrerGrant = null;
    if (crossedTier) {
      referrerGrant = await grantPlan(
        s, referrer.id, crossedTier.plan, crossedTier.days, crossedTier.reason,
        { referee_id: user.id, referee_nick: refereeNick, total_referrals: currentCount, tier: crossedTier.label }
      );
    }

    // ── NOTIFICATIONS ─────────────────────────────────────────────────
    const expiresStr = new Date(Date.now() + REFEREE_WELCOME_DAYS * 86400000)
      .toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' });

    // Filleul : welcome message avec le nom du parrain
    const refereeTitle = 'Bienvenue chez FragValue';
    const refereeMsg = referrerNick
      ? `Tu as rejoint FragValue via le parrainage de ${referrerNick}. Tu beneficies de ${REFEREE_WELCOME_DAYS} jours Pro offerts jusqu'au ${expiresStr} pour decouvrir toutes les features premium.`
      : `Ton parrainage est valide. Tu beneficies de ${REFEREE_WELCOME_DAYS} jours Pro offerts jusqu'au ${expiresStr} pour decouvrir toutes les features premium.`;

    // Parrain : message different selon si palier franchi ou pas
    let referrerTitle, referrerMsg;
    if (crossedTier) {
      const planLabel = crossedTier.plan === 'team' ? 'Elite' : 'Pro';
      const durationLabel = crossedTier.days == null
        ? 'a vie'
        : `pendant ${Math.round(crossedTier.days / 30)} mois`;
      referrerTitle = `Palier ${crossedTier.threshold} parrainages atteint ${planLabel} ${durationLabel}`;
      referrerMsg = crossedTier.days == null
        ? `Felicitations ! Tu viens de debloquer ${planLabel} a vie grace a ${crossedTier.threshold} parrainages reussis. Cet acces ne peut plus etre revoque. Merci d'etre un pilier de la communaute FragValue.`
        : `Tu viens de franchir le palier ${crossedTier.threshold} parrainages. En recompense, tu recois ${planLabel} gratuit pendant 1 an. Continue pour atteindre le prochain palier.`;
    } else {
      // Pas de palier franchi : simple notif d'encouragement avec progression
      const nextTier = findNextTier(currentCount);
      const remaining = nextTier ? nextTier.threshold - currentCount : 0;
      referrerTitle = refereeNick
        ? `${refereeNick} vient de s'inscrire avec ton code`
        : 'Un nouveau joueur s\'est inscrit avec ton code';
      referrerMsg = nextTier
        ? `Tu as maintenant ${currentCount} parrainage${currentCount > 1 ? 's' : ''}. Plus que ${remaining} pour atteindre ${nextTier.label}. Continue de partager ton lien.`
        : `Tu as maintenant ${currentCount} parrainages. Tu as deja atteint tous les paliers, merci d'etre un pilier de FragValue.`;
    }

    await Promise.all([
      insertNotification(s, {
        user_id: user.id,
        type: 'referral_welcome',
        title: refereeTitle,
        message: refereeMsg,
        action_url: '/account.html',
        icon: 'trophy',
        metadata: { referrer_id: referrer.id, referrer_nick: referrerNick, grant_id: refereeGrant?.id },
      }),
      insertNotification(s, {
        user_id: referrer.id,
        type: crossedTier ? 'referral_tier_reached' : 'referral_reward',
        title: referrerTitle,
        message: referrerMsg,
        action_url: '/account.html#settings',
        icon: crossedTier ? 'trophy' : 'trophy',
        metadata: {
          referee_id: user.id,
          referee_nick: refereeNick,
          total_referrals: currentCount,
          tier_crossed: crossedTier?.label || null,
          grant_id: referrerGrant?.id,
        },
      }),
    ]);

    return res.status(200).json({
      ok: true,
      message: 'Parrain enregistre',
      reward: {
        days: REFEREE_WELCOME_DAYS,
        expires_at: refereeGrant?.expires_at || new Date(Date.now() + REFEREE_WELCOME_DAYS * 86400000).toISOString(),
      },
      referrer: { nickname: referrerNick },
      tier_crossed: crossedTier ? { label: crossedTier.label, plan: crossedTier.plan === 'team' ? 'elite' : crossedTier.plan, lifetime: crossedTier.days == null } : null,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
