#!/usr/bin/env node
// scripts/seo-add-breadcrumbs.js
//
// Ajoute le BreadcrumbList JSON-LD sur les pages publiques crawlables
// qui ne l'ont pas encore. Permet a Google d'afficher un fil d'Ariane
// dans la SERP au lieu de juste l'URL plate, augmente le CTR (~5-10%
// observe sur le secteur SaaS).
//
// Pages ciblees :
//   - Pages PUBLIQUES (pas /admin, pas auth-required)
//   - Hors index.html (le breadcrumb d'accueil n'a pas de sens)
//   - Hors callback / extension-auth (pages techniques)
//
// Mapping hierarchy :
//   / -> /pricing.html : Accueil > Tarifs
//   / -> /how-it-works.html : Accueil > Comment ca marche
//   / -> /pro-demos.html : Accueil > Pro Demos
//   / -> /blog.html : Accueil > Blog
//   etc.
//
// Idempotent : skip si BreadcrumbList deja present dans le fichier.
//
// Format : injecte juste avant </head>.

const fs = require('fs');
const path = require('path');

// Mapping page -> nom affiche dans le breadcrumb
// (FR par defaut, EN en miroir pour /en/)
const PAGE_NAMES = {
  'pricing.html':       { fr: 'Tarifs',                en: 'Pricing' },
  'how-it-works.html':  { fr: 'Comment ça marche',    en: 'How it works' },
  'stats-guide.html':   { fr: 'Guide des stats',      en: 'Stats guide' },
  'astuces.html':       { fr: 'Astuces & tips CS2',   en: 'CS2 tips' },
  'compare-outils.html':{ fr: 'Comparatif outils',    en: 'Tools comparison' },
  'compare.html':       { fr: 'Comparer joueurs',     en: 'Compare players' },
  'pro-demos.html':     { fr: 'Pro Demos',            en: 'Pro Demos' },
  'pro-match.html':     { fr: 'Match pro',            en: 'Pro match' },
  'pro-benchmarks.html':{ fr: 'Pro Benchmarks',       en: 'Pro Benchmarks' },
  'lineup-library.html':{ fr: 'Lineup Library',       en: 'Lineup Library' },
  'prep-veto.html':     { fr: 'Prep Veto',            en: 'Veto Prep' },
  'anti-strat.html':    { fr: 'Anti-strat',           en: 'Anti-strat' },
  'levels.html':        { fr: 'Niveaux FACEIT',       en: 'FACEIT levels' },
  'scout.html':         { fr: 'Scout',                en: 'Scout' },
  'sitemap.html':       { fr: 'Plan du site',         en: 'Sitemap' },
  'blog.html':          { fr: 'Blog',                 en: 'Blog' },
  'mentions-legales.html': { fr: 'Mentions légales',  en: 'Legal notice' },
  'cgv.html':           { fr: 'CGV',                  en: 'Terms' },
  'privacy.html':       { fr: 'Confidentialité',      en: 'Privacy' },
  'login.html':         { fr: 'Connexion',            en: 'Login' },
  'demo.html':          { fr: 'Analyser une démo',    en: 'Analyze a demo' },
};

function buildBreadcrumb(pageBase, isEn) {
  const lang = isEn ? 'en' : 'fr';
  const homeName = isEn ? 'Home' : 'Accueil';
  const homeUrl = isEn ? 'https://fragvalue.com/en/' : 'https://fragvalue.com/';
  const pageName = PAGE_NAMES[pageBase]?.[lang];
  if (!pageName) return null;
  const pageUrl = isEn ? `https://fragvalue.com/en/${pageBase}` : `https://fragvalue.com/${pageBase}`;

  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "${homeName}", "item": "${homeUrl}"},
    {"@type": "ListItem", "position": 2, "name": ${JSON.stringify(pageName)}, "item": "${pageUrl}"}
  ]
}
</script>`;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  if (content.includes('BreadcrumbList')) {
    return { filePath, action: 'skip', reason: 'already has breadcrumb' };
  }

  // Detect FR vs EN
  const isEn = filePath.includes('/en/');
  const base = path.basename(filePath);

  // Skip auth-required, technical, admin pages
  const SKIP = new Set([
    'index.html', '404.html', 'account.html', 'dashboard.html',
    'analysis.html', 'matches.html', 'replay.html', 'team.html',
    'heatmap-results.html', 'share.html', 'unsubscribed.html',
    'extension-auth.html', 'faceit-callback.html', 'onboarding.html',
  ]);
  if (SKIP.has(base)) return { filePath, action: 'skip', reason: 'in skip list' };
  if (!PAGE_NAMES[base]) return { filePath, action: 'skip', reason: 'no name mapping' };

  const breadcrumb = buildBreadcrumb(base, isEn);
  if (!breadcrumb) return { filePath, action: 'skip', reason: 'cannot build' };

  // Inject just before </head>
  if (!content.includes('</head>')) return { filePath, action: 'noop', reason: 'no </head>' };
  const newContent = content.replace('</head>', breadcrumb + '\n</head>');
  fs.writeFileSync(filePath, newContent);
  return { filePath, action: 'updated' };
}

function walkHtml(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.next', 'dist', 'docs', 'admin', 'fonts', 'blog'].includes(entry.name)) continue;
      walkHtml(full, results);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      results.push(full);
    }
  }
  return results;
}

const root = path.resolve(__dirname, '..');
const files = walkHtml(root);

console.log(`Scanning ${files.length} HTML files...\n`);
const stats = { updated: 0, skipped: 0, noop: 0 };

for (const f of files) {
  const r = processFile(f);
  if (r.action === 'updated') {
    stats.updated++;
    console.log(`✓ ${path.relative(root, f)}`);
  } else if (r.action === 'skip') {
    stats.skipped++;
  } else {
    stats.noop++;
  }
}

console.log(`\nDone. ${stats.updated} updated, ${stats.skipped} skipped, ${stats.noop} no match.`);
