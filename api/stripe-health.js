// api/stripe-health.js — FragValue
// Health check : verifie que toutes les variables Stripe et Supabase sont configurees

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(200).json({
    ok: true,
    stripe: !!process.env.STRIPE_SECRET_KEY,
    pro_monthly: !!process.env.STRIPE_PRICE_PRO_MONTHLY,
    pro_yearly: !!process.env.STRIPE_PRICE_PRO_YEARLY,
    team: !!process.env.STRIPE_PRICE_TEAM_MONTHLY,
    supabase: !!process.env.SUPABASE_URL,
  });
}
