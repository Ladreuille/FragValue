// api/_lib/faceit-webhook-validator.js
// Validation HMAC SHA-256 des webhooks FACEIT.
//
// FACEIT signe ses webhooks via un header HTTP (le nom exact sera
// confirme avec la documentation des credentials, on supporte les
// noms courants : X-FACEIT-Signature, X-Hub-Signature-256, X-Signature).
//
// Le secret est partage cote FACEIT a la creation du webhook (via
// l'admin panel ou l'API webhook). On le stocke dans
// process.env.FACEIT_WEBHOOK_SECRET.
//
// Verification :
//   1. Lire le raw body de la requete (JSON.stringify(req.body) suffit
//      en serverless Node, pas de raw buffer dispo)
//   2. Compute HMAC-SHA256(body, secret) -> hex
//   3. Compare en constant-time avec la signature recue
//   4. Reject 401 si mismatch
//
// IMPORTANT : sans secret configure, on rejette par defaut (fail-closed).

const crypto = require('crypto');

// Headers possibles ou la signature peut arriver, par ordre de priorite.
// La doc FACEIT precise le nom exact, on garde flexible pour eviter de
// breaker si convention change.
const SIGNATURE_HEADERS = [
  'x-faceit-signature',
  'x-hub-signature-256',
  'x-signature-256',
  'x-signature',
];

function extractSignature(headers) {
  if (!headers) return null;
  // Normalise les headers en lowercase (Node retourne deja lowercase)
  for (const h of SIGNATURE_HEADERS) {
    const v = headers[h];
    if (v) {
      // Format possible : "sha256=<hex>" ou directement "<hex>"
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

// Compare en constant-time (timingSafeEqual exige meme longueur).
function safeCompare(a, b) {
  if (!a || !b) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch { return false; }
}

// Valide un webhook FACEIT.
// rawBody : string (JSON.stringify(req.body) ou le buffer si dispo)
// headers : req.headers (lowercase keys)
// Retourne { valid: bool, reason: string }.
function validateFaceitWebhook(rawBody, headers) {
  const secret = process.env.FACEIT_WEBHOOK_SECRET;
  if (!secret) {
    return { valid: false, reason: 'FACEIT_WEBHOOK_SECRET not configured (fail-closed)' };
  }
  if (!rawBody) {
    return { valid: false, reason: 'empty body' };
  }
  const sigHeader = extractSignature(headers);
  if (!sigHeader) {
    return { valid: false, reason: 'no signature header found' };
  }
  const expected = computeSignature(rawBody, secret);
  if (!safeCompare(sigHeader, expected)) {
    return { valid: false, reason: 'signature mismatch' };
  }
  return { valid: true, reason: 'ok' };
}

module.exports = {
  validateFaceitWebhook,
  computeSignature,
  extractSignature,
};
