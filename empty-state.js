// empty-state.js
// ══════════════════════════════════════════════════════════════════════════
// Composant empty-state global partage entre toutes les pages FragValue.
// Expose window.FV.emptyState({icon, title, message, cta, variant}) qui
// retourne un HTML string a injecter dans un container.
//
// Usage :
//   container.innerHTML = FV.emptyState({
//     icon: 'match', title: 'Aucun match', message: '...',
//     cta: { label: 'Lancer', href: '/demo.html' }
//   });
//
// Les illustrations SVG sont inlinees (pas de requetes reseau). Design :
// fond tres subtil degrade lime, cercle halo anime, icone au centre.
//
// Variants : 'default' (grande), 'compact' (petite, pas d'illustration),
// 'inline' (1 ligne, pour dropdowns/notifs).
// ══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (window.FV && window.FV.emptyState) return; // deja charge

  // ── Icones SVG (60x60 pour default, 24x24 pour compact) ─────────────────
  const ICONS = {
    // Manette + recherche : pas encore de match
    match: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 22h24a8 8 0 0 1 8 8v8a8 8 0 0 1-8 8H20a8 8 0 0 1-8-8v-8a8 8 0 0 1 8-8z"/>
      <line x1="22" y1="32" x2="30" y2="32"/><line x1="26" y1="28" x2="26" y2="36"/>
      <circle cx="40" cy="30" r="1.5" fill="currentColor"/><circle cx="44" cy="34" r="1.5" fill="currentColor"/>
      <circle cx="32" cy="14" r="4"/><line x1="32" y1="18" x2="32" y2="22"/>
    </svg>`,
    // Feedback envelope
    feedback: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="10" y="18" width="44" height="28" rx="3"/>
      <polyline points="10,20 32,34 54,20"/>
      <path d="M14 50l8-8M50 50l-8-8" opacity=".5"/>
    </svg>`,
    // Chart + loupe : analyse vide
    chart: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="10" y="14" width="36" height="32" rx="3"/>
      <polyline points="16,38 22,30 28,34 34,24 40,28"/>
      <circle cx="48" cy="44" r="6"/><line x1="52.5" y1="48.5" x2="56" y2="52"/>
    </svg>`,
    // Deux joueurs : compare
    compare: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="20" cy="22" r="6"/><path d="M8 44c0-6.6 5.4-12 12-12s12 5.4 12 12"/>
      <circle cx="44" cy="22" r="6"/><path d="M32 44c0-6.6 5.4-12 12-12s12 5.4 12 12"/>
      <line x1="32" y1="14" x2="32" y2="50" stroke-dasharray="2,3" opacity=".5"/>
    </svg>`,
    // Bell : notifications
    bell: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 28a12 12 0 0 1 24 0c0 14 6 18 6 18H14s6-4 6-18z"/>
      <path d="M28 50a4 4 0 0 0 8 0"/>
    </svg>`,
    // Trophy : leaderboard / pros
    trophy: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M24 14h16v14a8 8 0 0 1-16 0V14z"/>
      <path d="M24 18h-6a4 4 0 0 0 0 8h6M40 18h6a4 4 0 0 1 0 8h-6"/>
      <line x1="28" y1="42" x2="36" y2="42"/><line x1="26" y1="50" x2="38" y2="50"/>
      <line x1="32" y1="36" x2="32" y2="42"/>
    </svg>`,
    // Error
    error: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="32" cy="32" r="22"/><line x1="32" y1="22" x2="32" y2="34"/>
      <circle cx="32" cy="42" r="1.5" fill="currentColor"/>
    </svg>`,
    // Loading (spinner like)
    loading: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
      <circle cx="32" cy="32" r="18" opacity=".2"/>
      <path d="M32 14a18 18 0 0 1 18 18"><animateTransform attributeName="transform" type="rotate" from="0 32 32" to="360 32 32" dur="1.2s" repeatCount="indefinite"/></path>
    </svg>`,
    // Search
    search: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="28" cy="28" r="14"/><line x1="38.5" y1="38.5" x2="48" y2="48"/>
    </svg>`,
    // Lock : premium locked
    lock: `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="14" y="28" width="36" height="24" rx="3"/>
      <path d="M22 28v-6a10 10 0 0 1 20 0v6"/>
      <circle cx="32" cy="40" r="2"/><line x1="32" y1="42" x2="32" y2="46"/>
    </svg>`,
  };

  // ── CSS inject une seule fois ───────────────────────────────────────────
  if (!document.getElementById('fv-empty-state-css')) {
    const css = `
      .fv-empty{
        position:relative;
        text-align:center;
        padding:56px 24px;
        background:linear-gradient(180deg, rgba(184,255,87,.015) 0%, transparent 100%);
        border:1px solid rgba(184,255,87,.08);
        border-radius:14px;
        overflow:hidden;
      }
      .fv-empty::before{
        content:'';
        position:absolute;inset:-1px;
        background:
          radial-gradient(circle at 30% 20%, rgba(184,255,87,.04) 0%, transparent 40%),
          radial-gradient(circle at 70% 80%, rgba(184,255,87,.03) 0%, transparent 40%);
        pointer-events:none;
      }
      .fv-empty::after{
        content:'';
        position:absolute;top:0;left:0;right:0;bottom:0;
        background-image:
          linear-gradient(rgba(184,255,87,.025) 1px, transparent 1px),
          linear-gradient(90deg, rgba(184,255,87,.025) 1px, transparent 1px);
        background-size:28px 28px;
        mask-image:radial-gradient(circle at center, rgba(0,0,0,.8) 0%, transparent 60%);
        -webkit-mask-image:radial-gradient(circle at center, rgba(0,0,0,.8) 0%, transparent 60%);
        pointer-events:none;
        opacity:.6;
      }
      .fv-empty > *{position:relative;z-index:1}
      .fv-empty-icon{
        display:inline-flex;align-items:center;justify-content:center;
        width:88px;height:88px;border-radius:50%;
        background:radial-gradient(circle, rgba(184,255,87,.12) 0%, rgba(184,255,87,.02) 70%);
        border:1px solid rgba(184,255,87,.18);
        color:#b8ff57;margin-bottom:20px;
        animation:fv-empty-float 3s ease-in-out infinite;
        box-shadow:0 0 32px rgba(184,255,87,.08), inset 0 0 20px rgba(184,255,87,.04);
      }
      .fv-empty-icon svg{width:44px;height:44px}
      @keyframes fv-empty-float{
        0%,100%{transform:translateY(0)}
        50%{transform:translateY(-4px)}
      }
      .fv-empty-title{
        font-family:'Anton', sans-serif;
        font-size:22px;color:#e8eaea;
        letter-spacing:.04em;text-transform:uppercase;
        margin:0 0 10px 0;
      }
      .fv-empty-msg{
        font-family:'Space Mono', monospace;
        font-size:12px;color:#a8b0b0;
        line-height:1.7;max-width:420px;
        margin:0 auto 20px auto;
      }
      .fv-empty-cta{
        display:inline-flex;align-items:center;gap:8px;
        background:#b8ff57;color:#000;
        padding:10px 20px;border-radius:6px;
        font-family:'Space Mono', monospace;
        font-size:11px;font-weight:700;
        text-transform:uppercase;letter-spacing:.08em;
        text-decoration:none;border:none;cursor:pointer;
        transition:all .18s;
      }
      .fv-empty-cta:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 4px 16px rgba(184,255,87,.3)}
      .fv-empty-cta.secondary{background:transparent;color:#b8ff57;border:1px solid rgba(184,255,87,.35)}
      .fv-empty-cta.secondary:hover{background:rgba(184,255,87,.06);border-color:#b8ff57}
      .fv-empty-hint{
        display:block;margin-top:14px;
        font-family:'Space Mono', monospace;
        font-size:10px;color:#7a8080;letter-spacing:.05em;
      }

      /* Variant compact : 24px icon, inline h/msg */
      .fv-empty.compact{padding:28px 18px;border-radius:10px}
      .fv-empty.compact .fv-empty-icon{width:52px;height:52px;margin-bottom:12px}
      .fv-empty.compact .fv-empty-icon svg{width:24px;height:24px}
      .fv-empty.compact .fv-empty-title{font-size:15px;margin-bottom:6px}
      .fv-empty.compact .fv-empty-msg{font-size:11px;margin-bottom:14px}

      /* Variant inline : tout sur une ligne, pour notif dropdown */
      .fv-empty.inline{padding:18px 16px;border:none;background:none}
      .fv-empty.inline::before, .fv-empty.inline::after{display:none}
      .fv-empty.inline .fv-empty-icon{width:38px;height:38px;margin-bottom:8px}
      .fv-empty.inline .fv-empty-icon svg{width:18px;height:18px}
      .fv-empty.inline .fv-empty-title{font-size:12px;margin-bottom:4px}
      .fv-empty.inline .fv-empty-msg{font-size:10px;margin-bottom:0}
    `;
    const s = document.createElement('style');
    s.id = 'fv-empty-state-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function emptyState(opts) {
    opts = opts || {};
    const variant = opts.variant || 'default';
    const iconKey = opts.icon || 'search';
    const iconSvg = ICONS[iconKey] || ICONS.search;
    const title = esc(opts.title || 'Rien a afficher pour l\'instant');
    const msg = opts.message ? esc(opts.message) : '';
    const hint = opts.hint ? esc(opts.hint) : '';
    let ctaHTML = '';
    if (opts.cta) {
      const secondary = opts.cta.secondary ? ' secondary' : '';
      if (opts.cta.href) {
        ctaHTML = `<a class="fv-empty-cta${secondary}" href="${esc(opts.cta.href)}">${esc(opts.cta.label)}</a>`;
      } else if (opts.cta.onclick) {
        ctaHTML = `<button class="fv-empty-cta${secondary}" type="button" onclick="${esc(opts.cta.onclick)}">${esc(opts.cta.label)}</button>`;
      }
    }
    const variantCls = variant !== 'default' ? ' ' + variant : '';
    return `
      <div class="fv-empty${variantCls}">
        <div class="fv-empty-icon">${iconSvg}</div>
        <h3 class="fv-empty-title">${title}</h3>
        ${msg ? `<p class="fv-empty-msg">${msg}</p>` : ''}
        ${ctaHTML}
        ${hint ? `<span class="fv-empty-hint">${hint}</span>` : ''}
      </div>
    `;
  }

  window.FV = window.FV || {};
  window.FV.emptyState = emptyState;
})();
