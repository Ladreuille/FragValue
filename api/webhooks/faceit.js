// api/webhooks/faceit.js
// Receiver des webhooks FACEIT (Downloads API + Match events).
//
// URL publique : POST https://fragvalue.com/api/webhooks/faceit
//
// Events attendus (avril 2026, se base sur la doc FACEIT) :
//   DEMO_READY            : la demo .dem est dispo en cloud, on peut la
//                           download via la Downloads API
//   MATCH_OBJECT_CREATED  : nouveau match cree (matchmaking found)
//   MATCH_FINISHED        : match termine
//
// Strategie :
//   1. Valider la signature HMAC (fail-closed si secret manquant)
//   2. Idempotency par event_id (insert ON CONFLICT DO NOTHING)
//   3. Repondre 200 OK rapidement (FACEIT retry sinon)
//   4. Le processing async (download demo, parse, etc.) est fait par
//      un worker separe qui pull les events non-processed
//
// Securite :
//   - bodyParser: false pour avoir le raw body (utile en mode HMAC fallback)
//   - 401 si auth invalide (header static OU signature HMAC selon mode FACEIT)
//   - 405 si pas POST
//   - Aucune lecture client de la table (RLS deny-all)

import { createClient } from '@supabase/supabase-js';
import { validateFaceitWebhook } from '../_lib/faceit-webhook-validator.js';

// Vercel ne parse pas le body : on a besoin du raw pour le fallback HMAC.
// Le mode static-header (defaut FACEIT) n'a pas besoin du raw body.
export const config = { api: { bodyParser: false } };

async function readRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Extrait l'event_id et match_id depuis le payload (formats varient
// selon le type d'event). Best-effort, retourne null si absent.
function extractEventMeta(parsed) {
  if (!parsed || typeof parsed !== 'object') return { eventId: null, matchId: null };
  const eventId   = parsed.event_id || parsed.id || parsed.transaction_id || null;
  const matchId   = parsed.match_id || parsed.payload?.match_id || parsed.data?.match_id || null;
  const eventType = parsed.event || parsed.event_type || parsed.type || 'unknown';
  return { eventId, matchId, eventType: String(eventType).toUpperCase() };
}

export default async function handler(req, res) {
  // Health check : GET retourne le status sans secret (utile pour
  // verifier que l'URL est joignable depuis le panel FACEIT).
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      ready: !!process.env.FACEIT_WEBHOOK_SECRET,
      auth_header: (process.env.FACEIT_WEBHOOK_AUTH_HEADER || 'X-FACEIT-Token').toLowerCase(),
      hint: process.env.FACEIT_WEBHOOK_SECRET ? null : 'FACEIT_WEBHOOK_SECRET not set',
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  // Lecture raw body (necessaire pour HMAC verify, et json.parse derriere).
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    console.error('[faceit-webhook] body read failed:', e.message);
    return res.status(400).json({ error: 'invalid body' });
  }

  // Validation HMAC (fail-closed si secret manquant)
  const validation = validateFaceitWebhook(rawBody, req.headers);
  if (!validation.valid) {
    console.warn('[faceit-webhook] signature invalid:', validation.reason);
    return res.status(401).json({ error: 'invalid signature', reason: validation.reason });
  }

  // Parse JSON
  let parsed;
  try {
    parsed = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'invalid json' });
  }

  // Insert dans la table de log (idempotent par event_id)
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { eventId, matchId, eventType } = extractEventMeta(parsed);

    // Si event_id manquant on insere quand meme (genere un UUID local
    // pour eviter le conflit unique). Sans event_id on perd l'idempotency
    // mais on garde le log.
    const row = {
      event_id: eventId,
      event_type: eventType,
      match_id: matchId,
      payload: parsed,
      signature_valid: true,
      received_at: new Date().toISOString(),
    };

    // Tente insert ; si event_id duplicate, on no-op (idempotency)
    const { error } = await sb.from('faceit_webhook_events')
      .insert(row, { onConflict: 'event_id', ignoreDuplicates: true });

    if (error && !String(error.message).includes('duplicate key')) {
      console.error('[faceit-webhook] insert failed:', error.message);
      // On repond quand meme 200 : si on retourne 5xx, FACEIT va retry
      // et on re-fail. Mieux vaut log + accepter (event perdu) que boucler.
      return res.status(200).json({ ok: true, warning: 'log failed but accepted' });
    }

    return res.status(200).json({ ok: true, eventType, eventId });
  } catch (e) {
    console.error('[faceit-webhook] processing error:', e.message);
    return res.status(200).json({ ok: true, warning: 'processing error logged' });
  }
}
