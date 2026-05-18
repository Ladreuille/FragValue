// sw.js · FragValue Service Worker
//
// Strategy minimaliste pour MVP PWA shell :
// - Cache statique (HTML shells, JS/CSS/fonts) au install
// - Network-first pour HTML (toujours fresh, fallback cache offline)
// - Cache-first pour assets immuables (fonts/icons)
// - Bypass total pour /api/* (jamais cache)
//
// Versioning : changer CACHE_VERSION pour forcer un nettoyage + refetch.
// Le browser swap automatiquement le nouveau SW au prochain navigate, mais
// les pages deja ouvertes gardent l'ancien jusqu'a un reload.

const CACHE_VERSION = 'v1-2026-05-18';
const CACHE_NAME = `fragvalue-${CACHE_VERSION}`;

// Assets statiques precaches (shell minimum pour offline fallback)
const PRECACHE_URLS = [
  '/fragvalue_icon.svg',
  '/manifest.webmanifest',
  '/fonts/fonts.css',
  '/fonts/anton-latin.woff2',
  '/fonts/spacemono-400-latin.woff2',
  '/fonts/spacemono-700-latin.woff2',
];

// ── Install : precache shell assets ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS).catch(err => {
      console.warn('[sw] precache failed (non-blocking):', err.message);
    }))
  );
  self.skipWaiting();
});

// ── Activate : delete old caches ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('fragvalue-') && k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// ── Fetch handler : strategy par type de ressource ───────────────────────
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Bypass : pas notre origin (CDN supabase, anthropic, stripe, etc.)
  if (url.origin !== self.location.origin) return;

  // Bypass : POST/PUT/DELETE et autres non-GET
  if (req.method !== 'GET') return;

  // Bypass : /api/* (toujours frais, RLS / auth dependent)
  if (url.pathname.startsWith('/api/')) return;

  // Bypass : Supabase auth callbacks / OAuth (sensible aux query params + state)
  if (url.pathname.includes('/auth/') || url.pathname.includes('callback')) return;

  // Strategy fonts / icons : cache-first (assets immuables)
  if (url.pathname.startsWith('/fonts/') || url.pathname === '/fragvalue_icon.svg') {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Strategy HTML / JS / CSS : network-first avec fallback cache
  if (req.destination === 'document' || /\.(html|js|css)$/.test(url.pathname)) {
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req).then(cached => cached || new Response(
        '<html><body style="background:#080909;color:#e8eaea;font-family:monospace;padding:40px;text-align:center"><h1 style="color:#b8ff57">FragValue · Offline</h1><p>Tu sembles deconnecte. Reconnecte-toi pour revoir tes analyses.</p></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 503 }
      )))
    );
    return;
  }

  // Default : passthrough (images, etc.)
});
