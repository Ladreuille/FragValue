// api/_lib/subscription.js - FragValue
// Helper pour resoudre le plan d'un user (free | pro | team) cote backend.
//
// Source of truth : table `subscriptions` (peuplee par le webhook Stripe).
// Fallback : Stripe API si rien en DB pour le customer (cas legacy ou si
// le webhook n'a pas encore tourne).
//
// Usage :
//   const { plan, user, source } = await getUserPlan(req.headers.authorization);
//   if (plan !== 'pro' && plan !== 'team') return res.status(403)...
//
//   // ou plus court :
//   const gate = await requirePro(req, res);
//   if (!gate) return; // 401/403 deja envoye
//   const { user, plan } = gate;

const { createClient } = require('@supabase/supabase-js');

const ADMIN_EMAILS = ['qdreuillet@gmail.com'];

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
// 'team_monthly', 'team_yearly', 'team') vers le tier logique 'pro'|'team'.
function normalizePlan(rawPlan, priceId) {
  const p = String(rawPlan || '').toLowerCase();
  if (p.includes('team') || p.includes('elite')) return 'team';
  if (p.includes('pro')) return 'pro';
  // Fallback price ID (utilise quand on lit Stripe direct)
  const pid = String(priceId || '').toLowerCase();
  if (pid.includes('team') || pid.includes('elite')) return 'team';
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
    .single();
  if (!data) return null;
  if (!ACTIVE_STATUSES.has(data.status)) return { plan: 'free', status: data.status };
  return { plan: normalizePlan(data.plan), status: data.status };
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

  // Admin bypass : acces team permanent
  if (user.email && ADMIN_EMAILS.includes(user.email)) {
    const result = { plan: 'team', user, status: 'active', source: 'admin' };
    setCached(token, result);
    return result;
  }

  // 1. DB en priorite (peuplee par stripe-webhook)
  const fromDB = await resolvePlanFromDB(user.id);
  if (fromDB && fromDB.plan !== 'free') {
    const result = { plan: fromDB.plan, user, status: fromDB.status, source: 'db' };
    setCached(token, result);
    return result;
  }

  // 2. Fallback Stripe API si DB vide (cas legacy ou webhook pas encore tourne)
  const { data: profile } = await sb()
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

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
  if (result.plan !== 'pro' && result.plan !== 'team') {
    res.status(403).json({
      error: 'Abonnement Pro requis',
      plan: result.plan,
      upgrade_url: '/pricing.html',
    });
    return null;
  }
  return result;
}

async function requireTeam(req, res) {
  const result = await getUserPlan(req.headers.authorization);
  if (!result.user) {
    res.status(401).json({ error: 'Authentification requise' });
    return null;
  }
  if (result.plan !== 'team') {
    res.status(403).json({
      error: 'Abonnement Team requis',
      plan: result.plan,
      upgrade_url: '/pricing.html',
    });
    return null;
  }
  return result;
}

module.exports = { getUserPlan, requirePro, requireTeam, normalizePlan };
