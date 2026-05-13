#!/usr/bin/env node
/* eslint-disable */
// scripts/discover-pro-demos.js · FragValue · Option B Phase 2
//
// Decouvre les URLs des demos HLTV pour les pro_matches deja en DB.
//
// Pipeline :
//   1. SELECT pro_matches WHERE demo_available = false AND hltv_match_id IS NOT NULL
//   2. Pour chaque match : fetch HLTV page, parse "GOTV demo" link
//   3. Update pro_matches.demo_available = true
//   4. Update pro_match_maps.demo_url ou demo_archive_url
//   5. Insert pro_demos row avec status='pending' par map
//
// HLTV expose les demos via deux formats :
//   a) Archive .rar/.zip contenant toutes les maps : URL en bas de page match
//   b) Demos individuelles par map : rare, surtout les vieux formats
//
// Strategie : on stocke l'URL d'archive dans pro_match_maps.demo_archive_url
// (meme URL pour toutes les maps du match), le download script extracte ensuite.
//
// HLTV bloque les IPs datacenter (Vercel) → ce script tourne en LOCAL.
//
// Usage :
//   node scripts/discover-pro-demos.js [--limit=20] [--match=<hltv_match_id>]
//
// Rate limit : 1 req / 10s pour rester safe.

const fs = require('node:fs');
const path = require('node:path');

// ─── Load .env.local ───────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { createClient } = require('@supabase/supabase-js');
const cheerio = require('cheerio');
const { fetchHtml, closeBrowser } = require('./hltv-playwright.js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([a-z-]+)=(.+)$/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});
const LIMIT = parseInt(args.limit || '20', 10);
const SINGLE_MATCH = args.match || null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── HLTV match page parsing ───────────────────────────────────────────────
// Le link "GOTV demo" est dans #matchstats > .stats-section .demo-link, ou
// dans .matchstats class .streams selon le format de page.
async function getDemoUrlsForMatch(hltvMatchId) {
  const url = `https://www.hltv.org/matches/${hltvMatchId}/x`;
  const html = await fetchHtml(url, { waitForSelector: '.match-page', timeout: 60000 });
  const $ = cheerio.load(html);

  // Option 1 : "GOTV Demo" download link (archive .rar/.zip avec toutes les maps)
  let demoArchiveUrl = null;
  $('.stream-box, .matchstats, .match-info').find('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = ($(el).text() || '').toLowerCase();
    if (href.startsWith('/download/demo/') || /gotv|demo/i.test(text)) {
      if (href.startsWith('/download/demo/')) {
        demoArchiveUrl = 'https://www.hltv.org' + href;
      }
    }
  });

  // Option 2 : link direct vers "demos" en sidebar
  if (!demoArchiveUrl) {
    const downloadLink = $('a[href^="/download/demo/"]').first().attr('href');
    if (downloadLink) demoArchiveUrl = 'https://www.hltv.org' + downloadLink;
  }

  return { demoArchiveUrl, found: !!demoArchiveUrl };
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[discover-pro-demos] start (limit=${LIMIT}${SINGLE_MATCH ? ', match=' + SINGLE_MATCH : ''})`);

  // 1. Recupere les pro_matches sans demos discovered
  let query = supabase
    .from('pro_matches')
    .select('id, hltv_match_id, team_a, team_b, match_date, demo_available')
    .not('hltv_match_id', 'is', null)
    .eq('demo_available', false)
    .order('match_date', { ascending: false })
    .limit(LIMIT);

  if (SINGLE_MATCH) {
    query = supabase
      .from('pro_matches')
      .select('id, hltv_match_id, team_a, team_b, match_date, demo_available')
      .eq('hltv_match_id', parseInt(SINGLE_MATCH, 10));
  }

  const { data: matches, error } = await query;
  if (error) throw error;
  if (!matches || matches.length === 0) {
    console.log('[discover-pro-demos] no matches to process');
    return;
  }
  console.log(`[discover-pro-demos] ${matches.length} matches to process`);

  let discovered = 0;
  let failed = 0;

  for (const match of matches) {
    console.log(`\n[discover-pro-demos] match ${match.hltv_match_id} ${match.team_a} vs ${match.team_b}`);
    try {
      const { demoArchiveUrl, found } = await getDemoUrlsForMatch(match.hltv_match_id);

      if (!found) {
        console.log(`  no demo URL found (archive probably expired or HLTV layout changed)`);
        // Don't mark unavailable definitively, just skip - retry later
        await sleep(10000);
        continue;
      }

      console.log(`  demo archive : ${demoArchiveUrl}`);

      // Update match
      await supabase.from('pro_matches')
        .update({ demo_available: true })
        .eq('id', match.id);

      // Update all maps with same archive URL
      const { data: maps } = await supabase
        .from('pro_match_maps')
        .select('id, map_name')
        .eq('match_id', match.id);

      if (maps && maps.length > 0) {
        for (const map of maps) {
          await supabase.from('pro_match_maps')
            .update({ demo_archive_url: demoArchiveUrl })
            .eq('id', map.id);

          // Insert pro_demos row si pas deja la
          const { error: insertErr } = await supabase.from('pro_demos').insert({
            pro_match_map_id: map.id,
            hltv_demo_url: demoArchiveUrl,
            status: 'pending',
          });
          if (insertErr && !insertErr.message.includes('duplicate')) {
            console.warn(`  pro_demos insert error : ${insertErr.message}`);
          }
        }
        console.log(`  enqueued ${maps.length} maps`);
      }

      discovered++;
    } catch (e) {
      console.error(`  ERROR : ${e.message}`);
      failed++;
    }

    // Rate limit
    await sleep(10000);
  }

  await closeBrowser();
  console.log(`\n[discover-pro-demos] DONE. discovered=${discovered}, failed=${failed}, skipped=${matches.length - discovered - failed}`);
}

main().catch(e => {
  console.error('[discover-pro-demos] FATAL:', e);
  process.exit(1);
});
