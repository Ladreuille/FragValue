// api/_lib/subscription.js - FragValue
// Helper pour resoudre le plan d'un user (free | pro | elite) cote backend.
//
// Source of truth : table `subscriptions` (peuplee par le webhook Stripe).
// Fallback : Stripe API si rien en DB pour le customer (cas legacy ou si
// le webhook n'a pas encore tourne).
//
// Usage :
//   const { plan, user, source } = await getUserPlan(req.headers.authorization);
//   if (plan !== 'pro' && plan !== 'elite') return res.status(403)...
//
//   // ou plus court :
//   const gate = await requirePro(req, res);
//   if (!gate) return; // 401/403 deja envoye
//   const { user, plan } = gate;
//
// NB : le plan interne est 'elite' depuis avril 2026 (anciennement 'team').
// Legacy : les valeurs DB ou priceId contenant 'team' sont mappees vers 'elite'
// par normalizePlan pour backward-compat.

const { createClient } = require('@supabase/supabase-js');

// Liste des emails admin (en lowercase pour match case-insensitive). Bypass
// permanent vers plan='elite' utile pour : tests internes du killer feature
// AI Coach, debug en prod sans devoir souscrire, demo a des prospects.
// Override possible via env var FRAGVALUE_ADMIN_EMAILS (comma-separated).
const ADMIN_EMAILS = (process.env.FRAGVALUE_ADMIN_EMAILS || 'qdreuillet@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

// Cache par token (5 min) pour eviter de re-resoudre le plan a chaque endpoint
// dans une meme session. Cle = sha256-like (premier 32 chars du token suffisent
// pour dedup, on garde pas en clair).
const _planCache = new Map();
const PLAN_TTL_MS = 5 * 60 * 1000;

function cacheKey(token) {
  return token.slice(0, 32);
}

function getCached(token) {
  const k = cacheKey(token);
  const e = _planCache.get(k);
  if (!e) return null;
  if (Date.now() - e.t > PLAN_TTL_MS) { _planCache.delete(k); return null; }
  return e.v;
}

function setCached(token, value) {
  const k = cacheKey(token);
  _planCache.set(k, { t: Date.now(), v: value });
  // Eviction simple : si plus de 200 entrees, on vire les plus vieilles.
  if (_planCache.size > 200) {
    const entries = [..._planCache.entries()].sort((a, b) => a[1].t - b[1].t);
    for (let i = 0; i < 50; i++) _planCache.delete(entries[i][0]);
  }
}

// Mappe la valeur stockee en DB (qui peut etre 'pro_monthly', 'pro_yearly',
// 'elite_monthly', 'elite_yearly', 'elite', legacy 'team_*') vers le tier
// logique 'pro'|'elite'.
function normalizePlan(rawPlan, priceId) {
  const p = String(rawPlan || '').toLowerCase();
  if (p.includes('elite') || p.includes('team')) return 'elite';
  if (p.includes('pro')) return 'pro';
  // Fallback price ID (utilise quand on lit Stripe direct)
  const pid = String(priceId || '').toLowerCase();
  if (pid.includes('elite') || pid.includes('team')) return 'elite';
  if (pid.includes('pro')) return 'pro';
  return 'free';
}

// Statuts Stripe consideres comme "actif" pour gating
// (active = paye, trialing = en periode d'essai, past_due = grace period).
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

async function resolvePlanFromDB(userId) {
  const { data } = await sb()
    .from('subscriptions')
    .select('plan, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  if (!ACTIVE_STATUSES.has(data.status)) return { plan: 'free', status: data.status };
  return { plan: normalizePlan(data.plan), status: data.status };
}

// Check les pro_grants actifs (parrainage, admin, promo) pour cet user.
// Retourne le grant le plus fort. expires_at = NULL signifie "a vie" (lifetime),
// et supplante tout grant avec une date d'expiration.
async function resolvePlanFromGrants(userId) {
  const nowIso = new Date().toISOString();
  const { data } = await sb()
    .from('pro_grants')
    .select('plan, expires_at, reason')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('plan', { ascending: false }) // elite > pro
    // NULLS FIRST : les grants a vie sont prioritaires
    .order('expires_at', { ascending: false, nullsFirst: true })
    .limit(1);
  if (!data || data.length === 0) return null;
  return {
    plan: normalizePlan(data[0].plan),
    status: 'trialing',
    source: 'grant',
    reason: data[0].reason,
    expires_at: data[0].expires_at, // null si lifetime
    lifetime: data[0].expires_at === null,
  };
}

// Compare 2 plans et retourne le plus fort (elite > pro > free)
function upgradePlan(a, b) {
  const rank = { elite: 3, team: 3, pro: 2, free: 1 }; // team = legacy alias
  return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
}

async function resolvePlanFromStripe(customerId) {
  if (!customerId || !process.env.STRIPE_SECRET_KEY) return null;
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    // On accepte trialing aussi (limit=3 pour couvrir les transitions)
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 3 });
    const active = subs.data.find(s => ACTIVE_STATUSES.has(s.status));
    if (!active) return { plan: 'free', status: 'none' };
    const priceId = active.items.data[0]?.price?.id || '';
    return { plan: normalizePlan(null, priceId), status: active.status };
  } catch (e) {
    console.warn('[subscription] resolvePlanFromStripe failed:', e.message);
    return null;
  }
}

async function getUserPlan(authHeader, opts = {}) {
  if (!authHeader) return { plan: 'free', user: null, status: 'none', source: 'no-auth' };
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return { plan: 'free', user: null, status: 'none', source: 'empty-token' };

  // bypassCache : utilise par check-subscription (drive l'UI, doit etre fresh
  // immediatement apres un webhook). Le cache 5 min reste actif pour les
  // endpoints de gating (pro-match, roster) qui peuvent tolerer un delai.
  if (!opts.bypassCache) {
    const cached = getCached(token);
    if (cached) return cached;
  }

  const { data: { user }, error } = await sb().auth.getUser(token);
  if (error || !user) {
    const result = { plan: 'free', user: null, status: 'none', source: 'invalid-token' };
    return result;
  }

  // Admin bypass : acces elite permanent (case-insensitive match sur l'email)
  if (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase().trim())) {
    const result = { plan: 'elite', user, status: 'active', source: 'admin' };
    setCached(token, result);
    return result;
  }

  // 1. DB subscriptions (peuplee par stripe-webhook) + pro_grants (parrainage/admin)
  // On check les 2 sources en parallele et on prend le plan le plus fort.
  const [fromDB, fromGrants] = await Promise.all([
    resolvePlanFromDB(user.id),
    resolvePlanFromGrants(user.id),
  ]);

  const dbPlan     = fromDB?.plan || 'free';
  const grantPlan  = fromGrants?.plan || 'free';
  const topPlan    = upgradePlan(dbPlan, grantPlan);

  if (topPlan !== 'free') {
    // Source d'autorite : grant si c'est le grant qui l'emporte, sinon DB
    const fromGrant = fromGrants && grantPlan === topPlan;
    const result = {
      plan: topPlan,
      user,
      status: fromGrant ? 'trialing' : (fromDB?.status || 'active'),
      source: fromGrant ? 'grant' : 'db',
      grant: fromGrant ? {
        reason: fromGrants.reason,
        expires_at: fromGrants.expires_at,
        lifetime: fromGrants.lifetime || false,
      } : null,
    };
    setCached(token, result);
    return result;
  }

  // 2. Fallback Stripe API si DB vide (cas legacy ou webhook pas encore tourne)
  const { data: profile } = await sb()
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.stripe_customer_id) {
    const fromStripe = await resolvePlanFromStripe(profile.stripe_customer_id);
    if (fromStripe) {
      const result = { plan: fromStripe.plan, user, status: fromStripe.status, source: 'stripe-fallback' };
      setCached(token, result);
      return result;
    }
  }

  const result = { plan: 'free', user, status: 'none', source: 'no-customer' };
  setCached(token, result);
  return result;
}

// Helper de gating : retourne le user/plan si pro/team, sinon envoie 403 et
// retourne null. Le caller fait `if (!gate) return;` apres l'appel.
async function requirePro(req, res) {
  const result = await getUserPlan(req.headers.authorization);
  if (!result.user) {
    res.status(401).json({ error: 'Authentification requise' });
    return null;
  }
  if (result.plan !== 'pro' && result.plan !== 'elite') {
    res.status(403).json({
      error: 'Abonnement Pro requis',
      plan: result.plan,
      upgrade_url: '/pricing.html',
    });
    return null;
  }
  return result;
}

async function requireElite(req, res) {
  const result = await getUserPlan(req.headers.authorization);
  if (!result.user) {
    res.status(401).json({ error: 'Authentification requise' });
    return null;
  }
  if (result.plan !== 'elite') {
    res.status(403).json({
      error: 'Abonnement Elite requis',
      plan: result.plan,
      upgrade_url: '/pricing.html',
    });
    return null;
  }
  return result;
}

// Alias legacy : requireTeam redirige vers requireElite (anciennement le plan
// s'appelait 'team'). Garde pour ne pas casser les imports tiers.
const requireTeam = requireElite;

module.exports = { getUserPlan, requirePro, requireElite, requireTeam, normalizePlan };
