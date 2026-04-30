// scripts/record-demo.js · FragValue
// Enregistre une demo video automatique des principales features de FragValue
// pour le marketing / landing / reseaux sociaux. Utilise Playwright (deja dep).
//
// USAGE
//   node scripts/record-demo.js                        # prod (fragvalue.com)
//   FV_BASE=http://localhost:3000 node scripts/record-demo.js
//   FV_HEADLESS=1 node scripts/record-demo.js          # sans GUI (CI/server)
//
// SORTIE
//   video-assets/clips/01-intro.webm
//   video-assets/clips/02-demo-upload.webm
//   video-assets/clips/03-fv-rating.webm
//   video-assets/clips/04-replay-2d.webm
//   video-assets/clips/05-coach-ia.webm
//   video-assets/clips/06-heatmaps.webm
//   video-assets/clips/07-pro-benchmarks.webm
//   video-assets/clips/08-prep-veto.webm
//   video-assets/clips/09-outro.webm
//   video-assets/screenshots/*.png      (vignettes HD pour thumbnails)
//
// MONTAGE
//   Une fois les clips generes, voir scripts/assemble-demo.sh pour le
//   concat ffmpeg, ou importer dans CapCut / iMovie / DaVinci pour
//   ajouter narration voix-off + transitions + musique.
//
// NARRATION
//   Le storyboard complet (texte FR, timing, ce qui se passe) est dans
//   scripts/video-script.md.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FV_BASE || 'https://fragvalue.com';
const HEADLESS = process.env.FV_HEADLESS === '1';
const OUT_DIR = path.join(__dirname, '..', 'video-assets');
const CLIPS_DIR = path.join(OUT_DIR, 'clips');
const SHOTS_DIR = path.join(OUT_DIR, 'screenshots');
const VIEWPORT = { width: 1920, height: 1080 };

// ── Helpers ────────────────────────────────────────────────────────────────

function ensureDirs() {
  for (const d of [OUT_DIR, CLIPS_DIR, SHOTS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function log(emoji, msg) {
  // eslint-disable-next-line no-console
  console.log(emoji + ' ' + msg);
}

async function smoothScroll(page, targetY, durationMs) {
  durationMs = durationMs || 1500;
  await page.evaluate(({ y, d }) => {
    return new Promise((resolve) => {
      const startY = window.scrollY;
      const dist = y - startY;
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / d);
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        window.scrollTo(0, startY + dist * ease);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }, { y: targetY, d: durationMs });
}

async function injectFakeCursor(page) {
  await page.addStyleTag({
    content: `
      #fv-fake-cursor {
        position: fixed; top: 0; left: 0; width: 24px; height: 24px;
        pointer-events: none; z-index: 999999;
        background: radial-gradient(circle at 35% 35%, #b8ff57, #6cb024);
        border-radius: 50%; box-shadow: 0 0 12px rgba(184,255,87,.6);
        transition: transform .15s ease;
      }
    `,
  });
  await page.evaluate(() => {
    const c = document.createElement('div');
    c.id = 'fv-fake-cursor';
    document.body.appendChild(c);
    document.addEventListener('mousemove', (e) => {
      c.style.transform = 'translate(' + (e.clientX - 12) + 'px,' + (e.clientY - 12) + 'px)';
    });
  });
}

async function cursorTo(page, x, y, durationMs) {
  durationMs = durationMs || 800;
  const steps = 30;
  const stepDelay = durationMs / steps;
  const start = await page.evaluate(() => ({
    x: window._fvLastCursor?.x || window.innerWidth / 2,
    y: window._fvLastCursor?.y || window.innerHeight / 2,
  }));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const cx = start.x + (x - start.x) * ease;
    const cy = start.y + (y - start.y) * ease;
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(stepDelay);
  }
  await page.evaluate(({ x, y }) => { window._fvLastCursor = { x, y }; }, { x, y });
}

async function newRecordingContext(browser, name) {
  return browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    locale: 'fr-FR',
    recordVideo: {
      dir: CLIPS_DIR,
      size: VIEWPORT,
    },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 FragValueDemoRecorder/1.0',
  });
}

async function saveAndRename(context, page, name) {
  const video = page.video();
  const screenshot = path.join(SHOTS_DIR, name + '.png');
  await page.screenshot({ path: screenshot, fullPage: false });
  await context.close();
  if (video) {
    const oldPath = await video.path();
    const newPath = path.join(CLIPS_DIR, name + '.webm');
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
      log('✓', 'clip ' + name + '.webm + screenshot ' + name + '.png');
    }
  }
}

// ── Scenes ─────────────────────────────────────────────────────────────────

async function scene01Intro(browser) {
  log('▶', '01 INTRO (logo + headline)');
  const ctx = await newRecordingContext(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await injectFakeCursor(page);
  await page.waitForTimeout(1500); // headline visible
  await smoothScroll(page, 200, 1000); // tease scroll
  await page.waitForTimeout(800);
  await saveAndRename(ctx, page, '01-intro');
}

async function scene02DemoUpload(browser) {
  log('▶', '02 UPLOAD (drag-drop demo)');
  const ctx = await newRecordingContext(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/demo.html', { waitUntil: 'networkidle' });
  await injectFakeCursor(page);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 400, 1500);
  await page.waitForTimeout(1200);
  // hover sur la dropzone
  const dropzone = await page.$('.dropzone, .upload-area, [data-dropzone]');
  if (dropzone) {
    const box = await dropzone.boundingBox();
    if (box) await cursorTo(page, box.x + box.width / 2, box.y + box.height / 2, 1200);
  }
  await page.waitForTimeout(1000);
  await saveAndRename(ctx, page, '02-demo-upload');
}

async function scene03FvRating(browser) {
  log('▶', '03 FV RATING (analysis page)');
  const ctx = await newRecordingContext(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/stats-guide.html', { waitUntil: 'networkidle' });
  await injectFakeCursor(page);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 600, 2000);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 1400, 2000);
  await page.waitForTimeout(1500);
  await saveAndRename(ctx, page, '03-fv-rating');
}

async function scene04Replay(browser) {
  log('▶', '04 2D REPLAY (round-by-round playback)');
  const ctx = await newRecordingContext(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/how-it-works.html', { waitUntil: 'networkidle' });
  await injectFakeCursor(page);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 800, 2000);
  await page.waitForTimeout(2000);
  await saveAndRename(ctx, page, '04-replay-2d');
}

async function scene05CoachIA(browser) {
  log('▶', '05 AI COACH CONVERSATIONAL (killer feature)');
  const ctx = await newRecordingContext(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/pricing.html', { waitUntil: 'networkidle' });
  await injectFakeCursor(page);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 500, 2000);
  await page.waitForTimeout(1500);
  // hover sur la card Elite
  const eliteCard = await page.$('text=/elite/i');
  if (eliteCard) {
    const box = await eliteCard.boundingBox();
    if (box) await cursorTo(page, box.x + box.width / 2, box.y + 50, 1000);
  }
  await page.waitForTimeout(1500);
  await saveAndRename(ctx, page, '05-coach-ia');
}

async function scene06Heatmaps(browser) {
  log('▶', '06 HEATMAPS TACTIQUES');
  const ctx = await newRecordingContext(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/lineup-library.html', { waitUntil: 'networkidle' });
  await injectFakeCursor(page);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 500, 2000);
  await page.waitForTimeout(2000);
  await saveAndRename(ctx, page, '06-heatmaps');
}

async function scene07ProBenchmarks(browser) {
  log('▶', '07 PRO BENCHMARKS (HLTV pro twin)');
  const ctx = await newRecordingContext(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/pro-benchmarks.html', { waitUntil: 'networkidle' });
  await injectFakeCursor(page);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 600, 2000);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 1300, 2000);
  await page.waitForTimeout(1500);
  await saveAndRename(ctx, page, '07-pro-benchmarks');
}

async function scene08PrepVeto(browser) {
  log('▶', '08 PREP VETO BO3 (ban-pick recommendations)');
  const ctx = await newRecordingContext(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/prep-veto.html', { waitUntil: 'networkidle' });
  await injectFakeCursor(page);
  await page.waitForTimeout(1500);
  await smoothScroll(page, 500, 2000);
  await page.waitForTimeout(1500);
  await saveAndRename(ctx, page, '08-prep-veto');
}

async function scene09Outro(browser) {
  log('▶', '09 OUTRO (CTA)');
  const ctx = await newRecordingContext(browser);
  const page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await injectFakeCursor(page);
  await page.waitForTimeout(1500);
  // Aller au CTA principal
  const cta = await page.$('a[href*="demo"], a.cta, button.cta');
  if (cta) {
    const box = await cta.boundingBox();
    if (box) {
      await smoothScroll(page, Math.max(0, box.y - 400), 1500);
      await page.waitForTimeout(800);
      await cursorTo(page, box.x + box.width / 2, box.y + box.height / 2, 1200);
    }
  }
  await page.waitForTimeout(1500);
  await saveAndRename(ctx, page, '09-outro');
}

// ── Main ───────────────────────────────────────────────────────────────────

(async () => {
  ensureDirs();
  log('🎬', 'FragValue demo recorder');
  log('🌐', 'BASE = ' + BASE);
  log('📁', 'Output: ' + OUT_DIR);
  log('🪟', 'Headless = ' + HEADLESS);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const scenes = [
    scene01Intro,
    scene02DemoUpload,
    scene03FvRating,
    scene04Replay,
    scene05CoachIA,
    scene06Heatmaps,
    scene07ProBenchmarks,
    scene08PrepVeto,
    scene09Outro,
  ];

  for (const scene of scenes) {
    try {
      await scene(browser);
    } catch (e) {
      log('✗', 'scene failed: ' + (e.message || e));
    }
  }

  await browser.close();
  log('✅', 'Done. Clips in ' + CLIPS_DIR);
  log('💡', 'Next: run scripts/assemble-demo.sh to concat into final MP4');
  log('💡', 'Or import .webm files into CapCut / iMovie / DaVinci Resolve');
})();
