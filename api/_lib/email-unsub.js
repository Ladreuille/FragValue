// api/_lib/email-unsub.js
// Generation et verification du token unsubscribe pour les emails marketing.
//
// Le token est self-contained (signe HMAC) : pas de DB lookup necessaire pour
// resoudre le userId au moment du clic. Pas de TTL : un lien unsub doit
// toujours fonctionner (sinon non-conforme CAN-SPAM Act / RGPD art. 21).
//
// Format : base64url("<userId>|<sig>")
// Signature : HMAC-SHA256(userId) avec un secret server-side, tronque a 24 hex chars.
//
// Conformite :
//   - CAN-SPAM Act (US) : unsub functional pour 30 jours minimum apres envoi
//   - RGPD art. 21 : droit d'opposition au marketing direct, lien doit etre
//     dans chaque email et fonctionner indefiniment
//   - LCEN (FR) art. L34-5 : meme logique, opt-out facile et permanent

const crypto = require('crypto');

function getSecret() {
  // Reutilise le meme secret que le state Discord ou un secret dedie.
  return (
    process.env.EMAIL_UNSUB_SECRET ||
    process.env.DISCORD_STATE_SECRET ||
    process.env.CRON_SECRET ||
    (process.env.SUPABASE_SERVICE_KEY ? process.env.SUPABASE_SERVICE_KEY.slice(0, 64) : null)
  );
}

function makeUnsubToken(userId) {
  if (!userId) throw new Error('userId required for unsub token');
  const secret = getSecret();
  if (!secret) throw new Error('EMAIL_UNSUB_SECRET not configured');

  const sig = crypto.createHmac('sha256', secret).update(String(userId)).digest('hex').slice(0, 24);
  return Buffer.from(`${userId}|${sig}`).toString('base64url');
}

function verifyUnsubToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'token empty' };
  }
  const secret = getSecret();
  if (!secret) {
    return { valid: false, reason: 'EMAIL_UNSUB_SECRET not configured (fail-closed)' };
  }

  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch (e) {
    return { valid: false, reason: 'token base64url decode failed' };
  }

  const parts = decoded.split('|');
  if (parts.length !== 2) {
    return { valid: false, reason: `token format invalid (${parts.length} parts)` };
  }
  const [userId, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(String(userId)).digest('hex').slice(0, 24);

  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'signature length mismatch' };
  }
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'signature mismatch' };
  }

  return { valid: true, userId };
}

function makeUnsubUrl(userId, baseUrl) {
  const token = makeUnsubToken(userId);
  return `${baseUrl || 'https://fragvalue.com'}/api/unsubscribe?token=${token}`;
}

module.exports = { makeUnsubToken, verifyUnsubToken, makeUnsubUrl };
