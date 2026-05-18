// api/cron/detect-pro-patterns.js · FragValue
//
// Cron qui detecte les patterns tactiques dans pro_demo_events et les
// insert dans pro_demo_patterns (avec confidence scoring).
//
// PIPELINE OPTION B :
//   1. Discover demos pros (cron refresh-pro-demos)
//   2. Download + parse demos (parser Railway /process-pro-demo, ecrit
//      dans pro_demo_events)
//   3. Detect patterns recurrents (ce cron) -> pro_demo_patterns
//   4. Generate RAG corpus entries depuis patterns (scripts/generate-
//      pattern-entries.js, manuel pour l instant) -> pro_demo_situations
//
// SCHEDULE : weekly (lundi 6h, juste apres refresh-pro-demos qui run a 5h
// le lundi). On a besoin que les demos soient parsees AVANT de detecter.
//
// COMPLEXITE :
//   - Appelle 5 SQL functions Postgres (detect_util_lineups, etc.) qui
//     font tout l'aggregation cote DB (rapide, indexes pre-existants).
//   - Pour chaque pattern : signature_hash dedup + upsert into pro_demo_patterns.
//   - Pas de batching (les RPC retournent quelques 100ne de patterns max).
//   - Timeout Vercel 60s suffisant (les RPCs prennent <5s sur le dataset
//     actuel ~3-5k events; scale-up requis a >100k events probablement).

const { createClient } = require('@supabase/supabase-js');
const crypto = require('node:crypto');

const MIN_SAMPLE = 3;
const MIN_CONFIDENCE = 0.4;

function sigHash(parts) {
  const json = JSON.stringify(parts);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── Detectors : un par pattern type ──────────────────────────────────────
async function detectUtilLineups(s) {
  const { data, error } = await s.rpc('detect_util_lineups', { p_map: null, p_min_sample: MIN_SAMPLE });
  if (error) { console.warn('[util_lineup] RPC error:', error.message); return []; }
  return (data || []).map(r => ({
    pattern_type: 'util_lineup', map: r.map, side: r.player_team,
    player_steamid: r.player_steamid, player_name: r.player_name,
    sample_size: Number(r.sample_size), total_opportunities: Number(r.total_opportunities),
    confidence: Number(r.confidence),
    pattern_data: {
      grenade_type: r.grenade_type,
      thrown_pos: [r.thrown_x, r.thrown_y],
      impact_pos: [r.impact_x, r.impact_y],
      is_jumping: r.is_jumping,
    },
  }));
}

async function detectPositionHolds(s) {
  const { data, error } = await s.rpc('detect_position_holds', {
    p_map: null, p_min_sample: MIN_SAMPLE, p_timing_s: 10.0, p_timing_window_s: 5.0,
  });
  if (error) { console.warn('[position_hold] RPC error:', error.message); return []; }
  return (data || []).map(r => ({
    pattern_type: 'position_hold', map: r.map, side: r.side,
    player_steamid: r.player_steamid, player_name: r.player_name,
    sample_size: Number(r.sample_size), total_opportunities: Number(r.total_opportunities),
    confidence: Number(r.confidence),
    pattern_data: { position: [r.pos_x_bucket, r.pos_y_bucket], timing_s: 10.0 },
  }));
}

async function detectExecuteTimings(s) {
  const { data, error } = await s.rpc('detect_execute_timings', { p_map: null, p_min_sample: MIN_SAMPLE });
  if (error) { console.warn('[execute_timing] RPC error:', error.message); return []; }
  return (data || []).map(r => ({
    pattern_type: 'execute_timing', map: r.map, side: r.side,
    player_steamid: null, player_name: null,
    sample_size: Number(r.sample_size), total_opportunities: Number(r.total_plants),
    confidence: Number(r.confidence),
    pattern_data: {
      exec_speed: r.exec_speed,
      avg_plant_time_s: Number(r.avg_plant_time_s),
      stddev_plant_time_s: Number(r.stddev_plant_time_s),
    },
  }));
}

async function detectPostPlantCrossfires(s) {
  const { data, error } = await s.rpc('detect_post_plant_crossfires', { p_map: null, p_min_sample: MIN_SAMPLE });
  if (error) { console.warn('[post_plant_crossfire] RPC error:', error.message); return []; }
  return (data || []).map(r => ({
    pattern_type: 'post_plant_crossfire', map: r.map, side: r.player_team,
    player_steamid: r.player_steamid, player_name: r.player_name,
    sample_size: Number(r.sample_size), total_opportunities: Number(r.total_post_plants),
    confidence: Number(r.confidence),
    pattern_data: { position: [r.pos_x_bucket, r.pos_y_bucket] },
  }));
}

async function detectOpeningPositions(s) {
  const { data, error } = await s.rpc('detect_opening_positions', { p_map: null, p_min_sample: MIN_SAMPLE });
  if (error) { console.warn('[opening_position] RPC error:', error.message); return []; }
  return (data || []).map(r => ({
    pattern_type: 'opening_position', map: r.map, side: r.side,
    player_steamid: r.player_steamid, player_name: r.player_name,
    sample_size: Number(r.sample_size), total_opportunities: Number(r.total_opportunities),
    confidence: Number(r.confidence),
    pattern_data: { position: [r.pos_x_bucket, r.pos_y_bucket], timing_s: 5.0 },
  }));
}

async function insertPattern(s, pattern) {
  if (pattern.confidence < MIN_CONFIDENCE) return false;
  const sig = sigHash([pattern.pattern_type, pattern.map, pattern.side, pattern.player_steamid, pattern.pattern_data]);
  const { error } = await s.from('pro_demo_patterns').upsert({
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
    console.warn('[insert] error:', error.message);
    return false;
  }
  return true;
}

module.exports = async function handler(req, res) {
  // Auth cron
  const auth = req.headers.authorization || '';
  const expected = process.env.CRON_SECRET;
  const valid = expected && (auth === `Bearer ${expected}` || req.query?.secret === expected);
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = sb();
  const startedAt = Date.now();
  const stats = { detected: 0, inserted: 0, by_type: {}, errors: [] };

  try {
    // Skip si aucun event dispo (cas demos pas encore parsees)
    const { count } = await supabase.from('pro_demo_events').select('*', { count: 'exact', head: true });
    if (!count) {
      return res.status(200).json({ ok: true, skipped: 'no_events', took_ms: Date.now() - startedAt });
    }

    const detectors = {
      util_lineup: detectUtilLineups,
      position_hold: detectPositionHolds,
      execute_timing: detectExecuteTimings,
      post_plant_crossfire: detectPostPlantCrossfires,
      opening_position: detectOpeningPositions,
    };

    for (const [type, detector] of Object.entries(detectors)) {
      try {
        const patterns = await detector(supabase);
        stats.detected += patterns.length;
        stats.by_type[type] = { detected: patterns.length, inserted: 0 };
        for (const p of patterns) {
          const ok = await insertPattern(supabase, p);
          if (ok) {
            stats.inserted++;
            stats.by_type[type].inserted++;
          }
        }
      } catch (e) {
        stats.errors.push({ type, error: e.message });
        console.error(`[detect-pro-patterns] ${type} failed:`, e.message);
      }
    }

    return res.status(200).json({ ok: true, ...stats, took_ms: Date.now() - startedAt });
  } catch (err) {
    console.error('[detect-pro-patterns] FATAL:', err);
    try {
      const { sendAlert } = require('../_lib/alert.js');
      await sendAlert({
        severity: 'medium',
        title: 'Cron detect-pro-patterns crashed',
        details: { error: err.message, stack: err.stack?.slice(0, 600), stats },
        source: 'cron/detect-pro-patterns',
      });
    } catch (_) {}
    return res.status(500).json({ error: err.message, ...stats });
  }
};
