#!/usr/bin/env node
/* eslint-disable */
// Generate Open Graph images for FragValue (1200x630 PNG)
// Usage : node scripts/og.mjs [slug]  (default = all)
//
// Stack : satori (JSX -> SVG) + @resvg/resvg-js (SVG -> PNG)
// Output : og/<slug>.png
//
// Install deps locally : npm i -D satori @resvg/resvg-js

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'og');

// Fonts : on utilise les memes que le site (Anton + Space Mono) depuis Google Fonts
// On les telecharge et cache localement la premiere fois
const FONT_DIR = resolve(__dirname, 'fonts');
const FONTS = {
  'Anton': 'https://fonts.gstatic.com/s/anton/v25/1Ptgg87LROyAm3Kz-C8.woff2',
  'SpaceMono-Regular': 'https://fonts.gstatic.com/s/spacemono/v14/i7dPIFZifjKcF5UAWdDRYEF8RXi4EwQ.woff2',
  'SpaceMono-Bold': 'https://fonts.gstatic.com/s/spacemono/v14/i7dMIFZifjKcF5UAWdDRYER8QHi-EwWMbg.woff2',
};

async function fetchFont(name, url) {
  const cached = resolve(FONT_DIR, `${name}.woff2`);
  try {
    return await readFile(cached);
  } catch {
    await mkdir(FONT_DIR, { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch font ${name}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(cached, buf);
    return buf;
  }
}

// Les WOFF2 de Google Fonts ne sont pas directement consommables par satori
// qui attend du TTF/OTF. On bascule sur les .ttf sources a la place (Google
// les expose aussi via CSS API v1 ou directement sur fonts.google.com/download).
// Pour simplifier on utilise les fichiers TTF bruts stockes dans scripts/fonts/.
// Si absents, on tombe sur du fallback system-ui.

async function loadFontBuffer(name, url, optional = false) {
  const cached = resolve(FONT_DIR, `${name}.ttf`);
  try {
    return await readFile(cached);
  } catch (e) {
    if (optional) return null;
    console.warn(`⚠ Font ${name} non trouvee (${cached}). Telecharge-la via :`);
    console.warn(`  scripts/download-fonts.sh ou pose le .ttf dans scripts/fonts/`);
    return null;
  }
}

// ── Templates ──────────────────────────────────────────────────────────────
const BG = '#080909';
const ACCENT = '#b8ff57';
const GOLD = '#f5c842';
const TEXT = '#e8eaea';
const TEXT2 = '#a8b0b0';
const TEXT3 = '#5a6060';
const BORDER = '#1c1e1e';

function tagBg(color) { return `${color}20`; }

function ogTemplate({ title, subtitle, tag, tagColor = ACCENT, statsLine = [] }) {
  return {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        background: BG,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        fontFamily: '"Space Mono", monospace',
        color: TEXT,
        padding: '56px 64px',
      },
      children: [
        // radial gradient accent haut-gauche
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(ellipse 50% 70% at 20% 0%, ${ACCENT}1a 0%, transparent 60%)`,
            },
          },
        },
        // grid pattern subtil
        {
          type: 'div',
          props: {
            style: {
              position: 'absolute',
              inset: 0,
              backgroundImage: `linear-gradient(${BORDER} 1px, transparent 1px), linear-gradient(90deg, ${BORDER} 1px, transparent 1px)`,
              backgroundSize: '60px 60px',
              opacity: 0.25,
            },
          },
        },
        // Logo top-left + tag top-right
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              zIndex: 1,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: '"Anton"',
                    fontSize: 52,
                    letterSpacing: '0.04em',
                    color: TEXT,
                    display: 'flex',
                    alignItems: 'baseline',
                  },
                  children: [
                    'Frag',
                    { type: 'span', props: { style: { color: ACCENT }, children: 'Value' } },
                  ],
                },
              },
              tag ? {
                type: 'div',
                props: {
                  style: {
                    background: `${tagColor}22`,
                    border: `1px solid ${tagColor}66`,
                    color: tagColor,
                    padding: '8px 18px',
                    borderRadius: 40,
                    fontSize: 14,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                  },
                  children: tag,
                },
              } : null,
            ].filter(Boolean),
          },
        },
        // Title + subtitle center
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              zIndex: 1,
              marginTop: 24,
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    fontFamily: '"Anton"',
                    fontSize: 88,
                    lineHeight: 0.98,
                    letterSpacing: '0.01em',
                    color: TEXT,
                    maxWidth: 1040,
                  },
                  children: title,
                },
              },
              subtitle ? {
                type: 'div',
                props: {
                  style: {
                    fontSize: 22,
                    lineHeight: 1.5,
                    color: TEXT2,
                    marginTop: 24,
                    maxWidth: 960,
                  },
                  children: subtitle,
                },
              } : null,
            ].filter(Boolean),
          },
        },
        // Stats line bottom
        statsLine.length ? {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              gap: 28,
              alignItems: 'center',
              paddingTop: 20,
              borderTop: `1px solid ${BORDER}`,
              zIndex: 1,
              fontSize: 18,
              color: TEXT3,
              letterSpacing: '0.04em',
            },
            children: statsLine.flatMap((s, i) => {
              const parts = [{
                type: 'div',
                props: {
                  style: { display: 'flex', alignItems: 'center', gap: 8 },
                  children: [
                    { type: 'div', props: { style: { width: 6, height: 6, borderRadius: 3, background: ACCENT } } },
                    { type: 'div', props: { style: { color: TEXT }, children: s } },
                  ],
                },
              }];
              return parts;
            }),
          },
        } : null,
      ].filter(Boolean),
    },
  };
}

// ── Spec par page (matche og/README.md) ─────────────────────────────────────
const PAGES = {
  'home': {
    title: 'Le premier coach IA pour CS2',
    subtitle: 'Analyse tes 20 derniers matchs FACEIT. Diagnostic chiffré, 2D replay, heatmaps tactiques.',
    tag: 'Nouveau',
    tagColor: ACCENT,
    statsLine: ['Coach IA', '2D Replay', '134 métriques'],
  },
  'stats-guide': {
    title: 'Guide des stats CS2',
    subtitle: '16 métriques expliquées avec seuils pro et méthode de calcul.',
    statsLine: ['16 KPIs', 'FV Rating', 'Thresholds FACEIT'],
  },
  'lineup-library': {
    title: 'Les smokes des pros sur chaque map',
    subtitle: '1 842 lineups filtrables par map, site, côté et type.',
    tag: 'Bientôt',
    tagColor: ACCENT,
    statsLine: ['7 maps', '524 matchs', '98% success'],
  },
  'pro-demos': {
    title: 'Les matchs pros en 2D replay',
    subtitle: 'Major, Blast, ESL Pro League analysables round par round.',
    tag: 'Pro',
    tagColor: ACCENT,
    statsLine: ['524 matchs HLTV', '32 équipes', '14 tournois'],
  },
  'pro-benchmarks': {
    title: 'Ton jeu vs le top 20 HLTV',
    subtitle: 'Écart chiffré sur 18 métriques. Map par map, par rôle.',
    tag: 'Elite',
    tagColor: GOLD,
    statsLine: ['20 pros', '18 métriques', '90 jours'],
  },
  'prep-veto': {
    title: 'Gagne le veto avant la partie',
    subtitle: 'Séquence optimale de bans calculée sur la data des deux camps.',
    tag: 'Elite',
    tagColor: GOLD,
    statsLine: ['7 maps', 'CT vs T', 'BO3 supporté'],
  },
  'anti-strat': {
    title: 'Démonte leurs setups',
    subtitle: 'Patterns adverses détectés sur 20 matchs. Counters actionnables inclus.',
    tag: 'Elite',
    tagColor: GOLD,
    statsLine: ['8 patterns', '7 maps', '30 jours'],
  },
};

// ── Main ───────────────────────────────────────────────────────────────────
async function render(slug, spec, fonts) {
  const svg = await satori(ogTemplate(spec), {
    width: 1200,
    height: 630,
    fonts,
  });
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const png = resvg.render().asPng();
  const outPath = resolve(OUT_DIR, `${slug}.png`);
  await writeFile(outPath, png);
  console.log(`  ✓ ${slug}.png (${(png.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  const only = process.argv[2];
  await mkdir(OUT_DIR, { recursive: true });

  const [antonBuf, monoRegBuf, monoBoldBuf] = await Promise.all([
    loadFontBuffer('Anton'),
    loadFontBuffer('SpaceMono-Regular'),
    loadFontBuffer('SpaceMono-Bold'),
  ]);
  if (!antonBuf || !monoRegBuf) {
    console.error('❌ Fonts manquantes. Lance `scripts/download-fonts.sh` d\'abord.');
    process.exit(1);
  }
  const fonts = [
    { name: 'Anton', data: antonBuf, weight: 400, style: 'normal' },
    { name: 'Space Mono', data: monoRegBuf, weight: 400, style: 'normal' },
  ];
  if (monoBoldBuf) fonts.push({ name: 'Space Mono', data: monoBoldBuf, weight: 700, style: 'normal' });

  const slugs = only ? [only] : Object.keys(PAGES);
  console.log(`Generating ${slugs.length} OG image${slugs.length > 1 ? 's' : ''}...`);
  for (const slug of slugs) {
    if (!PAGES[slug]) { console.warn(`  - ${slug} : spec inconnue, skip`); continue; }
    await render(slug, PAGES[slug], fonts);
  }
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
