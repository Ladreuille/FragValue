// api/stripe-health.js - FragValue
// Health check : verifie que toutes les variables Stripe et Supabase sont configurees.
// Curl rapide : `curl https://fragvalue.com/api/stripe-health` doit retourner true partout.

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // elite_* prend la priorite, sinon fallback sur les anciennes env vars team_*
  // (backward-compat pendant la migration post-rename du plan).
  const checks = {
    stripe_key: !!process.env.STRIPE_SECRET_KEY,
    webhook_secret: !!(process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOKLIVE_SECRET),
    pro_monthly: !!process.env.STRIPE_PRICE_PRO_MONTHLY,
    pro_yearly: !!process.env.STRIPE_PRICE_PRO_ANNUEL,
    elite_monthly: !!(process.env.STRIPE_PRICE_ELITE_MONTHLY || process.env.STRIPE_PRICE_TEAM_MONTHLY),
    elite_yearly: !!(process.env.STRIPE_PRICE_ELITE_ANNUEL  || process.env.STRIPE_PRICE_TEAM_ANNUEL),
    supabase_url: !!process.env.SUPABASE_URL,
    supabase_key: !!process.env.SUPABASE_SERVICE_KEY,
  };
  const ok = Object.values(checks).every(Boolean);

  return res.status(200).json({ ok, ...checks });
}
