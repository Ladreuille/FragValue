// FragValue analytics + cookie consent
// ─────────────────────────────────────────────────────────────────────────
// COOKIE BANNER + CONSENT MANAGEMENT pour GA4 (deja initialise dans <head>).
//
// IMPORTANT : le snippet GA4 + Consent Mode v2 default est inline dans le
// <head> de chaque page HTML (necessaire pour que le crawler 'Google Tag
// installation tester' le detecte dans le HTML statique). Cf le bloc
// "Google tag (gtag.js)" inline avant ce script.
//
// Ce fichier gere :
// - Le banner cookie (Accept / Refuse)
// - Le consent update (gtag('consent', 'update', ...)) post-banner
// - La capture UTM pour attribution signup
// - L'helper window.fvTrack(event, props) -> gtag('event', ...)
// ─────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const STORAGE_KEY = 'fv_consent_v1';
  const UTM_KEY = 'fv_utm_v1';
  const REFUSED_TTL_DAYS = 30;
  const ACCEPTED_TTL_DAYS = 365;
  const UTM_TTL_DAYS = 30;

  // gtag est deja defini dans le <head> inline. Si pas la (page sans tag),
  // on stub pour eviter les ReferenceError.
  if (typeof window.gtag !== 'function') {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
  }
  const gtag = window.gtag;

  // === Helpers consent ====================================================
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

  // === UTM capture (pre-consent, no PII) ==================================
  function captureUtm() {
    try {
      const existing = JSON.parse(localStorage.getItem(UTM_KEY) || 'null');
      if (existing && existing.ts && (Date.now() - existing.ts) < UTM_TTL_DAYS * 86400000) return;
      const params = new URLSearchParams(window.location.search);
      const utm = {
        source:   params.get('utm_source')   || null,
        medium:   params.get('utm_medium')   || null,
        campaign: params.get('utm_campaign') || null,
        term:     params.get('utm_term')     || null,
        content:  params.get('utm_content')  || null,
        referrer: (document.referrer || '').slice(0, 200) || null,
        landing:  (window.location.origin + window.location.pathname).slice(0, 200),
        ts:       Date.now(),
      };
      if (utm.source || utm.medium || utm.campaign || utm.referrer) {
        localStorage.setItem(UTM_KEY, JSON.stringify(utm));
      }
    } catch (_) {}
  }
  captureUtm();
  window.fvGetSignupUtm = function () {
    try {
      const raw = localStorage.getItem(UTM_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  };

  // === Public tracking helper =============================================
  // Utilise depuis n'importe quelle page : window.fvTrack('sign_up', { method: 'email' })
  // Si le user n'a pas accepte, gtag fonctionne en mode signal-only (cookieless)
  // qui envoie des pings agreges sans tracker l'individu - conforme RGPD.
  window.fvTrack = function (eventName, props) {
    try {
      gtag('event', eventName, props || {});
    } catch (_) {}
  };

  // === Banner cookie ======================================================
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
        'Nous utilisons <strong>Google Analytics 4</strong> (mesure d\'audience anonymisee) pour comprendre comment tu utilises FragValue. ' +
        'Tu peux refuser : aucune trace individuelle ne sera collectee, juste des statistiques agregees. ' +
        '<a href="/privacy.html" target="_blank" rel="noopener">En savoir plus</a>.' +
      '</div>' +
      '<div id="fvCookieBanner-actions">' +
        '<button type="button" class="refuse" id="fvCookieRefuse">Refuser</button>' +
        '<button type="button" class="accept" id="fvCookieAccept">Accepter</button>' +
      '</div>';
    document.body.appendChild(b);

    document.getElementById('fvCookieAccept').addEventListener('click', function () {
      writeConsent('accept');
      // Update Consent Mode : autorise GA4 + ads cookies. GA4 est deja
      // charge via init() ; le 'consent update' suffit a switcher en mode
      // collecte complete (avec cookie client_id, sessions, conversions).
      gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted',
      });
      // Track le consent pour mesurer le taux d'acceptation
      gtag('event', 'consent_accepted');
      b.remove();
    });
    document.getElementById('fvCookieRefuse').addEventListener('click', function () {
      writeConsent('refuse');
      // Garde 'denied'. GA4 deja charge fonctionne en mode signal-only :
      // pings agreges (page_view sans cookie ni client_id stable) qui
      // restent conformes RGPD et permettent de mesurer tendance trafic.
      b.remove();
    });
  }

  // === Init flow ==========================================================
  // GA4 est deja charge via le snippet inline du <head>. Ici on :
  // - Restore le consent precedent si le user avait deja choisi
  // - Affiche le banner sinon (pour collecter le choix)
  function init() {
    const consent = readConsent();

    if (consent === 'accept') {
      // Consent deja accepte sur visite precedente -> upgrade direct
      gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted',
      });
    }
    // Si consent 'refuse' ou null : on garde 'denied' par defaut (deja set
    // dans le snippet inline du <head> avec gtag('consent', 'default', ...))

    // Si pas de choix encore : affiche le banner pour solliciter consentement
    if (!consent) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(showBanner, 800); });
      } else {
        setTimeout(showBanner, 800);
      }
    }
  }

  // CNIL HIGH #5 (cf. ultrareview Trust/Legal) : la modification du choix
  // cookies doit etre aussi simple que le retrait. On expose une fonction globale
  // qui efface le consent et reaffiche le banner. Le footer.js l'appelle depuis
  // le lien "Cookies" persistant.
  window.fvOpenCookies = function () {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
    showBanner();
  };

  init();
})();
