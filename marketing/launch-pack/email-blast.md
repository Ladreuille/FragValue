# Email Blast Launch (J-Day)

3 emails à préparer : waitlist FragValue (chaud), beta testers (gold), cold list CS2 si tu en as une.

⚠️ **GDPR check** : tous les destinataires doivent avoir opt-in. Marketing_opt_out = true dans profiles → exclure. Sinon amende possible.

⚠️ **Avant d'envoyer en masse** : test sur 5 emails (gmail, outlook, proton, free.fr, yahoo) pour vérifier le rendu HTML + le spam folder.

---

## A. Email "Waitlist FragValue" (audience la plus chaude)

**Cible** : users dans `feature_interests` (`pro-launch`, `faceit-sync`) qui se sont inscrits à la waitlist.
**Subject A** : `C'est le grand jour : FragValue est live`
**Subject B (recommandé)** : `Ton FV Rating CS2 t'attend (FragValue est public)`
**Pre-header** : `Auto-sync FACEIT activé. Code beta INSIDE pour les premiers 50.`

```
Hello {nickname},

Tu t'es inscrit à la waitlist FragValue il y a [X jours / semaines].

J'avais promis de prévenir le jour du launch. On y est : FragValue
est en public depuis ce matin.

→ https://fragvalue.com

**Ce qui a changé depuis ta waitlist :**
- ✅ FACEIT auto-sync (match terminé → analyse 5 min après, zero clic)
- ✅ Coach IA propulsé par Claude 4.7 (Anthropic) avec contexte par round
- ✅ 11 axes de progression structurés
- ✅ PWA installable mobile (Android + iOS)

**Cadeau de bienvenue waitlist :**
Code `WAITLIST2026` valable jusqu'au 30 juin : ton 1er mois Pro
offert (Diagnostic IA illimité + 2D Replay + auto-sync FACEIT).

Pas de CB requise. Annulation 1 clic. Si tu kiffes pas, tu remarques
même pas que c'est fini.

→ Récupère ton mois gratuit : https://fragvalue.com/redeem?code=WAITLIST2026

Tu peux aussi commencer en Free (3 analyses/mois) si tu veux tester
d'abord. Aucune pression.

Un truc qui pète ? Répondre directement à ce mail, c'est moi qui lis.

Bonne game,
Quentin
Solo founder FragValue

PS : si t'as un pote CS2 qui galère sur ses analyses, ce code est
1-use mais le partage sur Twitter en RT est apprécié 🙏
→ https://twitter.com/FragValue/status/[LINK_TO_LAUNCH_THREAD]
```

---

## B. Email "Beta Testers" (audience or)

**Cible** : users `created_at < 2026-05-01` qui ont au moins 1 demo parsée (= ils ont vraiment utilisé).
**Subject** : `Le jour J est là — merci d'avoir testé`
**Pre-header** : `Récap des 3 mois ensemble + ce que vous obtenez en prime`

```
Hello {nickname},

Tu fais partie des [X] beta testers qui ont essayé FragValue depuis
avril. Sans vous, j'aurais ship un produit cassé. Merci sincèrement.

**Aujourd'hui FragValue passe en public.** C'est grâce à vos retours.

**Ce que vous obtenez en remerciement :**

🎁 **Pro gratuit jusqu'au 30 juin 2026** (auto-prolongé sur votre
compte, rien à faire).
🎁 **Code parrainage `BETAFV-{NICKNAME_UPPER}`** : donne 1 mois Pro
gratuit à un pote, tu gagnes 1 mois Pro de plus si il subscribe.
🎁 **Channel Discord #beta-vips** ouvert (accès permanent même
après le launch).

**Ce que j'aimerais de votre part (totalement optionnel) :**

🙏 Un RT du thread Twitter launch (si vous trouvez ça utile) :
   https://twitter.com/FragValue/status/[LINK_TO_LAUNCH_THREAD]

🙏 Un avis Reddit ou Discord si vous voyez le post FragValue
   passer dans vos communautés.

🙏 Un screenshot de votre meilleur diagnostic dans #showcase Discord.

Si vous voyez un bug, screenshot dans #beta-feedback. Réponse <24h
garantie pendant le launch.

Merci encore. Vraiment.

Quentin
```

---

## C. Email "Cold list CS2" (audience tiède)

⚠️ **Ne pas envoyer sans opt-in explicite**. Vérifie `marketing_opt_out = false`
sur tous les destinataires. Si liste achetée → ne PAS envoyer.

**Cible** : profiles `created_at < 2026-05-01` AVEC `marketing_opt_out = false` AVEC `last_seen_at > 30j` (inactifs).
**Subject A** : `Un outil CS2 que tu rates peut-être`
**Subject B (recommandé)** : `Pourquoi t'as perdu R14 hier (sans être ton coach)`
**Pre-header** : `Coach IA + auto-sync FACEIT, 3 analyses gratuites/mois`

```
Hello {nickname},

Je sais pas si t'as gardé FragValue en tête depuis ton signup, mais
en 3 mois on est passé du teaser "soon" à un produit qui marche
vraiment.

3 trucs qui sont nouveaux depuis que tu nous as vus :

**1. Auto-sync FACEIT** (l'API officielle, validée mai 2026)
Tu joues un match → 5-10 min après, ton analyse est dans ta boîte.
Zero upload, zero clic.

**2. Coach IA contextuel par round**
Au lieu de te dire "ADR 75, KAST 68%", il te dit :
"[R14] tu peek long sans util alors que l'adversaire avait 2 flashs.
Action : 1 setup pop-flash long Mirage à l'entraînement."

**3. 11 axes de progression**
Au lieu d'un score unique, tu sais exactement quel axe travailler
(aim, crosshair, spray, utility, positioning, etc.).

→ https://fragvalue.com

Free 3 analyses/mois suffit pour tester. Pro 9€/mois si tu kiffes.
Annulation 1 clic. 14j satisfait ou remboursé.

Pas de réponse ? Cool, je te re-mailerai plus avant le prochain
launch features (probablement Septembre).

Pour te désabonner : [LIEN_UNSUB] (1 clic, no question)

Bonne game,
Quentin
```

---

## D. Configuration technique

### Resend / SendGrid setup

- **From** : `Quentin <hello@fragvalue.com>` (perso > marketing)
- **Reply-to** : `quentin@fragvalue.com` (lit vraiment les réponses)
- **List-Unsubscribe** : header HTTP obligatoire (RGPD + Gmail/Apple)
- **DKIM/SPF/DMARC** : vérifier sur https://www.mail-tester.com (score >9/10 obligatoire)

### Throttling

- Batch 50 emails/min max (sinon Gmail flag spam)
- Total launch blast : <500 emails sur 24h pour éviter blacklist IP
- Si liste >2000 → étaler sur 48h

### Tracking

- UTM params : `?utm_source=email&utm_medium=launch&utm_campaign=public_launch_2026_05`
- Track via GA4 `email_open` (pixel tracking) + `email_click` (link redirects)

---

## E. Si tu n'as pas de liste email

**Le plus important** : commence à construire une newsletter MAINTENANT.

Ajoute un widget "Newsletter" sur la landing (footer ou pop-up exit-intent).
Promesse : "1 email/mois : nouvelles features + insights pros CS2".
Outils : Resend (déjà setup dans tes apis), MailerLite (free <1000 contacts).

Mieux vaut commencer 50 abonnés que rien. Dans 6 mois ce sera 500.
