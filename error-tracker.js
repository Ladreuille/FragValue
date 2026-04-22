// error-tracker.js // FragValue
// Lightweight client-side error tracker : hook window.onerror + unhandledrejection
// et POST vers /api/errors. Rate-limit local pour eviter de spam l'endpoint.
//
// Usage : charge via <script src="/error-tracker.js"></script> (inclus
// automatiquement par nav.js).

(function () {
  'use strict';

  if (window.__fvErrorTrackerLoaded) return; // idempotent
  window.__fvErrorTrackerLoaded = true;

  const ENDPOINT = '/api/errors';
  const MAX_PER_SESSION = 15;   // cap total d'erreurs envoyees par session
  const DEDUP_WINDOW_MS = 5000; // meme fingerprint <5s = skip
  let sentCount = 0;
  const lastSent = new Map(); // fingerprint -> timestamp

  function fingerprint(msg, route) {
    // Hash naif client-side (le server recalcule le vrai)
    let h = 0;
    const s = String(msg || '').slice(0, 200) + '|' + String(route || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return String(h);
  }

  function getAuthToken() {
    try {
      const raw = localStorage.getItem('sb-xmyruycvvkmcwysfygcq-auth-token');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.access_token || null;
    } catch { return null; }
  }

  function send(payload) {
    if (sentCount >= MAX_PER_SESSION) return;

    const fp = fingerprint(payload.message, payload.route);
    const now = Date.now();
    const last = lastSent.get(fp);
    if (last && now - last < DEDUP_WINDOW_MS) return; // dedupe
    lastSent.set(fp, now);

    sentCount++;

    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    // sendBeacon si dispo (fire-and-forget fiable meme au unload)
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(ENDPOINT, blob);
        return;
      }
    } catch {}

    // Fallback fetch (silencieux)
    try {
      fetch(ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }

  function buildPayload(partial) {
    return Object.assign({
      source: 'client',
      level: 'error',
      url: window.location.href,
      route: window.location.pathname,
      user_agent: navigator.userAgent,
    }, partial);
  }

  // ── Hook 1 : erreurs JavaScript non catchees (window.onerror) ───────────
  window.addEventListener('error', (ev) => {
    // Skip les erreurs de chargement de ressources (images, scripts externes)
    if (ev.target && ev.target !== window && (ev.target.tagName === 'IMG' || ev.target.tagName === 'SCRIPT' || ev.target.tagName === 'LINK')) {
      return;
    }
    const err = ev.error;
    send(buildPayload({
      message: err?.message || ev.message || 'Unknown error',
      stack: err?.stack || null,
      extra: {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      },
    }));
  });

  // ── Hook 2 : promises rejetees non catchees ──────────────────────────
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    let message, stack;
    if (reason instanceof Error) {
      message = reason.message || 'Unhandled promise rejection';
      stack = reason.stack;
    } else {
      message = typeof reason === 'string' ? reason : JSON.stringify(reason).slice(0, 500);
    }
    send(buildPayload({
      message: '[unhandled] ' + message,
      stack,
    }));
  });

  // ── Hook 3 : monitor des fetch() qui echouent avec status >= 500 ─────
  // On ne log PAS les 4xx (c'est souvent un erreur user/auth, pas un bug).
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = async function (...args) {
      const [resource, init] = args;
      const url = (typeof resource === 'string') ? resource : (resource?.url || '');
      try {
        const res = await origFetch.apply(this, args);
        if (res.status >= 500) {
          send(buildPayload({
            level: 'error',
            message: `[fetch] ${res.status} ${res.statusText} on ${url}`,
            extra: { api_url: url, status: res.status, method: init?.method || 'GET' },
          }));
        }
        return res;
      } catch (err) {
        // Network error (CORS, offline, DNS)
        // On ne log que si c'est une URL FragValue (evite de logger les fetch externes)
        if (url.startsWith('/api/') || url.includes('fragvalue.com') || url.includes('supabase.co')) {
          send(buildPayload({
            level: 'error',
            message: `[fetch-network] ${err.message} on ${url}`,
            stack: err.stack,
            extra: { api_url: url, method: init?.method || 'GET' },
          }));
        }
        throw err;
      }
    };
  }

  // ── Helper expose pour reporter manuellement une erreur ──────────────
  // Usage : window.FV.reportError('Something weird happened', { ctx: 123 });
  window.FV = window.FV || {};
  window.FV.reportError = function (message, extra, level = 'error') {
    send(buildPayload({
      source: 'client',
      level,
      message: String(message),
      extra: extra || null,
    }));
  };
})();
