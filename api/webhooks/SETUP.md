# FACEIT Webhooks · Setup checklist

Ce fichier documente comment activer le webhook FACEIT cote FragValue
maintenant que les credentials Downloads API sont disponibles (mai 2026).

## URL publique du webhook

```
POST https://fragvalue.com/api/webhooks/faceit
```

Le endpoint :
- Valide l'auth (mode static-header par defaut, fallback HMAC-SHA256 si applicable)
- Idempotent par `event_id` (FACEIT peut retry sans creer de doublons)
- Repond 200 OK rapidement (FACEIT retry sur 5xx)
- Health check via `GET /api/webhooks/faceit` -> `{ ok: true, ready: bool }`

## Variables d'environnement Vercel

A ajouter dans Vercel > Settings > Environment Variables (Production +
Preview) :

| Var                          | Description                                                              |
|------------------------------|--------------------------------------------------------------------------|
| `FACEIT_API_KEY`             | Server-side API Key (Data API + Downloads API). Source de verite.        |
| `FACEIT_WEBHOOK_SECRET`      | Valeur du header static que FACEIT enverra a chaque webhook (mode auth defaut FACEIT). Generer avec `openssl rand -hex 32`. |
| `FACEIT_WEBHOOK_AUTH_HEADER` | (Optionnel, default `X-FACEIT-Token`) Nom du header d'auth. Doit matcher exactement ce qui est configure dans App Studio. |

`FACEIT_CLIENT_ID` + `FACEIT_CLIENT_SECRET` (existant) restent utilises
par le OAuth login user (`api/faceit-auth.js`) · sans rapport avec la
Downloads API.

## Configuration cote FACEIT App Studio

1. Aller sur https://developers.faceit.com/ -> ton app FragValue -> onglet **WEBHOOKS**
2. **+ Add Webhook**
3. **REST endpoint URL** : `https://fragvalue.com/api/webhooks/faceit`
4. **Subscription Type** : `User` (events des users connectes)
5. **Events** :
   - `match_demo_ready`        : critique pour le flow auto-analyse
   - `match_status_finished`   : pour notifications post-match (optionnel)
6. **Authentication** :
   - Type : `Header Name + Header Value`
   - Header Name : `X-FACEIT-Token` (idem `FACEIT_WEBHOOK_AUTH_HEADER`)
   - Header Value : valeur generee avec `openssl rand -hex 32` (mettre dans `FACEIT_WEBHOOK_SECRET`)
7. **Save**

## Test rapide post-config

1. Healthcheck :
   ```
   curl https://fragvalue.com/api/webhooks/faceit
   -> { "ok": true, "ready": true, "auth_header": "x-faceit-token" }
   ```

2. Test webhook static-header (simule ce que FACEIT envoie) :
   ```bash
   curl -X POST https://fragvalue.com/api/webhooks/faceit \
        -H "Content-Type: application/json" \
        -H "X-FACEIT-Token: $FACEIT_WEBHOOK_SECRET" \
        -d '{"event":"match_demo_ready","event_id":"test-123","payload":{"match_id":"1-abc"}}'
   -> { "ok": true, "eventType": "match_demo_ready", "eventId": "test-123" }
   ```

3. Test fallback HMAC (si FACEIT change de mode auth a l'avenir) :
   ```bash
   BODY='{"event":"match_demo_ready","event_id":"test-456","payload":{"match_id":"1-def"}}'
   SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$FACEIT_WEBHOOK_SECRET" | sed 's/^.* //')
   curl -X POST https://fragvalue.com/api/webhooks/faceit \
        -H "Content-Type: application/json" \
        -H "X-FACEIT-Signature: sha256=$SIG" \
        -d "$BODY"
   ```

4. Verifier le log dans Supabase :
   ```sql
   SELECT event_type, match_id, signature_valid, received_at
   FROM faceit_webhook_events
   ORDER BY received_at DESC LIMIT 5;
   ```

## Format demos : `.dem.zst` (zstandard) · pas `.gz`

⚠️ La doc FACEIT (https://docs.faceit.com/getting-started/Guides/download-api/)
mentionne `.dem.gz` mais en pratique en mai 2026, FACEIT delivre les demos
au format `.dem.zst` (zstandard, ~80-85% compression). Implications :

- Decompression Node : besoin du package `simple-zstd` ou `@bokuweb/zstd-wasm`
- Decompression CLI : `brew install zstd && zstd -d demo.dem.zst -o demo.dem`
- Decompression Python (parser Railway) : `pip install zstandard`

## Phase 2 : URL-based demo analysis (en cours)

Avec les credentials Downloads API actifs :
- ✅ `api/_lib/faceit-downloads.js` : client API + cache + decompression
- ✅ `api/parse-from-faceit-url.js` : endpoint user-facing
- ✅ Form URL match sur `demo.html`
- ✅ Worker async `api/cron/faceit-process-events.js` qui consomme les events
  `match_demo_ready` non-processed (auto-analyse pour les users avec roster lie)

## Schema DB (applique avril 2026)

Migration : `faceit_webhook_events`
- `id`              BIGSERIAL PK
- `event_id`        TEXT UNIQUE          (idempotency)
- `event_type`      TEXT NOT NULL        (match_demo_ready | match_status_* | other)
- `match_id`        TEXT                 (extrait du payload)
- `payload`         JSONB NOT NULL       (raw, pour debug + reprocessing)
- `signature_valid` BOOLEAN              (resultat auth verify)
- `processed_at`    TIMESTAMPTZ          (NULL = pas encore traite)
- `error_message`   TEXT                 (si processing fail)
- `retry_count`     INT DEFAULT 0
- `received_at`     TIMESTAMPTZ
- `created_at`      TIMESTAMPTZ

RLS : deny-all clients. Lecture/ecriture via service_role uniquement.

## Troubleshooting

### `403 err_f0 "no valid scope provided"` sur `/download/v2/demos/download`

Le scope `downloads_api` n'est pas active sur ta `FACEIT_API_KEY`. Cas
typique : tu as regenere la key apres l'octroi initial du scope. Solution :
demander a Adam Harb (ad.harb@ext.efg.gg) de re-appliquer le scope a la
nouvelle key.

### `401 unauthorized` sur les webhooks entrants

Soit `FACEIT_WEBHOOK_SECRET` n'est pas configure (fail-closed), soit le
header envoye par FACEIT ne matche pas `FACEIT_WEBHOOK_AUTH_HEADER`. Verifier
dans App Studio que le nom du header configure cote FACEIT est identique a
la valeur de `FACEIT_WEBHOOK_AUTH_HEADER` cote Vercel.

### Demo introuvable / `404` sur `resource_url`

Les demos FACEIT sont disponibles ~2-4 semaines apres le match. Apres ce
delai elles sont purgees. Le webhook `match_demo_ready` permet d'eviter ce
probleme (declencher l'analyse des que la demo est dispo).
