# Railway Parser — Changelog technique

Le parser Railway (dossier local `/Users/quentin/Documents/Fragvalue/GitHub/fragvalue-demo-parser/`)
n'est pas versionné git. Ce fichier documente les changements non triviaux
poussés via `railway up` pour garder un historique.

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
