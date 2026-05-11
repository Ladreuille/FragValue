# Coach IA · Rubric d'evaluation par coachs humains

**Objectif** : valider que le Coach IA FragValue produit des diagnostics CS2 au moins equivalents (idealement superieurs) a ceux d'un coach humain Top FACEIT lvl 10 / ex semi-pro EU.

**Methodologie** : blind A/B sur 50 diagnostics. Pour chaque diagnostic : 2 versions (IA + coach humain) generees independamment sur les MEMES stats player. Un panel de 3-5 juges note chaque version sur les 10 axes du rubric ci-dessous (1-10). Comparaison agregee.

**Cible** : IA moyenne >= 8/10 sur 10 axes, et IA >= coach humain sur >= 7/10 axes en moyenne.

---

## Les 10 axes du rubric

### Axe 1 — Diagnostic chiffre et personnalise

Le diagnostic cite-il des STATS CONCRETES du joueur (ADR, KAST, K/D, opening ratio, FV Rating) avec leur valeur exacte, plutot que des generalites ?

- **10/10** : 5+ stats citees nominalement avec valeur (ex: "ADR 76 sur Mirage, KAST 64%, opening 38%"). Lien explicite entre stat et probleme.
- **8/10** : 3-4 stats citees nominalement avec valeur.
- **5/10** : 1-2 stats citees, le reste en generalites ("tu fais peu de kills", "ton aim est moyen").
- **2/10** : Aucune stat citee, full generalites.

### Axe 2 — Ancrage benchmark pro

Le diagnostic compare-il le joueur a des CHIFFRES PROS REELS (HLTV / scene), avec nom du pro, map specifique, et delta chiffre ?

- **10/10** : 3+ comparaisons avec nom de pro reel + chiffre ADR/Rating/KAST du pro + delta chiffre vs user. Ex: "donk fait 92 ADR sur Inferno T, toi 71 (delta -23%)."
- **8/10** : 2 comparaisons avec nom + chiffre + delta.
- **5/10** : 1 comparaison vague ("comme les pros", "au niveau pro on fait X").
- **2/10** : Aucune comparaison ou comparaisons inventees / fausses.

### Axe 3 — Drills calibres par tier

Le diagnostic propose-il 3-5 DRILLS PRECIS (workshop + nom + duree + objectif chiffre), calibres au niveau du joueur (low/mid/high/elite) ?

- **10/10** : 3-5 drills cites avec workshop reel (aim_botz, Yprac, KovaaK, etc.) + nom du drill + duree + objectif chiffre.
- **8/10** : 3 drills cites avec workshop + duree, objectif moins precis.
- **5/10** : 1-2 drills vagues ("entraine ton aim", "fais des deathmatches").
- **2/10** : Aucun drill ou drills non-CS (gym, mental).

### Axe 4 — Role detection precis

Le diagnostic IDENTIFIE-IL le role du joueur (entry, AWP, IGL, support, lurker, anchor, rifler) avec signaux explicites (opening ratio, FK/FD, KAST, K/R) et l'utilise pour calibrer ses conseils ?

- **10/10** : Role nomme explicitement + signaux chiffres + conseils adaptes au role (ex: pour entry, focus sur opening; pour anchor, focus sur trade KAST).
- **8/10** : Role nomme mais signaux moins explicites.
- **5/10** : Role devine mais pas verifie par les chiffres, conseils generaux.
- **2/10** : Aucun role identifie, conseils generiques.

### Axe 5 — Priorisation impact x effort

Les recommandations sont-elles HIERARCHISEES par impact (combien de % winrate gagne) x effort (heures de pratique necessaires) ?

- **10/10** : 3 priorites strictement ordonnees, chacune avec impact estime + effort estime + raisonnement.
- **8/10** : Priorites ordonnees mais sans estimation chiffree.
- **5/10** : Liste vague de "trucs a ameliorer" sans hierarchie.
- **2/10** : Aucune priorisation, conseils en vrac.

### Axe 6 — Citations rounds / situations concretes

Le diagnostic cite-il des ROUNDS PRECIS (numero) ou SITUATIONS CONCRETES (timing, score, action) tires de la demo ou des stats avancees ?

- **10/10** : 5+ citations de rounds avec contexte (score, action, lecon). Ex: "Round 12, 7-5 CT, tu push banane seul sans util, mort 1v1 au pixel boost — c'est ton pattern recurrent."
- **8/10** : 3-4 citations avec contexte.
- **5/10** : 1-2 citations vagues sans contexte.
- **2/10** : Aucune citation de round specifique.

### Axe 7 — Vocabulaire CS2 authentique

Le diagnostic utilise-il le LEXIQUE CS2 PRO (callouts officiels, terms scene comme "FK ratio", "opening duel", "KAST", "trade kill", "stack", "anchor", "off-angle", "peeker's advantage") ?

- **10/10** : Lexique CS2 dense (10+ termes pro), aucun terme generique "gaming". Lecture par un FACEIT lvl 10 = fluide.
- **8/10** : Lexique CS2 present (5-10 termes), quelques generalites.
- **5/10** : Lexique generique (kill, mort, position), peu de termes scene.
- **2/10** : Vocabulaire generique non-CS, ou pire : termes faux ("strafe-jump" pour reference).

### Axe 8 — Structure de sortie

Le diagnostic suit-il une STRUCTURE CLAIRE (Diagnostic / Top priorites / Drills / Pros refs / Objectif hebdo) avec format coherent ?

- **10/10** : Structure parfaite, sections nommees, pas de markdown abuse, lisible en 60s.
- **8/10** : Structure presente, quelques sections fusionnees ou floues.
- **5/10** : Structure partielle, recommandations melangees.
- **2/10** : Pas de structure, texte en bloc.

### Axe 9 — Suivi de progression

Le diagnostic compare-il aux diags PRECEDENTS du joueur (si dispo) et identifie-t-il des deltas (progres ou regression) sur les axes deja signales ?

- **10/10** : Compare aux 3 derniers diags avec deltas chiffres + lecture (progress, plateau, regression).
- **8/10** : Compare au dernier diag avec deltas chiffres.
- **5/10** : Mention vague du diag precedent sans deltas.
- **2/10** : Aucune reference au diag precedent (ou explicitement "premier diag").

### Axe 10 — Confidence + sample size

Le diagnostic indique-il son NIVEAU DE CONFIANCE et la TAILLE DE L'ECHANTILLON (combien de matchs analyses) ?

- **10/10** : Confidence explicite (high/medium/low) + sample size (N matchs) + caveats si N < 10 ("attention, base sur 5 matchs seulement, plus de data necessaire").
- **8/10** : Confidence et sample size mais sans caveat sur petit echantillon.
- **5/10** : Sample size mais pas de confidence ou inverse.
- **2/10** : Aucune indication de confidence ou sample size.

---

## Scoring global

Score moyen sur 10 axes pour chaque diagnostic IA et chaque diagnostic coach humain.

**Cible IA** :
- Moyenne >= 8/10 sur tous les axes
- IA >= coach humain sur >= 7/10 axes en moyenne
- Aucun axe < 6/10 sur > 20% des diagnostics

Si IA echoue sur ces criteres : retour developpement (prompt, RAG corpus, modele, schema).

---

## Protocole eval blind A/B

### Setup

1. **Dataset** : 50 player profiles anonymises (cf. `scripts/coach-eval-export-dataset.js`). Chaque profile contient stats + demos + previousDiag.
2. **Coaches humains** : 3-5 coachs CS2 valides (FACEIT lvl 10 minimum, ex semi-pro EU). Chaque coach analyse 10-15 profiles (rotation).
3. **IA** : run `ai-roadmap` endpoint sur les 50 profiles, store JSON output.

### Anonymisation

- Remove `faceit_nickname` (replace par "Player-XX")
- Remove `user_id`, `faceit_player_id`
- Keep stats / demos / role / map history
- Strip toute mention nominale dans les demos (replace pros referenced par "Pro-X")

### Judging

- 3 juges (FACEIT lvl 10+ ou coach pro).
- Pour CHAQUE profile :
  - Recevoir 2 diagnostics ANONYMISES (label "A" et "B" — ordre randomise par profile).
  - Scorer chaque diagnostic sur les 10 axes (1-10).
  - 5 min max par diagnostic.
- Juges NE SAVENT PAS lequel est IA / coach humain.
- Inter-rater reliability check : Krippendorff alpha >= 0.7 sinon discard.

### Output

- Tableau Excel : profile_id, juge_id, diag_label, axis_score_1..10, total.
- Stats agreges : IA moyenne par axe, coach humain moyenne par axe, p-value test t apparie.

---

## Datasource

- Source IA : table `diagnostic_history` (col `diagnosis_json`)
- Source coach humain : commission externe (~15-50 €/diag, budget total 750-2500 €)
- Anonymisation : `scripts/coach-eval-export-dataset.js`
- Scoring : Google Form -> Sheet -> SQL eval

---

## Calendrier indicatif

| Etape | Duree | Owner |
|-------|-------|-------|
| Export 50 profiles anonymises | 1 jour | Quentin |
| Commissionner 3-5 coachs humains | 1 semaine | Quentin |
| Run IA sur 50 profiles | 1 jour | Auto (Vercel) |
| Coachs humains produisent leurs diags | 2-3 semaines | Coaches |
| Setup judging (Google Form) | 1 jour | Quentin |
| Juges scorent (3 juges x 50 profiles x 2 diags) | 1-2 semaines | Juges |
| Analyse stats + report | 2-3 jours | Quentin |

**Total** : 6-8 semaines, budget ~1500-3000 € (coachs + juges + temps Quentin).

---

## Iterations post-eval

Si IA echoue sur certains axes :

- **Axe 1 (chiffres)** : Renforcer prompt avec exigence stats nominees + sample size minimum.
- **Axe 2 (benchmark pro)** : Etendre RAG corpus, ameliorer pro-benchmarks freshness.
- **Axe 3 (drills)** : Audit drill-library, calibrer par tier.
- **Axe 4 (role)** : Tune role-detection.js thresholds.
- **Axe 5 (prio)** : Renforcer rubric output structure (impact + effort obligatoires).
- **Axe 6 (rounds)** : Verifier que demo_data injection marche, extend keyRounds extraction.
- **Axe 7 (lexique)** : Etendre cs2-lexicon.js avec terms manquants identifies par juges.
- **Axe 8 (structure)** : JSON schema strict, validate output a chaque generation.
- **Axe 9 (progression)** : Verifier diagnostic_history populating, extend axisScores comparison.
- **Axe 10 (confidence)** : Force confidence + sampleSize fields in schema.
