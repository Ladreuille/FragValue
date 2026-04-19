// FragValue : Vercel Edge Middleware pour routing FR/EN.
// Pas de framework (pas Next.js), API Web Request/Response standard.
//
// Comportement :
//   - URL deja /en/xxx                              → laisse passer
//   - URL /xxx avec cookie fv_lang=fr               → laisse passer
//   - URL /xxx avec cookie fv_lang=en               → redirect /en/xxx
//   - URL /xxx sans cookie + Accept-Language=en-*   → redirect /en/xxx + set cookie
//   - URL /xxx sinon (FR par defaut)                → laisse passer
//
// Skip API routes, assets, pages user authentifie.

// Pages dont la version EN existe (synchro avec scripts/build-i18n.js PAGES)
const TRANSLATED_PAGES = new Set([
  'index.html',
  'pricing.html',
  'demo.html',
  'login.html',
  'cgv.html',
  'mentions-legales.html',
  'privacy.html',
  'lineup-library.html',
  'pro-demos.html',
  'pro-benchmarks.html',
  'prep-veto.html',
  'anti-strat.html',
  'levels.html',
  'stats-guide.html',
]);

export const config = {
  // Matcher : toutes les routes sauf /api, /admin, /_next, /icons, /maps, /og,
  // et toute URL avec une extension (assets statiques type .css .js .svg).
  matcher: [
    '/((?!api|admin|_next|icons|maps|og|.*\\.[a-z0-9]+$).*)',
    '/',
  ],
};

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = v.join('=');
  }
  return out;
}

export default function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Skip /en/* (deja routé)
  if (pathname.startsWith('/en/') || pathname === '/en') {
    return;
  }

  // Resolve nom de page : "/" → "index.html", sinon strip leading "/"
  const pageName = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');

  // Skip si page non traduite (account.html, dashboard.html, etc.)
  if (!TRANSLATED_PAGES.has(pageName)) {
    return;
  }

  // Cookie explicite (priorité haute)
  const cookies = parseCookies(request.headers.get('cookie'));
  const langCookie = cookies['fv_lang'];

  if (langCookie === 'fr') return;

  if (langCookie === 'en') {
    const target = new URL('/en/' + pageName, request.url);
    return Response.redirect(target, 307);
  }

  // Pas de cookie : check Accept-Language
  const accept = (request.headers.get('accept-language') || '').toLowerCase();
  const langs = accept.split(',').map(l => l.trim());
  const firstLang = langs[0]?.split(';')[0].split('-')[0];
  const hasFr = langs.some(l => l.startsWith('fr'));

  if (firstLang === 'en' && !hasFr) {
    const target = new URL('/en/' + pageName, request.url);
    const res = Response.redirect(target, 307);
    // Set cookie pour ne pas re-detecter à chaque page
    res.headers.set(
      'Set-Cookie',
      'fv_lang=en; Path=/; Max-Age=' + (60 * 60 * 24 * 365) + '; SameSite=Lax'
    );
    return res;
  }

  // Default : FR (pas de redirect, mais on set cookie pour stabiliser)
  return;
}
