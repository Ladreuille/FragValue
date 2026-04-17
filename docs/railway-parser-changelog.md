# Railway Parser — Changelog technique

Le parser Railway (dossier local `/Users/quentin/Documents/Fragvalue/GitHub/fragvalue-demo-parser/`)
n'est pas versionné git. Ce fichier documente les changements non triviaux
poussés via `railway up` pour garder un historique.

## 2026-04-17 — Hotfix parser crash (inventory_as_string + bomb isolation)

La demo parsait correctement les 20 rounds mais crashait apres "Rounds: 20" :
le champ `inventory` dans parseTicks n'est pas supporte par toutes les
versions de demoparser2, et le champ `site` dans bomb_planted non plus.

### Fix

1. `parseTicks` utilise `inventory_as_string` (string CSV universellement
   supportee) au lieu de `inventory` (array, pas toujours dispo). Fallback
   sans inventaire si le champ manque.
2. Bomb events : un try/catch independant par event (plant / defuse / explode)
   pour qu'un crash sur un event ne bloque pas les autres.
3. Champ `site` retire de bomb_planted (parfois non present).

Sans ce fix, le parser redemarrait en boucle apres "Rounds: 20" → le client
recevait "Failed to fetch" (pas de reponse HTTP → pas de CORS headers).

## 2026-04-17 — Bomb events + inventaire grenades par joueur

### Bomb events

`bomb_planted` ne retournait que 0 events car les champs user_X / user_Y
n'etaient pas demandes explicitement. Fix :

- `parseEvent('bomb_planted', [], ['tick', 'total_rounds_played', 'user_name', 'user_X', 'user_Y', 'X', 'Y', 'site'])` :
  on recupere les coords du planter et le site
- Ajout `bomb_defused` + `bomb_exploded` pour terminer le timer cote client
- Payload : `bombPlants`, `bombDefuses`, `bombExplodes` (3 arrays)

### Inventaire grenades

`parseTicks` etend le payload avec le champ `inventory` (array de weapon names).
On compte par joueur et par tick :

- `smk` (nombre de smokes), `fl` (flashs), `heg` (HE), `mol` (molo/inc), `dec` (decoy), `c4` (0/1)
- Cles compactes dans `positions` pour garder le payload < 5MB sessionStorage

Cote client : `frame.players[name].smk/fl/heg/mol/dec/c4` disponibles a chaque
tick interpole, utilises par le HUD pour afficher les icones grenades.

## 2026-04-17 — Fallback round_end pour rounds non detectes

`round_freeze_end` peut rater le dernier round si le demo se termine juste
apres le round decisif (pas de buy phase suivante). Resultat : MR12 qui finit
a 13-X peut etre vu comme 12-X par notre parser (1 round manquant).

### Fix

Ajout de `parseEvent(demoPath, 'round_end', ...)` comme fallback pour :

1. **Detecter les rounds manquants** : pour chaque `round_end`, si `total_rounds_played`
   n'est pas dans `roundStartTicks` (pas de freeze_end associe), reconstruire
   `startTick` en estimant `endTick - 6000 ticks` (90s de round typique).

2. **Completer les winners** : `round_end.winner` est utilise comme fallback
   apres `round_announce_win` si ce dernier est vide. Le champ est frequemment
   renseigne dans les demos FACEIT meme quand `round_announce_win` ne fire pas.

## 2026-04-17 — HE detonTick precis (recale sur event)

Le dernier point de `parseGrenades` continue parfois d'etre tracke 2-4 ticks
apres l'explosion reelle d'une HE (le projectile a un "ghost state"). Le client
voyait donc un delai anormal entre le lancer et le boom.

### Fix

Pour les grenades de type HE et flash : apres avoir choisi `detonTick = lastPoint.tick`
via la trajectoire, on cherche le `hegrenade_detonate` / `flashbang_detonate`
event le plus proche spatialement du lastPoint (< 400px, tick <= lastPoint.tick + 64)
et on recale `detonTick` dessus.

Les points du path ecrits dans le payload sont aussi filtres pour ne pas
continuer au-dela de ce detonTick (evite la queue fantome visible dans le replay).

Pas de changement pour smokes/molotov/decoy : leurs events ont des timings
differents (smoke_started != smoke_expired, inferno_startburn est le debut de
flamme pas le lancer), donc le lastPoint du path reste la meilleure source.

## 2026-04-17 — Fix trajectoires grenades (rebonds)

Ajout de l'extraction des trajectoires complètes via `parseGrenades` du SDK
`@laihoe/demoparser2`, avec matching robuste aux grenades existantes.

### Objectifs

1. Afficher la polyline de vol des grenades dans le 2D replay (avec rebonds)
2. Supprimer le bug "grenade qui explose à l'endroit du lancer"
3. Skip propre les grenades sans données fiables (plutôt que rendu cassé)

### Changements appliqués

1. **Import ajouté** : `const { parseEvent, parsePlayerInfo, parseGrenades } = require('@laihoe/demoparser2')`

2. **Extraction trajectoires** (nouveau bloc avant la map `grenades = thrown.map(...)`) :
   - Appel `parseGrenades(demoPath, ['X', 'Y', 'Z'])` qui retourne une row par tick de vol
   - Format retourné : `{ grenade_entity_id, grenade_type, name, steamid, tick, x, y, z }`
     (le champ `name` est le pseudo du thrower, `grenade_entity_id` identifie un projectile unique)
   - Groupement par `grenade_entity_id` (pas `entity_id`, c'est la clé distincte)
   - Filtrage des rows avec x/y null (grenades in-hand)
   - Tri des points par tick croissant

3. **Refonte du mapping grenade → trajectoire/détonation** :
   - **Tier A — match par nom exact** : `t.thrower === g.thrower`, fenêtre tick ≤ 512
   - **Tier B — fallback spatial** : mismatch nom autorisé si distance < 200px + tickDelta ≤ 128
   - Scoring pénalise le mismatch nom pour préférer les matches Tier A quand possible
   - Fenêtre temporelle tolérante : `first.tick ≤ g.tick + 3500` (smokes durent ~2300 ticks)

4. **Source de vérité `detonX/detonY`** :
   - Si `path` trouvé : dernier point du path = position réelle d'explosion
   - Sinon : fallback sur event `smokegrenade_detonate` / `hegrenade_detonate` / etc.
     avec filtre spatial de cohérence (maxRange 2500px pour grenades lancées, 800px pour molotov)
   - Sinon : `detonX = detonY = detonTick = null` (pas "= g.x/g.y" qui causait le bug)

5. **Downsampling** : chaque trajectoire est réduite à ~40 points max pour limiter
   la taille du payload JSON retourné au client.

### Résultats mesurés (démo test de_inferno 19 rounds)

| Type | Total | Path (avec rebonds) | Skip | Bug |
|------|-------|---------------------|------|-----|
| Smokes | 62 | 57 (92%) | 0 | 0 |
| Flashs | 57 | 54 (95%) | 0 | 0 |
| HE | 48 | 43 (90%) | 0 | 0 |
| Molotovs | 18 | 16 (89%) | 2 | 0 |
| Incendiaires | 32 | 22 (69%) | 10 | 1 |
| Decoys | 3 | 3 (100%) | 0 | 0 |
| **Total** | **220** | **195 (88.6%)** | **12** | **1** |

- Le seul "bug" résiduel est une vraie grenade qui a rebondi près du lanceur
  (distance d'explosion < 20px). Le frontend (`replay.html`) garde un guard
  défensif qui skip le rendu dans ce cas.

### Deploys Railway

- `railway up --detach` ne marche que si `*.dem` de test sorti du dossier
  (le build context uploade tout avant d'appliquer `.dockerignore`, donc
  un fichier de 276 MB cause un timeout upload)
- 6 itérations de build pour converger :
  - v1 : 4% match (mauvais champ thrower)
  - v2 : 94.5% match (fallback spatial)
  - v3 : 3.6% (trop restrictif après null-safety)
  - v4 : 4.1% (même problème)
  - v5 : 4.1% (même problème)
  - v6 : **88.6%** (fix clé entity_id)

### Côté client (replay.html)

Modifs couplées dans `replay.html` :

1. Skip complet de la grenade si `detonX == null || detonY == null || detonTick == null`
2. Guard défensif : si distance throw-detonation < 20px écran → skip
3. Rendu polyline à rebonds (lignes 1916-1954) : interpolation entre les points
   successifs du `g.path`, avec dessin progressif de la polyline déjà parcourue
