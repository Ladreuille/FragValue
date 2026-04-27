# FACEIT Webhooks · Setup checklist

Ce fichier documente comment activer le webhook FACEIT cote FragValue
une fois que les credentials Downloads API arrivent (mail de suivi
post-approbation, avril 2026).

## URL publique du webhook

```
POST https://fragvalue.com/api/webhooks/faceit
```

Le endpoint :
- Valide la signature HMAC-SHA256 (fail-closed si secret absent)
- Idempotent par `event_id` (FACEIT peut retry sans creer de doublons)
- Repond 200 OK rapidement (FACEIT retry sur 5xx)
- Health check via `GET /api/webhooks/faceit` -> `{ ok: true, ready: bool }`

## Variables d'environnement Vercel

A ajouter dans Vercel > Settings > Environment Variables (Production +
Preview) une fois les credentials recus :

| Var                          | Description                                                   |
|------------------------------|---------------------------------------------------------------|
| `FACEIT_WEBHOOK_SECRET`      | Secret partage avec FACEIT pour signer les webhooks (HMAC).   |
| `FACEIT_DOWNLOADS_CLIENT_ID` | Client ID pour la Downloads API (a venir).                    |
| `FACEIT_DOWNLOADS_SECRET`    | Secret pour la Downloads API (a venir).                       |

`FACEIT_API_KEY` (existant, Data API publique) reste utilise par
`api/scout.js`, `api/prep-veto.js`, etc.

## Configuration cote FACEIT

Quand le panel webhook est dispo (cf. https://docs.faceit.com/docs/webhooks/) :

1. **Webhook URL** : `https://fragvalue.com/api/webhooks/faceit`
2. **Events a souscrire** :
   - `DEMO_READY`              : critique pour le flow auto-analyse
   - `MATCH_OBJECT_CREATED`    : pour Phase 4 (pre-match prep, optionnel)
   - `MATCH_FINISHED`          : pour notifications post-match
3. **Signature header** : auto-detecte par le validator
   (X-FACEIT-Signature, X-Hub-Signature-256, X-Signature-256, X-Signature)
4. **Algorithme** : HMAC-SHA256 (par defaut, ajuster si FACEIT impose autre)

## Test rapide post-config

1. Healthcheck :
   ```
   curl https://fragvalue.com/api/webhooks/faceit
   -> { "ok": true, "ready": true }
   ```

2. Test webhook signe (en local avec le secret pour debug) :
   ```bash
   BODY='{"event":"DEMO_READY","event_id":"test-123","match_id":"1-abc"}'
   SIG=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$FACEIT_WEBHOOK_SECRET" | sed 's/^.* //')
   curl -X POST https://fragvalue.com/api/webhooks/faceit \
        -H "Content-Type: application/json" \
        -H "X-FACEIT-Signature: sha256=$SIG" \
        -d "$BODY"
   -> { "ok": true, "eventType": "DEMO_READY", "eventId": "test-123" }
   ```

3. Verifier le log dans Supabase :
   ```sql
   SELECT event_type, match_id, signature_valid, received_at
   FROM faceit_webhook_events
   ORDER BY received_at DESC LIMIT 5;
   ```

## Phase suivante (Phase 2 : URL-based demo analysis)

Une fois les credentials Downloads API recus :
- Creer `api/_lib/faceit-downloads.js` : client API avec auth
- Creer `api/parse-from-faceit-url.js` : endpoint qui prend une URL
  match -> appelle Downloads API -> download .dem.gz -> parse
- Ajouter le formulaire URL sur `demo.html`
- Worker async qui consomme `faceit_webhook_events` non-processed pour
  les events DEMO_READY (auto-analyse pour les users avec roster lie)

## Schema DB (deja applique avril 2026)

Migration : `faceit_webhook_events`
- `id`              BIGSERIAL PK
- `event_id`        TEXT UNIQUE          (idempotency)
- `event_type`      TEXT NOT NULL        (DEMO_READY | MATCH_* | other)
- `match_id`        TEXT                 (extrait du payload)
- `payload`         JSONB NOT NULL       (raw, pour debug + reprocessing)
- `signature_valid` BOOLEAN              (resultat HMAC verify)
- `processed_at`    TIMESTAMPTZ          (NULL = pas encore traite)
- `error_message`   TEXT                 (si processing fail)
- `retry_count`     INT DEFAULT 0
- `received_at`     TIMESTAMPTZ
- `created_at`      TIMESTAMPTZ

RLS : deny-all clients. Lecture/ecriture via service_role uniquement.
