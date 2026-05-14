# Parser Railway · Spec densification sampling trajectoires grenades

**Public** : toi (proprio repo `fragvalue-demo-parser` sur Railway).
**Statut** : en attente d'implementation.
**Date** : 2026-05-14.

## Probleme

Les utilisateurs voient les trajectoires de grenades **traverser les murs** dans le replay 2D, alors que les grenades ont reellement rebondi en jeu. Bug rapporte le 14/05/2026.

## Cause racine

Le parser sample les positions des grenade entities via `parseTicks` (default ~8 ticks). Une grenade rapide (HE/flash a velocite ~1500 units/sec a 128tick) peut traverser un mur entre deux samples :

```
                ┌──────────┐
                │   Wall   │
T-spawn         │          │           A-site
   *────────────?──────────?────────────*
   sample N     (bounce ici             sample N+1
                non capture)
```

Sur le rendu canvas 2D (`ctx.lineTo` direct entre samples), le segment cross le mur visuellement. Avec 8-16 ticks d'intervalle entre samples a 128 tick/s, une grenade rapide peut bouger 90-180 units → un mur typique CS2 fait 16-128 units d'epaisseur, donc cross trivialement.

## Solutions deja deployees (client-side, cosmetique)

Commit `63e2b54` (14/05/2026) :
- **Quadratic Bezier smoothing** : `quadraticCurveTo()` via midpoints au lieu de `lineTo()` droit. Visuel plus naturel mais le segment peut toujours cross un mur si sparse.
- **Bounce markers** : detection angle change > 72° entre 3 samples consecutifs, dot visuel pour clarifier "bounce ici".
- **`computeBounceCorrectedPath()`** : cache WeakMap, retourne `{points, bounces}`.

Cosmetique. Ne fixe pas la cause racine. Une grenade qui bounce 2 fois entre samples cross toujours visuellement.

## Fix parser-side (REQUIS)

### Objectif

Sampler les positions des grenade entities **tous les 1-2 ticks** au lieu de 8-16, du throw_tick jusqu'au detonate_tick.

A 128 tick/s avec sampling tous les 1 tick : 128 samples/s de vol. Une grenade 1s en l'air = 128 samples = ~6 unit max entre samples = sub-wall resolution.

### Storage / format

Modifier le champ `g.path` dans le payload demo_data :
```javascript
// AVANT (sparse) : ~8 samples par grenade
g.path = [x0, y0, x1, y1, ...x7, y7];  // 16 floats = ~64 bytes

// APRES (dense) : ~80-128 samples par grenade
g.path = [x0, y0, ...x127, y127];  // 256 floats = ~1 KB
```

Pour 300 grenades par match (30 rounds × 10 utilities) :
- Avant : 300 × 64 = 19 KB
- Apres : 300 × 1024 = 300 KB

Sur le payload total demo_data (typiquement 2-5 MB), c'est +5-15%. Acceptable.

### Implementation cote parser (pseudo-code)

L'API exacte depend de `@laihoe/demoparser2` version. Schema :

```javascript
// 1. Detect grenade entities + leurs thrown/detonate ticks
const grenadeEvents = parser.parseEvents([
  'smokegrenade_detonate',
  'flashbang_detonate',
  'hegrenade_detonate',
  'inferno_startburn',
  'decoy_started',
  'smokegrenade_expired',  // pour fin de tracking smoke cloud
]);

// 2. Pour chaque grenade, recuperer son entity_id et range de ticks
const grenadeSpans = {};
for (const event of grenadeEvents) {
  const eid = event.entity_id || event.grenade_entity_id;
  if (!grenadeSpans[eid]) {
    grenadeSpans[eid] = {
      type: event.event_name.replace('_detonate', '').replace('_startburn', '').replace('_started', ''),
      throwTick: event.thrown_tick || (event.tick - 128),  // fallback : 1s avant detonate
      detonateTick: event.tick,
    };
  }
}

// 3. Override parseTicks interval pour les ticks dans les grenadeSpans
// (l'API peut differer mais le concept est : sample seulement ces entites
// avec un interval dense)
const trajectories = {};
for (const [eid, span] of Object.entries(grenadeSpans)) {
  const ticks = [];
  for (let t = span.throwTick; t <= span.detonateTick; t += 1) {  // <-- INTERVAL 1
    ticks.push(t);
  }
  const samples = parser.parseTicks(['X', 'Y', 'Z'], {
    ticks,
    entity_id: parseInt(eid),
  });
  // Build path = [x0, y0, x1, y1, ...]
  trajectories[eid] = [];
  for (const s of samples) {
    if (s.X !== undefined && s.Y !== undefined) {
      trajectories[eid].push(s.X, s.Y);  // skip Z pour 2D radar
    }
  }
}

// 4. Attacher au grenade event correspondant dans le payload final
for (const g of demoData.grenades) {
  if (g.entity_id && trajectories[g.entity_id]) {
    g.path = trajectories[g.entity_id];
  }
}
```

### Filtrage post-detonation

CRUCIAL : la grenade entity continue d'exister apres explosion (smoke cloud, inferno fire, debris). Ces samples post-detonation pollue le path (la grenade "teleporte" vers le centre du smoke cloud).

**Solution** : cap le sampling au `detonate_tick` (event smokegrenade_detonate, hegrenade_detonate, etc.). Pour molotov/inferno, cap au `inferno_startburn`. Pour decoy, cap au `decoy_started`.

Le code existant client-side a deja une logique de truncation (`replay.html` lignes 2236-2266), mais elle est imparfaite. Mieux : que le parser ne donne JAMAIS de samples post-detonation.

### Edge cases

1. **Grenade detruite sans detonation** (smoke etouffe par molotov adverse) : le span throw → destroy peut ne pas avoir d'event detonate. Detecter via `entity_destroyed` event.
2. **Tickrate variable** : si le parser supporte 64-tick et 128-tick demos, sample interval doit etre RELATIF au tickrate (ex: 1 sample tous les 1 tick = 1/128s a 128, 1/64s a 64).
3. **Multi-grenade par joueur** : un joueur peut avoir 2 smokes simultanees. Le `entity_id` doit etre unique par projectile, pas par joueur.

### Tests recommandes

Avant deploiement prod, valider :

1. **Test Mirage HE bounce** : T-spawn HE thrown over CT-spawn building (bounces off back wall). Path doit show 2 bounces visibles, sans crossing du building.
2. **Test Inferno banana smoke** : smoke standard banana entry, doit show le jump-throw arc + landing. Pre vs post : la difference doit etre flagrante.
3. **Volume check** : payload demo_data taille avant/apres. Doit etre +5-15% max.
4. **Performance** : temps de parsing demo 30 rounds. Doit etre +20-40% max (parseTicks plus dense).

### Effort estime

| Tache | Heures |
|---|---|
| Identifier grenade entities + lifetime spans | 1-2h |
| Override parseTicks pour ces entites uniquement | 2-3h |
| Filtrage post-detonation propre | 1-2h |
| Edge cases (variable tickrate, multi-grenade) | 1h |
| Tests + debug 3 demos differentes | 2-3h |
| **Total** | **7-11h (~1 jour)** |

## Validation post-deploy

1. Charger une demo qui avait le bug avant
2. Toggler `Trajectoires grenades` dans le replay 2D
3. Verifier visuellement : les lignes hug la geometrie des murs au lieu de cross
4. Verifier dans la console JS : `demoData.grenades[0].path.length` doit etre >= 50 (vs ~16 avant)

## Suivi

Quand tu deploies cote parser, dis-le-moi. Je peux :
- Faire un smoke test cote replay 2D sur une demo recente
- Mesurer l'amelioration visuelle (avant/apres screenshot)
- Ajuster les seuils de `computeBounceCorrectedPath` si necessaire (avec sampling dense, on peut RELACHER les filtres anti-jump et anti-stationnaire dans `replay.html` lignes 2210-2290)
