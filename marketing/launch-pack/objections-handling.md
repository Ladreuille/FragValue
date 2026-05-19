# Objections classiques · Réponses préparées

Quand tu communiqueras publiquement, ces 10 objections vont revenir.
Mémorise les réponses, surtout les 3 premières (90% du volume).

---

## 1. "C'est juste un wrapper ChatGPT, comme tous les autres"

**Réponse courte** :
> Non, on est différent sur 3 points :
> (1) Coach IA contextuel par round avec ticks précis (pas du prompt générique)
> (2) Auto-sync FACEIT API officielle (gated, pas accessible aux wrappers)
> (3) 11 axes structurés stockés en historique pour mesurer ta progression
>
> Mais oui, on utilise Claude (Anthropic, pas OpenAI). On l'assume — c'est
> le meilleur modèle pour le coaching contextuel aujourd'hui. Le moat c'est
> le pipeline data (FACEIT + parser custom + RAG sur 200+ situations pros),
> pas le LLM.

**Réponse longue (si débat technique)** : montre un exemple de diagnostic
réel avec les citations de tick. C'est imparable visuellement.

---

## 2. "Leetify fait déjà ça, gratuit"

**Réponse** :
> Leetify est super bon sur les stats brutes (HLTV-like rating, heatmaps,
> KAST/ADR). Mais Leetify ne te dit pas POURQUOI un round est perdu en
> termes tactiques. FragValue cite le tick exact + l'action concrète.
>
> Concrètement, exemple côté Leetify : "Round 14 ADR 87, KAST 60%"
> Concrètement, exemple côté FragValue : "[R14] tu peek long sans util
> alors que l'adversaire avait 2 flashs. Action : 1 setup pop-flash long
> Mirage à l'entraînement."
>
> On est compatible, pas concurrent. Beaucoup de nos users utilisent les
> deux.

**Tip** : Ne JAMAIS trash Leetify. Ils ont une excellente reputation, tu
te tires une balle si tu les attaques.

---

## 3. "9€/mois pour un AI chatbot, c'est cher"

**Réponse** :
> 0,30€/jour. Moins qu'un café. Et tu peux annuler en 1 clic, 14j satisfait
> ou remboursé.
>
> Comparé à un coach humain CS2 (30-80€/h, dispo limitée), c'est 0,4% à 1%
> du coût. Si une seule action te fait progresser de 100 ELO, FragValue
> s'est payé pour 10 ans.
>
> Si tu veux tester avant : Free fait 3 analyses/mois, c'est suffisant pour
> voir si tu aimes.

**Réponse alternative** (si la personne est dans une logique éco) :
> Free fait 3 analyses/mois + 1 diagnostic IA. Tu peux progresser avec ça
> aussi. Pro c'est si tu joues 5+ matchs/semaine et tu veux le coaching
> illimité.

---

## 4. "Et la confidentialité de mes demos ?"

**Réponse** :
> Tes demos sont privées par défaut, RLS Supabase. Personne d'autre que toi
> (et l'IA pour générer le diagnostic) ne les voit. Tu peux supprimer ton
> compte + toutes tes données en 1 clic via /account.
>
> RGPD-compliant, hosting EU (Supabase eu-west-1, Vercel CDG). DPA dispo
> sur demande. Pas de partage à des tiers, pas de revente de data.
>
> Plus de détails : fragvalue.com/privacy

---

## 5. "Comment je sais que l'IA dit pas n'importe quoi ?"

**Réponse** :
> Bonne question. 3 choses :
>
> (1) Le Coach IA cite des ticks PRÉCIS, tu peux les vérifier dans le 2D
> Replay. Si l'analyse dit "tu meurs à tick 47000 par AK headshot smoke",
> tu peux ouvrir le replay au bon tick et le vérifier.
>
> (2) On stocke les sources : le diagnostic référence les rounds, les
> stats, les benchmarks pros. Tout est traçable.
>
> (3) C'est imparfait. Comme tout outil. Si tu vois une analyse foireuse,
> screenshot + envoie-moi (réponses ouvertes), on calibre le prompt.
>
> Le but c'est pas que l'IA remplace ton jugement, c'est qu'elle te
> propose une lecture du round que t'aurais pas faite seul.

---

## 6. "Pourquoi pas open source ?"

**Réponse** :
> Le parser CS2 (.dem reading) qu'on utilise EST open source :
> @laihoe/demoparser2 sur GitHub. Notre stack appelle Anthropic Claude
> qui est closed-source (mais accessible via API à n'importe qui).
>
> Le code de FragValue.com pourrait être open un jour, mais tant que c'est
> un produit en croissance avec des décisions stratégiques rapides, on
> reste closed. Si la communauté CS2 manque, on pourrait ouvrir le
> diagnostic engine.

---

## 7. "Et si FACEIT vous coupe l'API ?"

**Réponse** :
> Risque réel, on l'a en tête. Mais :
> (1) On a un accord partenariat officiel (mai 2026) avec terms clairs
> (2) On peut fallback sur upload manuel .dem (déjà supporté)
> (3) Si FACEIT change de policy on s'adapte, on a déjà été en mode no-API
> pendant 2 mois (avril 2026) et le produit marchait avec upload manuel.
>
> L'auto-sync est un nice-to-have qui devient nice-to-have-very-much.

---

## 8. "Solo founder = pas pérenne"

**Réponse** :
> Vrai et faux.
>
> Vrai : si je me fais renverser par un bus, FragValue meurt. Risque réel
> pour un user qui paie 9€/mois.
>
> Faux : (1) Tous les paiements sont gérés par Stripe (refund/cancel
> automatique si je disparais), (2) Le code est documenté et hébergé chez
> Vercel/Supabase (récupérable), (3) Beaucoup de produits CS2 réussis
> sont solo (csstats au début, gitgud.gg, etc.).
>
> Je communique l'avancement régulièrement (Discord/Twitter). Si je deviens
> moins actif, on saura.

---

## 9. "C'est utile pour quel niveau ?"

**Réponse** :
> Sweet spot : FACEIT Lvl 6-10 (ELO ~1500-3500). À ce niveau, t'as les
> mécaniques de base, le bottleneck devient la décision tactique. Le
> Coach IA aide précisément là.
>
> Lvl 1-5 : utile mais surdimensionné. Travaille d'abord ton aim sur
> aim_botz / training maps avant de payer pour de l'analyse.
>
> Pros / FPL : intéressant pour le suivi systématique sur 11 axes, mais
> ils ont déjà des coachs humains pour ça.

---

## 10. "T'es pas Anthropic / FACEIT / un sponsor pro, c'est crédible ?"

**Réponse** :
> Je suis un dev solo qui a appris CS depuis 2014, fait FACEIT Lvl 10,
> et construit FragValue en 3 mois parce que les outils existants me
> frustraient.
>
> Pas de sponsors, pas d'investisseurs (encore), pas d'équipe. C'est un
> produit indé.
>
> La crédibilité elle vient pas de qui te paie, elle vient du produit.
> Test 30 jours gratuit, juge sur pièces.

---

## Bonus : objections agressives / trolls

Sur Twitter/Reddit, tu vas avoir des trolls. Règle d'or :

- ❌ Ne réponds JAMAIS à un troll
- ❌ Ne te défends pas, ne te justifie pas, ne argumente pas
- ✅ Ignore. Mute / block au 2e msg. Continue tes réponses constructives
   en parallèle. Les autres users voient que tu es pro.

Si une critique légitime mais agressive ("c'est de la merde parce que X") :
> "Critique recue. Sur X, t'as raison/tort parce que [contexte]. Si tu veux
> tester sérieusement, DM ouvert. Sinon, peace."

Court, factuel, pas défensif.
