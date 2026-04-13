// api/check-subscription.js
// Verifie le plan Stripe de l'utilisateur via son stripe_customer_id
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://frag-value.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non authentifie' });

  try {
    // Verifier le JWT Supabase
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) return res.status(401).json({ error: 'Token invalide' });

    // Recuperer le profil
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    const customerId = profile?.stripe_customer_id;
    if (!customerId) {
      return res.status(200).json({ plan: 'free', status: 'none' });
    }

    // Chercher un abonnement actif
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    if (!subs.data.length) {
      return res.status(200).json({ plan: 'free', status: 'none' });
    }

    const sub = subs.data[0];
    const priceId = sub.items.data[0]?.price?.id || '';

    // Determiner le plan depuis le price ID
    let plan = 'free';
    if (priceId.includes('team')) plan = 'team';
    else if (priceId.includes('pro') || sub.items.data[0]?.price?.unit_amount >= 500) plan = 'pro';

    return res.status(200).json({
      plan,
      status: sub.status,
      current_period_end: sub.current_period_end,
    });
  } catch (err) {
    console.error('check-subscription error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
