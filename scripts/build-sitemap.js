#!/usr/bin/env node
/* FragValue : générateur de sitemap.xml.
 *
 * Génère un sitemap conforme aux standards Google avec :
 *   - lastmod basé sur git log (date du dernier commit qui modifie la page)
 *   - changefreq + priority adaptés au type de page
 *   - hreflang FR/EN avec x-default pour les pages bilingues
 *
 * Usage : node scripts/build-sitemap.js
 *
 * Exclusions : pages auth (account, dashboard, onboarding), pages techniques
 * (faceit-callback, extension-auth, pro-match), pages dynamiques (share/:id,
 * team/:tag, replay, heatmap-results - dépendent de query params).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOST = 'https://fragvalue.com';
const OUTPUT = path.join(ROOT, 'sitemap.xml');

// Pages publiques avec leur configuration SEO.
// priority : 0-1, indique l'importance relative au sein du site
// changefreq : hint pour les crawlers (always, hourly, daily, weekly, monthly, yearly, never)
// bilingual : true si la version /en/ existe (synchro avec build-i18n.js PAGES)
const PUBLIC_PAGES = [
  // High-priority : conversion + landing
  { path: '/',                       file: 'index.html',           priority: 1.0, changefreq: 'daily',   bilingual: true  },
  { path: '/pricing.html',           file: 'pricing.html',         priority: 0.9, changefreq: 'weekly',  bilingual: true  },
  { path: '/demo.html',              file: 'demo.html',            priority: 0.9, changefreq: 'weekly',  bilingual: true  },
  { path: '/levels.html',            file: 'levels.html',          priority: 0.8, changefreq: 'weekly',  bilingual: true  },
  { path: '/compare-outils.html',    file: 'compare-outils.html',  priority: 0.8, changefreq: 'monthly', bilingual: true  },

  // Mid-priority : features + content
  { path: '/lineup-library.html',    file: 'lineup-library.html',  priority: 0.7, changefreq: 'weekly',  bilingual: true  },
  { path: '/pro-demos.html',         file: 'pro-demos.html',       priority: 0.7, changefreq: 'weekly',  bilingual: true  },
  { path: '/pro-benchmarks.html',    file: 'pro-benchmarks.html',  priority: 0.7, changefreq: 'monthly', bilingual: true  },
  { path: '/prep-veto.html',         file: 'prep-veto.html',       priority: 0.6, changefreq: 'monthly', bilingual: true  },
  { path: '/anti-strat.html',        file: 'anti-strat.html',      priority: 0.6, changefreq: 'monthly', bilingual: true  },
  { path: '/stats-guide.html',       file: 'stats-guide.html',     priority: 0.6, changefreq: 'monthly', bilingual: true  },
  { path: '/blog.html',              file: 'blog.html',            priority: 0.5, changefreq: 'weekly',  bilingual: false },

  // Légal (obligatoire pour SEO + confiance) - low priority
  { path: '/cgv.html',               file: 'cgv.html',             priority: 0.3, changefreq: 'yearly',  bilingual: true  },
  { path: '/privacy.html',           file: 'privacy.html',         priority: 0.3, changefreq: 'yearly',  bilingual: true  },
  { path: '/mentions-legales.html',  file: 'mentions-legales.html',priority: 0.3, changefreq: 'yearly',  bilingual: true  },
];

// Récupère la date du dernier commit qui touche un fichier (au format ISO 8601).
// Fallback : date courante si le fichier n'a pas d'historique git.
function getLastModified(filePath) {
  try {
    const out = execSync(
      `git log -1 --format=%cI -- "${filePath}"`,
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    return out || new Date().toISOString();
  } catch (_) {
    return new Date().toISOString();
  }
}

// Format ISO 8601 mais tronqué a la date (YYYY-MM-DD) - plus stable et standard sitemap
function formatDate(iso) {
  return iso.split('T')[0];
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;' }[c]));
}

function buildEntry(page) {
  const fullUrl = HOST + page.path;
  const lastmod = formatDate(getLastModified(page.file));
  const lines = [
    '  <url>',
    `    <loc>${escapeXml(fullUrl)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${page.changefreq}</changefreq>`,
    `    <priority>${page.priority.toFixed(1)}</priority>`,
  ];

  // hreflang : on ajoute la version FR (canonical) + EN si bilingue + x-default
  if (page.bilingual) {
    const enUrl = HOST + '/en' + (page.path === '/' ? '/' : page.path);
    lines.push(`    <xhtml:link rel="alternate" hreflang="fr" href="${escapeXml(fullUrl)}"/>`);
    lines.push(`    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(enUrl)}"/>`);
    lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(fullUrl)}"/>`);
  }

  lines.push('  </url>');
  return lines.join('\n');
}

function buildEnEntry(page) {
  if (!page.bilingual) return null;
  const enUrl = HOST + '/en' + (page.path === '/' ? '/' : page.path);
  const enFile = path.join('en', page.file);
  const lastmod = formatDate(getLastModified(enFile));
  return [
    '  <url>',
    `    <loc>${escapeXml(enUrl)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    `    <changefreq>${page.changefreq}</changefreq>`,
    `    <priority>${(page.priority * 0.9).toFixed(2)}</priority>`,
    `    <xhtml:link rel="alternate" hreflang="fr" href="${escapeXml(HOST + page.path)}"/>`,
    `    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(enUrl)}"/>`,
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(HOST + page.path)}"/>`,
    '  </url>',
  ].join('\n');
}

function main() {
  const entries = [];
  for (const page of PUBLIC_PAGES) {
    entries.push(buildEntry(page));
    const en = buildEnEntry(page);
    if (en) entries.push(en);
  }

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    entries.join('\n'),
    '</urlset>',
    '',
  ].join('\n');

  fs.writeFileSync(OUTPUT, xml);
  console.log(`[sitemap] ${PUBLIC_PAGES.length} pages FR + ${PUBLIC_PAGES.filter(p => p.bilingual).length} EN -> ${OUTPUT}`);
  console.log(`[sitemap] Total : ${PUBLIC_PAGES.length + PUBLIC_PAGES.filter(p => p.bilingual).length} URLs`);
}

main();
