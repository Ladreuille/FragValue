// FragValue analytics + cookie consent
// ─────────────────────────────────────────────────────────────────────────
// GA4 + Consent Mode v2 (RGPD-compliant pour audience EU/France).
//
// Comportement :
// - Au load, on initialise gtag avec ad_storage='denied' + analytics_storage='denied'
//   par defaut (Consent Mode v2 obligatoire pour GA4 dans l'EEE).
// - Le banner cookie reste affiche jusqu'a choix explicite.
// - Si Accepter : gtag('consent','update', { analytics_storage:'granted' })
// - Si Refuser : on garde les valeurs 'denied' (GA4 envoie quand meme des
//   pings cookieless / signal-based : page_view comptes mais pas de visiteur
//   identifie ni de cohorts publicitaires).
// - Le choix est memorise localStorage : 1 an si Accept, 30j si Refuse.
//
// Pour activer : remplacer GA_MEASUREMENT_ID par ton vrai ID (format G-XXXXXXXXXX)
// que tu trouves sur analytics.google.com -> Admin -> Property -> Data streams.
// ─────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // GA4 Measurement ID FragValue (production)
  const GA_MEASUREMENT_ID = 'G-H6PLDKSCJR';

  const STORAGE_KEY = 'fv_consent_v1';
  const UTM_KEY = 'fv_utm_v1';
  const REFUSED_TTL_DAYS = 30;
  const ACCEPTED_TTL_DAYS = 365;
  const UTM_TTL_DAYS = 30;

  // === Consent Mode v2 init (avant tout chargement de tag) ================
  // gtag DOIT etre defini avant que le script GA4 ne charge, sinon les
  // 'consent default' sont ignores et GA collecte avec consent par defaut
  // (= violation RGPD).
  window.dataLayer = window.dataLayer || [];
  function gtag(){ window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('consent', 'default', {
    'ad_storage': 'denied',
    'ad_user_data': 'denied',
    'ad_personalization': 'denied',
    'analytics_storage': 'denied',
    'functionality_storage': 'granted',  // necessaire pour preferences (theme)
    'security_storage': 'granted',       // anti-fraude, toujours allume
    'wait_for_update': 500,              // attend 500ms le choix avant de fire
    'region': ['EEA', 'CH', 'GB'],       // strict consent pour EU/UK/CH
  });

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

  // === GA4 loader =========================================================
  function loadGA4() {
    if (window._fvGaLoaded) return;
    if (!GA_MEASUREMENT_ID || GA_MEASUREMENT_ID === 'G-XXXXXXXXXX') {
      console.warn('[analytics] GA_MEASUREMENT_ID non configure - GA4 desactive');
      return;
    }
    window._fvGaLoaded = true;
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_MEASUREMENT_ID;
    document.head.appendChild(s);

    gtag('js', new Date());
    // anonymize_ip recommande pour RGPD strict (mais GA4 le fait par defaut
    // en EU). On ajoute send_page_view:true pour le pageview initial.
    gtag('config', GA_MEASUREMENT_ID, {
      anonymize_ip: true,
      send_page_view: true,
      // Cookie flags : SameSite=Strict + Secure pour eviter CSRF
      cookie_flags: 'SameSite=Strict;Secure',
    });
  }

  // === Public tracking helper =============================================
  // Utilise depuis n'importe quelle page : window.fvTrack('Signup', { method: 'email' })
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
      // Update Consent Mode : autorise GA4 + ads cookies
      gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted',
      });
      loadGA4();
      // Track le consent pour mesurer le taux d'acceptation
      setTimeout(function () { gtag('event', 'consent_accepted'); }, 200);
      b.remove();
    });
    document.getElementById('fvCookieRefuse').addEventListener('click', function () {
      writeConsent('refuse');
      // Garde 'denied'. GA4 va quand meme charger en mode signal-only qui
      // envoie des pings agreges (page_view sans cookie ni client_id stable).
      // C'est conforme RGPD et permet de mesurer tendance trafic global.
      loadGA4();
      b.remove();
    });
  }

  // === Init flow ==========================================================
  function init() {
    const consent = readConsent();
    if (consent === 'accept') {
      // Consent deja accepte (visite precedente)
      gtag('consent', 'update', {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted',
      });
      loadGA4();
    } else if (consent === 'refuse') {
      // Refus deja exprime - on charge GA4 en mode signal-only
      // (le 'denied' par defaut reste applique)
      loadGA4();
    } else {
      // Aucun choix : affiche le banner. GA4 NE charge PAS encore (on attend
      // le choix). Si l'user navigue sans repondre, on capture rien.
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(showBanner, 800); });
      } else {
        setTimeout(showBanner, 800);
      }
    }
  }

  init();
})();
