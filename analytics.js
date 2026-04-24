// FragValue analytics + cookie consent
// ─────────────────────────────────────────────────────────────────────────
// Comportement RGPD-compliant :
// - Au 1er load, affiche un banner cookie pour demander consentement.
// - Tant que le user n'a pas accepte, AUCUN script analytics n'est charge
//   (Plausible est privacy-friendly mais on respecte quand meme le standard EU).
// - Le choix est memorise dans localStorage (1 an).
// - Si "Refuser", on ne charge rien et on ne re-demande pas pendant 30j.
// - Si "Accepter", on charge Plausible et on expose window.plausible('Event').
//
// Inclusion : <script src="/analytics.js" defer></script> dans tous les <head>.
// Pages auth (login.html, account.html) qui ont deja Supabase n'en ont pas
// besoin (mais c'est OK de l'inclure, pas de side effect).
// ─────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const PLAUSIBLE_DOMAIN = 'fragvalue.com';
  const PLAUSIBLE_SCRIPT = 'https://plausible.io/js/script.outbound-links.js';
  const STORAGE_KEY = 'fv_consent_v1';
  const REFUSED_TTL_DAYS = 30;
  const ACCEPTED_TTL_DAYS = 365;

  function readConsent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const ageDays = (Date.now() - parsed.ts) / (1000 * 60 * 60 * 24);
      const ttl = parsed.value === 'accept' ? ACCEPTED_TTL_DAYS : REFUSED_TTL_DAYS;
      if (ageDays > ttl) { localStorage.removeItem(STORAGE_KEY); return null; }
      return parsed.value;
    } catch (_) { return null; }
  }

  function writeConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ value, ts: Date.now() }));
    } catch (_) { /* quota / private mode */ }
  }

  function loadPlausible() {
    if (window._fvPlausibleLoaded) return;
    window._fvPlausibleLoaded = true;
    const s = document.createElement('script');
    s.defer = true;
    s.src = PLAUSIBLE_SCRIPT;
    s.setAttribute('data-domain', PLAUSIBLE_DOMAIN);
    document.head.appendChild(s);
    // Stub avant chargement complet
    window.plausible = window.plausible || function () {
      (window.plausible.q = window.plausible.q || []).push(arguments);
    };
  }

  function trackEvent(name, props) {
    if (typeof window.plausible === 'function') {
      window.plausible(name, props ? { props } : undefined);
    }
  }
  // Helper public : utilisable depuis n'importe quelle page connectee a analytics.js
  window.fvTrack = trackEvent;

  function showBanner() {
    if (document.getElementById('fvCookieBanner')) return;
    const b = document.createElement('div');
    b.id = 'fvCookieBanner';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-labelledby', 'fv-cookie-title');
    b.innerHTML =
      '<style>' +
        '#fvCookieBanner{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;' +
          'background:#0f1010;border:1px solid #1c1e1e;border-top:2px solid #b8ff57;border-radius:10px;' +
          'padding:14px 16px;max-width:540px;width:calc(100% - 32px);box-shadow:0 10px 30px rgba(0,0,0,.5);' +
          'font-family:"Space Mono",ui-monospace,monospace;color:#e8eaea;display:flex;align-items:center;gap:12px;flex-wrap:wrap}' +
        '#fvCookieBanner-text{flex:1;min-width:240px;font-size:11px;line-height:1.55;color:#d8dcdc}' +
        '#fvCookieBanner-text strong{color:#b8ff57;font-weight:700}' +
        '#fvCookieBanner-text a{color:#b8ff57;text-decoration:underline}' +
        '#fvCookieBanner-actions{display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap}' +
        '#fvCookieBanner button{font-family:"Space Mono",monospace;font-size:11px;font-weight:700;letter-spacing:.04em;' +
          'padding:8px 14px;border-radius:6px;cursor:pointer;border:1px solid #252727;background:transparent;color:#a8b0b0;transition:all .15s}' +
        '#fvCookieBanner button.accept{background:#b8ff57;color:#000;border-color:#b8ff57}' +
        '#fvCookieBanner button.accept:hover{filter:brightness(1.08)}' +
        '#fvCookieBanner button.refuse:hover{color:#e8eaea;border-color:#4a5050}' +
        '@media(max-width:480px){#fvCookieBanner{left:8px;right:8px;transform:none;width:auto}}' +
      '</style>' +
      '<div id="fvCookieBanner-text">' +
        '<strong>Cookies & confidentialite</strong> &middot; ' +
        'Nous utilisons Plausible (analytics anonymes, pas de donnees personnelles) pour comprendre comment tu utilises FragValue. ' +
        'Tes donnees de jeu (FACEIT, demos) sont privees et necessaires au fonctionnement. ' +
        '<a href="/privacy.html" target="_blank" rel="noopener">En savoir plus</a>.' +
      '</div>' +
      '<div id="fvCookieBanner-actions">' +
        '<button type="button" class="refuse" id="fvCookieRefuse">Refuser</button>' +
        '<button type="button" class="accept" id="fvCookieAccept">Accepter</button>' +
      '</div>';
    document.body.appendChild(b);

    document.getElementById('fvCookieAccept').addEventListener('click', function () {
      writeConsent('accept');
      b.remove();
      loadPlausible();
      // Track le consent comme premier event (utile pour mesurer le taux)
      setTimeout(function () { trackEvent('Consent Accepted'); }, 200);
    });
    document.getElementById('fvCookieRefuse').addEventListener('click', function () {
      writeConsent('refuse');
      b.remove();
    });
  }

  function init() {
    const consent = readConsent();
    if (consent === 'accept') {
      loadPlausible();
    } else if (consent === null) {
      // Affiche le banner apres un court delai pour ne pas spoiler le LCP
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(showBanner, 800); });
      } else {
        setTimeout(showBanner, 800);
      }
    }
    // 'refuse' : ne fait rien, on ne re-affiche pas avant 30j
  }

  init();
})();
