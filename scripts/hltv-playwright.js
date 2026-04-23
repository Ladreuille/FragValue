#!/usr/bin/env node
/* eslint-disable */
// scripts/hltv-playwright.js
// Helper Playwright pour fetch HLTV en bypassant Cloudflare.
//
// Cloudflare fingerprinte les requetes HTTP (JA3 TLS, headers, User-Agent).
// La seule maniere fiable de bypass sans service payant : utiliser un vrai
// Chromium headless qui execute le JS challenge.
//
// Expose :
//   fetchHtml(url)                  -> html string
//   fetchMapStats(mapStatsId)       -> { players: [...] }  (parse /matches/mapstatsid/ID)
//   fetchMatchResults(opts)         -> [matchId, ...]      (parse /results)
//
// Usage interne depuis scripts/import-hltv.js.

const cheerio = require('cheerio');

let _browser = null;
let _context = null;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Chromium stealth via playwright-extra + puppeteer-extra-plugin-stealth
// Le plugin stealth applique ~20 patches qui masquent les indicateurs
// typiques d'un navigateur automatise (navigator.webdriver, plugins list,
// WebGL vendor, chrome runtime, permissions, etc.)
//
// FV_HEADLESS=0 dans l'env pour voir la fenetre Chrome (debug visuel).
async function ensureBrowser() {
  if (_browser) return _browser;

  // Charge playwright-extra au lieu de playwright, puis enregistre stealth
  const { chromium } = require('playwright-extra');
  const stealth = require('puppeteer-extra-plugin-stealth')();
  chromium.use(stealth);

  const isHeadless = process.env.FV_HEADLESS !== '0';
  _browser = await chromium.launch({
    headless: isHeadless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
    ],
  });
  _context = await _browser.newContext({
    userAgent: UA,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'Europe/Paris',
    deviceScaleFactor: 2,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
  });
  if (!isHeadless) {
    console.log('  [hltv-playwright] headless=false (fenetre Chrome visible pour debug)');
  }
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch {}
    _browser = null;
    _context = null;
  }
}

/**
 * Fetch une URL HLTV en bypassant Cloudflare via Chromium headless + stealth.
 * Attend jusqu'a 30s que le challenge Cloudflare se resolve.
 */
async function fetchHtml(url, { timeout = 45000, waitForSelector = null } = {}) {
  await ensureBrowser();
  const page = await _context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    // Attend que le challenge Cloudflare se resolve (title change de
    // "Just a moment..." a la vraie page). Avec stealth plugin, ca prend
    // generalement 3-10s.
    let title = await page.title().catch(() => '');
    let tries = 0;
    const maxTries = 30; // 30 * 1s = 30s max
    while (title.includes('Just a moment') || title.includes('Attention Required') || title.includes('Verifying')) {
      if (tries++ >= maxTries) {
        console.warn(`    [cf] challenge non resolu apres ${maxTries}s, title="${title}"`);
        break;
      }
      await page.waitForTimeout(1000);
      title = await page.title().catch(() => '');
    }
    if (tries > 0 && tries < maxTries) {
      console.log(`    [cf] challenge resolu apres ${tries}s`);
    }

    // Attend le selector specifique (page hydratee) OU networkidle en fallback
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 15000 }).catch(() => {
        console.warn(`    [cf] selector "${waitForSelector}" pas trouve, page peut-etre incomplete`);
      });
    } else {
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
    }

    const html = await page.content();
    return html;
  } finally {
    await page.close();
  }
}

/**
 * Parse une page HLTV /matches/mapstatsid/XXX et retourne les stats joueurs
 * au format { playerStats: { team1: [...], team2: [...] }, map } attendu
 * par scripts/import-hltv.js (meme shape que HLTV.getMatchMapStats()).
 *
 * Chaque player : { player:{name}, kills, deaths, assists, ADR, KAST, rating2 }
 */
function parseMapStatsHtml(html) {
  const $ = cheerio.load(html);
  const result = { playerStats: { team1: [], team2: [] }, map: null };

  // Nom de la map
  result.map = $('.map-name-holder .map-name').first().text().trim()
            || $('.match-info-box .map').first().text().trim()
            || null;

  // HLTV structure 2026 : 2 tables .stats-table (une par equipe), chacune avec
  // une <tr> par joueur sous tbody. Colonnes typiques :
  //   0: Player (nom + country flag)
  //   1: K-D (ex "23-18")
  //   2: +/-
  //   3: ADR
  //   4: KAST %
  //   5: Rating 2.1
  const tables = $('table.stats-table, .stats-table.totalstats');
  tables.each((tIdx, tbl) => {
    const target = tIdx === 0 ? 'team1' : 'team2';
    $(tbl).find('tbody tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length < 5) return;

      // Nom : d'abord le texte du lien /player/, sinon le texte brut
      const nameEl = $(cells[0]).find('a').first();
      const nickname = (nameEl.text().trim() || $(cells[0]).text().trim()).split('\n')[0].trim();
      if (!nickname) return;

      // K-D : tentes les 2 formats "23-18" ou cells separees
      const kdText = $(cells[1]).text().trim();
      let kills = 0, deaths = 0;
      const kdMatch = kdText.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (kdMatch) { kills = parseInt(kdMatch[1]); deaths = parseInt(kdMatch[2]); }

      // Iteration sur les cells restantes pour identifier ADR / KAST / rating
      let adr = null, kast = null, rating = null, assists = null;
      cells.each((i, c) => {
        const txt = $(c).text().trim();
        const cls = ($(c).attr('class') || '').toLowerCase();
        const num = parseFloat(txt);
        if (cls.includes('adr') || (adr == null && i === 3 && /^\d+(\.\d+)?$/.test(txt))) {
          adr = num;
        }
        if (cls.includes('kast') || (kast == null && /^\d+(\.\d+)?%$/.test(txt))) {
          kast = parseFloat(txt.replace('%',''));
        }
        if (cls.includes('rating') || (rating == null && /^\d\.\d{2}$/.test(txt))) {
          rating = num;
        }
        if (cls.includes('assists') && Number.isFinite(num)) {
          assists = num;
        }
      });

      result.playerStats[target].push({
        player: { name: nickname },
        kills,
        deaths,
        assists: assists || 0,
        ADR: adr,
        KAST: kast,
        rating2: rating,
        rating1: rating, // backward-compat
      });
    });
  });

  return result;
}

/**
 * Fetch les stats detaillees d'une map HLTV via son mapstats_id.
 * Retourne l'objet compatible avec le code d'import.
 *
 * Debug : si FV_DEBUG_HLTV=1 dans l'env, sauvegarde le HTML a chaque fetch
 * dans /tmp/hltv-debug-MAPSTATSID.html pour inspection manuelle.
 */
async function fetchMapStats(mapStatsId) {
  const url = `https://www.hltv.org/stats/matches/mapstatsid/${mapStatsId}/-`;
  // Plusieurs selectors tentes car HLTV change parfois les classes
  const html = await fetchHtml(url, {
    waitForSelector: 'table.stats-table, .stats-table, .match-info-box, .contentCol',
    timeout: 45000,
  });

  // Save HTML si debug active OU si parse vide plus tard (done dans caller)
  if (process.env.FV_DEBUG_HLTV === '1') {
    const fs = require('node:fs');
    const outPath = `/tmp/hltv-debug-${mapStatsId}.html`;
    fs.writeFileSync(outPath, html);
    console.log(`    [debug] HTML sauvegarde : ${outPath} (${html.length} chars)`);
  }

  const parsed = parseMapStatsHtml(html);
  const totalPlayers = (parsed.playerStats?.team1?.length || 0) + (parsed.playerStats?.team2?.length || 0);

  // Si 0 joueurs parses, auto-save HTML pour analyse meme sans debug flag
  if (totalPlayers === 0 && !process.env.FV_DEBUG_HLTV) {
    const fs = require('node:fs');
    const outPath = `/tmp/hltv-debug-${mapStatsId}.html`;
    fs.writeFileSync(outPath, html);
    console.log(`    [auto-debug] 0 joueurs parses, HTML sauvegarde : ${outPath}`);
  }

  return parsed;
}

/**
 * Parse la page /results et retourne la liste des match IDs recents.
 */
async function fetchMatchResults({ maxResults = 30 } = {}) {
  const html = await fetchHtml('https://www.hltv.org/results', { waitForSelector: '.result-con' });
  const $ = cheerio.load(html);
  const ids = [];
  $('.result-con a.a-reset, .result-con a[href*="/matches/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/\/matches\/(\d+)(?:\/|$|\?)/);
    if (m) ids.push(parseInt(m[1], 10));
  });
  const unique = [...new Set(ids)];
  return unique.slice(0, maxResults);
}

module.exports = {
  fetchHtml,
  fetchMapStats,
  fetchMatchResults,
  closeBrowser,
};
