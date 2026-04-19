// ═══ FragValue : Navbar partagée ══════════════════════════════════════════
// Remplace la navbar existante par la structure 4 sections : MON JEU,
// PROGRESSER, PROS, ÉQUIPE. Détecte la page courante pour highlight la
// section active. Gère le state auth (Connexion vs Mon espace) et le plan
// (masque ÉQUIPE si pas Elite).
//
// Usage : inclure <script src="nav.js"></script> en fin de <body>. La
// fonction s'auto-exécute et remplace le premier <nav> de la page.
//
// Si la page utilise déjà window._sb (Supabase client), le script lit la
// session et le plan automatiquement. Sinon état anon par défaut.

(function () {
  'use strict';

  // ── Styles injectés (scope navbar) ──────────────────────────────────────
  const css = `
    nav.fv-nav{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:0 32px;height:56px;background:linear-gradient(180deg,rgba(12,14,10,.94) 0%,rgba(8,9,9,.92) 100%);backdrop-filter:blur(12px);border-bottom:1px solid rgba(184,255,87,.15);box-shadow:0 1px 0 rgba(184,255,87,.08),0 4px 24px rgba(0,0,0,.3)}
    nav.fv-nav .logo{font-family:'Anton',sans-serif;font-size:20px;letter-spacing:.04em;text-decoration:none;color:#e8eaea;transition:text-shadow .2s}
    nav.fv-nav .logo:hover{text-shadow:0 0 18px rgba(184,255,87,.4)}
    nav.fv-nav .logo-accent{color:#b8ff57;text-shadow:0 0 12px rgba(184,255,87,.3)}
    nav.fv-nav .fv-sections{display:flex;align-items:center;gap:2px}
    nav.fv-nav .fv-section{position:relative}
    nav.fv-nav .fv-section-btn{background:none;border:none;cursor:pointer;font-family:'Space Mono',monospace;font-size:11px;font-weight:700;color:#a8b0b0;text-transform:uppercase;letter-spacing:.09em;padding:8px 14px;border-radius:6px;transition:all .18s;display:flex;align-items:center;gap:5px;position:relative}
    nav.fv-nav .fv-section-btn::after{content:'';position:absolute;bottom:-3px;left:50%;transform:translateX(-50%) scaleX(0);width:60%;height:2px;background:#b8ff57;border-radius:2px;transition:transform .2s;box-shadow:0 0 8px rgba(184,255,87,.6)}
    nav.fv-nav .fv-section-btn:hover{color:#b8ff57;background:rgba(184,255,87,.06)}
    nav.fv-nav .fv-section-btn.active{color:#b8ff57}
    nav.fv-nav .fv-section-btn.active::after{transform:translateX(-50%) scaleX(1)}
    nav.fv-nav .fv-section-btn .chevron{width:10px;height:10px;transition:transform .2s;opacity:.7}
    nav.fv-nav .fv-section.open .fv-section-btn{color:#b8ff57;background:rgba(184,255,87,.06)}
    nav.fv-nav .fv-section.open .fv-section-btn .chevron{transform:rotate(180deg);opacity:1}
    nav.fv-nav .fv-dropdown{position:absolute;top:calc(100% + 6px);left:0;min-width:240px;background:linear-gradient(180deg,#111313 0%,#0d0e0e 100%);border:1px solid rgba(184,255,87,.18);border-top:2px solid #b8ff57;border-radius:8px;padding:6px;opacity:0;visibility:hidden;transform:translateY(-4px);transition:all .18s;box-shadow:0 12px 32px rgba(0,0,0,.6),0 0 0 1px rgba(184,255,87,.04)}
    nav.fv-nav .fv-section.open .fv-dropdown{opacity:1;visibility:visible;transform:translateY(0)}
    nav.fv-nav .fv-dropdown a{display:flex;align-items:center;gap:10px;padding:10px 12px;font-family:'Space Mono',monospace;font-size:12px;color:#d8dcdc;text-decoration:none;border-radius:6px;transition:all .15s}
    nav.fv-nav .fv-dropdown a:hover{background:rgba(184,255,87,.1);color:#b8ff57;padding-left:14px}
    nav.fv-nav .fv-badge{font-size:8px;font-family:'Space Mono',monospace;font-weight:700;padding:2px 6px;border-radius:40px;letter-spacing:.08em;margin-left:auto}
    nav.fv-nav .fv-badge.pro{background:linear-gradient(135deg,#b8ff57,#7ddd1a);color:#000;box-shadow:0 0 8px rgba(184,255,87,.3)}
    nav.fv-nav .fv-badge.elite{background:linear-gradient(135deg,#f5c842,#d4a52a);color:#000;box-shadow:0 0 8px rgba(245,200,66,.3)}
    nav.fv-nav .fv-badge.soon{background:rgba(184,255,87,.08);color:#b8ff57;border:1px solid rgba(184,255,87,.25);box-shadow:none}
    nav.fv-nav .fv-right{display:flex;align-items:center;gap:10px}
    nav.fv-nav .fv-login{font-family:'Space Mono',monospace;font-size:11px;font-weight:700;color:#a8b0b0;text-decoration:none;text-transform:uppercase;letter-spacing:.09em;padding:8px 14px;border-radius:6px;transition:all .18s}
    nav.fv-nav .fv-login:hover{color:#b8ff57;background:rgba(184,255,87,.06)}
    nav.fv-nav .fv-lang{background:transparent;color:#a8b0b0;padding:6px 10px;border-radius:6px;font-family:'Space Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;border:1px solid #1c1e1e;transition:all .15s}
    nav.fv-nav .fv-lang:hover{color:#b8ff57;border-color:rgba(184,255,87,.4)}
    nav.fv-nav .fv-cta{background:#b8ff57;color:#000;padding:8px 18px;border-radius:6px;font-family:'Space Mono',monospace;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;transition:all .18s;box-shadow:0 0 0 0 rgba(184,255,87,.5);position:relative}
    nav.fv-nav .fv-cta:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 4px 20px rgba(184,255,87,.4)}
    nav.fv-nav .fv-account-dot{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#ff8a3d;border:2px solid #080909;animation:fv-dot-pulse 1.8s ease-in-out infinite;display:none}
    @keyframes fv-dot-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,138,61,.5)}50%{box-shadow:0 0 0 6px rgba(255,138,61,0)}}
    @media (max-width: 768px){
      nav.fv-nav{padding:0 16px}
      nav.fv-nav .fv-sections{display:none}
    }
  `;

  const styleTag = document.createElement('style');
  styleTag.textContent = css;
  document.head.appendChild(styleTag);

  // ── Définition des 4 sections ───────────────────────────────────────────
  const sections = [
    {
      key: 'mon-jeu',
      label: 'Mon jeu',
      items: [
        { href: '/dashboard.html', label: 'Aperçu' },
        { href: '/matches.html', label: 'Mes matchs' },
        { href: '/demo.html', label: 'Nouvelle démo' },
        { href: '/scout.html', label: 'Scout', badge: 'pro' },
        { href: '/compare.html', label: 'Comparer' },
      ],
    },
    {
      key: 'progresser',
      label: 'Progresser',
      items: [
        { href: '/levels.html', label: 'Roadmap' },
        { href: '/stats-guide.html', label: 'Guide des stats' },
        { href: '/lineup-library.html', label: 'Lineup library' },
      ],
    },
    {
      key: 'pros',
      label: 'Pros',
      items: [
        { href: '/pro-demos.html', label: 'Pro demos (HLTV)', badge: 'soon' },
        { href: '/pro-benchmarks.html', label: 'Pro benchmarks', badge: 'elite' },
      ],
    },
    {
      key: 'equipe',
      label: 'Équipe',
      items: [
        { href: '/team.html', label: 'Team dashboard', badge: 'elite' },
        { href: '/prep-veto.html', label: 'Prep veto', badge: 'elite' },
        { href: '/anti-strat.html', label: 'Anti-strat', badge: 'elite' },
      ],
    },
  ];

  // ── Détection de la section active depuis l'URL ─────────────────────────
  const path = window.location.pathname.split('/').pop() || 'index.html';
  const activeKey = (() => {
    for (const s of sections) {
      if (s.items.some(it => it.href.endsWith(path))) return s.key;
    }
    return null;
  })();

  // ── Construction du HTML ────────────────────────────────────────────────
  function buildSectionHTML(section) {
    const activeCls = section.key === activeKey ? ' active' : '';
    const badgeLabels = { pro: 'PRO', elite: 'ELITE', soon: 'BIENTÔT' };
    const items = section.items.map(it => {
      const badge = it.badge ? `<span class="fv-badge ${it.badge}">${badgeLabels[it.badge] || it.badge.toUpperCase()}</span>` : '';
      return `<a href="${it.href}">${it.label}${badge}</a>`;
    }).join('');
    return `
      <div class="fv-section" data-key="${section.key}">
        <button class="fv-section-btn${activeCls}" type="button" aria-haspopup="true" aria-expanded="false">
          ${section.label}
          <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="fv-dropdown" role="menu">${items}</div>
      </div>
    `;
  }

  const navHTML = `
    <a href="/index.html" class="logo">Frag<span class="logo-accent">Value</span></a>
    <div class="fv-sections">${sections.map(buildSectionHTML).join('')}</div>
    <div class="fv-right">
      <button class="fv-lang" id="navLangSwitch" type="button" title="Switch language"></button>
      <a href="/pricing.html" class="fv-login">Tarifs</a>
      <a href="/login.html" class="fv-login" id="navLoginBtn">Connexion</a>
      <a href="/account.html#feedback" class="fv-cta" id="navAccountBtn" style="display:none">Mon espace<span class="fv-account-dot" id="navFeedbackDot" title="Tu as une réponse à ton feedback"></span></a>
    </div>
  `;

  // ── Injection dans le <nav> existant (ou création si absent) ────────────
  let navEl = document.querySelector('nav');
  if (!navEl) {
    navEl = document.createElement('nav');
    document.body.insertBefore(navEl, document.body.firstChild);
  }
  navEl.className = 'fv-nav';
  navEl.innerHTML = navHTML;

  // ── Toggle dropdowns (click + outside-close) ────────────────────────────
  navEl.querySelectorAll('.fv-section-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const section = btn.closest('.fv-section');
      const isOpen = section.classList.contains('open');
      navEl.querySelectorAll('.fv-section.open').forEach(s => s.classList.remove('open'));
      navEl.querySelectorAll('.fv-section-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
      if (!isOpen) {
        section.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
  document.addEventListener('click', () => {
    navEl.querySelectorAll('.fv-section.open').forEach(s => s.classList.remove('open'));
    navEl.querySelectorAll('.fv-section-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
  });

  // ── Auth state : check Supabase session via localStorage ────────────────
  // Supabase stocke la session dans localStorage avec une cle `sb-<ref>-auth-token`.
  // On lit directement sans avoir besoin du client SDK (evite de dependre de la
  // page hote d'exposer window._sb).
  function hasSession() {
    try {
      // Prefer existing client if page already created one
      if (window._sb && window._sb.auth) {
        // Best-effort sync check : si la session est en memoire, l'indicateur
        // localStorage existe aussi. On privilegie le check localStorage ci-dessous
        // qui est sync, mais on considere la presence du client comme hint positif.
      }
      // Supabase project ref dans notre URL : xmyruycvvkmcwysfygcq
      const key = 'sb-xmyruycvvkmcwysfygcq-auth-token';
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      // Check expiry
      const expiresAt = parsed?.expires_at || 0;
      if (expiresAt && expiresAt * 1000 < Date.now()) return false;
      return !!parsed?.access_token;
    } catch { return false; }
  }
  function refreshAuth() {
    const loginBtn = document.getElementById('navLoginBtn');
    const accountBtn = document.getElementById('navAccountBtn');
    if (!loginBtn || !accountBtn) return;
    if (hasSession()) {
      loginBtn.style.display = 'none';
      accountBtn.style.display = '';
      checkUnreadFeedback();
    } else {
      loginBtn.style.display = '';
      accountBtn.style.display = 'none';
    }
  }

  // Verifie si l'user a des reponses admin non lues, affiche un dot orange.
  // Lit le meme localStorage 'fv_feedback_seen_v1' que account.html.
  async function checkUnreadFeedback() {
    const dot = document.getElementById('navFeedbackDot');
    if (!dot) return;
    try {
      const raw = localStorage.getItem('sb-xmyruycvvkmcwysfygcq-auth-token');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const token = parsed?.access_token;
      if (!token) return;
      const res = await fetch('/api/feedback?mine=1&limit=50', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) return;
      const d = await res.json();
      let seen;
      try { seen = new Set(JSON.parse(localStorage.getItem('fv_feedback_seen_v1') || '[]')); }
      catch { seen = new Set(); }
      const unread = (d.feedbacks || []).filter(f => f.admin_response && !seen.has(f.id)).length;
      dot.style.display = unread > 0 ? 'block' : 'none';
    } catch {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshAuth);
  } else {
    refreshAuth();
  }
  // Retry si localStorage pas encore ecrit au moment du 1er check (login flow)
  setTimeout(refreshAuth, 300);

  // ── Feedback widget : injection auto sur toutes les pages avec nav.js ──
  // Skip pages admin (l'admin a sa propre vue / ne veut pas se feedback lui-meme)
  if (!/\/admin\//.test(window.location.pathname)) {
    const fbScript = document.createElement('script');
    fbScript.src = '/feedback-widget.js';
    fbScript.defer = true;
    document.head.appendChild(fbScript);
  }

  // ── Switch FR/EN ───────────────────────────────────────────────────────
  // Detecte si on est sur /en/ → bouton affiche FR (cliquer = retour FR)
  // Sinon → bouton affiche EN (cliquer = passer EN)
  // Set cookie fv_lang persistant 1 an pour memoriser le choix.
  const langBtn = document.getElementById('navLangSwitch');
  if (langBtn) {
    const isOnEn = /^\/en\//.test(window.location.pathname);
    langBtn.textContent = isOnEn ? 'FR' : 'EN';
    langBtn.addEventListener('click', () => {
      const newLang = isOnEn ? 'fr' : 'en';
      document.cookie = `fv_lang=${newLang}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      const path = window.location.pathname;
      let target;
      if (isOnEn) {
        // /en/page.html → /page.html
        target = path.replace(/^\/en\//, '/');
      } else {
        // /page.html → /en/page.html
        target = '/en' + (path === '/' ? '/index.html' : path);
      }
      window.location.href = target + window.location.hash;
    });
  }
})();
