#!/usr/bin/env node
/* eslint-disable */
// scripts/generate-pattern-entries.js · FragValue · Option B Phase 4
//
// Convertit les patterns detectes (pro_demo_patterns) en entries corpus RAG
// (pro_demo_situations) via Claude (description naturelle) + Voyage (embedding).
//
// Pipeline :
//   1. SELECT pro_demo_patterns WHERE pro_demo_situation_id IS NULL AND confidence >= 0.4
//   2. Pour chaque pattern : Claude convertit pattern_data → description CS2 pro
//   3. Embed via Voyage
//   4. Insert dans pro_demo_situations
//   5. Link via pro_demo_patterns.pro_demo_situation_id = inserted.id
//
// Cost estime : ~$0.002 par pattern (Claude haiku + Voyage embedding)
// Pour 200 patterns → $0.40 one-shot.
//
// Usage :
//   node scripts/generate-pattern-entries.js [--limit=50] [--dry-run]

const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { createClient } = require('@supabase/supabase-js');
const { callClaude, parseJsonRobust, MODELS } = require('../api/_lib/claude-client.js');
const { embed } = require('../api/_lib/embeddings.js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([a-z-]+)=(.+)?$/);
  if (m) acc[m[1]] = m[2] || true;
  return acc;
}, {});
const LIMIT = parseInt(args.limit || '50', 10);
const DRY_RUN = !!args['dry-run'];

// ─── System prompt pour conversion pattern → entry ─────────────────────────
const SYSTEM_PROMPT = `Tu es un analyste CS2 qui convertit des patterns tactiques detectes (extraits de demos pros HLTV) en entries de corpus RAG pour un coach IA.

Regles strictes :
- Vocabulaire CS2 pro (callouts officiels, terms HLTV)
- Pas d'invention : utilise UNIQUEMENT les data du pattern fourni
- Pas de markdown, juste du texte coulant
- Output JSON valide selon le schema fourni

Output format (JSON strict) :
{
  "description": "2-3 phrases naturelles decrivant le pattern observe. Cite le pro, la map, le side, ce qu'il fait, et le sample size.",
  "tactical_notes": "3-5 phrases : pourquoi ce pattern marche, comment le reproduire, lecon applicable pour un joueur amateur.",
  "key_callouts": ["callout1", "callout2", "callout3"],
  "axes_demonstrated": ["axe1", "axe2"],
  "notable_rating": 7
}

Axes possibles : aim, crosshair, spray, utility, positioning, gamesense, economy, mental, movement, comms, reaction

Notable rating (1-10) :
- 9-10 : pattern execute par 1-2 pros mondiaux avec confidence > 0.6 et sample_size > 10
- 7-8 : pattern reproductible avec confidence 0.4-0.6 et sample_size 5-10
- 5-6 : pattern emergent (confidence 0.4 minimum, sample_size 3-5)`;

// ─── Pattern → user prompt ─────────────────────────────────────────────────
function buildUserPrompt(pattern) {
  return `Pattern detecte (extrait de demos pros HLTV) :

- Type : ${pattern.pattern_type}
- Map : ${pattern.map}
- Side : ${pattern.side || 'both'}
- Pro : ${pattern.player_name || 'inconnu'} (steamid ${pattern.player_steamid?.slice(-8) || 'na'})
- Team : ${pattern.team_name || 'inconnu'}
- Sample size : ${pattern.sample_size} occurrences
- Total opportunities : ${pattern.total_opportunities || 'na'}
- Confidence : ${(pattern.confidence * 100).toFixed(0)}%

Data specifique :
${JSON.stringify(pattern.pattern_data, null, 2)}

Convertis en entry corpus JSON selon le schema.`;
}

// ─── Map pattern_type → situation_type pour pro_demo_situations ──────────
function patternToSituationType(patternType, patternData) {
  switch (patternType) {
    case 'util_lineup':
      const gt = patternData?.grenade_type || '';
      if (gt === 'flash') return 'flash_assist';
      if (gt === 'smoke' || gt === 'molotov' || gt === 'incgrenade') return 'util_setup';
      return 'util_setup';
    case 'position_hold':
    case 'opening_position':
      return 'opening_kill';
    case 'execute_timing':
      return 'execute_won';
    case 'post_plant_crossfire':
      return 'post_plant';
    case 'lurk_timing':
      return 'lurk_impact';
    default:
      return 'util_setup';
  }
}

// ─── Generate single entry ────────────────────────────────────────────────
async function generateEntry(pattern) {
  // 1. Claude generation (Haiku 4.5 — patterns courts, pas besoin Opus)
  const messages = [{ role: 'user', content: buildUserPrompt(pattern) }];
  const result = await callClaude({
    model: MODELS.HAIKU_45,
    system: SYSTEM_PROMPT,
    messages,
    maxTokens: 1500,
    cacheSystem: true,
    cacheTtl: '1h',
  });

  let parsed;
  try {
    parsed = parseJsonRobust(result.text);
  } catch (e) {
    console.warn(`  Claude parse error : ${e.message}`);
    return null;
  }

  // 2. Build embedding text + embed
  const embedText = `${parsed.description} ${parsed.tactical_notes}`;
  let vector;
  try {
    vector = await embed(embedText, { inputType: 'document' });
  } catch (e) {
    console.warn(`  embed error : ${e.message}`);
    return null;
  }

  // 3. Insert dans pro_demo_situations
  const situationType = patternToSituationType(pattern.pattern_type, pattern.pattern_data);
  const row = {
    map: pattern.map,
    side: pattern.side || 'both',
    situation_type: situationType,
    pro_name: pattern.player_name || 'pro pattern',
    match_event: null,
    description: parsed.description,
    tactical_notes: parsed.tactical_notes,
    key_callouts: parsed.key_callouts || null,
    axes_demonstrated: parsed.axes_demonstrated || null,
    embedding: vector,
    notable_rating: parsed.notable_rating || 7,
  };

  if (DRY_RUN) {
    console.log(`  [DRY] would insert : ${row.pro_name} ${row.map}/${row.side}/${row.situation_type} notable=${row.notable_rating}`);
    return { id: 'dry-run' };
  }

  const { data: inserted, error } = await supabase
    .from('pro_demo_situations')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    console.warn(`  insert error : ${error.message}`);
    return null;
  }

  // 4. Link pattern → situation
  await supabase
    .from('pro_demo_patterns')
    .update({ pro_demo_situation_id: inserted.id })
    .eq('id', pattern.id);

  return inserted;
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[generate-pattern-entries] start (limit=${LIMIT}${DRY_RUN ? ' DRY-RUN' : ''})`);

  // Recupere patterns unlinked avec confidence suffisante
  const { data: patterns, error } = await supabase
    .from('pro_demo_patterns')
    .select('*')
    .is('pro_demo_situation_id', null)
    .gte('confidence', 0.4)
    .gte('sample_size', 3)
    .order('confidence', { ascending: false })
    .limit(LIMIT);

  if (error) throw error;
  if (!patterns || patterns.length === 0) {
    console.log('[generate] no eligible patterns. Run detect-pro-patterns first.');
    return;
  }
  console.log(`[generate] ${patterns.length} patterns to convert`);

  let generated = 0;
  let failed = 0;

  for (const pattern of patterns) {
    console.log(`\n[${generated + failed + 1}/${patterns.length}] ${pattern.pattern_type} ${pattern.map}/${pattern.side} ${pattern.player_name || ''} sample=${pattern.sample_size} conf=${pattern.confidence}`);
    try {
      const result = await generateEntry(pattern);
      if (result) generated++;
      else failed++;
    } catch (e) {
      console.error(`  ERROR : ${e.message}`);
      failed++;
    }
  }

  console.log(`\n[generate-pattern-entries] DONE. generated=${generated}, failed=${failed}`);
}

main().catch(e => {
  console.error('[generate-pattern-entries] FATAL:', e);
  process.exit(1);
});
