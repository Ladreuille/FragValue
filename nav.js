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

  // ── Styles injectés (scope navbar + global focus-visible pour A11y) ──
  const css = `
    /* Global focus-visible : bordure accent verte visible au clavier sur
       tous les elements interactifs. Les inputs/boutons qui ont "outline:none"
       sur :focus restent desactives pour la souris, mais le clavier garde
       un anneau de focus visible via :focus-visible (spec WCAG AA). */
    :focus-visible{outline:2px solid #b8ff57 !important;outline-offset:2px !important;border-radius:4px}
    button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,[role="button"]:focus-visible,[tabindex]:focus-visible{outline:2px solid #b8ff57 !important;outline-offset:2px !important}

    /* Skip-to-content link : visible uniquement au focus clavier (Tab au load).
       Permet aux users keyboard/screen reader de sauter la nav et aller direct
       au contenu principal. Pattern WCAG 2.4.1 Bypass Blocks. */
    .fv-skip-link{position:absolute;top:-40px;left:8px;z-index:10001;background:#b8ff57;color:#000;padding:8px 14px;border-radius:6px;font-family:'Space Mono',monospace;font-size:12px;font-weight:700;text-decoration:none;transition:top .15s;letter-spacing:.04em}
    .fv-skip-link:focus{top:8px;outline:2px solid #080909;outline-offset:2px}

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
    nav.fv-nav .fv-cta{background:#b8ff57;color:#000;padding:8px 18px;border-radius:6px;font-family:'Space Mono',monospace;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;transition:all .18s;box-shadow:0 0 0 0 rgba(184,255,87,.5);position:relative}
    nav.fv-nav .fv-cta:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 4px 20px rgba(184,255,87,.4)}
    nav.fv-nav .fv-account-dot{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#ff8a3d;border:2px solid #080909;animation:fv-dot-pulse 1.8s ease-in-out infinite;display:none}
    @keyframes fv-dot-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,138,61,.5)}50%{box-shadow:0 0 0 6px rgba(255,138,61,0)}}

    /* ── Bell notifications ───────────────────────────────────────── */
    nav.fv-nav .fv-bell{position:relative;background:none;border:none;cursor:pointer;color:#a8b0b0;padding:8px;border-radius:6px;display:flex;align-items:center;justify-content:center;transition:all .18s;width:36px;height:36px}
    nav.fv-nav .fv-bell:hover{color:#b8ff57;background:rgba(184,255,87,.06)}
    nav.fv-nav .fv-bell.open{color:#b8ff57;background:rgba(184,255,87,.08)}
    nav.fv-nav .fv-bell svg{width:18px;height:18px}
    nav.fv-nav .fv-bell-badge{position:absolute;top:2px;right:2px;min-width:16px;height:16px;border-radius:8px;background:#ff8a3d;color:#000;font-family:'Space Mono',monospace;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid rgba(12,14,10,.94);box-shadow:0 0 0 1px #0c0e0a}

    /* ── Notifications dropdown panel ─────────────────────────────── */
    .fv-notif-panel{position:fixed;top:60px;right:20px;width:min(380px,92vw);max-height:70vh;background:linear-gradient(180deg,#111313 0%,#0d0e0e 100%);border:1px solid rgba(184,255,87,.18);border-top:2px solid #b8ff57;border-radius:8px;padding:0;opacity:0;visibility:hidden;transform:translateY(-8px);transition:all .2s;box-shadow:0 12px 32px rgba(0,0,0,.7),0 0 0 1px rgba(184,255,87,.04);z-index:10000;display:flex;flex-direction:column;overflow:hidden}
    .fv-notif-panel.open{opacity:1;visibility:visible;transform:translateY(0)}
    .fv-notif-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(184,255,87,.1);flex-shrink:0}
    .fv-notif-title{font-family:'Anton',sans-serif;font-size:14px;color:#e8eaea;letter-spacing:.06em}
    .fv-notif-actions{display:flex;gap:10px;align-items:center}
    .fv-notif-action{background:none;border:none;color:#7a8080;font-family:'Space Mono',monospace;font-size:10px;font-weight:700;cursor:pointer;letter-spacing:.06em;text-transform:uppercase;transition:color .15s;padding:4px 2px}
    .fv-notif-action:hover{color:#b8ff57}
    .fv-notif-action:disabled{opacity:.4;cursor:not-allowed}
    .fv-notif-list{overflow-y:auto;flex:1;padding:4px 0}
    .fv-notif-item{display:flex;align-items:flex-start;gap:12px;padding:12px 16px;cursor:pointer;transition:background .15s;border-bottom:1px solid rgba(28,30,30,.6);position:relative;background:none;border-left:none;border-right:none;border-top:none;width:100%;text-align:left;color:inherit;font:inherit}
    .fv-notif-item:hover{background:rgba(184,255,87,.04)}
    .fv-notif-item.unread{background:rgba(184,255,87,.02)}
    .fv-notif-item.unread::before{content:'';position:absolute;left:4px;top:18px;width:4px;height:4px;border-radius:50%;background:#b8ff57;box-shadow:0 0 4px rgba(184,255,87,.5)}
    .fv-notif-icon{flex-shrink:0;width:32px;height:32px;border-radius:6px;background:rgba(184,255,87,.08);border:1px solid rgba(184,255,87,.2);color:#b8ff57;display:flex;align-items:center;justify-content:center}
    .fv-notif-icon svg{width:15px;height:15px}
    .fv-notif-body{flex:1;min-width:0}
    .fv-notif-item-title{font-family:'Space Mono',monospace;font-size:12px;font-weight:700;color:#e8eaea;margin-bottom:3px;line-height:1.35;letter-spacing:.01em}
    .fv-notif-item-msg{font-family:'Space Mono',monospace;font-size:11px;color:#a8b0b0;line-height:1.45;margin-bottom:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
    .fv-notif-item-time{font-family:'Space Mono',monospace;font-size:9px;color:#7a8080;letter-spacing:.04em}
    .fv-notif-empty{padding:40px 20px;text-align:center;color:#7a8080;font-family:'Space Mono',monospace;font-size:12px}
    .fv-notif-footer{padding:10px 16px;border-top:1px solid rgba(184,255,87,.1);text-align:center;flex-shrink:0}
    .fv-notif-footer a{font-family:'Space Mono',monospace;font-size:10px;color:#7a8080;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;font-weight:700}
    .fv-notif-footer a:hover{color:#b8ff57}

    @media(max-width:640px){
      .fv-notif-panel{top:60px;right:10px;left:10px;width:auto}
    }

    /* ── Mobile burger (hidden on desktop) ──────────────────────────── */
    nav.fv-nav .fv-burger{display:none;background:none;border:1px solid rgba(184,255,87,.2);border-radius:6px;width:40px;height:40px;align-items:center;justify-content:center;cursor:pointer;transition:all .18s;padding:0}
    nav.fv-nav .fv-burger:hover{border-color:rgba(184,255,87,.4);background:rgba(184,255,87,.06)}
    nav.fv-nav .fv-burger:focus-visible{outline:2px solid #b8ff57;outline-offset:2px}
    nav.fv-nav .fv-burger svg{width:20px;height:20px;color:#e8eaea}
    nav.fv-nav .fv-burger[aria-expanded="true"] svg{color:#b8ff57}

    /* ── Mobile drawer (full overlay from right) ────────────────────── */
    .fv-mobile-drawer{position:fixed;top:0;right:0;bottom:0;width:min(320px,85vw);background:linear-gradient(180deg,#0f1010 0%,#0a0c0c 100%);border-left:1px solid rgba(184,255,87,.18);box-shadow:-12px 0 32px rgba(0,0,0,.6);z-index:9999;transform:translateX(100%);transition:transform .25s ease;overflow-y:auto;display:flex;flex-direction:column;padding:72px 20px 32px}
    .fv-mobile-drawer.open{transform:translateX(0)}
    .fv-mobile-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);z-index:9998;opacity:0;visibility:hidden;transition:all .25s}
    .fv-mobile-backdrop.open{opacity:1;visibility:visible}
    .fv-mobile-close{position:absolute;top:18px;right:18px;width:36px;height:36px;background:none;border:1px solid rgba(184,255,87,.2);border-radius:6px;color:#e8eaea;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
    .fv-mobile-close:hover{border-color:rgba(184,255,87,.4);color:#b8ff57}
    .fv-mobile-close:focus-visible{outline:2px solid #b8ff57;outline-offset:2px}
    .fv-mobile-close svg{width:18px;height:18px}
    .fv-mobile-drawer .fv-mobile-section{margin-bottom:20px}
    .fv-mobile-drawer .fv-mobile-section-label{font-family:'Anton',sans-serif;font-size:11px;color:#b8ff57;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px 4px;opacity:.8}
    .fv-mobile-drawer .fv-mobile-link{display:flex;align-items:center;gap:10px;padding:12px 14px;font-family:'Space Mono',monospace;font-size:13px;color:#d8dcdc;text-decoration:none;border-radius:6px;transition:all .15s;border:1px solid transparent}
    .fv-mobile-drawer .fv-mobile-link:hover,.fv-mobile-drawer .fv-mobile-link:focus-visible{background:rgba(184,255,87,.08);color:#b8ff57;border-color:rgba(184,255,87,.18);outline:none}
    .fv-mobile-drawer .fv-mobile-link.active{color:#b8ff57;background:rgba(184,255,87,.06)}
    .fv-mobile-drawer .fv-mobile-divider{height:1px;background:rgba(184,255,87,.1);margin:16px 4px}
    .fv-mobile-drawer .fv-mobile-cta{display:flex;align-items:center;justify-content:center;gap:8px;padding:14px;background:#b8ff57;color:#000;text-decoration:none;border-radius:6px;font-family:'Space Mono',monospace;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin-top:8px}
    .fv-mobile-drawer .fv-mobile-cta:hover{filter:brightness(1.08)}

    body.fv-drawer-open{overflow:hidden}

    @media (max-width: 768px){
      nav.fv-nav{padding:0 16px}
      nav.fv-nav .fv-sections{display:none}
      /* On masque les liens Tarifs/Connexion/Mon espace sur mobile mais on
         garde la cloche visible (accessible via .fv-right qui reste flex). */
      nav.fv-nav .fv-right .fv-login,
      nav.fv-nav .fv-right .fv-cta{display:none !important}
      nav.fv-nav .fv-right{gap:4px}
      nav.fv-nav .fv-burger{display:flex}
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
        { href: '/blog.html', label: 'Blog' },
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
      <a href="/pricing.html" class="fv-login">Tarifs</a>
      <button class="fv-bell" id="navBellBtn" type="button" aria-label="Notifications" aria-haspopup="true" aria-expanded="false" style="display:none">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        <span class="fv-bell-badge" id="navBellBadge" style="display:none">0</span>
      </button>
      <a href="/login.html" class="fv-login" id="navLoginBtn">Connexion</a>
      <a href="/account.html#feedback" class="fv-cta" id="navAccountBtn" style="display:none">Mon espace<span class="fv-account-dot" id="navFeedbackDot" title="Tu as une réponse à ton feedback"></span></a>
    </div>
    <button class="fv-burger" type="button" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="fvMobileDrawer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="7" x2="21" y2="7"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="17" x2="21" y2="17"/></svg>
    </button>
  `;

  // ── Skip-to-content link (a11y WCAG 2.4.1) ─────────────────────────────
  // Injecte un lien invisible au load, qui apparait au 1er Tab pour sauter
  // la nav. Cherche #main, fallback sur le 1er <main>, fallback sur body.
  if (!document.getElementById('fv-skip-link')) {
    const skip = document.createElement('a');
    skip.id = 'fv-skip-link';
    skip.className = 'fv-skip-link';
    skip.href = '#main-content';
    skip.textContent = 'Aller au contenu principal';
    document.body.insertBefore(skip, document.body.firstChild);
    // Au click, cible le <main> ou le 1er h1 et lui donne le focus programmatique
    skip.addEventListener('click', e => {
      e.preventDefault();
      const target = document.querySelector('main, #main-content, h1') || document.body;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

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

  // ── Mobile drawer ──────────────────────────────────────────────────────
  // Construit le drawer mobile avec toutes les sections + Tarifs/Connexion/Mon espace.
  // Injecté dans document.body pour éviter tout conflit de stacking context avec la nav.
  function buildMobileDrawer() {
    const badgeLabels = { pro: 'PRO', elite: 'ELITE', soon: 'BIENTÔT' };
    const sectionsHTML = sections.map(s => {
      const links = s.items.map(it => {
        const activeCls = it.href.endsWith(path) ? ' active' : '';
        const badge = it.badge ? `<span class="fv-badge ${it.badge}" style="margin-left:auto">${badgeLabels[it.badge] || it.badge.toUpperCase()}</span>` : '';
        return `<a href="${it.href}" class="fv-mobile-link${activeCls}">${it.label}${badge}</a>`;
      }).join('');
      return `<div class="fv-mobile-section"><div class="fv-mobile-section-label">${s.label}</div>${links}</div>`;
    }).join('');

    const drawer = document.createElement('div');
    drawer.className = 'fv-mobile-drawer';
    drawer.id = 'fvMobileDrawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Menu principal');
    drawer.innerHTML = `
      <button class="fv-mobile-close" type="button" aria-label="Fermer le menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
      ${sectionsHTML}
      <div class="fv-mobile-divider"></div>
      <a href="/pricing.html" class="fv-mobile-link">Tarifs</a>
      <a href="/login.html" class="fv-mobile-link" id="navMobileLoginBtn">Connexion</a>
      <a href="/account.html#feedback" class="fv-mobile-cta" id="navMobileAccountBtn" style="display:none">Mon espace</a>
    `;

    const backdrop = document.createElement('div');
    backdrop.className = 'fv-mobile-backdrop';

    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);

    const burger = navEl.querySelector('.fv-burger');
    const closeBtn = drawer.querySelector('.fv-mobile-close');

    function openDrawer() {
      drawer.classList.add('open');
      backdrop.classList.add('open');
      document.body.classList.add('fv-drawer-open');
      burger.setAttribute('aria-expanded', 'true');
      // Focus le bouton fermer pour les users clavier
      setTimeout(() => closeBtn.focus(), 100);
    }
    function closeDrawer() {
      drawer.classList.remove('open');
      backdrop.classList.remove('open');
      document.body.classList.remove('fv-drawer-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.focus();
    }

    burger.addEventListener('click', () => {
      drawer.classList.contains('open') ? closeDrawer() : openDrawer();
    });
    closeBtn.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
    });
  }
  buildMobileDrawer();

  // ── Notifications bell : variable holders (moved up to avoid TDZ) ──────
  // Declarations hoistees ici car refreshAuth() ci-dessous reference notifPanel
  // et les fonctions initNotifs/fetchNotifications/etc. Le reste de la logique
  // notifications (buildPanel, render, polling) est plus bas.
  let notifPanel = null;
  let notifListEl = null;
  let notifMarkAllBtn = null;
  let notifPollTimer = null;

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
    const mobileLoginBtn = document.getElementById('navMobileLoginBtn');
    const mobileAccountBtn = document.getElementById('navMobileAccountBtn');
    const bellBtn = document.getElementById('navBellBtn');
    if (!loginBtn || !accountBtn) return;
    const logged = hasSession();
    loginBtn.style.display = logged ? 'none' : '';
    accountBtn.style.display = logged ? '' : 'none';
    if (mobileLoginBtn) mobileLoginBtn.style.display = logged ? 'none' : '';
    if (mobileAccountBtn) mobileAccountBtn.style.display = logged ? '' : 'none';
    if (bellBtn) bellBtn.style.display = logged ? '' : 'none';
    if (logged) {
      checkUnreadFeedback();
      fetchNotifications();
    } else {
      updateBellBadge(0);
      if (notifPanel && notifPanel.classList.contains('open')) closeNotifPanel();
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

  // ── Notifications bell : logique ───────────────────────────────────────
  // Panel dropdown injecte dans document.body (evite conflit stacking context
  // avec la nav sticky). Polling toutes les 60s quand tab visible + refresh
  // au visibilitychange. Affichage lie au state auth dans refreshAuth().
  // Les 4 let notifPanel/notifListEl/notifMarkAllBtn/notifPollTimer sont
  // declares plus haut pour eviter TDZ quand refreshAuth() est appele sync.

  function getAuthToken() {
    try {
      const raw = localStorage.getItem('sb-xmyruycvvkmcwysfygcq-auth-token');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.access_token || null;
    } catch { return null; }
  }

  // Icones SVG par type. Fallback "info" si type inconnu.
  const NOTIF_ICONS = {
    ticket_created: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    ticket_response: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    match: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    coach: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/></svg>',
    subscription: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
    feature: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  };

  function getNotifIcon(key) {
    return NOTIF_ICONS[key] || NOTIF_ICONS.info;
  }

  function formatRelativeTime(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (!then || isNaN(then)) return '';
    const diff = Date.now() - then;
    if (diff < 0) return 'a l\'instant';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return 'a l\'instant';
    const min = Math.floor(sec / 60);
    if (min < 60) return `il y a ${min} min`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return `il y a ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `il y a ${days} j`;
    return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  }

  function escapeHtmlNotif(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function buildNotifPanel() {
    if (document.getElementById('fvNotifPanel')) return;
    const panel = document.createElement('div');
    panel.id = 'fvNotifPanel';
    panel.className = 'fv-notif-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notifications');
    panel.innerHTML = `
      <div class="fv-notif-header">
        <div class="fv-notif-title">Notifications</div>
        <div class="fv-notif-actions">
          <button class="fv-notif-action" id="fvNotifMarkAll" type="button" disabled>Tout marquer lu</button>
        </div>
      </div>
      <div class="fv-notif-list" id="fvNotifList">
        <div class="fv-notif-empty">Chargement...</div>
      </div>
      <div class="fv-notif-footer">
        <a href="/account.html#feedback">Voir mes tickets</a>
      </div>
    `;
    document.body.appendChild(panel);
    notifPanel = panel;
    notifListEl = panel.querySelector('#fvNotifList');
    notifMarkAllBtn = panel.querySelector('#fvNotifMarkAll');

    notifMarkAllBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (notifMarkAllBtn.disabled) return;
      await markAllNotifsRead();
    });
  }

  function openNotifPanel() {
    const bell = document.getElementById('navBellBtn');
    if (!bell || !notifPanel) return;
    notifPanel.classList.add('open');
    bell.classList.add('open');
    bell.setAttribute('aria-expanded', 'true');
    fetchNotifications(true);
  }
  function closeNotifPanel() {
    const bell = document.getElementById('navBellBtn');
    if (!bell || !notifPanel) return;
    notifPanel.classList.remove('open');
    bell.classList.remove('open');
    bell.setAttribute('aria-expanded', 'false');
  }
  function toggleNotifPanel() {
    if (!notifPanel) return;
    notifPanel.classList.contains('open') ? closeNotifPanel() : openNotifPanel();
  }

  async function fetchNotifications(renderList = false) {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch('/api/notifications?limit=20', { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) return;
      const data = await res.json();
      updateBellBadge(data.unread || 0);
      if (renderList || (notifPanel && notifPanel.classList.contains('open'))) {
        renderNotifList(data.notifications || []);
      }
    } catch {}
  }

  function updateBellBadge(unread) {
    const badge = document.getElementById('navBellBadge');
    if (!badge) return;
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.style.display = '';
      if (notifMarkAllBtn) notifMarkAllBtn.disabled = false;
    } else {
      badge.style.display = 'none';
      if (notifMarkAllBtn) notifMarkAllBtn.disabled = true;
    }
  }

  function renderNotifList(notifs) {
    if (!notifListEl) return;
    if (!notifs.length) {
      notifListEl.innerHTML = '<div class="fv-notif-empty">Pas encore de notification.</div>';
      return;
    }
    notifListEl.innerHTML = notifs.map(n => {
      const unreadCls = !n.read ? ' unread' : '';
      const title = escapeHtmlNotif(n.title || 'Notification');
      const msg = escapeHtmlNotif(n.message || '');
      const time = formatRelativeTime(n.created_at);
      const iconKey = n.icon || n.type || 'info';
      const icon = getNotifIcon(iconKey);
      const url = escapeHtmlNotif(n.action_url || '');
      return `
        <button class="fv-notif-item${unreadCls}" type="button" data-id="${escapeHtmlNotif(n.id)}" data-url="${url}">
          <div class="fv-notif-icon">${icon}</div>
          <div class="fv-notif-body">
            <div class="fv-notif-item-title">${title}</div>
            ${msg ? `<div class="fv-notif-item-msg">${msg}</div>` : ''}
            <div class="fv-notif-item-time">${time}</div>
          </div>
        </button>
      `;
    }).join('');
    notifListEl.querySelectorAll('.fv-notif-item').forEach(el => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-id');
        const url = el.getAttribute('data-url');
        if (el.classList.contains('unread')) {
          el.classList.remove('unread');
          markNotifsRead([id]);
        }
        if (url) {
          // Si url == page courante, juste fermer + rafraichir auth (pour hash scroll)
          closeNotifPanel();
          window.location.href = url;
        }
      });
    });
  }

  async function markNotifsRead(ids) {
    const token = getAuthToken();
    if (!token || !ids || !ids.length) return;
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      fetchNotifications();
    } catch {}
  }

  async function markAllNotifsRead() {
    const token = getAuthToken();
    if (!token) return;
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      // Enleve visuellement tous les .unread dans la liste courante
      if (notifListEl) {
        notifListEl.querySelectorAll('.fv-notif-item.unread').forEach(el => el.classList.remove('unread'));
      }
      updateBellBadge(0);
    } catch {}
  }

  function initNotifs() {
    const bell = document.getElementById('navBellBtn');
    if (!bell) return;
    buildNotifPanel();
    bell.addEventListener('click', e => {
      e.stopPropagation();
      toggleNotifPanel();
    });
    // Stop propagation sur le panel pour ne pas fermer au click interne
    if (notifPanel) {
      notifPanel.addEventListener('click', e => e.stopPropagation());
    }
    // Click outside ferme
    document.addEventListener('click', () => {
      if (notifPanel && notifPanel.classList.contains('open')) closeNotifPanel();
    });
    // Escape ferme
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && notifPanel && notifPanel.classList.contains('open')) closeNotifPanel();
    });
    // Poll 60s en tab visible
    if (notifPollTimer) clearInterval(notifPollTimer);
    notifPollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && hasSession()) {
        fetchNotifications();
      }
    }, 60000);
    // Refresh immediat au retour de tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && hasSession()) {
        fetchNotifications();
      }
    });
  }
  initNotifs();

  // ── Feedback widget : injection auto sur toutes les pages avec nav.js ──
  // Skip pages admin (l'admin a sa propre vue / ne veut pas se feedback lui-meme)
  if (!/\/admin\//.test(window.location.pathname)) {
    const fbScript = document.createElement('script');
    fbScript.src = '/feedback-widget.js';
    fbScript.defer = true;
    document.head.appendChild(fbScript);
  }

  // ── Block pinch-zoom sur iOS Safari ───────────────────────────────────
  // iOS Safari 10+ ignore les meta viewport user-scalable=no et minimum-scale=1.
  // Pour vraiment bloquer le zoom-out (qui cree un vide noir a droite), il
  // faut intercepter les gesture events.
  // On garde le double-tap zoom (accessibilite texte) mais on bloque le
  // pinch-zoom qui de toute facon n'est pas utile sur un site responsive.
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
  document.addEventListener('gestureend', e => e.preventDefault(), { passive: false });
  // Prevent double-tap zoom sur les boutons/CTAs pour une UX native-like
  let lastTouchEnd = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      // Double tap detecte : ne le bloque que si c'est sur un bouton/lien
      const target = e.target.closest('button, a, [role="button"]');
      if (target) e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
})();
