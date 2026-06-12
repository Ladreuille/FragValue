# Business plan B2B : FragValue pour structures esport

**Date** : 13 juin 2026
**Postulat** : FragValue n'est plus un produit B2C. Le client est la structure
(org pro, académie, école), pas le joueur. Le produit joueur existant devient
une surface d'usage incluse dans l'abonnement structure, plus un produit vendu.

## 1. Ce qu'est vraiment une structure type Vitality (réalité client)

- Division CS2 : 5 joueurs + head coach + assistant + 1-2 analystes + staff
  performance (psy, préparateur physique), academy, cellule détection.
- Multi-jeux : CS2 n'est qu'une division parmi 4-6 titres.
- Budget division CS2 en millions (salaires joueurs 20-50k/mois chacun).
  Un outil à 1-2k EUR/mois est invisible dans le budget SI il fait gagner
  du temps au staff.
- Stack actuel : Skybox (analyse, pénétration revendiquée 85% du pro),
  data officielle via les ligues (GRID), pipelines internes maintenus par
  les analystes, Notion/Sheets, Discord.
- Contraintes d'achat : confidentialité des strats (un leak = catastrophe
  compétitive), DPA/sécurité, support réactif, cycles de décision longs,
  préférence pour la data brute (API) plutôt que les UI imposées.

## 2. Listing produits (la gamme complète envisageable)

| # | Produit | Pitch | Client visé |
|---|---------|-------|-------------|
| P1 | **Structure Hub** (multi-rosters) | Main + academy + détection sous un compte, staff illimité, vue consolidée | Toutes structures |
| P2 | **Pracc Planner + Discord** | Planning hebdo cross-rosters, ready check par DM Discord, conflits détectés | Toutes structures (LIVE depuis le 12/06) |
| P3 | **Rapports automatiques** | Débrief joueur auto, hebdo coach, mensuel direction, one-pager sponsor | Coach + direction |
| P4 | **Anti-Strat / Playbook auto** | Patterns adverses détectés sur N démos + counters suggérés | Analyste + head coach |
| P5 | **VOD Coordinator** | Annotations timecodées assignées par joueur, async Discord | Coach |
| P6 | **Pipeline détection / academy** | Suivi FV Rating des trials et élèves dans la durée, comparaison candidats | Academy manager, écoles |
| P7 | **API / export data** | La data FragValue (ratings, events, heatmaps) dans leurs pipelines internes | Analystes tier 1 |
| P8 | **Coach IA scoped structure** | Chat IA sur les démos privées de la structure, timecodes cliquables | Coach + analyste |
| P9 | **Suivi de charge / wellness** | RPE, charge d'entraînement vs calendrier | Staff performance |

## 3. Avis critique produit par produit

### À tuer (ne pas construire)

- **P9 Wellness/charge** : le staff perf des tier 1 utilise déjà des outils
  du sport traditionnel matures. Hors de notre légitimité, hors CS2, marché
  pris. MORT.
- **P5 VOD Coordinator en priorité haute** : utile mais c'est un produit de
  confort, pas un produit d'achat. Personne ne signe POUR ça. Rétrogradé en
  module v2 du bundle, pas un argument de vente.

### À modifier (le cœur du correctif)

- **P1 "OS de la structure"** : un outil CS2-only ne sera JAMAIS l'OS d'une
  structure multi-jeux. Repositionner : "l'OS de ta division CS2". La couche
  logistique (P2) est techniquement agnostique au jeu : la dériver
  multi-jeux plus tard est l'option d'expansion, pas la promesse jour 1.
- **P4 Anti-Strat** : c'est LE produit que le marché valorise (réservé au
  tier à 1 299 EUR/mois chez Skybox, mission n°1 de l'analyste Fnatic).
  MAIS deux réalités : (a) frontal contre l'incumbent installé partout,
  (b) l'accès aux démos adverses tier 1 passe par la data officielle
  verrouillée (GRID) — au niveau ESEA/FACEIT ça marche, au niveau BLAST/ESL
  non. Donc : produit d'appel pour tier 2/3 et académies, PAS pour le main
  roster d'un tier 1.
- **P3 Rapports** : le "rapport direction" est un pain de tier 1 ; le
  "rapport élève/parent" est un pain d'école ; le "one-pager sponsor" est
  un pain de tier 2/3 qui vit du sponsoring. Même moteur, trois habillages.
  Construire le moteur une fois, vendre l'habillage par segment.
- **P7 API** : c'est paradoxalement LE produit crédible pour un vrai tier 1
  (ils veulent la data, pas l'UI). Mais en solo founder, un contrat API
  tier 1 = exigences sécurité/SLA intenables. Version réaliste : exports
  CSV/Sheets + webhook, pas une "API entreprise".

### À garder tel quel

- **P2 Planner + Discord** : livré, différenciant, aucun concurrent vivant
  ne le fait (Esports Planner mort, Refrag ne fait pas de planning, PRACC
  fait le matchmaking pas la logistique interne). C'est la porte d'entrée.
- **P6 Pipeline détection/academy** : sous-coté. C'est le produit cœur des
  écoles esport et des académies de structures : évaluer des joueurs dans
  la durée est leur métier quotidien, et personne ne l'outille. Le pont
  naturel avec l'infra existante (le candidat upload ses démos gratuitement,
  la structure le juge dessus).
- **P8 Coach IA scoped** : différenciateur réel (Claude + timecodes), coût
  marginal faible, mais en garde du corps des autres produits, pas en tête
  d'affiche. Attention contractuelle : les structures exigeront que leurs
  démos ne servent à rien d'autre (clause de confidentialité, pas
  d'entraînement de modèles).

### La vérité qui fâche sur "vendre à Vitality"

Un solo founder ne signe pas un contrat SaaS payant avec un tier 1 :
cycles 6-12 mois, exigences sécurité (pentest, DPA, isolation des données
de strats), POC gratuits exigés, et ils ont des devs internes pour
assembler leur stack. Et le risque confidentialité est structurel : une
plateforme mutualisée qui fait de l'anti-strat héberge potentiellement les
démos de deux adversaires du même match.

**Le rôle réaliste d'un Vitality dans ce business plan n'est pas client,
c'est vitrine.** Un partenariat avec l'ACADEMY d'une structure tier 1
(gratuit ou symbolique, co-construction, logo + case study) crédibilise
toute la pyramide en dessous. C'est l'academy qui a notre profil client
(démos FACEIT/ESEA accessibles, besoin multi-groupes, pas d'exigences
GRID), pas le main roster.

## 4. L'offre commerciale (3 SKUs)

| Offre | Cible | Contenu | Prix |
|-------|-------|---------|------|
| **Coach** | 1 roster (semi-pro, hub) | Planner + Discord, anti-strat ESEA/FACEIT, analyse joueurs, rapports joueur/coach | 99 EUR/mois (annuel : 990) |
| **Structure** | Académies, écoles, orgs tier 2/3 multi-équipes | Tout Coach x rosters illimités + pipeline trials/élèves + rapports direction/parents/sponsor + exports | 299 EUR/mois (annuel : 2 990) |
| **Partenaire** | 1-2 structures tier 1 (academy) | Tout Structure + co-construction roadmap + support direct fondateur | Gratuit an 1 contre logo, case study, 2 interviews staff/mois |

Le plan Elite B2C actuel (25 EUR) migre vers "Coach" ; Free/Pro joueur
restent comme funnel et surface d'usage des joueurs des structures clientes.

## 5. Projections (ordres de grandeur honnêtes)

- Marché adressable réaliste an 1 : France + EU francophone d'abord.
  ~12-15 écoles esport FR, ~30-50 académies/orgs tier 2/3 atteignables,
  des centaines de rosters ESEA Open/Inter/Main pour l'offre Coach.
- An 1 (objectif sobre) : 2 écoles + 5 structures + 30 Coach
  = (2+5) x 299 + 30 x 99 = ~5 060 EUR MRR (~60k ARR). Vivable solo.
- An 2 : 5 écoles + 15 structures + 100 Coach + 1 partenaire converti
  payant = ~16k MRR (~190k ARR).
- Coût de revient marginal faible (infra Supabase/Vercel/Railway existante,
  coût IA Claude par structure plafonné par quotas).

## 6. Go-to-market

1. **Vitrine** : 1 academy tier 1 FR en partenariat gratuit (réseau FR,
   angle "outil construit avec X Academy").
2. **Écoles esport FR** : vente directe fondateur, démo planner live +
   rapport de progression élève. Cycle court, budget edtech.
3. **ESEA/FACEIT leagues** : l'offre Coach en self-serve, acquisition par
   le produit joueur gratuit + contenu (blog, TikTok déjà en place).
4. Facturation entreprise dès le jour 1 : devis, virement, annuel
   prépayé (les orgs meurent en cours de saison, encaisser d'abord).

## 7. Risques majeurs

| Risque | Réalité | Mitigation |
|--------|---------|------------|
| Confidentialité des strats | Blocker n°1 pour toute structure sérieuse | Isolation par structure, clause contractuelle zéro réutilisation, pas d'entraînement IA sur leurs données |
| Skybox étend vers la logistique | Possible, ils ont l'oreille du pro | Vitesse + segment qu'ils ignorent (écoles, tier 3, francophonie) |
| Accès démos (FACEIT Downloads bloquée, GRID fermé) | Limite l'anti-strat au niveau ESEA/FACEIT | Assumer le positionnement tier 2/3 ; relancer FACEIT ; GRID hors scope an 1 |
| Solo founder vs promesse B2B | Support, sécurité, pérennité questionnés | Peu de clients bien servis, annuel prépayé, transparence |
| RGPD mineurs (écoles) | Élèves souvent mineurs | DPA type, consentement parental, données minimales — à cadrer avant la 1re école |

## 8. Les 90 prochains jours

1. Semaine 1-2 : mock du rapport de progression (élève + direction) +
   page /structures.html avec les 3 offres. Liste de 15 cibles (écoles +
   académies FR) avec interlocuteur.
2. Semaine 3-6 : 10 démos en visio (planner live + mock rapport).
   Test prix : 299. Objectif : 2 signatures pilotes + 1 partenariat academy.
3. Semaine 7-12 : build guidé par les pilotes (multi-rosters, rapports,
   import calendrier ESEA, rappels H-2). Pas de build avant la demande.
