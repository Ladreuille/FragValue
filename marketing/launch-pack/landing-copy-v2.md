# Landing Copy v2 · Proposals

Audit + propositions de reformulation des sections clés de la landing
`/index.html`. Objectif : passer du "ce qu'on fait" au "ce que tu gagnes".

À chaque section : version actuelle + 2-3 variantes A/B testables.

---

## Hero (above-the-fold)

### Variante A — Douleur focus (recommandée)

```
Headline : Pourquoi t'as perdu R14 ?
Subline  : Tes stats CS2 te disent ton ADR. FragValue te dit le pourquoi
           tactique, citation de tick à l'appui.

CTA primaire : Analyser ma 1ère demo gratuitement
CTA secondaire : Voir un exemple de diagnostic →
```

### Variante B — Auto-sync focus

```
Headline : Joue. FragValue analyse. Tu progresses.
Subline  : Auto-sync FACEIT activé. Match terminé → 5 min après ton
           diagnostic IA est dans ta boîte. Aucun upload, aucun clic.

CTA primaire : Activer l'auto-sync (Pro 9€/mois)
CTA secondaire : Tester gratuit (3 analyses/mois) →
```

### Variante C — Tech/credibility focus

```
Headline : Coach IA pour CS2 · powered by Claude 4.7
Subline  : Premier outil avec accès officiel FACEIT Downloads API
           (validé partenariat mai 2026). Analyse round-by-round
           sur 11 axes de progression structurés.

CTA primaire : Commencer gratuit
CTA secondaire : Comparer aux concurrents →
```

### Recommandation

→ **Variante A**. La douleur "perdu R14" est universelle, frappe directement
chez les joueurs qui ont déjà vécu la frustration des stats sans contexte.

Tester A vs B en A/B 50/50 sur 2 semaines, garder le winner sur conversion
to signup.

---

## Section "Comment ça marche" (sous hero)

### Version actuelle (probable)
```
3 étapes pour analyser ton jeu :
1. Upload ta demo .dem
2. On analyse en 2 minutes
3. Tu reçois ton diagnostic IA
```

### Version v2 (recommandée)

```
Comment FragValue te coache (3 étapes, 5 minutes max) :

[ICON FACEIT] 1. Lie ton compte FACEIT (1 clic, OAuth)

[ICON SYNC] 2. Joue tes matchs normalement (FragValue récupère
              tes demos automatiquement)

[ICON BRAIN] 3. Reçois ton diagnostic Coach IA par notif (auto-sync
              Pro/Elite) ou via "Mes matchs" (Free)

→ Démonstration vidéo 60s
```

Why : action concrète à chaque step, mention auto-sync = features
critiques, démontre que le user "fait rien" (vrai différenciateur).

---

## Section "Ce que tu débloques"

### V2

```
Ce que le Coach IA voit que toi tu vois pas :

🎯 Le moment précis où le round bascule
   "[R14 tick 47000] tu peek long sans util alors que l'adversaire
    avait 2 flashs. Travaille ton pop-flash long Mirage."

🧠 Tes 3 priorités personnalisées sur 11 axes
   Aim, crosshair, spray, utility, positioning, gamesense, economy,
   mental, movement, comms, reaction. Ranking selon tes 20 derniers matchs.

📈 Ta progression dans le temps
   Compare tes diagnostics semaine après semaine. Mesure objective
   de tes axes de progression (axe 9 : "Suivi progression").

⚡ Les patterns pros adaptés à ton niveau
   On stocke 200+ situations de pros (ZywOo, donk, ropz...) et on
   suggère celles qui matchent ta situation tactique. Pas de copier-coller :
   adaptation à ton elo.
```

Tons : punchy, factuel, avec exemples concrets. Pas de mots vides.

---

## Section "Pricing"

Reformuler les headers de cards pour qu'ils répondent à "pour qui ?" :

| Card | Header avant | Header v2 (suggéré) |
|---|---|---|
| Free | "Découvrir" | "Pour tester sans rien commit" |
| Pro | "Progresser" | "Pour les joueurs sérieux (FACEIT Lvl 6+)" |
| Elite | "Dominer" | "Pour les équipes amateurs / coachs" |

→ Plus concret = mieux ciblé. "Découvrir" ne dit pas pour qui c'est.

---

## Section "Témoignages" (à créer)

Si pas encore là, créer 3 témoignages courts (citations + photo/handle) :

```
"FragValue a tué mon abonnement Leetify. Le Coach IA me dit ce que je
dois travailler, pas juste des chiffres."
— @nickname, FACEIT Lvl 9, ESEA Intermediate

"J'ai gagné 200 ELO en 6 semaines en suivant le plan d'action Coach IA
sur mes 3 axes prioritaires."
— @nickname, FACEIT Lvl 7, 100% solo queue

"En tant que coach amateur, je gagne 2h/semaine sur l'analyse en
laissant FragValue faire le diagnostic micro. Je me concentre sur
le macro."
— @nickname, coach équipe ESEA Open
```

**Important** : ne PAS fabriquer. Si t'as pas de témoignages réels,
remplace cette section par "Récents diagnostics communauté" avec des
screenshots anonymisés de vrais diagnostics.

---

## Section "FAQ" (déjà sur la page)

3 questions à AJOUTER :

```
Q : C'est compatible avec Leetify / csstats ?
A : Oui, totalement. Beaucoup de nos users utilisent les deux.
    Leetify = stats brutes excellentes. FragValue = contexte
    tactique + coaching IA. Complémentaire pas concurrent.

Q : Vous accédez à mes demos privées comment ?
A : Via la FACEIT Downloads API officielle (accord partenariat
    validé mai 2026). Tu peux révoquer l'accès en 1 clic via
    /account. Tes demos restent privées, RLS Supabase, jamais
    partagées.

Q : Free et Pro c'est combien d'analyses concrètement ?
A : Free = 3 analyses/mois + 1 diagnostic IA + accès top 20 HLTV.
    Pro = analyses illimitées + Chat Coach IA 5 msg/jour + auto-sync
    FACEIT + 2D Replay. Elite = +30 msg/jour Coach IA + outils équipe
    (anti-strat, prep-veto, pro benchmarks).
```

---

## Footer

Ajouter une ligne de credibilité :

```
Built solo by Quentin Dreuillet · Hosted in EU (Supabase eu-west-1)
· Stripe Verified · 14-day money-back guarantee
```

Et un lien direct vers `/status.html` :

```
Status [● operational] · Press kit · CGV · Privacy
```

---

## Tracking après changes

Si tu déploies V2 :
- A/B 50/50 hero via simple JS toggle (cookie sticky 30j)
- Monitor `signup_completed` event GA4 par variante
- Période test : 2 semaines minimum (saisonnalité weekly)
- Seuil de significance : >100 conversions par variante minimum

Outil A/B testing simple sans dependency : function `getVariant()` qui
hash le localStorage userId + assigne A ou B. Si tu veux du sérieux,
passe sur PostHog ou GrowthBook.
