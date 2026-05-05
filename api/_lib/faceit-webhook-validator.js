// api/_lib/faceit-webhook-validator.js
// Validation des webhooks FACEIT · supporte 2 modes d'auth :
//
// 1. STATIC HEADER (recommande, conforme doc FACEIT actuelle)
//    FACEIT laisse le user choisir un header name + valeur statique a
//    l'enregistrement du webhook dans App Studio. Pas de signature, pas
//    de HMAC : juste un header constant qu'on compare avec une valeur
//    secrete connue cote FragValue.
//    Config : FACEIT_WEBHOOK_AUTH_HEADER (default 'x-faceit-token')
//             FACEIT_WEBHOOK_SECRET (la valeur attendue)
//
// 2. HMAC-SHA256 (legacy, garde pour compat si FACEIT change ou pour
//    d'autres providers qui signent en HMAC type Resend/Stripe-like)
//    Header attendu (auto-detect parmi 4 noms communs) :
//      x-faceit-signature, x-hub-signature-256, x-signature-256, x-signature
//    Format : "sha256=<hex>" ou directement "<hex>"
//    Config : FACEIT_WEBHOOK_SECRET (cle HMAC partagee)
//
// La fonction tente d'abord le mode STATIC (plus simple, plus rapide), puis
// fallback HMAC si pas de header static valide trouve. Fail-closed si le
// secret n'est pas configure.
//
// Doc FACEIT webhooks : https://docs.faceit.com/docs/webhooks/

const crypto = require('crypto');

// Liste des headers possibles ou la signature HMAC peut arriver.
// FACEIT ne fait pas de HMAC mais on garde le code pour compat future.
const SIGNATURE_HEADERS = [
  'x-faceit-signature',
  'x-hub-signature-256',
  'x-signature-256',
  'x-signature',
];

// Header attendu pour le mode STATIC (configurable via env var).
// Default 'x-faceit-token' · l'user definit le meme nom dans App Studio.
function getStaticHeaderName() {
  const v = process.env.FACEIT_WEBHOOK_AUTH_HEADER || 'X-FACEIT-Token';
  return String(v).toLowerCase();
}

function extractSignature(headers) {
  if (!headers) return null;
  for (const h of SIGNATURE_HEADERS) {
    const v = headers[h];
    if (v) {
      const m = String(v).match(/^(?:sha256=)?([a-f0-9]+)$/i);
      return m ? m[1].toLowerCase() : null;
    }
  }
  return null;
}

// Compute HMAC-SHA256(body, secret) en hex.
function computeSignature(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// Compare HMAC en constant-time (timingSafeEqual exige meme longueur).
function safeCompareHex(a, b) {
  if (!a || !b) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

// Compare 2 strings en constant-time (pour le static header).
function safeCompareString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

// Valide un webhook FACEIT.
// rawBody : string (JSON.stringify(req.body) ou le buffer si dispo)
// headers : req.headers (lowercase keys cote Node serverless)
// Retourne { valid: bool, mode: 'static'|'hmac'|null, reason: string }.
function validateFaceitWebhook(rawBody, headers) {
  const secret = process.env.FACEIT_WEBHOOK_SECRET;
  if (!secret) {
    return {
      valid: false,
      mode: null,
      reason: 'FACEIT_WEBHOOK_SECRET not configured (fail-closed)',
    };
  }

  // === MODE 1 : STATIC HEADER (FACEIT defaut) ===
  const staticHeaderName = getStaticHeaderName();
  const staticHeaderValue = headers ? headers[staticHeaderName] : null;
  if (staticHeaderValue) {
    if (safeCompareString(String(staticHeaderValue), secret)) {
      return { valid: true, mode: 'static', reason: 'ok' };
    }
    // Header present mais valeur ne matche pas : reject sans fallback HMAC
    // (eviter timing oracle sur le mode)
    return {
      valid: false,
      mode: 'static',
      reason: `static header "${staticHeaderName}" mismatch`,
    };
  }

  // === MODE 2 : HMAC-SHA256 (fallback) ===
  if (!rawBody) {
    return { valid: false, mode: null, reason: 'empty body and no static header' };
  }
  const sigHeader = extractSignature(headers);
  if (!sigHeader) {
    return {
      valid: false,
      mode: null,
      reason: `no auth header found (expected "${staticHeaderName}" or one of: ${SIGNATURE_HEADERS.join(', ')})`,
    };
  }
  const expected = computeSignature(rawBody, secret);
  if (!safeCompareHex(sigHeader, expected)) {
    return { valid: false, mode: 'hmac', reason: 'HMAC signature mismatch' };
  }
  return { valid: true, mode: 'hmac', reason: 'ok' };
}

module.exports = {
  validateFaceitWebhook,
  computeSignature,
  extractSignature,
  getStaticHeaderName,
};
