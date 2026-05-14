# Option B · Spec extension parser Railway (events pro_demos)

**Public** : toi (proprio repo `fragvalue-demo-parser` sur Railway). Cette spec liste les events que le parser doit emit pour le pipeline pattern detection.

**Contexte** : le parser actuel supporte deja les demos FACEIT user (128 tick) et emit grenades, kills, bombs, positions. On veut etendre pour les demos pros HLTV (64 tick) et stocker tout dans `pro_demo_events` directement (au lieu de `matches.demo_data` jsonb).

## Endpoint a ajouter

```
POST /process-pro-demo
Authorization: Bearer ${PARSER_SECRET}
Content-Type: application/json

{
  "proMatchMapId": "uuid",          // FK vers pro_match_maps.id
  "demoUrl": "https://...",          // URL signee Supabase Storage (ou HLTV direct)
  "tickRate": 64,                    // 64 pour pro, 128 pour FACEIT (auto-detect possible via demo header)
  "callbackUrl": "https://fragvalue.com/api/admin/pro-demo-parsed"  // optionnel : notif fin
}
```

**Response** :
```json
{
  "ok": true,
  "proMatchMapId": "uuid",
  "queued": true
}
```

Le parser DOIT :
1. Repondre 200 immediatement (async processing)
2. Telecharger le .dem
3. Parser et emit events directement dans `pro_demo_events` via Supabase service key
4. Update `pro_demos.status` au fur et a mesure (`downloading` → `parsing` → `parsed` ou `failed`)
5. Set `pro_demos.event_count` une fois fini
6. Call `callbackUrl` si fourni (optionnel)

## Format des events

Chaque event = 1 row dans `pro_demo_events`. Schema :

```typescript
type ProDemoEvent = {
  pro_match_map_id: string;       // UUID
  round_num: number;              // 1-30+
  tick: number;                   // tick absolu (depuis debut demo)
  round_time_s: number | null;    // seconds depuis freeze_end (null pour round_start/freeze_end eux-memes)
  event_type: EventType;
  player_steamid: string | null;
  player_name: string | null;
  player_team: 'CT' | 'T' | 'spec' | null;
  pos_x: number | null;           // position joueur thrower
  pos_y: number | null;
  pos_z: number | null;
  target_pos_x: number | null;    // position cible (grenade impact, kill victim, etc.)
  target_pos_y: number | null;
  target_pos_z: number | null;
  weapon: string | null;          // pour kills : 'ak47', 'awp', 'm4a1_s', 'usp_s', 'deagle', etc.
  grenade_type: GrenadeType | null;
  victim_steamid: string | null;  // pour kills
  victim_name: string | null;
  metadata: object;               // jsonb, voir details par event_type ci-dessous
};

type EventType =
  | 'round_start'
  | 'freeze_end'
  | 'round_end'
  | 'grenade_thrown'
  | 'grenade_detonated'
  | 'kill'
  | 'bomb_planted'
  | 'bomb_defused'
  | 'bomb_exploded'
  | 'position_snapshot'
  | 'player_blinded'
  | 'utility_damage';

type GrenadeType = 'smoke' | 'flash' | 'molotov' | 'incgrenade' | 'hegrenade' | 'decoy';
```

## Detail par event_type

### `round_start` (1 par round)
```json
{
  "pro_match_map_id": "...",
  "round_num": 12,
  "tick": 192534,
  "round_time_s": null,
  "event_type": "round_start",
  "metadata": {
    "score_ct": 7, "score_t": 5,
    "ct_team_clan": "FaZe", "t_team_clan": "NaVi"
  }
}
```

### `freeze_end` (1 par round, marque debut "live")
```json
{
  "pro_match_map_id": "...",
  "round_num": 12,
  "tick": 193746,           // ~19s apres round_start a 64tick
  "round_time_s": 0,
  "event_type": "freeze_end",
  "metadata": {}
}
```

> **CRUCIAL** : `round_time_s` pour tous les events suivants doit etre calcule depuis ce tick (= (tick - freeze_end_tick) / tickRate).

### `round_end` (1 par round)
```json
{
  "pro_match_map_id": "...",
  "round_num": 12,
  "tick": 198250,
  "round_time_s": 70.4,
  "event_type": "round_end",
  "metadata": {
    "winner_team": "T",
    "reason": "bomb_exploded",  // ou "t_eliminated", "ct_eliminated", "time_expired", "defused"
    "score_ct": 7, "score_t": 6
  }
}
```

### `grenade_thrown` (1 par grenade jetee)
```json
{
  "pro_match_map_id": "...",
  "round_num": 12,
  "tick": 195000,
  "round_time_s": 19.6,
  "event_type": "grenade_thrown",
  "player_steamid": "76561198...",
  "player_name": "ropz",
  "player_team": "T",
  "pos_x": -480.5, "pos_y": -1620.3, "pos_z": 165.0,
  "target_pos_x": null,  // remplie par grenade_detonated correspondant
  "target_pos_y": null,
  "target_pos_z": null,
  "grenade_type": "smoke",
  "metadata": {
    "grenade_entity_id": 1247,  // pour matcher avec grenade_detonated
    "view_angle_x": 12.5,        // optionnel : facilite jump-throw detection
    "view_angle_y": -8.2,
    "is_jumping": false,         // critique pour jump-throw lineups
    "is_running": false
  }
}
```

### `grenade_detonated` (1 par detonation)
```json
{
  "pro_match_map_id": "...",
  "round_num": 12,
  "tick": 195128,
  "round_time_s": 21.6,
  "event_type": "grenade_detonated",
  "player_steamid": "76561198...",  // le thrower
  "player_name": "ropz",
  "player_team": "T",
  "pos_x": -480.5, "pos_y": -1620.3, "pos_z": 165.0,  // position thrower au moment du throw
  "target_pos_x": 250.0, "target_pos_y": 880.0, "target_pos_z": 64.0,  // position detonation
  "grenade_type": "smoke",
  "metadata": {
    "grenade_entity_id": 1247,
    "throw_to_detonation_ticks": 128,  // 2.0s a 64 tick
    "trajectory_points": [             // CRITIQUE pour rendu replay 2D - cf section dediee
      {"tick": 195000, "x": -480, "y": -1620, "z": 165},
      {"tick": 195002, "x": -460, "y": -1600, "z": 168},
      {"tick": 195004, "x": -440, "y": -1580, "z": 171},
      // ... sample tous les 1-2 ticks max (vs 8-16 actuel)
      {"tick": 195128, "x": 250, "y": 880, "z": 64}
    ]
  }
}
```

> **Note critique sampling density** : voir section dediee "Sampling Density Grenades" ci-dessous.

### `kill`
```json
{
  "pro_match_map_id": "...",
  "round_num": 12,
  "tick": 195500,
  "round_time_s": 27.4,
  "event_type": "kill",
  "player_steamid": "76561198...",  // killer
  "player_name": "ZywOo",
  "player_team": "CT",
  "pos_x": 800.0, "pos_y": 1200.0, "pos_z": 64.0,    // killer pos
  "target_pos_x": 1200.0, "target_pos_y": 1450.0,
  "target_pos_z": 64.0,                                  // victim pos
  "weapon": "awp",
  "victim_steamid": "76561198...",
  "victim_name": "donk",
  "metadata": {
    "headshot": true,
    "wallbang": false,
    "noscope": false,
    "smoke": false,
    "blind": false,                     // killer was blind
    "victim_blind": false,
    "distance": 423.5,                  // distance en units in-game
    "trade_kill": false,                // < 5s apres mort coequipier
    "opening_duel": true,               // 1er kill du round
    "assister_steamid": null,
    "flash_assister_steamid": null
  }
}
```

### `bomb_planted`
```json
{
  "pro_match_map_id": "...",
  "round_num": 12,
  "tick": 197000,
  "round_time_s": 50.8,
  "event_type": "bomb_planted",
  "player_steamid": "...",
  "player_name": "broky",
  "player_team": "T",
  "pos_x": 1500.0, "pos_y": 1850.0, "pos_z": 64.0,
  "metadata": {
    "site": "A",                  // determine par position (a calibrer par map)
    "callout": "default"          // optionnel : site default ou off-spot
  }
}
```

### `bomb_defused` / `bomb_exploded`
Similaire a bomb_planted. `pos_x/y` = position defuseur ou centre explosion.

### `position_snapshot` (CRUCIAL pour pattern detection holds)
```json
{
  "pro_match_map_id": "...",
  "round_num": 12,
  "tick": 194346,
  "round_time_s": 5.0,           // 5s apres freeze_end
  "event_type": "position_snapshot",
  "player_steamid": "...",
  "player_name": "karrigan",
  "player_team": "CT",
  "pos_x": 850.0, "pos_y": 350.0, "pos_z": 64.0,
  "weapon": "ak47",
  "metadata": {
    "health": 100,
    "armor": 100,
    "money": 4250,
    "has_kit": true,
    "view_angle_x": 90.0,
    "view_angle_y": 0.0,
    "is_alive": true
  }
}
```

> **Frequence** : emettre `position_snapshot` pour CHAQUE joueur encore vivant, A CES TICKS PRECIS :
> - `freeze_end + 5s` (pre-execute setup)
> - `freeze_end + 10s` (early-round hold)
> - `freeze_end + 20s` (mid-round)
> - `bomb_planted + 5s` (si plant happens : post-plant setup)
> - `bomb_planted + 15s` (post-plant deep hold)
>
> = max 5 snapshots × 10 joueurs × 30 rounds = 1500 snapshots/demo. OK.

### `player_blinded` (optionnel mais utile pour flash assists)
```json
{
  "event_type": "player_blinded",
  "tick": 195000,
  "round_time_s": 19.6,
  "player_steamid": "...",      // qui a flash
  "player_team": "T",
  "victim_steamid": "...",      // qui est blind
  "victim_name": "rain",
  "metadata": {
    "blind_duration_s": 2.3,
    "victim_team": "CT"
  }
}
```

### `utility_damage` (optionnel pour molly damage tracking)
```json
{
  "event_type": "utility_damage",
  "tick": 196000,
  "round_time_s": 35.0,
  "player_steamid": "...",      // qui a lance le molly
  "player_team": "T",
  "victim_steamid": "...",
  "victim_name": "EliGE",
  "weapon": "incgrenade",
  "metadata": { "damage": 23, "remaining_hp": 77 }
}
```

## Tickrate auto-detect

CS2 demos HLTV pro sont a **64 tick**. FACEIT demos a **128 tick**. Detection :
- Lire le header demo (`netproto` ou `netchannel` info)
- Fallback : detecter via duree round (un round CS2 dure 1:55, donc round_end - freeze_end devrait ≈ 1.92 × tickRate × N)
- Hardcode : si l'endpoint recoit `tickRate` dans le body, on fait confiance

Si le parser actuel suppose 128 tick partout (constants), il faut parametrer.

## Insert strategie

**Batch insert** : ne PAS faire 1 insert par event. Buffer 100-500 events puis bulk insert via Supabase JS client :
```js
const { error } = await supabase.from('pro_demo_events').insert(eventBatch);
```

Pour 1500 events/demo : 3-15 inserts batch = quelques secondes. OK pour le timeout Railway.

## Idempotence

Si le parser est re-run sur la meme demo (retry apres fail) :
1. DELETE FROM pro_demo_events WHERE pro_match_map_id = X (clean state)
2. INSERT batches

C'est plus simple que upsert avec conflit complexe.

## Tests recommandes

Avant de pousser en prod, valider sur 1 demo connue (ex : un match Astralis era ou tu connais bien le gameplay) :
1. Parser emit ~1500 events
2. `pro_demos.status = parsed`
3. Query manuel : `SELECT event_type, count(*) FROM pro_demo_events WHERE pro_match_map_id = X GROUP BY 1;` doit montrer ~30 round_start, ~30 freeze_end, ~30 round_end, ~200 grenades, ~150 kills, ~5-10 bomb_planted, etc.
4. Spot-check : visualiser 5 events grenade_thrown sur une carte 2D → coherent avec les positions in-game

## Sampling Density Grenades (CRITIQUE - bug rendu replay 2D)

### Probleme observe

Bug user-facing rapporte le 14/05/2026 : *"trajectoires des grenades qui traversent les murs au lieu de faire un rebond sur le mur oppose"*.

**Root cause** : le parser sample les positions des grenade entities tous les **8-16 ticks** (intervalle parseTicks par defaut). Entre deux samples, une grenade rapide (HE/flash a velocite ~1500 units/sec) peut :
1. Hit un mur
2. Bouncer
3. Avancer en direction reflechie

Sur le rendu canvas 2D (lineTo entre samples), la straight-line entre sample N et sample N+1 traverse visuellement le mur, alors que la grenade reelle a bouncé.

**Fix client-side** (deja deploye 14/05/2026, commit `63e2b54`) : smoothing Bezier + bounce markers. Cosmetique seulement, ne fixe pas la cause racine.

### Fix parser-side propose

Pour le `trajectory_points` array dans `grenade_detonated`, sampler **tous les 1-2 ticks** (vs 8-16 actuel). A 128 tick/s, ca donne 64-128 samples par seconde de vol.

#### Cout

Pour une demo pro 30 rounds × ~10 grenades/round × ~1s vol moyen :
- Avant : 300 grenades × ~8 samples = 2400 trajectory points
- Apres : 300 grenades × ~80 samples = 24000 trajectory points

Storage jsonb increase : ~10x sur le champ `metadata.trajectory_points`. Estimation : 2-5 MB en plus par demo. Acceptable.

Performance parser : parseTicks tous les 1-2 ticks au lieu de 8 = ~5-8x plus de samples traites. Acceptable si parser tourne en async.

#### Implementation cote parser

1. **Detect grenade entities en vol** : utiliser `class_name=BaseCSGrenadeProjectile` ou similaire dans le demoparser2
2. **Override parseTicks interval** : pour ces entites uniquement, sample tous les 1-2 ticks au lieu du default global
3. **Filtrer post-detonation** : la grenade entity continue d'exister apres explosion (smoke cloud, inferno, debris). Stop le sampling au tick `detonate_*` event correspondant
4. **Output dans `trajectory_points`** : array de `{tick, x, y, z}` ordonne par tick croissant

Pseudo-code (a adapter @laihoe/demoparser2 API) :
```javascript
const grenades = parser.parseEvents([
  'smokegrenade_detonate', 'flashbang_detonate', 'hegrenade_detonate',
  'inferno_startburn', 'decoy_started'
]);

for (const g of grenades) {
  const trajStartTick = g.thrown_tick;
  const trajEndTick = g.detonate_tick;
  // Sample entity positions tous les 1-2 ticks dans cette plage
  const trajectoryPoints = parser.parseTicks(
    ['X', 'Y', 'Z'],
    { ticks: range(trajStartTick, trajEndTick, 2) },
    { entity_id: g.grenade_entity_id }
  );
  g.metadata.trajectory_points = trajectoryPoints;
}
```

#### Effort estime parser

- Override sampling interval pour grenades only : 2-3h
- Filtrage post-detonation : 1-2h
- Tests sur 1 demo HE qui bounce sur Inferno apartments → verifier que la ligne hugs le mur correctement : 1-2h

**Total : 0.5-1 jour de dev cote parser Railway.**

### Effort client-side residuel

Une fois le parser denser : RIEN. Le code `drawSmoothTrajectory` deja deploye (commit 63e2b54) :
- Quadratic Bezier curves entre waypoints : se rapprochent automatiquement de la "vraie" trajectoire avec 16x plus de points
- Bounce markers : se positionnent automatiquement aux nouveaux points de bounce captures
- `computeBounceCorrectedPath` : cache via WeakMap, re-cache automatique avec nouveau path

### Validation

Apres deploiement, test cas suivant :
1. Demo Mirage T-side : 1 HE thrown depuis T-spawn vers A site, bouncing 2 fois (top of CT spawn wall + side wall A-rampe)
2. Replay 2D + toggle `Trajectoires grenades` (icone parabola)
3. La ligne doit visiblement hug la geometrie des murs (et plus traverser CT-spawn building visuellement)

## Effort estime total

- Endpoint `/process-pro-demo` : 2-4h (similaire a `/process-match` existant)
- Position snapshots : 1-2h (parseTicks existe deja, faut emit snapshots aux moments precis)
- Refactor pour ecrire dans `pro_demo_events` au lieu de `matches.demo_data` : 2-3h
- Tickrate auto-detect : 1-2h
- **Grenade sampling density override (nouveau)** : 4-7h
- Tests + debug sur 1 demo : 2-4h

**Total : 1.5-2.5 jours de dev cote parser Railway.**

## Coordination

Quand tu veux implementer cote parser, dis-moi. Je peux :
- Te donner un payload exact a tester (en faisant tourner un seed-pro-match)
- Run l'aggregation pattern detection sur le 1er match parse pour valider l'output
- Ajuster le schema `pro_demo_events` si tu identifies un event qui manque
