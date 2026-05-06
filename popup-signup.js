/* ──────────────────────────────────────────────────────────
   FragValue Signup Popup
   Self-contained IIFE. No external deps except Supabase JS.
   ────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  // i18n : detection langue + dictionnaire
  var FV_LANG = (document.documentElement.lang === 'en'
              || window.location.pathname.startsWith('/en/')) ? 'en' : 'fr';
  var T = FV_LANG === 'en' ? {
    close: 'Close',
    title: 'Analyze your CS2 performance',
    subtitle: 'Create a free account and access your advanced FACEIT stats, personalized FV Score, and progression tracking.',
    primary: 'Create my account',
    secondary: 'I already have an account',
    footer: 'Free, no commitment',
    loginHref: '/en/login.html',
  } : {
    close: 'Fermer',
    title: 'Analyse tes performances CS2',
    subtitle: 'Cree ton compte gratuitement et accede a tes statistiques FACEIT avancees, ton FV Score personnalise et le suivi de ta progression.',
    primary: 'Creer mon compte',
    secondary: 'J\'ai deja un compte',
    footer: 'Gratuit, sans engagement',
    loginHref: 'login.html',
  };

  var DISMISS_KEY   = 'fv_popup_dismissed';
  var DISMISS_DAYS  = 7;
  var DELAY_MS      = 12000;
  var SCROLL_PCT    = 0.6;

  /* ── Guard: already dismissed recently? ─────────────── */
  function wasDismissedRecently() {
    var ts = localStorage.getItem(DISMISS_KEY);
    if (!ts) return false;
    var diff = Date.now() - Number(ts);
    return diff < DISMISS_DAYS * 86400000;
  }

  if (wasDismissedRecently()) return;

  // Skip popup sur mobile et tablette (< 1024px). Sur petit ecran, la popup
  // couvre 90% du viewport et interrompt brutalement la navigation, ce qui
  // tue la conversion (anti-pattern UX e-commerce confirme). Le user mobile
  // verra l'objection-killer du hero + le CTA inline. Desktop garde la popup
  // a 12s/60% scroll qui marche bien sur grand ecran.
  if (typeof window !== 'undefined' && window.innerWidth < 1024) return;

  /* ── Inject CSS ─────────────────────────────────────── */
  var css = [
    '.fv-popup-overlay{',
    '  position:fixed;inset:0;z-index:9999;',
    '  display:flex;align-items:center;justify-content:center;',
    '  background:rgba(0,0,0,.7);',
    '  backdrop-filter:blur(6px);',
    '  -webkit-backdrop-filter:blur(6px);',
    '  opacity:0;',
    '  transition:opacity .35s ease;',
    '  pointer-events:none;',
    '}',
    '.fv-popup-overlay.fv-popup-visible{',
    '  opacity:1;',
    '  pointer-events:auto;',
    '}',
    '.fv-popup-modal{',
    '  position:relative;',
    '  width:92%;max-width:440px;',
    '  background:#0f1010;',
    '  border:1px solid #1c1e1e;',
    '  border-radius:12px;',
    '  padding:40px 32px 32px;',
    '  transform:translateY(16px);',
    '  transition:transform .35s ease;',
    '}',
    '.fv-popup-overlay.fv-popup-visible .fv-popup-modal{',
    '  transform:translateY(0);',
    '}',
    '.fv-popup-close{',
    '  position:absolute;top:16px;right:16px;',
    '  width:32px;height:32px;',
    '  display:flex;align-items:center;justify-content:center;',
    '  background:transparent;border:1px solid #252727;',
    '  border-radius:6px;cursor:pointer;',
    '  transition:border-color .15s;',
    '}',
    '.fv-popup-close:hover{border-color:#4a5050}',
    '.fv-popup-close svg{pointer-events:none}',
    '.fv-popup-title{',
    "  font-family:'Anton',sans-serif;",
    '  font-size:28px;line-height:1.1;',
    '  color:#e8eaea;letter-spacing:.01em;',
    '  margin-bottom:14px;',
    '}',
    '.fv-popup-subtitle{',
    "  font-family:'Space Mono',monospace;",
    '  font-size:13px;line-height:1.7;',
    '  color:#7a8080;',
    '  margin-bottom:32px;',
    '}',
    '.fv-popup-actions{display:flex;flex-direction:column;gap:10px}',
    '.fv-popup-btn-primary{',
    '  display:block;width:100%;text-align:center;',
    '  background:#b8ff57;color:#000;',
    "  font-family:'Space Mono',monospace;",
    '  font-size:13px;font-weight:700;',
    '  padding:14px 0;border-radius:6px;',
    '  text-decoration:none;letter-spacing:.04em;',
    '  transition:background .15s,transform .15s;',
    '}',
    '.fv-popup-btn-primary:hover{background:#7ddd1a;transform:translateY(-1px)}',
    '.fv-popup-btn-secondary{',
    '  display:block;width:100%;text-align:center;',
    '  background:transparent;color:#e8eaea;',
    '  border:1px solid #252727;',
    "  font-family:'Space Mono',monospace;",
    '  font-size:13px;font-weight:400;',
    '  padding:13px 0;border-radius:6px;',
    '  text-decoration:none;letter-spacing:.04em;',
    '  transition:border-color .15s,color .15s;',
    '}',
    '.fv-popup-btn-secondary:hover{border-color:#4a5050;color:#fff}',
    '.fv-popup-footer{',
    "  font-family:'Space Mono',monospace;",
    '  font-size:11px;color:#4a5050;',
    '  text-align:center;margin-top:20px;',
    '  letter-spacing:.04em;',
    '}',
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ── Build DOM ──────────────────────────────────────── */
  var overlay = document.createElement('div');
  overlay.className = 'fv-popup-overlay';

  overlay.innerHTML = [
    '<div class="fv-popup-modal">',
    '  <button class="fv-popup-close" aria-label="' + T.close + '">',
    '    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#7a8080" stroke-width="1.5" stroke-linecap="round">',
    '      <line x1="1" y1="1" x2="13" y2="13"/>',
    '      <line x1="13" y1="1" x2="1" y2="13"/>',
    '    </svg>',
    '  </button>',
    '  <div class="fv-popup-title">' + T.title + '</div>',
    '  <div class="fv-popup-subtitle">' + T.subtitle + '</div>',
    '  <div class="fv-popup-actions">',
    '    <a href="' + T.loginHref + '" class="fv-popup-btn-primary">' + T.primary + '</a>',
    '    <a href="' + T.loginHref + '" class="fv-popup-btn-secondary">' + T.secondary + '</a>',
    '  </div>',
    '  <div class="fv-popup-footer">' + T.footer + '</div>',
    '</div>',
  ].join('\n');

  document.body.appendChild(overlay);

  /* ── Show / Dismiss helpers ─────────────────────────── */
  var shown    = false;
  var canceled = false;

  function showPopup() {
    if (shown || canceled) return;
    shown = true;
    overlay.classList.add('fv-popup-visible');
  }

  function dismiss() {
    if (!shown) { canceled = true; return; }
    overlay.classList.remove('fv-popup-visible');
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    cleanup();
  }

  function cleanup() {
    canceled = true;
    window.removeEventListener('scroll', onScroll);
    clearTimeout(timer);
  }

  /* ── Dismiss bindings ───────────────────────────────── */
  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) dismiss();
  });

  overlay.querySelector('.fv-popup-close').addEventListener('click', function () {
    dismiss();
  });

  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') {
      dismiss();
      document.removeEventListener('keydown', handler);
    }
  });

  /* ── Triggers: 12 s timer + 60% scroll ─────────────── */
  var timer = setTimeout(showPopup, DELAY_MS);

  function onScroll() {
    var docH   = document.documentElement.scrollHeight - window.innerHeight;
    if (docH <= 0) return;
    var pct = window.scrollY / docH;
    if (pct >= SCROLL_PCT) showPopup();
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ── Supabase session check (async, cancels if logged in) ── */
  function cancelPopup() {
    canceled = true;
    clearTimeout(timer);
    window.removeEventListener('scroll', onScroll);
    if (shown) {
      overlay.classList.remove('fv-popup-visible');
    }
  }

  function checkSession() {
    var sb = window._sb;
    if (!sb || !sb.auth) return;

    // Immediate check
    if (typeof sb.auth.getSession === 'function') {
      sb.auth.getSession().then(function (res) {
        if (res && res.data && res.data.session) cancelPopup();
      }).catch(function () {});
    }

    // Listen for auth state changes (session restored from localStorage)
    if (typeof sb.auth.onAuthStateChange === 'function') {
      sb.auth.onAuthStateChange(function (event, session) {
        if (session) cancelPopup();
      });
    }
  }

  // Delay check slightly to let Supabase restore session from localStorage
  setTimeout(checkSession, 300);
})();
