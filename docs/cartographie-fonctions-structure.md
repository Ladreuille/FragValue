# Cartographie des fonctions d'une structure → produits FragValue

**Date** : 13 juin 2026
**Logique** (correctif stratégique Quentin) : ne rien supprimer. Pour CHAQUE
fonction du quotidien d'une structure esport qui n'a aujourd'hui **aucun outil
dédié** (le "non servi"), en faire un produit FragValue, le développer, le vendre.
Approche additive : on remplit les trous, on ne coupe pas la gamme.

Base : recherche vérifiée (16 claims 3-0) + benchmark concurrents. Une structure
complète (type Vitality) a coach + analyste + perf coach + manager + academy +
détection ; en descendant les tiers, ces fonctions ne disparaissent pas, elles
se fusionnent sur moins de personnes. Chaque fonction = un besoin, qu'il soit
porté par un poste dédié (tier 1) ou par le coach seul (tier 3 / école).

## Les 12 fonctions, leur outil actuel, et le produit FragValue

| # | Fonction dans la structure | Outil aujourd'hui | Trou ? | Produit FragValue |
|---|----------------------------|-------------------|--------|-------------------|
| 1 | Prépa adversaire / anti-strat | Skybox (tier 1), sinon le coach à la main | Partiel : non servi hors tier 1 | **Anti-Strat auto** (existe, à pousser) |
| 2 | VOD review de sa propre équipe | Skybox/Noesis (partiel), souvent live in-game | Partiel : pas d'async assigné | **VOD Coordinator** (page live, outil à build) |
| 3 | Logistique des praccs (planning, ready check) | Discord + Sheets ; Esports Planner MORT | **TROU TOTAL** | **Pracc Planner** (LIVE + Discord) |
| 4 | Trouver des adversaires de scrim | PRACC, SCL (gratuits) | Pris et gratuit | Ne pas refaire — intégrer un lien |
| 5 | Suivi de progression d'un joueur | Leetify/FACEIT (stats brutes individuelles) | Partiel : rien de scopé roster | **Progression roster** (FV Rating dans le temps) |
| 6 | Détection / évaluation des trials | Tableurs maison, FACEIT à la main | **TROU TOTAL** | **Pipeline détection** (trials suivis au FV Rating) |
| 7 | Reporting à la direction / GM | Rien de structuré | **TROU TOTAL** | **Rapport direction** (le "lundi") |
| 8 | Reporting aux sponsors | PowerPoint à la main, rien d'outillé | **TROU TOTAL** | **One-pager sponsor** (auto) |
| 9 | Reporting aux parents (écoles) | Bulletins maison, rien d'esport | **TROU TOTAL** | **Bulletin élève** (progression pédagogique) |
| 10 | Mémoire tactique / playbook coach | Notion, Sheets, docs perso | Partiel : rien de natif CS2 | **Strat Library** (v2, à creuser) |
| 11 | Charge mentale / wellness | Outils du sport traditionnel (matures) | Servi ailleurs | Ne pas entrer — hors légitimité |
| 12 | Contrats / voyages / admin | Notion, outils RH génériques | Servi par du générique | Ne pas entrer — hors domaine |

## Lecture : les 5 trous totaux = la gamme à vendre

Cinq fonctions n'ont **aucun outil** aujourd'hui. Ce sont elles, et elles seules,
qui justifient qu'une structure paie : on ne lui vend pas "mieux que Skybox", on
lui vend "ce que personne ne fait".

1. **Logistique praccs** (#3) → Pracc Planner. **Déjà construit et live.**
2. **Détection / trials** (#6) → Pipeline détection. Le métier quotidien des
   académies et écoles, zéro concurrent. Réutilise le scout B2C existant.
3. **Reporting direction** (#7) → le rapport du lundi auto.
4. **Reporting sponsors** (#8) → one-pager auto. Les orgs tier 2/3 vivent du
   sponsoring et doivent prouver leur sérieux en continu.
5. **Reporting parents/élèves** (#9) → bulletin élève. Produit cœur des écoles.

Les trois reportings (#7, #8, #9) partagent **un seul moteur** : la donnée est
déjà dans FragValue (FV Rating, events du planner, ready check, démos analysées).
On construit le générateur une fois, on l'habille trois fois selon le destinataire.

## Ce qui change vs mon avis précédent (je me corrige)

- **VOD Coordinator** : je voulais le rétrograder. Erreur. Il sert la fonction #2,
  qui est partiellement non servie (l'async assigné n'existe pas). On le garde et
  on lui trouve son public : les structures qui font du débrief à distance.
- **Wellness (#11) et admin (#12)** : seules vraies exclusions, mais pas parce
  qu'on "tue un produit" — parce que la fonction est DÉJÀ servie par des outils
  matures. On n'entre pas sur un trou qui n'existe pas. Nuance importante : on
  exclut un marché servi, pas une idée.

## Ordre de développement (par valeur de vente × proximité du build)

| Rang | Produit | Pourquoi ce rang | État |
|------|---------|------------------|------|
| 1 | Pracc Planner | Trou total, différenciant, porte d'entrée | LIVE |
| 2 | Rapports (moteur + 3 habillages) | 3 trous d'un coup, data déjà là, argument de démo | À build (~2 sem) |
| 3 | Pipeline détection | Trou total, cœur des écoles/académies, scout réutilisable | À build (~1 sem) |
| 4 | Anti-Strat poussé | Le besoin le plus prouvé, mais frontal vs Skybox | Existe, à approfondir |
| 5 | VOD Coordinator | Confort, pas un déclencheur d'achat | Page live, outil à build |
| 6 | Strat Library | v2, à valider en entretien d'abord | Idée |

## Le principe à garder en tête

Une structure n'achète pas une fonctionnalité, elle achète **une fonction de son
organigramme qu'elle n'arrive pas à couvrir**. Chaque trou de ce tableau est un
poste qu'elle ne peut pas (ou pas entièrement) staffer. FragValue ne remplace pas
le coach ou l'analyste : il couvre la part de leur travail que personne ne fait
faute de temps ou de budget. C'est ça qu'on vend, fonction par fonction.

Prochaine étape inchangée : valider en entretien lesquels de ces 5 trous font le
plus mal, AVANT de construire le #2 et le #3. Le guide d'entretien
([guide-entretien-structures.md](guide-entretien-structures.md)) est fait pour ça.
