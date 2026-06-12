# Benchmark B2B pro tier : besoins des structures CS2 et positionnement FragValue

**Date** : 12 juin 2026
**Méthode** : deep research multi-agents (21 sources, 98 claims extraits) + vérification
manuelle de première main des pricing pages le 12/06/2026. Les claims marqués [vérifié]
ont été contrôlés directement sur la source ce jour. Les claims [indicatif] viennent du
run de recherche mais n'ont pas pu être re-vérifiés (vérificateurs tombés sur la limite
de crédits).

## 1. Pain points des structures pro (par intensité)

| # | Pain point | Preuve | Statut |
|---|-----------|--------|--------|
| 1 | **Temps de préparation anti-strat** : c'est la mission n°1 de l'analyste, en binôme direct avec le Head Coach | Offre d'emploi Performance Analyst CS2 Fnatic : "Collaborate with the Head Coach [...] emphasising counter-strategies and opponent analysis" | [vérifié 3-0] |
| 2 | **Maintenance manuelle des bases internes** : même en tier 1, l'analyste met à jour des bases de données stats et des logs d'entraînement à la main après chaque session | Même offre Fnatic : "Update and maintain statistical databases [...] Update training databases and logs after each session" | [vérifié 2-1] |
| 3 | **Reporting chronophage** : rapports post-match (codage vidéo) + rapports de performance pour la prise de décision = une part majeure du poste | Même offre Fnatic : "Code and edit match footage post-game to produce comprehensive post-match reports [...] Create detailed reports" | [vérifié 3-0] |
| 4 | **Logistique multi-rosters** (main + academy + trials) : aucun outil du marché ne la couvre (cf. cartographie) | Absence constatée sur les pricing pages Refrag/Noesis/Skybox | [vérifié] |

Lecture : le marché pro ne manque pas de DATA, il manque de TEMPS. Les 3 pain points
payés au prix fort sont des pain points de workflow (prep, saisie, reporting), pas
d'analytics brute.

## 2. Cartographie concurrentielle (pricing vérifiés le 12/06/2026)

| Outil | Offre équipe/org | Prix | Couvre | Ne couvre PAS |
|-------|------------------|------|--------|---------------|
| **Skybox EDGE** | Tier 2 | 350 EUR/mois (3 570/an) | 2D replayer avancé, stats équipe, voice integration | Anti-strat auto, rapports |
| **Skybox EDGE** | Tier 1 | **1 299 EUR/mois** (11 400/an) | + Tactic-spotter AI (Playbook), filtres tactiques, rapports de match | Logistique, multi-rosters, reporting direction |
| **Noesis** | Team | 29,99 EUR/mois (6 users, 100 démos) soit ~5 EUR/siège | Analyse démos 2D, notes. Témoignages : analyste G2, coach Endpoint, coach Renegades | Logistique, reporting |
| **Noesis** | Pro (org) | à partir de 249,99 EUR/mois, sur mesure, 1000+ démos | Analyse à l'échelle org + support premium | Logistique, reporting direction |
| **Refrag** | Team | 79 USD/mois (60 en annuel), 7 slots + 7 serveurs | Practice servers, scrim tools, 2D viewer | AUCUNE feature logistique/planning/reporting au team tier |
| **PRACC** | Plateforme scrims | non publié (freemium) | Scrim matchmaking multi-jeux. Utilisé par NaVi, Fnatic, FaZe, Astralis, Cloud9, Liquid, Heroic | Planning interne, ready check, analyse, reporting |
| **SCL** | Team ~19,90 EUR/mois | [indicatif] | Serveurs, scrim finder (gratuit), fusion de démos 2D | Planning interne, reporting |
| **Shadow.gg** | MORT | site down (vérifié 12/06) | Analytics pro tier 1 (clients revendiqués : NaVi, MIBR, Astralis) | n/a |
| **Esports Planner** | MORT | domaine NXDOMAIN (vérifié 12/06) | Calendrier d'équipe esport standalone (~20 USD/mois/équipe) | n/a |

**Trois enseignements structurants :**
1. **L'anti-strat automatisé est LA feature premium du marché** : c'est elle qui justifie
   le passage de 350 à 1 299 EUR/mois chez Skybox.
2. **Le cimetière est instructif** : l'analytics pure tier-1-only (Shadow) et la
   logistique standalone (Esports Planner) sont mortes toutes les deux. Le scrim
   matchmaking est pris et largement gratuit (PRACC, SCL). Ce qui survit : les suites
   intégrées et le mid-market per-seat.
3. **Personne ne vend la couche logistique interne + reporting direction.** Refrag
   facture 79 USD/mois pour des slots et des serveurs, sans aucun planning. C'est le
   trou dans la raquette.

## 3. Contexte data (risque structurel)

- GRID consolide le marché de la data officielle (insolvabilité de Bayes Esports,
  rachat d'actifs, deal exclusif EFG) : l'accès data officielle tier 1 se verrouille. [indicatif]
- Côté FragValue : la FACEIT Downloads API (démos) est toujours bloquée ; le polling
  Data API fonctionne. Conséquence : le tier 1 strict (matchs sur serveurs ESL/PGL)
  est difficile d'accès ; le terrain réaliste est tier 2/3, ligues ESEA/FACEIT et
  académies de grosses structures, où les démos sont accessibles.

## 4. Recommandation produit

### Concept A (recommandé) : FragValue Org, l'OS de la structure

Cible : orgs tier 2/3, académies de structures tier 1, centres de formation esport.
Le pitch : "Skybox vend l'analyse. PRACC trouve tes scrims. Personne ne fait tourner
ta structure. FragValue Org gère tes rosters, ta semaine et tes rapports."

Contenu :
- **Multi-rosters** : main + academy + trials sous un même compte org, staff illimité
- **Pracc Planner cross-roster** (la brique livrée hier) : planning consolidé,
  ready check, détection de conflits de salles/serveurs/horaires entre rosters
- **Anti-strat inclus** (brique existante) : patterns adverses par map sur N démos
- **Rapports automatiques** : hebdo par joueur, par roster, et par org (cf. concept B)

Pricing suggéré : **249 EUR/mois par org** (jusqu'à 3 rosters, 20 sièges) ; 449 EUR/mois
au-delà. Positionnement exact dans le trou entre Noesis Team (30) et Skybox Tier 2 (350),
avec une couche que ni l'un ni l'autre n'a. L'offre académies/semi-pro actuelle
(~5 EUR/siège) reste l'entrée de gamme et le funnel.

### Concept B : le rapport du lundi matin (module signature, inclus dans A)

Le digest automatique hebdo pour le Head Coach et la direction : résultats, heures de
pracc planifiées vs réalisées (données du ready check du planner), progression FV Rating
par joueur, points anti-strat du prochain adversaire. Généré par le coach IA.
C'est l'attaque directe du pain point n°3 (reporting chronophage, vérifié chez Fnatic)
et n°2 (bases à la main) : la data est déjà dans FragValue, la saisie disparaît.
Aucun concurrent ne le propose. C'est l'argument de démo en entretien avec une org.

### Concept C (plus tard, pas maintenant) : Anti-strat Pro standalone

Pousser l'anti-strat au niveau "Playbook" (détection auto de setups par équipe adverse
+ counters suggérés) vendu 249-499 EUR/mois. Marge énorme vs Skybox 1299, MAIS :
affrontement frontal avec l'incumbent dominant du segment, et dépendance à l'accès
démos adverses (bloqué côté FACEIT Downloads). À garder pour la phase 2, une fois
des orgs clientes via le concept A.

## 5. Risques

| Risque | Mitigation |
|--------|-----------|
| Skybox domine l'analyse pro (pénétration revendiquée 85%+, non vérifiée) | Ne pas vendre "meilleure analyse", vendre "ta structure tourne seule". Terrain vierge. |
| Accès démos tier 1 verrouillé (GRID exclusifs, FACEIT Downloads bloquée) | Cibler tier 2/3 + académies (démos FACEIT/ESEA accessibles). Relancer Adam côté FACEIT. |
| Cimetière SaaS esport (Shadow, Esports Planner, Bayes) | Vendre à l'org (budget staff, facture annuelle) pas au joueur ; rester multi-brique pour ne pas dépendre d'une seule feature. |
| Solo founder vs promesse "enterprise" | Onboarding white-glove limité à 5 orgs pilotes ; le support premium devient un argument, pas une charge. |

## 6. Prochaine étape concrète

Valider le concept A par 3 entretiens avec des structures cibles (académies d'orgs FR,
équipes ESEA Advanced/Main) en montrant le Pracc Planner live + un mock du rapport du
lundi matin. Prix testé en entretien : 249 EUR/mois. Si 2 sur 3 mordent, build du
multi-rosters + rapports (4-5 semaines, le reste existe).

## Sources principales

- https://skybox.gg/pricing/ (vérifié 12/06/2026)
- https://www.noesis.gg/pricing/ (vérifié 12/06/2026)
- https://refrag.gg/tiers/ (vérifié 12/06/2026)
- https://pracc.com/ (vérifié 12/06/2026)
- https://startup.jobs/performance-analyst-counter-strike-fnatic-4926014 (vérifié par 3 agents)
- https://shadow.gg/ (down, vérifié 12/06/2026) ; esports-planner.com (NXDOMAIN, vérifié 12/06/2026)
- HLTV : interview swani (G2, anti-strat), "Why we're still waiting for Counter-Strike's data revolution" [indicatif]
- esports.gg / esportsinsider.com : GRID partenaire exclusif EFG, insolvabilité Bayes Esports [indicatif]
