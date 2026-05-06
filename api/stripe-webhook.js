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

// Stripe peut renvoyer null/undefined pour current_period_* sur certains states
// transitoires (incomplete_expired, trialing pre-paiement, sub cancelled-then-reactivated).
// Eviter RangeError "Invalid time value" en retournant null au lieu de crash.
function tsToIso(unixSec) {
  if (unixSec == null || typeof unixSec !== 'number' || !Number.isFinite(unixSec)) return null;
  const ms = unixSec * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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

  // Idempotency : INSERT en premier dans stripe_webhook_events. Si l'event_id
  // existe deja (duplicate key violation 23505), on a deja traite ce webhook
  // (Stripe peut retry sur 5xx ou timeout). On renvoie 200 sans rejouer la
  // logique business (eviter double email, double credit, etc.).
  try {
    const { error: idemErr } = await sb
      .from('stripe_webhook_events')
      .insert({
        event_id: event.id,
        event_type: event.type,
        api_version: event.api_version || null,
        livemode: event.livemode || false,
      });
    if (idemErr) {
      if (idemErr.code === '23505') {
        console.log(`[Stripe] Skipped duplicate webhook ${event.id} (${event.type})`);
        return res.status(200).json({ received: true, duplicate: true });
      }
      // Autre erreur DB : on log et on continue, mieux vaut traiter que perdre.
      console.warn(`[Stripe] idempotency insert failed for ${event.id}: ${idemErr.message}`);
    }
  } catch (e) {
    console.warn('[Stripe] idempotency check threw:', e?.message);
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

          // GA4 Measurement Protocol : track le purchase server-side (autoritative).
          try {
            const { trackServer } = require('./_lib/ga4-mp.js');
            await trackServer({
              userId,
              clientId: `stripe.${session.customer || session.id}`,
              events: [{
                name: 'purchase',
                params: {
                  transaction_id: session.id,
                  value: (session.amount_total || 0) / 100,
                  currency: (session.currency || 'eur').toUpperCase(),
                  items: [{
                    item_id: packKey,
                    item_name: `Coach IA Credits ${packKey}`,
                    item_category: 'coach_credits',
                    quantity: parseInt(session.metadata.credits, 10) || 1,
                    price: (session.amount_total || 0) / 100,
                  }],
                },
              }],
            });
          } catch (mpErr) {
            console.warn('[Stripe] GA4 MP credits purchase failed (non-blocking):', mpErr?.message);
          }

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
        // GUEST CHECKOUT (cf. ultrareview CRO P0) : si metadata.guest_signup,
        // l'user a paye sans avoir de compte Supabase. On le cree maintenant
        // (via auth.admin) + on envoie un magic link pour qu'il puisse se
        // connecter et activer son compte.
        let userId = session.metadata?.supabase_user_id;
        if (!userId && session.metadata?.guest_signup === '1') {
          const guestEmail = session.metadata.guest_email
            || session.customer_details?.email
            || session.customer_email;
          if (!guestEmail) {
            console.error('[Stripe] guest_signup checkout sans email :', session.id);
            break;
          }
          try {
            // Cherche d'abord si l'user existe deja (cas user qui s'est inscrit
            // entre temps avec le meme email -> on lie au compte existant)
            const { data: existingList } = await sb.auth.admin.listUsers({
              page: 1, perPage: 1000,
            });
            const existing = existingList?.users?.find(
              u => (u.email || '').toLowerCase() === guestEmail.toLowerCase()
            );
            if (existing) {
              userId = existing.id;
              console.log(`[Stripe] guest_signup : user existant trouve ${userId} pour ${guestEmail}`);
            } else {
              // Cree un user Supabase avec mot de passe random + email confirme.
              // L'user recevra un magic link pour activer (cf. plus bas).
              const randomPwd = require('crypto').randomBytes(32).toString('base64url');
              const { data: newUser, error: createErr } = await sb.auth.admin.createUser({
                email: guestEmail,
                password: randomPwd,
                email_confirm: true, // pas de double opt-in : email valide via Stripe paiement
                user_metadata: { source: 'stripe_guest_checkout', stripe_session: session.id },
              });
              if (createErr || !newUser?.user) {
                console.error('[Stripe] guest_signup createUser failed:', createErr?.message);
                break;
              }
              userId = newUser.user.id;
              console.log(`[Stripe] guest_signup : nouveau user ${userId} cree pour ${guestEmail}`);
            }

            // Envoie un magic link pour login sans password
            const baseUrl = process.env.SITE_URL || 'https://fragvalue.com';
            const { data: linkData } = await sb.auth.admin.generateLink({
              type: 'magiclink',
              email: guestEmail,
              options: { redirectTo: `${baseUrl}/account.html?welcome=guest` },
            });
            const magicUrl = linkData?.properties?.action_link;
            if (magicUrl) {
              try {
                const { sendEmail } = await import('./_lib/email.js');
                await sendEmail({
                  to: guestEmail,
                  subject: 'Active ton compte FragValue (1 clic)',
                  html: `<p>Ton paiement est confirme. Clique sur le lien ci-dessous pour acceder a ton compte FragValue (pas besoin de mot de passe) :</p><p><a href="${magicUrl}" style="display:inline-block;background:#b8ff57;color:#000;padding:14px 28px;border-radius:8px;font-weight:700;text-decoration:none">Activer mon compte</a></p><p>Le lien est valable 24h. Tu pourras definir un mot de passe dans ton espace si tu prefere.</p>`,
                  text: `Ton paiement est confirme. Active ton compte FragValue ici (pas besoin de mot de passe) : ${magicUrl}\n\nLe lien est valable 24h.`,
                });
                console.log(`[Stripe] guest_signup magic link envoye a ${guestEmail}`);
              } catch (mailErr) {
                console.error('[Stripe] guest_signup magic link email failed:', mailErr.message);
              }
            }
          } catch (e) {
            console.error('[Stripe] guest_signup processing failed:', e.message);
            break;
          }
        }
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
          current_period_start: tsToIso(subscription.current_period_start),
          current_period_end: tsToIso(subscription.current_period_end),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        // Update profile.subscription_tier = 'pro' ou 'elite' selon planMeta
        // (source de verite single pour les pages frontend qui lisent profiles).
        // Schema reel : la colonne s'appelle subscription_tier (pas plan).
        const profilePlanCheckout = planMeta.startsWith('elite') || planMeta.startsWith('team') ? 'elite' : 'pro';
        await sb.from('profiles')
          .update({ subscription_tier: profilePlanCheckout })
          .eq('id', userId);

        // DISCORD SYNC : si user a deja lie son Discord avant le 1er paiement,
        // assign auto le role Pro/Elite. Sinon le sync se fera au moment du
        // /api/discord-link-callback. Best-effort, ne fail pas le webhook.
        try {
          const { data: link } = await sb
            .from('discord_links')
            .select('discord_id')
            .eq('user_id', userId)
            .maybeSingle();
          if (link?.discord_id) {
            const { syncUserPlan } = await import('./_lib/discord.js');
            await syncUserPlan(link.discord_id, profilePlanCheckout);
            console.log(`[Stripe] Discord role assigned for new subscriber ${userId} -> ${profilePlanCheckout}`);
          }
        } catch (discordErr) {
          console.warn('[Stripe] Discord role assign on checkout failed (non-blocking):', discordErr?.message);
        }

        console.log(`[Stripe] Subscription created for user ${userId}: ${subscription.id}`);

        // GA4 Measurement Protocol : track le purchase + subscription_started.
        // Le purchase est autoritative cote serveur (vs gtag client qui peut etre
        // bloque par ad blocker / refus consent). Source of truth = Stripe webhook.
        try {
          const { trackServer } = require('./_lib/ga4-mp.js');
          const amountEur = (subscription.items?.data?.[0]?.price?.unit_amount || 0) / 100;
          const interval = subscription.items?.data?.[0]?.price?.recurring?.interval || 'month';
          await trackServer({
            userId,
            clientId: `stripe.${session.customer || subscription.id}`,
            events: [
              {
                name: 'purchase',
                params: {
                  transaction_id: session.id,
                  value: amountEur,
                  currency: (subscription.currency || 'eur').toUpperCase(),
                  items: [{
                    item_id: planMeta,
                    item_name: `FragValue ${profilePlanCheckout} (${interval})`,
                    item_category: 'subscription',
                    item_variant: interval,
                    price: amountEur,
                    quantity: 1,
                  }],
                },
              },
              {
                name: 'subscription_started',
                params: {
                  plan: profilePlanCheckout,
                  interval,
                  value: amountEur,
                  currency: (subscription.currency || 'eur').toUpperCase(),
                },
              },
            ],
          });
        } catch (mpErr) {
          console.warn('[Stripe] GA4 MP subscription purchase failed (non-blocking):', mpErr?.message);
        }

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
              periodEndIso: tsToIso(subscription.current_period_end),
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

        const planMeta2 = sub.metadata?.plan || 'pro_monthly';

        // Edge case : un user peut avoir cree 2 subs en parallele (ex.
        // checkout Elite abandonne puis checkout Pro confirme). L'event
        // webhook arrive pour le sub abandonne (incomplete_expired) APRES
        // le sub actif. Sans garde, on ecraserait la sub active. Skip si
        // la row existante est active/trialing et que l'incoming est un
        // sub_id different en etat terminal.
        const TERMINAL_STATES = ['canceled', 'incomplete_expired', 'unpaid'];
        const ACTIVE_STATES   = ['active', 'trialing'];
        const { data: existingSub } = await sb
          .from('subscriptions')
          .select('stripe_subscription_id, status')
          .eq('user_id', userId)
          .maybeSingle();
        if (existingSub
            && existingSub.stripe_subscription_id
            && existingSub.stripe_subscription_id !== sub.id
            && ACTIVE_STATES.includes(existingSub.status)
            && TERMINAL_STATES.includes(sub.status)) {
          console.warn(`[Stripe] Skip subscription.updated for ${sub.id} (${sub.status}) : user ${userId} has active sub ${existingSub.stripe_subscription_id}`);
          break;
        }

        await sb.from('subscriptions').upsert({
          user_id: userId,
          stripe_subscription_id: sub.id,
          stripe_customer_id: sub.customer,
          plan: planMeta2,
          status: sub.status,
          current_period_start: tsToIso(sub.current_period_start),
          current_period_end: tsToIso(sub.current_period_end),
          // Propage le flag : TRUE si user a clique "Annuler" dans Stripe Portal
          // mais que la subscription reste active jusqu'a current_period_end.
          // Permet a l'UI de montrer "Annulation programmee pour le X".
          cancel_at_period_end: !!sub.cancel_at_period_end,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

        // Update profiles.subscription_tier pour qu'il reste source de verite
        // single (utilise par les pages /pricing.html, /account.html, etc.).
        const profilePlan = sub.status === 'active' || sub.status === 'trialing'
          ? (planMeta2.startsWith('elite') || planMeta2.startsWith('team') ? 'elite' : 'pro')
          : 'free';
        await sb.from('profiles')
          .update({ subscription_tier: profilePlan })
          .eq('id', userId);

        // DISCORD SYNC : si user a lie son Discord, on sync le role auto.
        // Best-effort : ne fail pas le webhook si Discord plante.
        try {
          const { data: link } = await sb
            .from('discord_links')
            .select('discord_id')
            .eq('user_id', userId)
            .maybeSingle();
          if (link?.discord_id) {
            const { syncUserPlan } = await import('./_lib/discord.js');
            await syncUserPlan(link.discord_id, profilePlan);
            console.log(`[Stripe] Discord role synced for user ${userId} (plan ${profilePlan})`);
          }
        } catch (discordErr) {
          console.warn('[Stripe] Discord role sync failed (non-blocking):', discordErr?.message);
        }

        console.log(`[Stripe] Subscription updated: ${sub.id} -> ${sub.status}${sub.cancel_at_period_end ? ' (cancel scheduled)' : ''}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        // maybeSingle() pour ne pas throw si la sub deletee n'a jamais ete
        // sync en DB (cas typique : sub abandonnee incomplete_expired qu'on a
        // skip lors du subscription.updated par la garde multi-subs).
        const { data: existingDel } = await sb.from('subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', sub.id)
          .maybeSingle();
        const userIdDel = existingDel?.user_id;
        if (!userIdDel) {
          console.log(`[Stripe] Skip subscription.deleted ${sub.id} : not tracked in DB (likely abandoned/duplicate sub)`);
          break;
        }

        await sb.from('subscriptions').update({
          status: 'canceled',
          cancel_at_period_end: false, // deja effective, plus de "scheduled"
          updated_at: new Date().toISOString(),
        }).eq('stripe_subscription_id', sub.id);

        // Downgrade profile.subscription_tier -> free
        if (userIdDel) {
          await sb.from('profiles')
            .update({ subscription_tier: 'free' })
            .eq('id', userIdDel);

          // DISCORD SYNC : retire les roles Pro/Elite, applique Free.
          // Best-effort.
          try {
            const { data: link } = await sb
              .from('discord_links')
              .select('discord_id')
              .eq('user_id', userIdDel)
              .maybeSingle();
            if (link?.discord_id) {
              const { syncUserPlan } = await import('./_lib/discord.js');
              await syncUserPlan(link.discord_id, 'free');
              console.log(`[Stripe] Discord role downgraded to Free for user ${userIdDel}`);
            }
          } catch (discordErr) {
            console.warn('[Stripe] Discord role downgrade failed (non-blocking):', discordErr?.message);
          }
        }

        console.log(`[Stripe] Subscription canceled: ${sub.id}`);

        // GA4 MP : track la resiliation pour analyse churn
        if (userIdDel) {
          try {
            const { trackServer } = require('./_lib/ga4-mp.js');
            await trackServer({
              userId: userIdDel,
              clientId: `stripe.${sub.customer || sub.id}`,
              events: [{
                name: 'subscription_canceled',
                params: {
                  subscription_id: sub.id,
                  cancel_reason: sub.cancellation_details?.reason || 'unknown',
                },
              }],
            });
          } catch (mpErr) {
            console.warn('[Stripe] GA4 MP cancel failed (non-blocking):', mpErr?.message);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          await sb.from('subscriptions').update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
            payment_failed_at: new Date().toISOString(),  // pour le cron dunning J+3/+5/+7
          }).eq('stripe_subscription_id', invoice.subscription);

          // P0 EMAIL CASH RECOVERY (cf. ultrareview Email lifecycle) :
          // J+0 dunning email immediat. Recovery rate SaaS standard 38-45% du MRR.
          try {
            // Recupere user + plan pour personnaliser l'email
            const { data: subRow } = await sb
              .from('subscriptions')
              .select('user_id, plan, current_period_end')
              .eq('stripe_subscription_id', invoice.subscription)
              .maybeSingle();
            if (subRow?.user_id) {
              const { data: userData } = await sb.auth.admin.getUserById(subRow.user_id);
              const email = userData?.user?.email;
              if (email) {
                const tpl = require('./_lib/email-templates.js');
                const { sendEmail } = await import('./_lib/email.js');
                const planLabel = subRow.plan?.startsWith('elite') ? 'Elite' : 'Pro';
                const amount = fmtAmount(invoice.amount_due, invoice.currency);
                const t = tpl.paymentFailed({
                  nickname: email.split('@')[0],
                  planLabel,
                  milestone: 'j0',
                  amount,
                  periodEndIso: subRow.current_period_end,
                  portalUrl: `${process.env.PUBLIC_URL || 'https://fragvalue.com'}/account.html`,
                });
                await sendEmail({ to: email, subject: t.subject, html: t.html, text: t.text });
                // Idempotence : flag dans dunning_sent_at (concat "j0,j3,j5,j7")
                await sb.from('subscriptions')
                  .update({ dunning_sent_at: 'j0' })
                  .eq('stripe_subscription_id', invoice.subscription)
                  .catch(() => {});
                console.log(`[Stripe] Dunning J+0 sent to ${email} for ${invoice.subscription}`);
              }
            }
          } catch (dunningErr) {
            console.warn('[Stripe] Dunning J+0 email failed:', dunningErr?.message);
          }

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
            current_period_start: tsToIso(sub.current_period_start),
            current_period_end:   tsToIso(sub.current_period_end),
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

      // Refund automatique ou manuel via dashboard Stripe. On log + alerte ops
      // pour declencher le suivi business : annuler la sub si pas deja fait,
      // recrediter ou debit les coach credits achetes, notifier le user.
      // La logique business est volontairement manuelle pour l'instant (rare).
      case 'charge.refunded': {
        const charge = event.data.object;
        const amount = fmtAmount(charge.amount_refunded, charge.currency);
        console.log(`[Stripe] Charge refunded: ${charge.id} · ${amount} · customer=${charge.customer || 'none'}`);
        try {
          const { sendAlert } = require('./_lib/alert.js');
          await sendAlert({
            severity: 'warning',
            title: 'Stripe charge refunded',
            source: 'stripe-webhook',
            details: {
              charge_id: charge.id,
              amount: amount,
              customer: charge.customer,
              reason: charge.refunds?.data?.[0]?.reason || 'unknown',
              receipt_url: charge.receipt_url,
            },
          });
        } catch (_) {}
        break;
      }

      // Trial expire dans 3 jours (notification automatique Stripe). Le cron
      // trial-expiring.js gere deja l'email J-3 par milestone DB, mais cet
      // event Stripe sert de safety-net si le cron a echoue.
      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object;
        const endIso = tsToIso(sub.trial_end);
        console.log(`[Stripe] Trial ending soon for sub=${sub.id} (user=${sub.metadata?.user_id || 'none'}) at ${endIso}`);
        break;
      }

      // 3DS / SCA : Stripe a tente de prelever mais la banque demande une
      // verification active du user (typiquement pour les renouvellements
      // au-dela de la limite de 30 EUR Art. 13 PSD2). Si on rate ca, le user
      // ne sera pas preleve et finira en past_due sans en etre informe.
      // Stripe envoie aussi un email Hosted Invoice Page au user, mais on
      // veut etre alerte en interne pour suivre.
      case 'invoice.payment_action_required': {
        const invoice = event.data.object;
        console.log(`[Stripe] Payment action required: invoice=${invoice.id} · ${fmtAmount(invoice.amount_due, invoice.currency)} · customer=${invoice.customer}`);
        try {
          const { sendAlert } = require('./_lib/alert.js');
          await sendAlert({
            severity: 'warning',
            title: 'Stripe SCA / 3DS required',
            source: 'stripe-webhook',
            details: {
              invoice_id: invoice.id,
              amount: fmtAmount(invoice.amount_due, invoice.currency),
              customer: invoice.customer,
              hosted_invoice_url: invoice.hosted_invoice_url,
              user_id: invoice.metadata?.user_id || invoice.subscription_details?.metadata?.user_id || null,
            },
          });
        } catch (_) {}
        break;
      }
    }

    // Marque l'event comme traite avec succes pour debug ulterieur.
    sb.from('stripe_webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('event_id', event.id)
      .then(() => {})
      .catch(() => {});
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Alerte ops critique : un crash de webhook Stripe = potentiel revenue
    // perdu (paiement reussi mais abonnement pas active dans la DB), Stripe
    // va retry 3x mais on veut etre au courant immediatement.
    try {
      const { sendAlert } = require('./_lib/alert.js');
      await sendAlert({
        severity: 'critical',
        title: 'Stripe webhook crash',
        source: 'stripe-webhook',
        details: {
          error: err?.message,
          stack: (err?.stack || '').slice(0, 600),
          event_type: event?.type,
          event_id: event?.id,
        },
      });
    } catch (_) { /* best-effort */ }
    return res.status(500).json({ error: 'Erreur traitement webhook' });
  }

  return res.status(200).json({ received: true });
}
