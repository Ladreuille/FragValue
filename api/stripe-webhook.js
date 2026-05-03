// api/stripe-webhook.js - FragValue
// Recoit les webhooks Stripe et met a jour les abonnements dans Supabase

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
// CoachCredits est en CommonJS (module.exports), donc default import + destructure
import coachCreditsModule from './_lib/coach-credits.js';
const { addCredits } = coachCreditsModule;

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Vercel ne parse pas le body pour les webhooks, on a besoin du raw body
export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) { chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk); }
  return Buffer.concat(chunks);
}

// Format un montant Stripe (centimes) en string humain pour les logs.
function fmtAmount(cents, currency) {
  return ((cents || 0) / 100).toFixed(2) + ' ' + (currency || 'eur').toUpperCase();
}

// Valide qu'une string est un UUID v4 valide. Defense-in-depth contre une
// metadata Stripe malformee ou injection (cf. ultrareview P1.9). Le webhook
// signature check protege deja le contenu, mais on valide en plus tout user_id
// avant de l'utiliser dans une query DB pour eviter SQL/NoSQL injection latente.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s);
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

        // ─── A. Achat de credits Coach IA (one-shot, mode 'payment') ───
        // Distinction via metadata.purchase_type == 'coach_credits' ou
        // session.mode === 'payment'. Les credits sont ajoutes via addCredits.
        if (session.mode === 'payment' && session.metadata?.purchase_type === 'coach_credits') {
          const userId  = session.metadata.user_id;
          const packKey = session.metadata.pack;
          if (!userId || !packKey) {
            console.warn('[Stripe] coach_credits checkout sans user_id ou pack:', session.id);
            break;
          }
          // Defense-in-depth : valide que user_id est un UUID avant query DB
          if (!isValidUuid(userId)) {
            console.error('[Stripe] coach_credits user_id invalide (pas UUID):', userId, 'session=' + session.id);
            break;
          }
          const result = await addCredits(sb, userId, packKey, session.id);
          if (!result.ok) {
            console.error('[Stripe] addCredits failed:', result.error, 'session=' + session.id);
            break;
          }
          console.log(`[Stripe] +${session.metadata.credits || '?'} credits coach_ia for user ${userId} (balance=${result.balance_after})`);

          // Email de confirmation post-achat (best-effort, n'echoue pas le webhook)
          try {
            const { data: profile } = await sb
              .from('profiles')
              .select('faceit_nickname')
              .eq('id', userId)
              .maybeSingle();
            const { data: userData } = await sb.auth.admin.getUserById(userId);
            const userEmail = userData?.user?.email;
            if (userEmail) {
              const tpl = (await import('./_lib/email-templates.js')).default
                || require('./_lib/email-templates.js');
              const { sendEmail } = await import('./_lib/email.js');
              // Resolution du label + montant depuis metadata (set par coach-credits-purchase.js)
              const creditsAdded = parseInt(session.metadata.credits, 10) || 0;
              const packLabelMap = {
                pack_50:  '50 credits Coach IA',
                pack_200: '200 credits Coach IA',
              };
              const t = tpl.coachCreditsPurchased({
                nickname:     profile?.faceit_nickname || userEmail.split('@')[0],
                packLabel:    packLabelMap[packKey] || packKey,
                creditsAdded,
                balanceAfter: result.balance_after,
                expiresAtIso: result.expires_at,
                amountEur:    (session.amount_total || 0) / 100,
              });
              await sendEmail({ to: userEmail, subject: t.subject, html: t.html, text: t.text });
              console.log(`[Stripe] coach_credits purchase email sent to ${userEmail}`);
            }
          } catch (mailErr) {
            console.error('[Stripe] coach_credits email failed:', mailErr.message);
          }
          break;
        }

        // ─── B. Subscription classique (mode 'subscription') ───
        const userId = session.metadata?.supabase_user_id;
        if (!userId) break;
        if (!isValidUuid(userId)) {
          console.error('[Stripe] subscription user_id invalide (pas UUID):', userId, 'session=' + session.id);
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const planMeta = session.metadata.plan || 'pro_monthly';

        await sb.from('subscriptions').upsert({
          user_id: userId,
          stripe_subscription_id: subscription.id,
          stripe_customer_id: session.customer,
          plan: planMeta,
          status: subscription.status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        console.log(`[Stripe] Subscription created for user ${userId}: ${subscription.id}`);

        // Email de confirmation paiement (best-effort, n'echoue pas le webhook)
        try {
          const { data: profile } = await sb
            .from('profiles')
            .select('faceit_nickname')
            .eq('id', userId)
            .maybeSingle();
          // Recupere l'email user via auth.users (admin scope avec SERVICE_KEY)
          const { data: userData } = await sb.auth.admin.getUserById(userId);
          const userEmail = userData?.user?.email;
          if (userEmail) {
            const tpl = (await import('./_lib/email-templates.js')).default
              || require('./_lib/email-templates.js');
            const { sendEmail } = await import('./_lib/email.js');
            const t = tpl.checkoutSuccess({
              nickname: profile?.faceit_nickname || userEmail.split('@')[0],
              plan: planMeta,
              periodEndIso: new Date(subscription.current_period_end * 1000).toISOString(),
            });
            await sendEmail({ to: userEmail, subject: t.subject, html: t.html, text: t.text });
            console.log(`[Stripe] Checkout success email sent to ${userEmail}`);
          }
        } catch (mailErr) {
          // On ne fait pas echouer le webhook si l'email rate (Stripe retry sinon)
          console.error('[Stripe] Checkout success email failed:', mailErr.message);
        }
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
        if (!isValidUuid(userId)) {
          console.error(`[Stripe] subscription.updated ${sub.id} : user_id invalide (pas UUID): ${userId}`);
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
          // Propage le flag : TRUE si user a clique "Annuler" dans Stripe Portal
          // mais que la subscription reste active jusqu'a current_period_end.
          // Permet a l'UI de montrer "Annulation programmee pour le X".
          cancel_at_period_end: !!sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        console.log(`[Stripe] Subscription updated: ${sub.id} -> ${sub.status}${sub.cancel_at_period_end ? ' (cancel scheduled)' : ''}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await sb.from('subscriptions').update({
          status: 'canceled',
          cancel_at_period_end: false, // deja effective, plus de "scheduled"
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

      // 1re facture payee a la fin du trial -> on passe trialing -> active.
      // CRITICAL : sans ce handler, les abonnes restaient bloques en 'trialing'
      // dans la DB meme apres avoir paye, et ne pouvaient pas voir les features
      // active-only (gating sur status='active'). Cf. ticket trial 7j.
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          // Recupere la subscription pour avoir les dates de la nouvelle periode
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          await sb.from('subscriptions').update({
            status: sub.status, // 'active' apres 1er paiement reussi
            current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
            current_period_end:   new Date(sub.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('stripe_subscription_id', invoice.subscription);

          console.log(`[Stripe] Payment succeeded for ${invoice.subscription}: ${fmtAmount(invoice.amount_paid, invoice.currency)} → status ${sub.status}`);
        }
        break;
      }

      // Facture finalisee (passe de draft -> open). Stripe finalise les invoices
      // automatiquement 1h apres creation par defaut. Pour finaliser plus tot
      // ou pour les invoices manuelles, ce handler permet de tracker l'etat.
      case 'invoice.finalized': {
        const invoice = event.data.object;
        console.log(`[Stripe] Invoice finalized: ${invoice.id} · ${fmtAmount(invoice.amount_due, invoice.currency)} · sub=${invoice.subscription || 'none'}`);
        break;
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Erreur traitement webhook' });
  }

  return res.status(200).json({ received: true });
}
