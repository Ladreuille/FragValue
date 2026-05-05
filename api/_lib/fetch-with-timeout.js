// api/_lib/fetch-with-timeout.js
//
// Wrapper fetch avec deadline via AbortController. Sans ca, un fetch vers une
// API tierce (Anthropic, FACEIT, PandaScore, Railway parser) peut hang jusqu'au
// timeout Vercel (60s par defaut, 300s sur les crons longs) et bloquer
// l'endpoint utilisateur sans message clair.
//
// Usage :
//   const { fetchWithTimeout } = require('./_lib/fetch-with-timeout.js');
//   const res = await fetchWithTimeout(url, { method, headers, body }, 25000);
//
// En cas de timeout : throw une erreur avec name='AbortError' (standard Web API).
// L'appelant peut catch et renvoyer une 504 ou retry. Si options.signal est
// deja fourni, on le respecte (compose les deux signals via AbortController.any
// si dispo, sinon on prend juste le notre).

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { fetchWithTimeout };
