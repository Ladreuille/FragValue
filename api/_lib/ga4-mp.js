// api/_lib/ga4-mp.js
// Helper Measurement Protocol GA4 pour tracker les events business cote serveur.
//
// Pourquoi server-side et pas client gtag :
//   - Stripe webhook = pas de browser, le client n'est plus la quand le paiement
//     est confirme (3D Secure async, retry async, etc.)
//   - Auto-import FACEIT demos (parser webhook) = idem
//   - Resilience : ad blockers / refus consent ne bloquent pas ces events
//   - Source of truth : revenue Stripe = autoritative, pas un best-effort client
//
// Documentation : https://developers.google.com/analytics/devguides/collection/protocol/ga4
//
// Env vars requises :
//   GA4_MEASUREMENT_ID = G-H6PLDKSCJR  (le meme que celui dans <head> client)
//   GA4_API_SECRET     = <generer dans GA4 Admin > Data Streams > Web stream
//                        > Measurement Protocol API secrets > Create>
//
// Pattern d'usage :
//   const { trackServer } = require('./ga4-mp.js');
//   await trackServer({
//     clientId: 'stripe.cs_xxx',           // requis : id stable par user/transaction
//     userId: profileUserId,               // optionnel : userId Supabase (= GA4 user-id pour cross-device)
//     events: [{ name: 'purchase', params: { ... } }],
//   });
//
// Best-effort : ne throw jamais, log silently. Un crash MP ne doit pas
// faire echouer un webhook Stripe.

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

function isEnabled() {
  return !!(process.env.GA4_MEASUREMENT_ID && process.env.GA4_API_SECRET);
}

// Genere un client_id stable a partir d'une string (ex: stripe customer_id).
// GA4 attend un format "1234567890.1234567890" (random.timestamp).
// On hash le seed pour obtenir un nombre stable, et on append un timestamp fige.
function deriveClientId(seed) {
  if (!seed) return `${Date.now()}.${Math.floor(Math.random() * 1e10)}`;
  // Hash simple djb2-like, retourne un positif sur 32 bits
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) >>> 0;
  }
  // On fixe la 2e moitie pour que le meme seed = meme client_id
  // (= toutes les events d'un meme user Stripe seront groupees dans GA4).
  return `${h}.${1700000000}`;
}

async function trackServer({ clientId, userId, events, debug }) {
  if (!isEnabled()) {
    if (debug) console.log('[ga4-mp] disabled (GA4_MEASUREMENT_ID or GA4_API_SECRET missing)');
    return { skipped: true, reason: 'env_missing' };
  }
  if (!Array.isArray(events) || events.length === 0) {
    return { skipped: true, reason: 'no_events' };
  }
  // Cap MP : 25 events / payload
  if (events.length > 25) events = events.slice(0, 25);

  const cid = clientId || deriveClientId(userId || 'anonymous');
  const url = `${GA4_ENDPOINT}?measurement_id=${process.env.GA4_MEASUREMENT_ID}&api_secret=${process.env.GA4_API_SECRET}`;

  const payload = {
    client_id: cid,
    ...(userId ? { user_id: String(userId) } : {}),
    events: events.map(e => ({
      name: String(e.name || '').slice(0, 40),
      params: {
        // engagement_time_msec est obligatoire pour que GA4 considere
        // le user comme "actif" sur l'event server-side. 1ms = signal valide.
        engagement_time_msec: 1,
        ...(e.params || {}),
      },
    })),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // GA4 MP retourne 204 No Content sur succes.
    if (res.status !== 204) {
      const txt = await res.text().catch(() => '');
      console.warn(`[ga4-mp] non-204 status: ${res.status} ${txt.slice(0, 200)}`);
      return { ok: false, status: res.status, body: txt.slice(0, 200) };
    }
    return { ok: true };
  } catch (err) {
    // Best-effort : log et on continue. MP doit jamais bloquer le caller.
    console.warn('[ga4-mp] send failed:', err?.message);
    return { ok: false, error: err?.message };
  }
}

// Validation endpoint (pour debug uniquement, ne loggue pas dans GA4 prod) :
// utile pour valider qu'un payload est bien forme avant de l'envoyer pour de vrai.
// Doc : https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events
async function validateServer(payload) {
  if (!isEnabled()) return { skipped: true };
  const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${process.env.GA4_MEASUREMENT_ID}&api_secret=${process.env.GA4_API_SECRET}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    return { error: err?.message };
  }
}

module.exports = { trackServer, validateServer, isEnabled, deriveClientId };
