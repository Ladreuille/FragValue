#!/usr/bin/env node
// scripts/migrate-fonts-self-hosted.js
// One-shot : migre toutes les pages HTML du Google Fonts CSS distant
// (preload+swap async pattern, commit 21ae502) vers le self-hosted local
// /fonts/fonts.css avec preload des woff2 critiques.
//
// AVANT (3 lignes par page) :
//   <link rel="preload" as="style" href="https://fonts.googleapis.com/css2?...">
//   <link rel="stylesheet" href="https://fonts.googleapis.com/css2?..." media="print" onload="this.media='all'">
//   <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?..."></noscript>
//
//   + en amont :
//   <link rel="preconnect" href="https://fonts.googleapis.com">
//   <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
//
// APRES :
//   <link rel="preload" href="/fonts/anton-latin.woff2" as="font" type="font/woff2" crossorigin>
//   <link rel="preload" href="/fonts/spacemono-400-latin.woff2" as="font" type="font/woff2" crossorigin>
//   <link rel="preload" href="/fonts/spacemono-700-latin.woff2" as="font" type="font/woff2" crossorigin>
//   <link rel="stylesheet" href="/fonts/fonts.css">
//
// Gain attendu :
// - Pas de DNS lookup ni 3-way TLS handshake vers fonts.googleapis.com
//   ni fonts.gstatic.com (= 200-400ms LCP saving sur mobile)
// - Cache long via Vercel (woff2 = static asset cache 1 an)
// - Pas de FOUT/FOIT (font-display: swap conserve le comportement)
//
// Idempotent : skip si on detecte deja `/fonts/fonts.css` dans la page.

const fs = require('fs');
const path = require('path');

const PRELOAD_BLOCK = [
  '<link rel="preload" href="/fonts/anton-latin.woff2" as="font" type="font/woff2" crossorigin>',
  '<link rel="preload" href="/fonts/spacemono-400-latin.woff2" as="font" type="font/woff2" crossorigin>',
  '<link rel="preload" href="/fonts/spacemono-700-latin.woff2" as="font" type="font/woff2" crossorigin>',
  '<link rel="stylesheet" href="/fonts/fonts.css">',
].join('\n');

// Pattern 1 : bloc 3 lignes preload+swap+noscript (commit 21ae502)
const REMOTE_FONTS_BLOCK_RE = /<link\s+rel="preload"\s+as="style"\s+href="https:\/\/fonts\.googleapis\.com\/css2[^"]+">\s*\n\s*<link\s+rel="stylesheet"\s+href="https:\/\/fonts\.googleapis\.com\/css2[^"]+"\s+media="print"\s+onload="[^"]+"[^>]*>\s*\n\s*<noscript><link\s+rel="stylesheet"\s+href="https:\/\/fonts\.googleapis\.com\/css2[^"]+"><\/noscript>/g;

// Pattern 2 : single line legacy (au cas ou des pages auraient ete loupees)
const LEGACY_FONTS_LINE_RE = /<link\s+href="https:\/\/fonts\.googleapis\.com\/css2[^"]+"\s+rel="stylesheet"[^>]*>/g;

// Pattern 3 : preconnect aux Google fonts servers (plus utiles desormais)
const PRECONNECT_RE = /<link\s+rel="preconnect"\s+href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>\s*\n?/g;

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Idempotence
  if (content.includes('/fonts/fonts.css')) {
    return { filePath, action: 'skip', reason: 'already migrated' };
  }

  let changed = false;
  let newContent = content;

  // 1. Remplace bloc 3 lignes preload+swap+noscript
  if (REMOTE_FONTS_BLOCK_RE.test(newContent)) {
    newContent = newContent.replace(REMOTE_FONTS_BLOCK_RE, PRELOAD_BLOCK);
    changed = true;
  }
  // 2. Sinon, remplace ligne legacy
  else if (LEGACY_FONTS_LINE_RE.test(newContent)) {
    newContent = newContent.replace(LEGACY_FONTS_LINE_RE, PRELOAD_BLOCK);
    changed = true;
  }

  // 3. Strip preconnect Google Fonts (plus utile)
  if (PRECONNECT_RE.test(newContent)) {
    newContent = newContent.replace(PRECONNECT_RE, '');
    changed = true;
  }

  if (!changed) return { filePath, action: 'noop', reason: 'no Google Fonts found' };

  fs.writeFileSync(filePath, newContent);
  return { filePath, action: 'updated' };
}

function walkHtml(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.next', 'dist', 'docs', 'admin', 'fonts'].includes(entry.name)) continue;
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
    console.log(`- ${path.relative(root, f)} (${r.reason})`);
  } else {
    stats.noop++;
  }
}

console.log(`\nDone. ${stats.updated} updated, ${stats.skipped} already migrated, ${stats.noop} no match.`);
