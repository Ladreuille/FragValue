// pwa-register.js
// Register le service worker FragValue (sw.js) sur les pages user-facing.
// Charger via <script defer src="/pwa-register.js"></script>.
//
// Strategy : register seulement en HTTPS (sinon SW non supporte), pas en
// preview Vercel non-prod (eviter cache stale en dev), pas dans /admin/*
// (admin tooling = toujours fresh).

(function () {
  'use strict';

  // Bypass : pages admin (toujours fresh, pas de PWA shell)
  if (location.pathname.startsWith('/admin/')) return;

  // Bypass : pas HTTPS (SW interdit), ou localhost (dev)
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  // Bypass : preview deploys (URL contient frag-value-git-...)
  // En preview on veut toujours du frais, pas du cache.
  if (/frag-value-(git|[a-z0-9-]+)\.vercel\.app/.test(location.hostname)) return;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
          // Optionnel : prompt user when new SW installs in background
          reg.addEventListener('updatefound', () => {
            const newSW = reg.installing;
            if (!newSW) return;
            newSW.addEventListener('statechange', () => {
              if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[FragValue PWA] Nouvelle version dispo, sera active au prochain reload.');
              }
            });
          });
        })
        .catch(err => {
          console.warn('[FragValue PWA] SW registration failed:', err.message);
        });
    });
  }
})();
