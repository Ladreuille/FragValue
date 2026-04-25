#!/usr/bin/env node
/* FragValue : générateur de pages anglaises depuis les pages FR.
 *
 * Principe :
 *   - Les pages HTML restent en FR (zéro modif des fichiers existants requise).
 *   - locales/translations.json contient les paires { "Texte FR": "Text EN" }.
 *   - Pour chaque page listée dans PAGES, on copie de root → /en/, en remplaçant
 *     toutes les occurrences FR par leur traduction EN.
 *   - On ajoute aussi : <html lang="en">, hreflang tags, lang attr sur la page.
 *
 * Usage :
 *   node scripts/build-i18n.js              # build toutes les pages
 *   node scripts/build-i18n.js index.html   # build une seule page
 *
 * Idempotent : peut être re-run autant de fois que nécessaire.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EN_DIR = path.join(ROOT, 'en');
const TRANSLATIONS = path.join(ROOT, 'locales', 'translations.json');

// Liste des pages à traduire (Extended scope = 22 pages)
const PAGES = [
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
  // Pages user-authentifiees (ajoutees Phase 6)
  'account.html',
  'dashboard.html',
  'matches.html',
  'scout.html',
  'compare.html',
  'team.html',
  'blog.html',
  'onboarding.html',
  // Pages techniques + post-analyse (ajoutees Phase 9)
  'replay.html',
  'analysis.html',
  'heatmap-results.html',
  'pro-match.html',
  'share.html',
  'extension-auth.html',
  'faceit-callback.html',
];

// Charge le dictionnaire (objet plat { "fr": "en" })
function loadDictionary() {
  if (!fs.existsSync(TRANSLATIONS)) {
    console.error(`[i18n] Dictionnaire manquant : ${TRANSLATIONS}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(TRANSLATIONS, 'utf8');
  return JSON.parse(raw);
}

// Échappe les regex specials
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Remplace dans le HTML toutes les occurrences FR par EN.
//
// Strategie :
//   - Trie les entrees par longueur DECROISSANTE (longest-first), pour que les
//     phrases completes matchent avant les fragments courts.
//   - Pour les entrees qui sont un MOT UNIQUE court (<=15 chars, pas d'espace,
//     commence par une lettre), on borne avec des word-boundaries Unicode-aware
//     pour empecher le match mid-mot (ex: "Analyse" -> "Analysis" ne doit pas
//     casser "Analyses" en "Analysiss").
//   - Pour chaque entree avec apostrophe, on tente aussi la variante echappee
//     (\') pour matcher les strings JS (ex: desc: 'l\'utility').
function translateHtml(html, dict) {
  const entries = Object.entries(dict).sort((a, b) => b[0].length - a[0].length);
  let out = html;

  // Helper : detecte si un match est a l'interieur d'une string JS '...'.
  // Utile quand l'EN a une apostrophe que le FR n'a pas (ex: "Tu devras"
  // -> "You'll") : il faut alors echapper l'apostrophe EN pour ne pas
  // casser la string JS qui contient le FR.
  function applyContextAware(fr, en) {
    const frEsc = escapeRegex(fr);
    // Pass 1a : si FR est dans une string JS single-quoted ET EN contient '
    // -> remplace avec EN echappe. Detection : le FR est precede par ' et
    // suivi par ' (eventuellement \\'), et EN contient une apostrophe.
    if (en.includes("'") && !fr.includes("'")) {
      // Match FR a l'interieur d'une string JS '...' (heuristique simple :
      // recherche FR avec une ' avant et apres dans la meme ligne).
      const enEscaped = en.replace(/'/g, "\\'");
      // Regex : ' (debut string) puis [contenu sans '] FR [contenu sans ']  '
      // Plus permissif : on cherche ' suivi de chars puis FR puis chars puis '
      // sur la meme ligne (sans nouvelle ligne).
      const ctxRe = new RegExp("(')([^'\\n\\r]*?)" + frEsc + "([^'\\n\\r]*?)(?=')", 'g');
      out = out.replace(ctxRe, function(_, q1, before, after) {
        return q1 + before + enEscaped + after;
      });
    }
    // Pass 1b : remplacement standard (HTML/text)
    const isWordOnly = !/\s/.test(fr) && /^[A-Za-zÀ-ſ]/.test(fr);
    if (isWordOnly && fr.length <= 15) {
      const pattern = '(?<![A-Za-z\\u00C0-\\u017F])' + frEsc + '(?![A-Za-z\\u00C0-\\u017F])';
      out = out.replace(new RegExp(pattern, 'g'), en);
    } else {
      out = out.replace(new RegExp(frEsc, 'g'), en);
    }
    // Pass 2 : variante FR-escapee si FR contient ' (ex: 'l\'utility')
    if (fr.includes("'")) {
      const frEscQ = fr.replace(/'/g, "\\'");
      const enEscQ = en.replace(/'/g, "\\'");
      out = out.replace(new RegExp(escapeRegex(frEscQ), 'g'), enEscQ);
    }
  }

  for (const [fr, en] of entries) {
    if (!fr || fr === en) continue;
    if (fr.startsWith('_')) continue; // section markers, ne rien faire
    applyContextAware(fr, en);
  }

  return out;
}

// Rewrite les liens internes pour pointer vers /en/* quand on est sur la version EN.
// - href="/page.html" → href="/en/page.html" SEULEMENT si page.html est dans PAGES
// - href="page.html" (relatif) : laisse tel quel (résolu auto vers /en/page.html)
// - href="/api/...", "/dashboard.html" (pages non traduites) : laisse tel quel (fallback FR)
// - src="..." (assets js/css/img) : jamais touché
function rewriteInternalLinks(html, pages) {
  let out = html;
  for (const page of pages) {
    // Match href="/page.html" ou href='/page.html' (absolu uniquement)
    const re = new RegExp(`(href=["'])/(${escapeRegex(page)})(["'])`, 'g');
    out = out.replace(re, '$1/en/$2$3');
  }
  return out;
}

// Ajoute / remplace les meta i18n dans le <head>
function addI18nHeaders(html, pageName) {
  let out = html;

  // 1. lang="fr" → lang="en"
  out = out.replace(/<html\s+lang=["']fr["']/i, '<html lang="en"');

  // 2. Canonical : /page.html → https://fragvalue.com/en/page.html
  out = out.replace(
    /<link\s+rel=["']canonical["']\s+href=["']https:\/\/fragvalue\.com\/([^"']+)["']/i,
    `<link rel="canonical" href="https://fragvalue.com/en/$1"`
  );

  // 3. Inject hreflang juste apres la canonical (si pas deja la)
  if (!/hreflang=["']en["']/i.test(out)) {
    const hreflangBlock = `
  <link rel="alternate" hreflang="fr" href="https://fragvalue.com/${pageName}">
  <link rel="alternate" hreflang="en" href="https://fragvalue.com/en/${pageName}">
  <link rel="alternate" hreflang="x-default" href="https://fragvalue.com/${pageName}">`;
    out = out.replace(
      /(<link\s+rel=["']canonical["'][^>]*>)/i,
      `$1${hreflangBlock}`
    );
  }

  // 4. og:locale fr_FR → en_US
  if (/<meta\s+property=["']og:locale["']/i.test(out)) {
    out = out.replace(
      /(<meta\s+property=["']og:locale["']\s+content=["'])fr_FR(["'])/i,
      '$1en_US$2'
    );
  } else {
    // ajoute si absent
    out = out.replace(
      /(<meta\s+property=["']og:type["'][^>]*>)/i,
      `$1\n  <meta property="og:locale" content="en_US">`
    );
  }

  // 5. og:url : ajouter /en/
  out = out.replace(
    /(<meta\s+property=["']og:url["']\s+content=["'])https:\/\/fragvalue\.com\/([^"']+)(["'])/i,
    `$1https://fragvalue.com/en/$2$3`
  );

  return out;
}

// Inverse aussi : ajoute hreflang au fichier FR original pour SEO bilingue.
// Idempotent : ne touche pas si déjà présent.
function injectHreflangInFrSource(pageName) {
  const frPath = path.join(ROOT, pageName);
  if (!fs.existsSync(frPath)) return;
  let html = fs.readFileSync(frPath, 'utf8');
  if (/hreflang=["']en["']/i.test(html)) return; // déjà fait

  const hreflangBlock = `
  <link rel="alternate" hreflang="fr" href="https://fragvalue.com/${pageName}">
  <link rel="alternate" hreflang="en" href="https://fragvalue.com/en/${pageName}">
  <link rel="alternate" hreflang="x-default" href="https://fragvalue.com/${pageName}">`;

  if (/<link\s+rel=["']canonical["']/i.test(html)) {
    html = html.replace(
      /(<link\s+rel=["']canonical["'][^>]*>)/i,
      `$1${hreflangBlock}`
    );
    fs.writeFileSync(frPath, html);
    console.log(`  + hreflang injecté dans ${pageName} (FR)`);
  }
}

function buildPage(pageName, dict) {
  const srcPath = path.join(ROOT, pageName);
  const dstPath = path.join(EN_DIR, pageName);

  if (!fs.existsSync(srcPath)) {
    console.warn(`  [skip] ${pageName} : source introuvable`);
    return;
  }

  const src = fs.readFileSync(srcPath, 'utf8');

  // 1. Traduit le contenu
  let translated = translateHtml(src, dict);

  // 2. Rewrite les liens internes (href absolus → /en/...)
  translated = rewriteInternalLinks(translated, PAGES);

  // 3. Ajoute les meta i18n
  translated = addI18nHeaders(translated, pageName);

  // 4. Ecrit le fichier
  fs.writeFileSync(dstPath, translated);
  console.log(`  ✓ ${pageName} -> en/${pageName} (${translated.length} chars)`);

  // 4. Inject hreflang dans la version FR (pour SEO bilingue cross-references)
  injectHreflangInFrSource(pageName);
}

function main() {
  const dict = loadDictionary();
  console.log(`[i18n] Dictionnaire chargé : ${Object.keys(dict).length} entrées`);

  if (!fs.existsSync(EN_DIR)) {
    fs.mkdirSync(EN_DIR, { recursive: true });
  }

  const arg = process.argv[2];
  const pages = arg ? [arg] : PAGES;

  console.log(`[i18n] Build de ${pages.length} page(s) :`);
  for (const page of pages) {
    buildPage(page, dict);
  }
  console.log(`[i18n] Terminé. Pages générées dans ${EN_DIR}`);
}

main();
