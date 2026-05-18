// pro-upsell.js · FragValue
//
// Composant Pro upsell unifie + tracking GA4 sur tous les CTAs "Passer Pro".
//
// 1. Tracking : intercepte les clicks sur les <a href="pricing.html"> ou
//    <a href="/pricing.html"> et fire 'upsell_click' avec context (page,
//    placement). Permet de mesurer quel paywall convertit (analyse vs
//    replay vs progress vs banner).
//
// 2. (Optionnel) Helper FV.upsellBanner({where, headline, valueProps})
//    pour generer une banner standard si la page veut un upsell inline.
//
// Usage : <script defer src="/pro-upsell.js"></script> sur n'importe quelle
// page user-facing. Auto-execute, n'attend pas DOMContentLoaded (delegation
// event sur document).

(function () {
  'use strict';

  if (window.FV?.upsellInit) return;  // deja charge
  window.FV = window.FV || {};
  window.FV.upsellInit = true;

  // ── 1. Tracking delegation : tout click sur un lien pricing fire un event
  // GA4 'upsell_click' avec contexte (page, anchor text, placement closest).
  function getPlacement(el) {
    // Remonte les parents pour trouver un data-upsell-placement, sinon
    // utilise l'ID/className du parent significatif.
    let cur = el;
    for (let i = 0; i < 6 && cur; i++) {
      if (cur.dataset?.upsellPlacement) return cur.dataset.upsellPlacement;
      if (cur.id) return cur.id;
      cur = cur.parentElement;
    }
    return 'unknown';
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href*="pricing.html"]');
    if (!link) return;
    // Skip si link explicitement opt-out (ex: footer)
    if (link.dataset?.noTrack === '1') return;

    const placement = getPlacement(link);
    const anchorText = (link.textContent || '').trim().slice(0, 80);
    const fromPage = location.pathname.replace(/^\//, '') || 'index.html';

    // CRITIQUE : utilise transport_type 'beacon' pour garantir que l'event
    // GA4 part AVANT que la page navigue. Sans ca, sur slow network le
    // beacon est cancel par la navigation et l'event est perdu. C'est le
    // pattern recommande GA4 docs pour les events click-then-navigate.
    try {
      if (typeof window.fvTrack === 'function') {
        window.fvTrack('upsell_click', {
          from_page: fromPage,
          placement,
          anchor_text: anchorText,
          target_url: link.href,
          transport_type: 'beacon',
        });
      } else if (typeof window.gtag === 'function') {
        // Fallback direct gtag si fvTrack n'est pas dispo sur la page
        window.gtag('event', 'upsell_click', {
          from_page: fromPage,
          placement,
          anchor_text: anchorText,
          target_url: link.href,
          transport_type: 'beacon',
        });
      }
    } catch (_) {}
    // Don't prevent default, normal navigation happens
  }, { capture: true });

  // ── 2. Helper : banner inline Pro upsell (optionnel, pour empty states)
  // Usage :
  //   container.innerHTML = FV.upsellBanner({
  //     where: 'analysis_locked',
  //     headline: 'Coach IA en illimite',
  //     valueProps: ['Diagnostic 11 axes', 'Replay 2D', 'Auto-sync FACEIT'],
  //     ctaLabel: 'Passer Pro - 9 EUR/mois',
  //   });
  function upsellBanner({
    where = 'generic',
    headline = 'Debloque ton potentiel Pro',
    subheadline = 'Accede a l\'integralite des outils CS2 analytics.',
    valueProps = ['Coach IA illimite', 'Replay 2D detaille', 'Pro benchmarks live'],
    ctaLabel = 'Passer Pro',
    ctaHref = '/pricing.html',
    secondaryLabel = '',
    secondaryHref = '',
    socialProof = '',
  } = {}) {
    const valuePropsHTML = valueProps.map(vp => `
      <li style="display:flex;align-items:center;gap:8px;padding:4px 0;font-family:'Space Mono',monospace;font-size:11px;color:#e8eaea">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b8ff57" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
        ${vp}
      </li>
    `).join('');

    const secondaryHTML = secondaryLabel ? `
      <a href="${secondaryHref}" style="display:inline-flex;align-items:center;gap:6px;padding:9px 18px;background:transparent;border:1px solid rgba(184,255,87,.3);color:#b8ff57;border-radius:6px;font-family:'Space Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-decoration:none">${secondaryLabel}</a>
    ` : '';

    const socialHTML = socialProof ? `
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.06);font-family:'Space Mono',monospace;font-size:10px;color:#7a8080;letter-spacing:.04em">${socialProof}</div>
    ` : '';

    return `
      <div class="fv-upsell-banner" data-upsell-placement="${where}" style="background:linear-gradient(180deg,rgba(184,255,87,.04) 0%,rgba(184,255,87,.01) 100%);border:1px solid rgba(184,255,87,.25);border-radius:14px;padding:24px 28px;max-width:480px;margin:24px auto;text-align:center">
        <div style="display:inline-flex;background:rgba(184,255,87,.1);border:1px solid rgba(184,255,87,.3);color:#b8ff57;padding:3px 10px;border-radius:40px;font-family:'Space Mono',monospace;font-size:9.5px;font-weight:700;letter-spacing:.1em;margin-bottom:12px">PRO</div>
        <h3 style="font-family:'Anton',sans-serif;font-size:24px;color:#e8eaea;letter-spacing:.02em;margin-bottom:8px">${headline}</h3>
        <p style="font-family:'Space Mono',monospace;font-size:11.5px;color:#7a8080;line-height:1.7;margin-bottom:16px;max-width:380px;margin-left:auto;margin-right:auto">${subheadline}</p>
        <ul style="list-style:none;padding:0;margin:0 0 18px;display:inline-block;text-align:left">${valuePropsHTML}</ul>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
          <a href="${ctaHref}" data-upsell-placement="${where}" style="display:inline-flex;align-items:center;gap:6px;background:#b8ff57;color:#000;padding:10px 22px;border-radius:6px;font-family:'Space Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;transition:all .15s">${ctaLabel}</a>
          ${secondaryHTML}
        </div>
        ${socialHTML}
      </div>
    `;
  }

  window.FV.upsellBanner = upsellBanner;
})();
