// api/stripe-health.js — FragValue
// Health check : verifie que toutes les variables Stripe et Supabase sont configurees
// v2 : force redeploy pour prise en compte des env vars

export default function handler(req, res) {
  // Internal debugging only — restricted to production origin
  res.setHeader('Access-Control-Allow-Origin', 'https://frag-value.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(200).json({
    ok: true,
    stripe_key: !!process.env.STRIPE_SECRET_KEY,
    pro_monthly: !!process.env.STRIPE_PRICE_PRO_MONTHLY,
    pro_yearly: !!process.env.STRIPE_PRICE_PRO_ANNUEL,
    team_monthly: !!process.env.STRIPE_PRICE_TEAM_MONTHLY,
    supabase_url: !!process.env.SUPABASE_URL,
    supabase_key: !!process.env.SUPABASE_SERVICE_KEY,
  });
}
