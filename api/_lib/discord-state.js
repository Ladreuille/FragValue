// api/_lib/discord-state.js
// Generation et verification du parametre OAuth `state` pour le link Discord.
//
// Le `state` proteg contre :
// 1. CSRF : un attaquant ne peut pas declencher un link au nom d'un user
// 2. Replay : TTL court (10 min) pour eviter qu'un state vole soit reutilise
// 3. Tampering : signature HMAC garantit l'integrite du userId encode
//
// Format : base64url("<userId>|<timestamp>|<nonce>|<returnUrl>|<sig>")
// Signature : HMAC-SHA256 du payload avec un secret server-side.
//
// Stateless : pas de DB. Le state est self-contained (signe), on peut le
// verifier sans stockage. Attention : signifie qu'on peut pas revoke un
// state pre-emptively (mais TTL 10 min suffit pour ce use case).

const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSecret() {
  // Priorite : secret dedie > CRON_SECRET > derive du SUPABASE_SERVICE_KEY
  // En prod il faut configurer DISCORD_STATE_SECRET avec `openssl rand -hex 32`.
  return (
    process.env.DISCORD_STATE_SECRET ||
    process.env.CRON_SECRET ||
    (process.env.SUPABASE_SERVICE_KEY ? process.env.SUPABASE_SERVICE_KEY.slice(0, 64) : null)
  );
}

function makeState(userId, returnUrl) {
  if (!userId) throw new Error('userId required for state');
  const secret = getSecret();
  if (!secret) throw new Error('DISCORD_STATE_SECRET not configured');

  const ts = Date.now();
  const nonce = crypto.randomBytes(8).toString('hex');
  const safeReturn = encodeURIComponent(returnUrl || '/account.html');
  const payload = `${userId}|${ts}|${nonce}|${safeReturn}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 24);
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function verifyState(state) {
  if (!state || typeof state !== 'string') {
    return { valid: false, reason: 'state empty' };
  }
  const secret = getSecret();
  if (!secret) {
    return { valid: false, reason: 'DISCORD_STATE_SECRET not configured (fail-closed)' };
  }

  let decoded;
  try {
    decoded = Buffer.from(state, 'base64url').toString('utf8');
  } catch (e) {
    return { valid: false, reason: 'state base64url decode failed' };
  }

  const parts = decoded.split('|');
  if (parts.length !== 5) {
    return { valid: false, reason: `state format invalid (got ${parts.length} parts)` };
  }

  const [userId, ts, nonce, safeReturn, sig] = parts;
  const payload = `${userId}|${ts}|${nonce}|${safeReturn}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 24);

  // Compare en constant-time
  const sigBuf = Buffer.from(sig, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'signature length mismatch' };
  }
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { valid: false, reason: 'signature mismatch' };
  }

  // TTL
  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || (Date.now() - tsNum) > TTL_MS) {
    return { valid: false, reason: 'state expired' };
  }

  return {
    valid: true,
    userId,
    returnUrl: decodeURIComponent(safeReturn),
  };
}

module.exports = { makeState, verifyState, TTL_MS };
