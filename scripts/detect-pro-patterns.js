#!/usr/bin/env node
/* eslint-disable */
// scripts/detect-pro-patterns.js · FragValue · Option B Phase 3
//
// Detection de patterns tactiques dans pro_demo_events.
// Run apres que des demos ont ete parsees (pro_demos.status = 'parsed').
// Insert dans pro_demo_patterns avec confidence scoring.
//
// 5 SQL functions appelees via supabase.rpc() :
//   - detect_util_lineups
//   - detect_position_holds
//   - detect_execute_timings
//   - detect_post_plant_crossfires
//   - detect_opening_positions
//
// Threshold : sample_size >= 3 ET confidence >= 0.4 (modifiable)
//
// Usage :
//   node scripts/detect-pro-patterns.js [--map=mirage] [--type=util_lineup]
//   node scripts/detect-pro-patterns.js --min-sample=5 --min-confidence=0.5

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([a-z-]+)=(.+)$/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});

const MAP_FILTER = args.map || null;
const TYPE_FILTER = args.type || null;
const MIN_SAMPLE = parseInt(args['min-sample'] || '3', 10);
const MIN_CONFIDENCE = parseFloat(args['min-confidence'] || '0.4');

function sigHash(parts) {
  const json = JSON.stringify(parts);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

// ─── Detection wrappers (1 par pattern type) ──────────────────────────────
// Chaque wrapper :
//   1. Appelle la SQL function via RPC
//   2. Transforme chaque row en pattern object (avec pattern_data jsonb)
//   3. Retourne array de patterns

async function detectUtilLineups() {
  const { data, error } = await supabase.rpc('detect_util_lineups', {
    p_map: MAP_FILTER,
    p_min_sample: MIN_SAMPLE,
  });
  if (error) { console.warn('[util_lineup] RPC error:', error.message); return []; }
  if (!data || !data.length) return [];

  return data.map(r => ({
    pattern_type: 'util_lineup',
    map: r.map,
    side: r.player_team,
    player_steamid: r.player_steamid,
    player_name: r.player_name,
    sample_size: Number(r.sample_size),
    total_opportunities: Number(r.total_opportunities),
    confidence: Number(r.confidence),
    pattern_data: {
      grenade_type: r.grenade_type,
      thrown_pos: [r.thrown_x, r.thrown_y],
      impact_pos: [r.impact_x, r.impact_y],
      is_jumping: r.is_jumping,
    },
  }));
}

async function detectPositionHolds() {
  const { data, error } = await supabase.rpc('detect_position_holds', {
    p_map: MAP_FILTER,
    p_min_sample: MIN_SAMPLE,
    p_timing_s: 10.0,
    p_timing_window_s: 5.0,
  });
  if (error) { console.warn('[position_hold] RPC error:', error.message); return []; }
  if (!data || !data.length) return [];

  return data.map(r => ({
    pattern_type: 'position_hold',
    map: r.map,
    side: r.side,
    player_steamid: r.player_steamid,
    player_name: r.player_name,
    sample_size: Number(r.sample_size),
    total_opportunities: Number(r.total_opportunities),
    confidence: Number(r.confidence),
    pattern_data: {
      position: [r.pos_x_bucket, r.pos_y_bucket],
      timing_s: 10.0,
    },
  }));
}

async function detectExecuteTimings() {
  const { data, error } = await supabase.rpc('detect_execute_timings', {
    p_map: MAP_FILTER,
    p_min_sample: MIN_SAMPLE,
  });
  if (error) { console.warn('[execute_timing] RPC error:', error.message); return []; }
  if (!data || !data.length) return [];

  return data.map(r => ({
    pattern_type: 'execute_timing',
    map: r.map,
    side: r.side,
    player_steamid: null,  // pattern team-wide
    player_name: null,
    sample_size: Number(r.sample_size),
    total_opportunities: Number(r.total_plants),
    confidence: Number(r.confidence),
    pattern_data: {
      exec_speed: r.exec_speed,
      avg_plant_time_s: Number(r.avg_plant_time_s),
      stddev_plant_time_s: Number(r.stddev_plant_time_s),
    },
  }));
}

async function detectPostPlantCrossfires() {
  const { data, error } = await supabase.rpc('detect_post_plant_crossfires', {
    p_map: MAP_FILTER,
    p_min_sample: MIN_SAMPLE,
  });
  if (error) { console.warn('[post_plant_crossfire] RPC error:', error.message); return []; }
  if (!data || !data.length) return [];

  return data.map(r => ({
    pattern_type: 'post_plant_crossfire',
    map: r.map,
    side: r.player_team,
    player_steamid: r.player_steamid,
    player_name: r.player_name,
    sample_size: Number(r.sample_size),
    total_opportunities: Number(r.total_post_plants),
    confidence: Number(r.confidence),
    pattern_data: {
      position: [r.pos_x_bucket, r.pos_y_bucket],
    },
  }));
}

async function detectOpeningPositions() {
  const { data, error } = await supabase.rpc('detect_opening_positions', {
    p_map: MAP_FILTER,
    p_min_sample: MIN_SAMPLE,
  });
  if (error) { console.warn('[opening_position] RPC error:', error.message); return []; }
  if (!data || !data.length) return [];

  return data.map(r => ({
    pattern_type: 'opening_position',
    map: r.map,
    side: r.side,
    player_steamid: r.player_steamid,
    player_name: r.player_name,
    sample_size: Number(r.sample_size),
    total_opportunities: Number(r.total_opportunities),
    confidence: Number(r.confidence),
    pattern_data: {
      position: [r.pos_x_bucket, r.pos_y_bucket],
      timing_s: 5.0,
    },
  }));
}

// ─── Insert pattern (idempotent via signature_hash) ───────────────────────
async function insertPattern(pattern) {
  if (pattern.confidence < MIN_CONFIDENCE) return null;

  const sig = sigHash([
    pattern.pattern_type,
    pattern.map,
    pattern.side,
    pattern.player_steamid,
    pattern.pattern_data,
  ]);

  const { error } = await supabase.from('pro_demo_patterns').upsert({
    pattern_type: pattern.pattern_type,
    map: pattern.map,
    side: pattern.side,
    signature_hash: sig,
    player_steamid: pattern.player_steamid,
    player_name: pattern.player_name,
    sample_size: pattern.sample_size,
    total_opportunities: pattern.total_opportunities,
    confidence: pattern.confidence,
    pattern_data: pattern.pattern_data,
    last_seen: new Date().toISOString(),
  }, { onConflict: 'signature_hash' });

  if (error) {
    console.warn(`[insert] error : ${error.message}`);
    return null;
  }
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[detect-pro-patterns] start (map=${MAP_FILTER || 'all'}, type=${TYPE_FILTER || 'all'}, min_sample=${MIN_SAMPLE}, min_conf=${MIN_CONFIDENCE})`);

  const { count } = await supabase.from('pro_demo_events').select('*', { count: 'exact', head: true });
  console.log(`[detect] ${count} events disponibles en DB`);
  if (count === 0) {
    console.log(`[detect] no events. Run discover + download + parser first.`);
    return;
  }

  const detectors = {
    util_lineup: detectUtilLineups,
    position_hold: detectPositionHolds,
    execute_timing: detectExecuteTimings,
    post_plant_crossfire: detectPostPlantCrossfires,
    opening_position: detectOpeningPositions,
  };

  const toRun = TYPE_FILTER ? [TYPE_FILTER] : Object.keys(detectors);
  let totalDetected = 0;
  let totalInserted = 0;

  for (const type of toRun) {
    if (!detectors[type]) { console.warn(`[detect] unknown type : ${type}`); continue; }
    const patterns = await detectors[type]();
    totalDetected += patterns.length;
    console.log(`[detect] ${type} : ${patterns.length} patterns detectes (avant filtre confidence)`);

    let inserted = 0;
    for (const p of patterns) {
      const res = await insertPattern(p);
      if (res) inserted++;
    }
    totalInserted += inserted;
    console.log(`[detect] ${type} : ${inserted} inseres (apres filtre min_conf=${MIN_CONFIDENCE})`);
  }

  console.log(`\n[detect-pro-patterns] DONE. detected=${totalDetected}, inserted=${totalInserted}`);
}

main().catch(e => {
  console.error('[detect-pro-patterns] FATAL:', e);
  process.exit(1);
});
