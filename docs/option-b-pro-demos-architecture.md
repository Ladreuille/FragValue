# Option B · Architecture parsing demos pros + pattern detection

**Objectif** : transformer le RAG Coach IA d'un corpus de **patterns canoniques generaux** (210 entries V3) en un corpus de **patterns specifiques observes** automatiquement extraits depuis les demos pros HLTV reelles. C'est la marque de fabrique difficilement reproductible par un competiteur.

## Vue d'ensemble

```
HLTV.org
   │
   ├─→ Scraper demo URLs (Node script local, IP residentielle)
   │      ↓
   │   Storage .dem files (Supabase Storage bucket pro-demos/)
   │      ↓
   │   pro_demos.status = downloaded
   │
   ├─→ Railway parser (extension /process-pro-demo endpoint)
   │      ↓
   │   pro_demo_events table (grenades, kills, bombs, positions)
   │      ↓
   │   pro_demos.status = parsed
   │
   ├─→ Pattern detection (Node scripts ou cron Vercel)
   │      ↓
   │   pro_demo_patterns table (confidence-scored)
   │
   ├─→ Auto-generation (Claude + Voyage)
   │      ↓
   │   pro_demo_situations table (corpus RAG)
   │
   └─→ Coach IA RAG (production)
```

## Schema DB (cf. migration `option_b_pro_demo_parsing_infra`)

### `pro_demos` — ingestion state

Une ligne par `pro_match_map`. Tracker le cycle download → parse → done.

Cles colonnes :
- `status` : `pending | downloading | parsing | parsed | failed | skipped`
- `hltv_demo_url` : URL .dem direct
- `storage_path` : path dans Supabase Storage (bucket `pro-demos/`)
- `event_count` : pour validation post-parsing
- `retry_count` : pour backoff exponentiel sur fails

### `pro_demo_events` — raw events

Une ligne par event emis par le parser. Volume estime : ~1500 events par demo (30 rounds × 50 events). Avec 80 demos → 120K rows. Avec 500 demos → 750K rows. Postgres gere sans souci.

Cles colonnes :
- `event_type` : `grenade_thrown | grenade_detonated | kill | bomb_planted | bomb_defused | bomb_exploded | round_start | round_end | freeze_end | position_snapshot | player_blinded | utility_damage`
- `tick` + `round_time_s` : timing precis dans le round
- `pos_x/y/z` + `target_pos_x/y/z` : positions thrower + impact (grenades) ou tueur + victime (kills)
- `player_team` : `CT | T | spec`
- `grenade_type` : `smoke | flash | molotov | incgrenade | hegrenade | decoy`
- `metadata jsonb` : champs specifiques par event_type (reason round_end, headshot bool, wallbang bool, etc.)

Index :
- `(pro_match_map_id, round_num)` : query par round
- `(event_type)` partiel sur grenades/kills/bomb : aggregation rapide
- `(player_steamid)` : queries par pro

### `pro_demo_patterns` — patterns detectes

Une ligne par pattern unique detecte (>=3 occurrences = pattern).

Cles colonnes :
- `pattern_type` : voir constraint
- `signature_hash` : hash unique du pattern (map + side + pattern_specifics) → dedup
- `sample_size` : nb d'occurrences detectees
- `total_opportunities` : nb de rounds eligibles (pour calculer confidence)
- `confidence` : `sample_size / total_opportunities` (0-1)
- `pattern_data jsonb` : specifics structures (positions, timings, players, etc.)
- `pro_demo_situation_id` : FK vers le corpus RAG si entry generee

## Pipeline par etape

### Etape 1 — Decouverte demos HLTV

Pour chaque `pro_match` en DB avec `match_date` recent :
1. Fetch HLTV match page (rate-limited)
2. Extract demo download link (souvent format `https://www.hltv.org/download/demo/<demo_id>`)
3. Update `pro_matches.demo_available = true` + `pro_match_maps.demo_url`

**Tooling** : Node script `scripts/discover-pro-demos.js`. Reuse l'existant `scripts/hltv-playwright.js` (deja gere Cloudflare). Run manuel pour le backfill, puis cron weekly.

**Limites** :
- HLTV bloque les IPs datacenter (Vercel) → tourne en local
- Rate limit prudent : 1 req/10s pour pas se faire ban
- Demos disponibles 14j puis archivees

### Etape 2 — Download .dem files

Pour chaque `pro_demos` avec `status='pending'` :
1. Set `status='downloading'`
2. Download .dem depuis `hltv_demo_url`
3. Upload vers Supabase Storage (bucket `pro-demos/`, path : `<map_id>.dem`)
4. Set `status='parsing'`

**Tooling** : `scripts/download-pro-demos.js` ou cron Vercel si Cloudflare passe.

**Note** : HLTV propose souvent une archive `.rar` avec toutes les maps du match. Si c'est le cas, extraire chaque map et stocker individuellement.

### Etape 3 — Parser Railway extension

Le parser actuel (`fragvalue-demo-parser`) supporte deja les demos FACEIT user (128 tick). Il faut etendre pour :
1. Accepter input depuis Supabase Storage (signed URL) au lieu de FACEIT URL
2. Detecter tick rate auto (64 pour pro, 128 pour FACEIT/MM)
3. Emit events au format `pro_demo_events` (deja en grande partie supporte)
4. Endpoint dedie `/process-pro-demo` qui prend `pro_match_map_id` au lieu de `matchId` FACEIT
5. Ecrit dans `pro_demo_events` au lieu de `matches.demo_data`

**Events specifiques a ajouter** (le parser emet deja la majorite) :
- `position_snapshot` : pour chaque joueur, snapshot tous les 10s (freeze+5s, freeze+15s, freeze+25s) → permet pattern de hold positions
- `freeze_end` : tick exact ou freeze finit (pour calculer round_time_s)

**Effort cote parser** : 2-3 jours (modifs minimes, le gros est deja la). A coordonner avec toi (proprio du repo Railway).

### Etape 4 — Pattern detection

Une fois `pro_demo_events` populated, on detecte les patterns via SQL aggregation.

#### A) Util lineups recurrents

Pattern : "tel pro lance tel smoke depuis position X vers position Y sur map M dans N% des rounds T-side".

```sql
WITH grid_snapped AS (
  SELECT
    e.pro_match_map_id,
    pm.map_name,
    e.player_steamid,
    e.player_name,
    e.player_team,
    e.grenade_type,
    -- Snap positions to 64-unit grid (smoke radius ≈ 144 units)
    (round(e.pos_x / 64) * 64) AS thrown_x_bucket,
    (round(e.pos_y / 64) * 64) AS thrown_y_bucket,
    (round(e.target_pos_x / 64) * 64) AS impact_x_bucket,
    (round(e.target_pos_y / 64) * 64) AS impact_y_bucket
  FROM pro_demo_events e
  JOIN pro_match_maps pm ON pm.id = e.pro_match_map_id
  WHERE e.event_type = 'grenade_thrown'
    AND e.grenade_type IS NOT NULL
)
SELECT
  map_name,
  player_steamid,
  player_name,
  player_team,
  grenade_type,
  thrown_x_bucket, thrown_y_bucket,
  impact_x_bucket, impact_y_bucket,
  count(*) AS sample_size
FROM grid_snapped
GROUP BY 1,2,3,4,5,6,7,8,9
HAVING count(*) >= 3
ORDER BY sample_size DESC;
```

#### B) Position holds recurrents

Pattern : "tel pro hold position X 10s apres round start sur map M side CT dans N% des rounds".

```sql
WITH snapshots AS (
  SELECT
    e.pro_match_map_id,
    pm.map_name,
    e.round_num,
    e.player_steamid,
    e.player_name,
    e.player_team,
    (round(e.pos_x / 128) * 128) AS x_bucket,
    (round(e.pos_y / 128) * 128) AS y_bucket
  FROM pro_demo_events e
  JOIN pro_match_maps pm ON pm.id = e.pro_match_map_id
  WHERE e.event_type = 'position_snapshot'
    AND e.round_time_s BETWEEN 10 AND 15  -- 10-15s apres freeze
)
SELECT
  map_name,
  player_steamid,
  player_name,
  player_team,
  x_bucket, y_bucket,
  count(*) AS sample_size,
  count(DISTINCT pro_match_map_id) AS distinct_maps
FROM snapshots
GROUP BY 1,2,3,4,5,6
HAVING count(*) >= 5  -- au moins 5 rounds
ORDER BY sample_size DESC;
```

#### C) Timing patterns (executes)

Pattern : "team X execute site Y timing T sur map M dans N% des rounds T-side gun-round".

```sql
WITH plant_times AS (
  SELECT
    e.pro_match_map_id,
    pm.map_name,
    e.round_num,
    e.round_time_s AS plant_time_s,
    e.pos_x, e.pos_y  -- pour determiner site A vs B
  FROM pro_demo_events e
  JOIN pro_match_maps pm ON pm.id = e.pro_match_map_id
  WHERE e.event_type = 'bomb_planted'
)
SELECT
  map_name,
  -- Bucket sites A/B basé sur positions (a calibrer par map)
  CASE WHEN pos_y > 0 THEN 'A' ELSE 'B' END AS site,
  CASE
    WHEN plant_time_s < 30 THEN 'fast'
    WHEN plant_time_s < 60 THEN 'default'
    ELSE 'slow'
  END AS exec_speed,
  count(*) AS sample_size,
  avg(plant_time_s) AS avg_plant_time
FROM plant_times
GROUP BY 1, 2, 3
HAVING count(*) >= 3;
```

#### D) Post-plant crossfires

Pattern : "tel pro hold position X apres bomb planted sur site Y dans N% des post-plants".

```sql
-- Position snapshots 5s apres bomb_planted, par site
WITH plants AS (
  SELECT
    pro_match_map_id,
    round_num,
    tick AS plant_tick
  FROM pro_demo_events
  WHERE event_type = 'bomb_planted'
),
post_plant_pos AS (
  SELECT
    e.pro_match_map_id,
    pm.map_name,
    e.player_steamid,
    e.player_name,
    (round(e.pos_x / 128) * 128) AS x_bucket,
    (round(e.pos_y / 128) * 128) AS y_bucket
  FROM pro_demo_events e
  JOIN pro_match_maps pm ON pm.id = e.pro_match_map_id
  JOIN plants p ON p.pro_match_map_id = e.pro_match_map_id AND p.round_num = e.round_num
  WHERE e.event_type = 'position_snapshot'
    AND e.tick BETWEEN p.plant_tick + 320 AND p.plant_tick + 640  -- 5-10s post-plant
)
SELECT
  map_name,
  player_steamid, player_name,
  x_bucket, y_bucket,
  count(*) AS sample_size
FROM post_plant_pos
GROUP BY 1, 2, 3, 4, 5
HAVING count(*) >= 3;
```

#### E) Lurk timings

Pattern : "tel pro joue solo (>2000u du teammate le + proche) timing T+ sur map M dans N% des rounds".

Plus complexe : necessite de calculer distance entre joueurs. Faisable via window function.

### Etape 5 — Auto-generation entries corpus

Pour chaque pattern detecte avec `confidence >= 0.4` et `sample_size >= 5` :

1. Convertir le pattern en description naturelle via Claude (sonnet 4.6, prompt court)
   ```
   "Pattern detecte sur {N} rounds : {player} sur {map} side {side} a lance {grenade_type}
   depuis position {x1,y1} vers {x2,y2} dans {confidence}% des opportunites.
   
   Convertis en entry pro_demo_situations format JSON avec :
   - description (2-3 phrases, vocabulaire CS2 pro)
   - tactical_notes (3-5 phrases, lecons applicables)
   - axes_demonstrated (subset de aim/crosshair/spray/utility/positioning/gamesense/...)
   - key_callouts (2-5 callouts officiels map)
   - notable_rating (1-10, basee sur confidence + sample_size)"
   ```

2. Embed la description via Voyage AI

3. Insert dans `pro_demo_situations` + link via `pro_demo_patterns.pro_demo_situation_id`

**Cout** : ~$0.001 par entry generee (Claude + embedding). Pour 100 patterns → $0.10.

### Etape 6 — Orchestration

#### Cron Vercel weekly (`api/cron/refresh-pro-demos.js`)

1. Fetch nouveaux pro_matches HLTV (via existing `import-hltv.js`)
2. Pour chaque nouveau match avec demos dispos : enqueue dans `pro_demos`
3. Trigger parser Railway sur les `pending`
4. Une fois `parsed`, run pattern detection sur new events
5. Auto-generate corpus entries pour nouveaux patterns

#### Manual scripts (local)

- `scripts/discover-pro-demos.js` : decouvre URLs demos (manuel car HLTV/Cloudflare)
- `scripts/download-pro-demos.js` : download .dem files (manuel, IP residentielle)
- `scripts/detect-patterns.js` : run aggregation queries → populate pro_demo_patterns
- `scripts/generate-pattern-entries.js` : auto-generate entries corpus

## Roadmap implementation

### Phase 1 (semaine 1) — Foundation
- [x] Schema DB (pro_demos, pro_demo_events, pro_demo_patterns)
- [ ] Architecture doc (ce fichier)
- [ ] Parser spec : detailler events a ajouter + format expected
- [ ] Supabase Storage bucket `pro-demos/` (+ RLS service role only)

### Phase 2 (semaine 2) — Ingestion
- [ ] HLTV discover script (URLs + tick rate)
- [ ] HLTV download script (residential IP)
- [ ] Parser extension `POST /process-pro-demo` (coordonner avec Quentin sur Railway)
- [ ] Endpoint `/api/admin/trigger-pro-parse` (verif admin)

### Phase 3 (semaine 3) — Pattern detection
- [ ] Scripts SQL pour les 5 pattern types (A-E ci-dessus)
- [ ] Confidence scoring + signature hash
- [ ] Backfill : run aggregation sur les events deja ingerees

### Phase 4 (semaine 4) — Auto-generation + ops
- [ ] Claude prompt pour pattern → description
- [ ] Pipeline auto-generate + embed + insert
- [ ] Cron Vercel weekly
- [ ] Runbook ops (que faire si demo download fail, etc.)

## Cout / valeur attendue

### Cout

- Storage Supabase : ~50MB par demo × 100 demos = 5GB → couvert par Pro tier
- Voyage embeddings : ~$0.001 par pattern × 200 patterns potentiels = $0.20
- Claude generation : ~$0.001 par pattern × 200 = $0.20
- Bandwidth HLTV : negligeable
- Vercel compute : negligeable (cron weekly)
- **Total mensuel : ~$2/mois** (negligeable)

### Valeur

Sur 100 demos top tier 1 (1 an de matchs majeurs) :
- ~30 patterns util lineups par pro (×40 pros surveilles) = 1200 entries
- ~20 patterns position holds par map (×7 maps) = 140 entries
- ~10 patterns execute timings par map (×7) = 70 entries
- ~15 patterns post-plant par map (×7) = 105 entries
- ~10 patterns lurk par map (×7) = 70 entries

= **~1500 entries** auto-generees, hyper-specifiques, verifiables.

Vs corpus V3 actuel 210 entries canoniques : **7x plus de volume + qualite verifiable**.

C'est ce qui differencie un coach IA "marque de fabrique" d'un wrapper LLM generique : **donnees proprietaires extraites depuis sources verifiees**.

## Risques + mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| HLTV change format URLs demos | Bloque discover | Cron daily + alert sur 0 nouveau / 7j |
| Demos archivees apres 14j | Manque les vieux matchs | Backfill mensuel, archive .dem localement |
| Parser plante sur certains demos | Lacune corpus | Retry max 3, log error, skip apres |
| Patterns sur petits sample sizes = bruit | Faux pattern dans corpus | Threshold sample_size >= 5 + confidence >= 0.4 |
| Pro change team/rosters | Pattern obsolete | last_seen + auto-deprec apres 6 mois inactivity |
| Storage Supabase plein | Ingestion bloque | Cleanup .dem files apres parsing (events suffit) |

## Decisions architecturales

### Pourquoi events relationnels et pas event sourcing ?

On veut faire des aggregation queries massives (GROUP BY player + map + grenade). Event sourcing serait surdimensionne. Une table `pro_demo_events` flat avec bons index suffit.

### Pourquoi grid-snap pour les positions ?

Smoke radius ~144 units. Si on aggregate par position exacte (pixel-perfect), zero match. Avec grid 64u, on capte les "meme jump-throw lineup" meme si le pro est a +/- 32u.

### Pourquoi separer pro_demo_patterns de pro_demo_situations ?

- `pro_demo_patterns` : raw output detection (tech, can be many per source pattern)
- `pro_demo_situations` : corpus RAG (curated, embedded, used in production)

Cette separation permet d'iterer sur la detection sans poluer le corpus. Si un pattern est detecte mais que sa generation Claude est moche, on peut regen sans toucher la detection.

### Pourquoi pas tout sur Railway parser ?

Le parser est specialise demo parsing. La logique business (pattern detection, generation, embedding) est sur Vercel ou en local. Separation des responsabilites.
