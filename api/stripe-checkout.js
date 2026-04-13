// api/stripe-checkout.js — FragValue
// Crée une Stripe Checkout Session pour l'abonnement Pro ou Team

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // CORS
  const allowedOrigins = ['https://frag-value.vercel.app', 'http://localhost:3456'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validate env vars before doing anything — detailed missing list
  const missing = [];
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (!process.env.STRIPE_PRICE_PRO_MONTHLY) missing.push('STRIPE_PRICE_PRO_MONTHLY');
  if (!process.env.STRIPE_PRICE_PRO_YEARLY) missing.push('STRIPE_PRICE_PRO_YEARLY');
  if (!process.env.STRIPE_PRICE_TEAM_MONTHLY) missing.push('STRIPE_PRICE_TEAM_MONTHLY');
  if (!process.env.SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!process.env.SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_KEY');
  if (missing.length > 0) {
    return res.status(503).json({ error: 'Variables manquantes : ' + missing.join(', ') });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const PLANS = {
    pro_monthly:  process.env.STRIPE_PRICE_PRO_MONTHLY,
    pro_yearly:   process.env.STRIPE_PRICE_PRO_YEARLY,
    team_monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY,
  };

  const { plan, token } = req.body;
  if (!plan || !(plan in PLANS)) {
    return res.status(400).json({ error: 'Plan invalide. Valeurs: pro_monthly, pro_yearly, team_monthly' });
  }
  if (!PLANS[plan]) {
    return res.status(503).json({ error: `Prix Stripe non configure pour "${plan}". Ajoute STRIPE_PRICE_* dans les variables Vercel.` });
  }

  // Verify Supabase session
  if (!token) return res.status(401).json({ error: 'Non authentifie' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Session invalide' });

  try {
    // Check if user already has a Stripe customer ID
    const { data: profile } = await sb.from('profiles').select('stripe_customer_id').eq('id', user.id).single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      // Create Stripe customer
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      // Save customer ID to profile
      await sb.from('profiles').upsert({
        id: user.id,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: PLANS[plan], quantity: 1 }],
      success_url: `${req.headers.origin || 'https://frag-value.vercel.app'}/account.html?checkout=success`,
      cancel_url: `${req.headers.origin || 'https://frag-value.vercel.app'}/#tarifs`,
      metadata: {
        supabase_user_id: user.id,
        plan,
      },
    });

    return res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: 'Erreur Stripe' });
  }
}
