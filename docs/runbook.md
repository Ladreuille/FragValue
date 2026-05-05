# Runbook ops FragValue

Procedures pour les incidents les plus probables. A jour mai 2026.

## Architecture en 3 lignes

- Frontend : vanilla HTML/CSS/JS sur Vercel (ce repo)
- Parser CS2 : Express + demoparser2 sur Railway (repo `fragvalue-demo-parser`)
- DB + Auth : Supabase (Postgres + RLS + Auth)

## Comment savoir si quelque chose a casse

1. Discord channel #ops-alerts : alertes auto via `_lib/alert.js`
   (Stripe webhook crash, crons crash, refunds, SCA 3DS).
2. Vercel dashboard > Deployments > tester le dernier deploy.
3. Vercel logs (Functions tab, filter sur error level).
4. `https://fragvalue.com/api/stripe-health` -> 200 si Stripe OK.
5. `https://fragvalue.com/api/webhooks/faceit` (GET) -> `{ ok, ready }`.

## Incident : Stripe webhook fail 1h

**Symptomes** : alerte Discord "Stripe webhook crash", users qui paient sans
voir leur abonnement actif, MRR qui baisse anormalement.

**Diagnostic** :
1. Vercel logs > `/api/stripe-webhook` > regarder le stack trace.
2. Si erreur DB Supabase -> verifier Supabase status page.
3. Si erreur signature -> verifier que `STRIPE_WEBHOOKLIVE_SECRET` matche
   bien le webhook configure dans Stripe Dashboard.

**Recovery** :
1. Fix le bug, push, deploy.
2. Stripe Dashboard > Developers > Webhooks > selection l'endpoint > onglet
   "Events" > filtrer sur les events failed (icone rouge) > clic sur chaque
   event > "Resend webhook". Stripe rejouera vers le nouveau code.
3. La table `stripe_webhook_events` skip les events deja traites (idempotency
   par `event_id`), donc resend safe.
4. Si plus de 100 events a rejouer : ecrire un script qui lit
   `stripe_webhook_events.processed_at IS NULL` + relance via `stripe.webhooks.list`.

## Incident : parser Railway down

**Symptomes** : users qui upload une demo et restent en `parsing` indefini,
alerte Discord "Cron faceit-process-events crashed".

**Diagnostic** :
1. `curl https://fragvalue-demo-parser-production.up.railway.app/health`
2. Railway dashboard > deployments > logs.
3. Si OOM (out of memory) : demo trop lourde, augmenter memory tier.

**Recovery** :
1. Si Railway down : Railway dashboard > redeploy le dernier commit stable.
2. Les demos en `parsing` peuvent etre rejouees manuellement :
   ```sql
   UPDATE matches SET status = 'pending'
   WHERE status = 'parsing' AND created_at > NOW() - INTERVAL '1 hour';
   ```
   Le cron `faceit-process-events` les retentera (max retry_count = 5).

## Incident : Supabase down

**Symptomes** : tout le site est mort, login impossible, dashboard vide.
**Recovery** : aucun, attendre Supabase. Status page : status.supabase.com.
**Mitigation future** : envisager un read replica + cache CDN sur les pages
publiques (pricing, blog, mentions legales).

## Incident : cron crashed silencieusement

**Symptomes** : alerte Discord "Cron <name> crashed".

**Diagnostic** :
1. Vercel dashboard > Functions > filtrer sur le path `/api/cron/<name>`.
2. Lire le stack trace.

**Recovery** :
1. Fix + deploy.
2. Manual trigger pour rejouer : `curl -X POST https://fragvalue.com/api/cron/<name>?secret=<CRON_SECRET>`
   (en local : `curl -H "Authorization: Bearer $CRON_SECRET" ...`).
3. Verifier que le rerun est idempotent (cf. doc inline du cron).

## Incident : FACEIT Downloads API renvoie 403 err_f0

**Symptomes** : analyse FACEIT-URL ne marche plus, log "no_scope" dans les
events.

**Recovery** : contacter Adam Harb (ad.harb@ext.efg.gg) pour reactiver le scope
`downloads_api` sur la `FACEIT_API_KEY`. Cas typique : key regeneree apres
l'octroi initial.

## Incident : Resend rate limit (emails non envoyes)

**Symptomes** : dunning J+3 / yearly notice ne partent pas, log Resend 429.

**Recovery** :
1. Resend dashboard > usage > verifier le quota du plan.
2. Si plan gratuit (3000 emails/mois) sature -> upgrade Pro.
3. Les emails ratés sont remontes dans les logs cron mais pas re-tentes.
   Pour rejouer : SQL `UPDATE subscriptions SET dunning_sent_at = REPLACE(dunning_sent_at, 'j3', '')`
   et le cron renverra le J+3.

## Tests post-deploy critiques

Apres tout deploy qui touche `/api/stripe-webhook.js` :
1. Stripe Dashboard > Developers > Webhooks > Send test event.
2. Verifier que la 200 arrive et qu'une row apparait dans
   `stripe_webhook_events`.

Apres tout deploy qui touche `/api/coach-conversational.js` :
1. Login en tant qu'user Pro de test.
2. Envoyer un message au Coach IA.
3. Verifier reponse + decrement credit dans `coach_credits_log`.

## Contacts utiles

- FACEIT (Downloads API scope) : Adam Harb <ad.harb@ext.efg.gg>
- Hebergement Vercel : support@vercel.com
- Hebergement Railway : team@railway.app
- DB Supabase : support@supabase.com
- DPO FragValue : quentin@fragvalue.com
