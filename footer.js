// footer.js · FragValue · Footer partage entre toutes les pages
//
// Inject le pied de page commun (logo + liens nav + socials + copy) en bas
// du body. Detecte la langue (FR/EN) via document.documentElement.lang ou
// l'URL /en/* (meme pattern que nav.js). Injecte aussi son CSS scope.
//
// Usage : <script src="/footer.js"></script> juste avant </body>.
// Pas de dependance, fonctionne meme si nav.js n'est pas charge.
//
// Pour modifier les liens : edite ce fichier et rebuild i18n
// (node scripts/build-i18n.js) pour propager les versions EN.

(function () {
  'use strict';
  if (window.__fvFooterMounted) return;
  window.__fvFooterMounted = true;

  // ─── Detection langue ────────────────────────────────────────────────────
  const FV_LANG = (document.documentElement.lang === 'en'
                || window.location.pathname.startsWith('/en/')) ? 'en' : 'fr';
  const enPrefix = FV_LANG === 'en' ? '/en' : '';

  // Helper : prefixe les liens internes en /en/ si on est cote anglais
  function link(href) {
    if (!href || href.startsWith('mailto:') || href.startsWith('http')
        || href.startsWith('#')) return href;
    // Pages traduites par build-i18n.js (cf. scripts/build-i18n.js).
    // /blog.html n'est pas traduit -> on garde l'original.
    const isTranslated = !href.includes('/blog.html');
    return isTranslated ? enPrefix + href : href;
  }

  // ─── Textes FR / EN ──────────────────────────────────────────────────────
  const T_FR = {
    monJeu: 'Mon jeu',
    progresser: 'Progresser',
    scout: 'Scout',
    comparer: 'Comparer',
    lineups: 'Lineups',
    guideStats: 'Guide stats',
    astuces: 'Astuces',
    commentCaMarche: 'Comment ca marche',
    tarifs: 'Tarifs',
    fragvalueVsLeetify: 'FragValue vs Leetify',
    cgv: 'CGV',
    mentionsLegales: 'Mentions legales',
    confidentialite: 'Confidentialite',
    cookies: 'Cookies',
    contact: 'Contact',
    planDuSite: 'Plan du site',
    madeIn: 'Made in France',
  };
  const T_EN = {
    monJeu: 'My game',
    progresser: 'Improve',
    scout: 'Scout',
    comparer: 'Compare',
    lineups: 'Lineups',
    guideStats: 'Stats guide',
    astuces: 'Tips',
    commentCaMarche: 'How it works',
    tarifs: 'Pricing',
    fragvalueVsLeetify: 'FragValue vs Leetify',
    cgv: 'Terms',
    mentionsLegales: 'Legal',
    confidentialite: 'Privacy',
    cookies: 'Cookies',
    contact: 'Contact',
    planDuSite: 'Sitemap',
    madeIn: 'Made in France',
  };
  const T = FV_LANG === 'en' ? T_EN : T_FR;

  // ─── CSS ─────────────────────────────────────────────────────────────────
  const css = `
.fv-footer{
  border-top:1px solid var(--border, #2a2f3a);
  padding:48px 32px 32px;
  margin-top:64px;
  display:flex;flex-direction:column;align-items:center;gap:18px;
  text-align:center;
  font-family:var(--mono, 'DM Mono', monospace);
}
.fv-footer-logo{
  font-family:var(--display, 'Anton', sans-serif);
  font-size:18px;color:var(--text2, #a0a4ad);letter-spacing:.04em
}
.fv-footer-logo span{color:var(--accent, #b8ff57)}
.fv-footer-links{
  display:flex;flex-wrap:wrap;justify-content:center;align-items:center;
  gap:10px 22px;max-width:1100px
}
.fv-footer-links a{
  font-size:11px;color:var(--text3, #6b7180);text-decoration:none;
  letter-spacing:.06em;transition:color .15s;white-space:nowrap;padding:4px 0
}
.fv-footer-links a:visited{color:var(--text3, #6b7180)}
.fv-footer-links a:hover{color:var(--accent, #b8ff57)}
.fv-footer-copy{
  font-size:11px;color:var(--text3, #6b7180);letter-spacing:.04em;margin-top:4px
}
.fv-footer-copy a{color:inherit;text-decoration:none;border-bottom:1px dotted currentColor}
.fv-footer-copy a:hover{color:var(--accent, #b8ff57)}
.fv-footer-socials{
  display:flex;align-items:center;justify-content:center;gap:14px;margin:6px 0
}
.fv-footer-socials a{
  color:var(--text3, #6b7180);transition:color .15s;text-decoration:none;
  display:inline-flex;align-items:center;justify-content:center
}
.fv-footer-socials a:hover[data-color="discord"]{color:#5865F2}
.fv-footer-socials a:hover[data-color="tiktok"]{color:var(--accent, #b8ff57)}
.fv-footer-socials a:hover[data-color="x"]{color:#fff}
@media(max-width:640px){
  .fv-footer{padding:36px 20px 24px;gap:14px;margin-top:48px}
  .fv-footer-logo{font-size:14px}
  .fv-footer-links{gap:8px 16px}
  .fv-footer-links a{font-size:11px;padding:4px 0}
  .fv-footer-copy{font-size:10px;opacity:.85}
}
`;

  // ─── HTML ────────────────────────────────────────────────────────────────
  const html = `
<footer class="fv-footer">
  <div class="fv-footer-logo">Frag<span>Value</span></div>
  <div class="fv-footer-links">
    <a href="${link('/dashboard.html')}">${T.monJeu}</a>
    <a href="${link('/levels.html')}">${T.progresser}</a>
    <a href="${link('/scout.html')}">${T.scout}</a>
    <a href="${link('/compare.html')}">${T.comparer}</a>
    <a href="${link('/lineup-library.html')}">${T.lineups}</a>
    <a href="${link('/stats-guide.html')}">${T.guideStats}</a>
    <a href="${link('/astuces.html')}">${T.astuces}</a>
    <a href="${link('/how-it-works.html')}">${T.commentCaMarche}</a>
    <a href="${link('/pricing.html')}">${T.tarifs}</a>
    <a href="${link('/compare-outils.html')}">${T.fragvalueVsLeetify}</a>
    <a href="${link('/cgv.html')}">${T.cgv}</a>
    <a href="${link('/mentions-legales.html')}">${T.mentionsLegales}</a>
    <a href="${link('/privacy.html')}">${T.confidentialite}</a>
    <a href="#" onclick="if(typeof window.fvOpenCookies==='function'){window.fvOpenCookies()}else{alert('Pour modifier tes preferences cookies, rafraichis la page.')};return false;">${T.cookies}</a>
    <a href="mailto:contact@fragvalue.com">${T.contact}</a>
  </div>
  <div class="fv-footer-socials">
    <a href="https://discord.gg/fragvalue" target="_blank" rel="noopener" data-color="discord" title="Discord FragValue" aria-label="Discord">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
    </a>
    <a href="https://www.tiktok.com/@fragvalue" target="_blank" rel="noopener" data-color="tiktok" title="TikTok FragValue" aria-label="TikTok">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.589 6.686a4.793 4.793 0 0 1-3.77-4.245V2h-3.445v13.672a2.896 2.896 0 0 1-5.201 1.743l-.002-.001.002.001a2.895 2.895 0 0 1 3.183-4.51v-3.5a6.329 6.329 0 0 0-5.394 10.692 6.33 6.33 0 0 0 10.857-4.424V8.687a8.182 8.182 0 0 0 4.773 1.526V6.79a4.831 4.831 0 0 1-1.003-.104z"/></svg>
    </a>
    <a href="https://x.com/fragvaluegg" target="_blank" rel="noopener" data-color="x" title="X (Twitter)" aria-label="X">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
    </a>
  </div>
  <div class="fv-footer-copy">&copy; 2026 FragValue &middot; <a href="${link('/sitemap.html')}">${T.planDuSite}</a> &middot; ${T.madeIn}</div>
</footer>
`;

  // ─── Injection ───────────────────────────────────────────────────────────
  function mount() {
    // Skip si la page a deja un <footer> manuel (ex: index.html, pricing.html)
    // pour eviter la duplication. On ne cherche que les footers DIRECTS du body.
    const existing = document.querySelector('body > footer');
    if (existing) return;

    // Injecte le CSS dans <head> une seule fois
    if (!document.getElementById('fv-footer-style')) {
      const style = document.createElement('style');
      style.id = 'fv-footer-style';
      style.textContent = css;
      document.head.appendChild(style);
    }

    // Injecte le footer juste avant </body>
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    document.body.appendChild(tpl.content.firstChild);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
