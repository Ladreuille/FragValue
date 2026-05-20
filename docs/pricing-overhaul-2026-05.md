# Pricing Overhaul · Mai 2026

Audit complet du business model FragValue + execution des 8 phases.
Ce doc liste ce qui a change cote produit + les actions critiques
que tu (Quentin) dois faire **avant** que le launch soit operationnel
sur la partie paiements/Stripe.

---

## TL;DR des changements code

| Avant | Apres |
|---|---|
| Free 3 analyses/mois, 1 diag IA/mois | **Free 5 analyses, 4 diags IA** |
| Pro 5 msg Coach IA/jour | **Pro 20 msg/jour** |
| Elite 30 msg/jour | **Elite 50 msg/jour** |
| Pro 17 bullets sur card | **Pro 8 bullets focus** |
| Elite 12 bullets | **Elite 8 bullets, team-focus** |
| Elite 29 EUR/mois | **Elite 25 EUR/mois** |
| Elite 290 EUR/an | **Elite 250 EUR/an** |
| Pro 79 EUR/an | **Pro 90 EUR/an** (= 2 mois offerts exact) |
| Aucun trial | **Pro = 7 jours gratuits** |
| Aucun LTD | **Lifetime Pro 99 EUR · 50 places** |
| Referral code en DB invisible | **Section Mes parrainages sur /account** |
| Coaching 1h human (Elite) | **Retire** (bottleneck founder) |
| Acces API (Elite) | **Retire** (wrong audience) |
| Pro benchmarks dans Elite | **Move vers Pro** (booste value Pro) |

---

## Actions Stripe (a faire AVANT le launch public)

### A. Nouveaux Stripe Prices a creer

Sur https://dashboard.stripe.com/products (mode LIVE) :

**1. Elite mensuel (NEW PRICE)**
- Product : "FragValue Elite" (peut etre existant)
- Price : `25.00 EUR / mois` recurrent
- Lookup key : `elite_monthly_v2`
- Copy le `price_xxx` -> Vercel env `STRIPE_PRICE_ELITE_MONTHLY` (overwrite l'ancien)

**2. Elite annuel (NEW PRICE)**
- Same product
- Price : `250.00 EUR / an` recurrent
- Lookup key : `elite_yearly_v2`
- Copy le `price_xxx` -> Vercel env `STRIPE_PRICE_ELITE_ANNUEL`

**3. Pro annuel (NEW PRICE si tu changes 79 -> 90)**
- Si tu garde a 79 EUR : skip cette etape
- Si tu passes a 90 EUR : new price `90.00 EUR/an` -> env `STRIPE_PRICE_PRO_ANNUEL`

**4. Lifetime Pro (NEW PRODUCT + PRICE)**
- Product : "FragValue Pro Lifetime"
- Price : `99.00 EUR` ONE-TIME (pas recurrent)
- Lookup key : `pro_lifetime`
- Copy le `price_xxx` -> Vercel env `STRIPE_PRICE_LIFETIME_PRO`

**Important** : NE PAS supprimer les anciens Stripe Prices. Les subs
existantes (s'il y en a) continueront a tourner sur les anciens prices.
Les nouveaux signups utiliseront les nouveaux prices.

### B. Activer le Trial 7 jours sur Pro

Le code envoie maintenant automatiquement `trial_period_days: 7`
**uniquement** sur les checkouts `pro_monthly` et `pro_yearly`.
Verifier dans Stripe Settings :

- Settings -> Subscriptions and emails -> Trial period reminders : ACTIVE
  (Stripe envoie auto un email J-3 avant la fin du trial, en plus du notre)
- Settings -> Email -> Customize : verifier que les emails Stripe sont en FR

### C. Activer les Apple Pay / Google Pay / Link

Si pas encore fait : Stripe Dashboard > Settings > Payments > Payment methods.
Active "Apple Pay", "Google Pay", "Link", "SEPA Direct Debit" (audience EU).
Lift conversion mobile +15-20% typique.

### D. Coupons / promo codes

`allow_promotion_codes: true` est deja active dans `stripe-checkout.js`.
Si tu veux creer un code promo launch :

- Dashboard > Coupons > Create
- Exemple : `LAUNCH50` -> 50% off pour 3 mois sur Pro
- Communique le code via Discord / Twitter au moment du J-Day
- Limite usage : 50 uses, exp 30 jours apres le launch

### E. Trigger webhook events necessaires

Verifier que ces events sont bien listened dans Stripe Webhook URL
`https://fragvalue.com/api/stripe-webhook` :

- ✅ `checkout.session.completed` (deja la)
- ✅ `customer.subscription.updated`
- ✅ `customer.subscription.deleted`
- ✅ `invoice.payment_succeeded`
- ✅ `invoice.payment_failed`
- 🆕 `customer.subscription.trial_will_end` (pour ton email J-3 personnalise,
  Stripe le fire 3 jours avant la fin du trial)

Si tu ne vois pas ce dernier, l'ajouter dans la liste des events du webhook.

---

## Actions cote produit (deja shippees, juste a verifier)

### Migration DB

Une nouvelle table `lifetime_purchases` a ete creee via Supabase MCP.
RLS active, policies definies. Verifie dans Supabase Studio que :

- Table `lifetime_purchases` existe
- 5 colonnes : id, user_id, stripe_session_id, stripe_payment_intent_id,
  amount_cents, currency, status, purchased_at, refunded_at, metadata
- RLS enabled
- Policies : `lifetime_purchases_self_read` + `lifetime_purchases_service_write`

### Schema impact subscription_tier

`profiles.subscription_tier` peut maintenant prendre la valeur `lifetime_pro`
en plus de `free | pro | elite | team`. Code defensif partout : `if (tier === 'pro' || tier === 'lifetime_pro')` -> traiter comme Pro.

A faire dans les endpoints existants qui check tier (si besoin) :

```sql
-- Voir les Pro a vie en prod
SELECT id, faceit_nickname, subscription_tier
FROM profiles
WHERE subscription_tier = 'lifetime_pro';
```

### Flow LTD

1. User va sur `/pricing.html`
2. Voit la banner LTD avec counter live (X / 50 places)
3. Click "Reserver mon acces Pro a vie"
4. Si pas connecte -> redirect `/login.html?redirect=/pricing.html#ltd`
5. Si connecte -> POST `/api/lifetime-deal` cree Stripe Checkout
6. Stripe -> paye 99 EUR
7. Webhook `checkout.session.completed` (mode=payment, plan=lifetime_pro)
   -> updates `lifetime_purchases.status=completed` + `profiles.subscription_tier=lifetime_pro`
   -> envoie email `lifetimeDealPurchased`
8. User redirige sur `/account.html?lifetime=success`

**Limite hard** : 50 places. Apres c'est `410 Gone` + banner cache.

### Flow Referral (MVP)

1. User va sur `/account.html` tab Abonnement
2. Voit sa Referral card : code + filleuls stats + share buttons
3. Partage `https://fragvalue.com/?ref=ABCD1234` sur Twitter/Discord
4. Filleul s'inscrit via ce lien -> profiles.referred_by = referrer.id
5. Filleul subscribe Pro -> referrer voit son count "Filleuls Pro" +1
6. **MVP** : tu applies manuellement le mois gratuit Stripe (coupon ou credit balance)
7. **Phase 2** (post-launch) : automation Stripe coupon dans webhook

### Free limits

`demo.html` checke `FREE_ANALYSES_PER_MONTH = 5` cote frontend.
Pour eviter le bypass, le backend devrait aussi verifier mais ce n'etait pas
le cas avant. **A faire phase 2** : enforcement server-side dans `/api/parse-from-storage`.

---

## Variables d'env Vercel a setter

```bash
# Existantes (verifier valeurs alignees) :
STRIPE_SECRET_KEY=sk_live_...           # mode LIVE
STRIPE_PRICE_PRO_MONTHLY=price_...      # 9 EUR/mois
STRIPE_PRICE_PRO_ANNUEL=price_...       # 79 OU 90 EUR/an selon ton choix
STRIPE_PRICE_ELITE_MONTHLY=price_...    # NEW 25 EUR/mois
STRIPE_PRICE_ELITE_ANNUEL=price_...     # NEW 250 EUR/an
STRIPE_PRICE_TEAM_MONTHLY=price_...     # = elite_monthly (alias legacy)
STRIPE_PRICE_TEAM_ANNUEL=price_...      # = elite_yearly (alias legacy)

# NOUVELLE pour le LTD :
STRIPE_PRICE_LIFETIME_PRO=price_...     # 99 EUR one-time
```

---

## Communication launch

Une fois Stripe LIVE + ces env vars setees :

1. Commit + push tout
2. Vercel deploy auto (~2 min)
3. Test E2E sur fragvalue.com :
   - Signup new user -> verif referral_code genere
   - Trial Pro 7j -> verif Stripe Checkout shows "7 days free"
   - LTD checkout -> verif counter decremente apres payment
4. Annonce launch via Twitter + Discord + email blast (cf. marketing/launch-pack/)
5. Tweet special LTD : "First 50 to get FragValue Pro for life · 99 EUR · never
   again" avec lien direct vers /pricing.html#ltd

---

## Metriques a monitorer post-launch

| Metric | Source | Target Week 1 |
|---|---|---|
| LTD sales | `lifetime_purchases.status=completed` count | 10-30 / 50 |
| Trial signups | `subscriptions.status=trialing` count | 50-100 |
| Trial -> Pro conversion | `subscriptions.status=active` apres trial / total trial | >60% |
| Free -> Pro conversion | new pro_monthly signups / new free signups | >5% |
| Referral signups | `profiles.referred_by IS NOT NULL` new | 10-20 |
| Coach IA usage Pro | coach_messages avg/day/user | 5-15 / 20 max |

Si trial conversion <50% a J+14 -> probleme onboarding ou friction debit.
Si LTD <5 sales J+7 -> communication insuffisante, repush.

---

## Things que je n'ai PAS automatise (a faire manuellement post-MVP)

1. **Referral coupon Stripe automatique** : quand filleul subscribe Pro,
   creer auto coupon `1_month_free_referral_XXX` + l'appliquer au referrer.
   Code stub a ajouter dans `api/stripe-webhook.js` case `checkout.session.completed`
   pour subscriptions (post-launch ETA 2-3h dev).

2. **Backend enforcement Free quota** : actuellement quota check est cote
   client uniquement (`demo.html`). Un user motive peut bypass en faisant des
   appels API direct. A ajouter dans `parse-from-storage.js` :
   ```js
   if (plan === 'free') {
     const { count } = await sb.from('demos').select('*', {count:'exact', head:true})
       .eq('user_id', user.id)
       .gte('analysed_at', monthStart);
     if (count >= 5) return res.status(403).json({ error: 'Quota atteint' });
   }
   ```

3. **LTD sold-out page** : actuellement la banner se cache silencieusement
   si 50/50. Idealement afficher un message "Lifetime Deal complet · Liste
   d'attente pour la prochaine fournee" avec form email capture.

4. **Email post-trial-cancel** : si user annule le trial avant la fin du 7j,
   envoyer un email "Tu nous quittes deja ? Voici les 3 features que tu rates"
   pour tenter de save 5-10% de churn pre-conversion.

---

## Rollback plan

Si le nouveau pricing tank les conversions a J+7 :

1. Revert le commit `feat(pricing-overhaul): ...` sur GitHub
2. Revert via Vercel dashboard (rollback last deploy)
3. Restaurer les anciens Stripe Prices env vars
4. Disable la LTD banner via env var `LTD_DISABLED=1` (a coder dans
   `api/lifetime-deal.js` si besoin)

Tout est git-tracked, recoverable < 5min.
