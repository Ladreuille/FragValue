// FragValue : Vercel Edge Middleware pour routing FR/EN.
// Pas de framework (pas Next.js), API Web Request/Response standard.
//
// Comportement :
//   - URL deja /en/xxx                              → laisse passer
//   - Bot crawler (ChatGPT, Google, OpenAI, etc.)   → laisse passer (FR canonique)
//   - URL /xxx avec cookie fv_lang=fr               → laisse passer
//   - URL /xxx avec cookie fv_lang=en               → redirect /en/xxx
//   - URL /xxx sans cookie + Accept-Language=en-*   → redirect /en/xxx + set cookie
//   - URL /xxx sinon (FR par defaut)                → laisse passer
//
// Skip API routes, assets, pages user authentifie.
//
// HISTORIQUE FIX 2026-04-30 :
//   Vercel a alerte sur 68 requetes ChatGPT-User qui retournaient 500. Cause :
//   Response.redirect() retourne une Response avec headers IMMUTABLES en Edge
//   runtime, et le code essayait de faire res.headers.set('Set-Cookie', ...)
//   apres -> TypeError silent (catch par le runtime, retour 500). Fix :
//   construction manuelle de la Response avec headers, et try/catch global
//   pour ne JAMAIS crash le middleware (fail-open).

// Pages dont la version EN existe (synchro avec scripts/build-i18n.js PAGES).
// Cf. ultrareview SEO P1 : avant 15 pages -> 18 manquantes etaient pas
// redirigees pour visiteurs EN -> bounce + signal qualite degrade.
// Maintenant : 33 pages (toutes les PAGES de build-i18n.js).
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
  'compare-outils.html',
  // Ajoutees (sync build-i18n) :
  'account.html',
  'dashboard.html',
  'matches.html',
  'scout.html',
  'compare.html',
  'team.html',
  'blog.html',
  'onboarding.html',
  'replay.html',
  'analysis.html',
  'heatmap-results.html',
  'pro-match.html',
  'share.html',
  'extension-auth.html',
  'faceit-callback.html',
  'how-it-works.html',
  'sitemap.html',
  'astuces.html',
  // Audit 2026-05-11
  '404.html',
  'unsubscribed.html',
]);

// User-Agents de bots / crawlers connus. On les laisse passer en FR (canonique)
// pour pas qu'ils indexent des redirects 307 vers /en/* (mauvais pour le SEO).
// Pattern combine, case-insensitive, base sur les bots les plus frequents.
//
// Inclut aussi les bots internes Vercel (vercel-favicon, vercel-screenshot,
// vercel-og-image) qui scannent /favicon.ico et OG images pour le dashboard.
// Sans ce skip, Vercel suit le 307 et fetch /en/index.html au lieu du canonique.
const BOT_UA_PATTERN = /(bot|crawler|spider|crawling|chatgpt|gptbot|openai|anthropic|claude-web|perplexity|cohere|baiduspider|bingbot|googlebot|yandex|duckduckbot|slurp|semrush|ahrefs|mj12bot|facebookexternalhit|whatsapp|linkedinbot|twitterbot|discordbot|slackbot|telegrambot|applebot|petalbot|amazonbot|bytespider|imagesiftbot|datasectorbot|seekport|barkrowler|netestate|exabot|seekport|dotbot|seznambot|naver|mediapartners-google|adsbot|pingdom|uptimerobot|monitor|lighthouse|pagespeed|gtmetrix|webpagetest|headlesschrome|phantomjs|prerender|fetch|curl|wget|httpclient|axios|vercel-|node-fetch|go-http-client|python-requests|java\/|okhttp|postmanruntime|insomnia)/i;

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

// Construction manuelle d'une Response 307 avec headers mutables. Indispensable
// car Response.redirect() retourne une Response immutable en Edge runtime,
// donc res.headers.set() throw silencieusement -> 500 cote Vercel.
function redirect307(targetUrl, extraHeaders) {
  const headers = new Headers({ Location: String(targetUrl) });
  if (extraHeaders) {
    for (const k of Object.keys(extraHeaders)) headers.set(k, extraHeaders[k]);
  }
  return new Response(null, { status: 307, headers });
}

export default function middleware(request) {
  // Try/catch global : si quoi que ce soit throw, on fail-open (laisse passer)
  // plutot que de retourner 500. Mieux vaut servir la mauvaise langue qu'une
  // erreur. console.error permet de voir le probleme dans Vercel logs.
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Skip /en/* (deja route)
    if (pathname.startsWith('/en/') || pathname === '/en') return;

    // Skip les bots/crawlers : on leur sert la version FR canonique pour
    // eviter les redirects 307 sur l'indexation et les loops infinies si
    // un bot ne supporte pas les cookies (cas ChatGPT-User).
    const ua = request.headers.get('user-agent') || '';
    if (ua && BOT_UA_PATTERN.test(ua)) return;

    // Resolve nom de page : "/" -> "index.html", sinon strip leading "/"
    const pageName = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');

    // Skip si page non traduite (account.html, dashboard.html, etc.)
    if (!TRANSLATED_PAGES.has(pageName)) return;

    // Cookie explicite (priorite haute)
    const cookies = parseCookies(request.headers.get('cookie'));
    const langCookie = cookies['fv_lang'];

    if (langCookie === 'fr') return;

    if (langCookie === 'en') {
      const target = new URL('/en/' + pageName, request.url);
      return redirect307(target);
    }

    // Pas de cookie : check Accept-Language
    const accept = (request.headers.get('accept-language') || '').toLowerCase();
    if (!accept) return; // pas d'info -> FR par defaut

    const langs = accept.split(',').map(l => l.trim()).filter(Boolean);
    const firstLang = langs[0] ? langs[0].split(';')[0].split('-')[0] : '';
    const hasFr = langs.some(l => l.startsWith('fr'));

    if (firstLang === 'en' && !hasFr) {
      const target = new URL('/en/' + pageName, request.url);
      return redirect307(target, {
        'Set-Cookie': 'fv_lang=en; Path=/; Max-Age=' + (60 * 60 * 24 * 365) + '; SameSite=Lax',
      });
    }

    // Default : FR (pas de redirect, pas de cookie pour pas surcharger)
    return;
  } catch (e) {
    // Fail-open : on log mais on laisse passer pour pas casser le site.
    // Visible dans Vercel Logs > Edge Functions.
    console.error('[middleware] error, falling through:', e && e.message ? e.message : e);
    return;
  }
}
