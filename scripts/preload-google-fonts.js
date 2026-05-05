#!/usr/bin/env node
// scripts/preload-google-fonts.js
// One-shot : remplace les <link href="...fonts.googleapis.com/css2..."> render-blocking
// par le pattern preload + media=print swap async load.
//
// Pattern target :
//   AVANT (render-blocking) :
//     <link href="...css2?..." rel="stylesheet">
//
//   APRES (non render-blocking, gain ~600ms LCP) :
//     <link rel="preload" as="style" href="...css2?...">
//     <link rel="stylesheet" href="...css2?..." media="print" onload="this.media='all'">
//     <noscript><link rel="stylesheet" href="...css2?..."></noscript>
//
// Idempotent : skip un fichier qui contient deja le pattern preload as=style sur fonts.

const fs = require('fs');
const path = require('path');

// Regex match : <link href="https://fonts.googleapis.com/css2..." rel="stylesheet">
// (avec self-closing optionnel /> et ordering href/rel possiblement inverse)
const FONT_LINK_RE = /<link\s+(?:href=("https:\/\/fonts\.googleapis\.com\/css2[^"]+")\s+rel=("stylesheet")|rel=("stylesheet")\s+href=("https:\/\/fonts\.googleapis\.com\/css2[^"]+"))\s*\/?>/gi;

function buildAsync(url) {
  return [
    `<link rel="preload" as="style" href=${url}>`,
    `<link rel="stylesheet" href=${url} media="print" onload="this.media='all'">`,
    `<noscript><link rel="stylesheet" href=${url}></noscript>`,
  ].join('\n');
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Idempotence : si on a deja un preload as=style sur fonts, skip
  if (/<link\s+rel="preload"\s+as="style"\s+href="https:\/\/fonts\.googleapis\.com/.test(content)) {
    return { filePath, action: 'skip', reason: 'already optimized' };
  }

  let changed = false;
  const newContent = content.replace(FONT_LINK_RE, (match, url1, _r1, _r2, url2) => {
    const url = url1 || url2;
    if (!url) return match;
    changed = true;
    return buildAsync(url);
  });

  if (!changed) return { filePath, action: 'noop', reason: 'no match' };

  fs.writeFileSync(filePath, newContent);
  return { filePath, action: 'updated' };
}

function walkHtml(dir, results = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.next', 'dist', 'docs', 'admin'].includes(entry.name)) continue;
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

console.log(`\nDone. ${stats.updated} updated, ${stats.skipped} already optimized, ${stats.noop} no match.`);
