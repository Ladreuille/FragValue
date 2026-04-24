// api/stripe-webhook.js - FragValue
// Recoit les webhooks Stripe et met a jour les abonnements dans Supabase

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Vercel ne parse pas le body pour les webhooks, on a besoin du raw body
export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) { chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk); }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const rawBody = await buffer(req);

  // Priorite absolue a STRIPE_WEBHOOKLIVE_SECRET s'il est set. Cette var a
  // ete ajoutee explicitement pour le mode live par l'user, donc on la
  // privilegie face au STRIPE_WEBHOOK_SECRET historique (qui peut encore
  // contenir un secret test mode cohabitant).
  const webhookSecret = process.env.STRIPE_WEBHOOKLIVE_SECRET
                     || process.env.STRIPE_WEBHOOK_SECRET;
  const secretSource = process.env.STRIPE_WEBHOOKLIVE_SECRET
    ? 'STRIPE_WEBHOOKLIVE_SECRET'
    : (process.env.STRIPE_WEBHOOK_SECRET ? 'STRIPE_WEBHOOK_SECRET' : 'NONE');

  if (!webhookSecret) {
    console.error('[Stripe] Aucun webhook secret configure');
    return res.status(500).json({ error: 'Webhook secret non configure', hint: 'Definir STRIPE_WEBHOOK_SECRET ou STRIPE_WEBHOOKLIVE_SECRET' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    // Log cote serveur uniquement (pas dans la reponse pour eviter info leak).
    // Le diagnostic detaille reste disponible dans les Vercel logs si besoin.
    console.error('[Stripe] Webhook signature verification failed:', {
      error: err.message,
      secretSource,
      bodyLen: rawBody.length,
    });
    return res.status(400).json({ error: 'Signature invalide' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        if (!userId) break;

        const subscription = await stripe.subscriptions.retrieve(session.subscription);

        await sb.from('subscriptions').upsert({
          user_id: userId,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: session.customer,
          plan: session.metadata.plan || 'pro_monthly',
          status: subscription.status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        console.log(`[Stripe] Subscription created for user ${userId}: ${subscription.id}`);
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const { data: existing } = await sb.from('subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', sub.id)
          .single();

        // Si pas en DB (ex: webhook race avant checkout.session.completed),
        // fallback via metadata.supabase_user_id propagee depuis stripe-checkout.
        const userId = existing?.user_id || sub.metadata?.supabase_user_id;
        if (!userId) {
          console.warn(`[Stripe] subscription.updated ${sub.id} : aucun user_id (DB ni metadata)`);
          break;
        }

        await sb.from('subscriptions').upsert({
          user_id: userId,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer,
          plan: sub.metadata?.plan || 'pro_monthly',
          status: sub.status,
          current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        console.log(`[Stripe] Subscription updated: ${sub.id} -> ${sub.status}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await sb.from('subscriptions').update({
          status: 'canceled',
          updated_at: new Date().toISOString(),
        }).eq('stripe_subscription_id', sub.id);

        console.log(`[Stripe] Subscription canceled: ${sub.id}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await sb.from('subscriptions').update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          }).eq('stripe_subscription_id', invoice.subscription);

          console.log(`[Stripe] Payment failed for subscription: ${invoice.subscription}`);
        }
        break;
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Erreur traitement webhook' });
  }

  return res.status(200).json({ received: true });
}
