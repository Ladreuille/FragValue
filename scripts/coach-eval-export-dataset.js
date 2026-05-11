#!/usr/bin/env node
// scripts/coach-eval-export-dataset.js · FragValue
//
// Exporte 50 player profiles anonymises depuis Supabase pour l'eval Coach IA.
// Cf. docs/coach-ia-eval-rubric.md pour le protocole complet.
//
// Output : eval-dataset.json + eval-dataset.csv dans /tmp/coach-eval/
//
// Selection criteria :
//   - Joueurs ayant au moins 1 diag ai-roadmap genere (table diagnostic_history)
//   - Diag genere il y a < 30 jours (data fraicheur)
//   - Min 10 matchs FACEIT sur la fenetre du diag
//   - Diversite : 70% lvl 5-8 (cible principale), 20% lvl 9-10, 10% lvl 1-4
//
// Anonymisation :
//   - Pseudo FACEIT → "Player-XX" (ordre aleatoire)
//   - user_id retire
//   - faceit_player_id retire
//   - emails / IPs retires
//   - Le diagnostic IA conserve mais avec name replace
//
// Usage : node scripts/coach-eval-export-dataset.js [--limit=50] [--out=/tmp/coach-eval]

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ── Load .env.local si present ──────────────────────────────────────────
const envPath = path.resolve(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) {
      const [, k, v] = m;
      if (!process.env[k]) process.env[k] = v.replace(/^["']|["']$/g, '');
    }
  }
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ─── Args parsing ──────────────────────────────────────────────────────────
const args = process.argv.slice(2).reduce((acc, a) => {
  const m = a.match(/^--([a-z-]+)=(.+)$/);
  if (m) acc[m[1]] = m[2];
  return acc;
}, {});
const LIMIT = parseInt(args.limit || '50', 10);
const OUT_DIR = args.out || '/tmp/coach-eval';

// ─── Anonymisation helpers ─────────────────────────────────────────────────
// Hash deterministe pour mapping pseudo -> alias (reproductible entre runs).
const SALT = process.env.IP_HASH_SALT || 'fragvalue-eval-salt-2026';
function anonId(pseudo) {
  return crypto.createHash('sha256').update(SALT + ':' + (pseudo || '')).digest('hex').slice(0, 8);
}

// Replace pseudo dans un texte par "Player-<hash>".
function sanitizeText(s, pseudoMap) {
  if (!s) return s;
  let out = String(s);
  for (const [orig, alias] of pseudoMap) {
    if (!orig) continue;
    const re = new RegExp(`\\b${orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    out = out.replace(re, alias);
  }
  // Remove emails / URLs evidents
  out = out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<email>');
  out = out.replace(/https?:\/\/[^\s)]+/g, '<url>');
  return out;
}

// Recursive sanitize d'un object (JSON-style).
function sanitizeObject(obj, pseudoMap) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeText(obj, pseudoMap);
  if (typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.map(x => sanitizeObject(x, pseudoMap));
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      // Skip champs sensibles
      if (['user_id', 'faceit_player_id', 'email', 'stripe_customer_id', 'ip', 'ip_hash'].includes(k)) {
        continue;
      }
      out[k] = sanitizeObject(v, pseudoMap);
    }
    return out;
  }
  return obj;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[eval-export] Loading up to ${LIMIT} diagnostics...`);

  // Recupere les diagnostics recents (< 30 jours) avec join profile + demos
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: diagnostics, error } = await supabase
    .from('diagnostic_history')
    .select('id, user_id, endpoint, generated_at, axis_scores, top_priorities, diagnosis_json, faceit_level, faceit_elo, faceit_nickname')
    .eq('endpoint', 'ai-roadmap')
    .gte('generated_at', thirtyDaysAgo)
    .order('generated_at', { ascending: false })
    .limit(LIMIT * 3); // overfetch pour filtrer ensuite

  if (error) throw new Error('diagnostic_history fetch: ' + error.message);
  if (!diagnostics || diagnostics.length === 0) {
    console.warn('[eval-export] Aucun diagnostic trouve dans les 30 derniers jours.');
    return;
  }

  console.log(`[eval-export] ${diagnostics.length} diagnostics recents trouves.`);

  // Stratified sampling par tier FACEIT
  const tiered = {
    low: diagnostics.filter(d => d.faceit_level >= 1 && d.faceit_level <= 4),
    mid: diagnostics.filter(d => d.faceit_level >= 5 && d.faceit_level <= 8),
    high: diagnostics.filter(d => d.faceit_level >= 9 && d.faceit_level <= 10),
  };
  console.log(`[eval-export] Distribution : low=${tiered.low.length}, mid=${tiered.mid.length}, high=${tiered.high.length}`);

  const targetCounts = {
    low: Math.min(Math.ceil(LIMIT * 0.1), tiered.low.length),
    mid: Math.min(Math.ceil(LIMIT * 0.7), tiered.mid.length),
    high: Math.min(Math.ceil(LIMIT * 0.2), tiered.high.length),
  };
  console.log(`[eval-export] Target : low=${targetCounts.low}, mid=${targetCounts.mid}, high=${targetCounts.high}`);

  // Random shuffle par tier puis pick N
  const shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);
  const sampled = [
    ...shuffle(tiered.low).slice(0, targetCounts.low),
    ...shuffle(tiered.mid).slice(0, targetCounts.mid),
    ...shuffle(tiered.high).slice(0, targetCounts.high),
  ];

  if (sampled.length < LIMIT) {
    // Fallback : complete avec ceux restants si on n'a pas atteint LIMIT
    const remaining = diagnostics.filter(d => !sampled.includes(d));
    sampled.push(...shuffle(remaining).slice(0, LIMIT - sampled.length));
  }

  console.log(`[eval-export] Sampled ${sampled.length} diagnostics.`);

  // Build pseudoMap pour anonymisation
  const pseudoMap = new Map();
  sampled.forEach((d, i) => {
    pseudoMap.set(d.faceit_nickname, `Player-${String(i + 1).padStart(2, '0')}`);
  });

  // Anonymise et structure pour eval
  const dataset = sampled.map((d, i) => {
    const alias = `Player-${String(i + 1).padStart(2, '0')}`;
    const tier = d.faceit_level >= 9 ? 'high' : d.faceit_level >= 5 ? 'mid' : 'low';
    return {
      profile_id: alias,
      profile_id_hash: anonId(d.faceit_nickname), // pour deduplication entre exports
      tier,
      faceit_level: d.faceit_level,
      faceit_elo: d.faceit_elo,
      diagnosis_generated_at: d.generated_at,
      // Diagnostic IA full (anonymise)
      ai_diagnosis: sanitizeObject(d.diagnosis_json, pseudoMap),
      // Axis scores que l'IA a auto-rapportes (pour comparison juges)
      ai_self_axis_scores: d.axis_scores || {},
      ai_top_priorities: d.top_priorities || [],
      // Pas de coach humain encore, le coach va recevoir un export "stats only"
      // pour produire son propre diag (cf. eval-input-for-coach.json plus bas)
    };
  });

  // ─── Build "input for human coach" : prive du diag IA, juste stats raw ──
  // Le coach humain recevra ce fichier pour produire son diag a froid.
  const inputForCoach = dataset.map(d => ({
    profile_id: d.profile_id,
    tier: d.tier,
    faceit_level: d.faceit_level,
    faceit_elo: d.faceit_elo,
    // On extrait les stats raw du diagnosis_json (les coachs ne voient PAS le diag IA)
    raw_stats: d.ai_diagnosis?._meta || {},
    // TODO : enrichir avec FACEIT API call frais (au moment de l'eval, plus reliable)
    note_for_coach: `Analyse ce joueur comme tu le ferais pour un client. Produis un diagnostic personnalise en suivant le format du rubric (docs/coach-ia-eval-rubric.md). 10 axes obligatoires. Cible : output JSON avec champs : topPriorities, deepDive, drills, proRefs, axisNotes, confidence, sampleSize.`,
  }));

  // ─── Output ─────────────────────────────────────────────────────────────
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const datasetPath = path.join(OUT_DIR, 'eval-dataset.json');
  fs.writeFileSync(datasetPath, JSON.stringify(dataset, null, 2));
  console.log(`[eval-export] Wrote ${dataset.length} entries to ${datasetPath}`);

  const coachInputPath = path.join(OUT_DIR, 'eval-input-for-coach.json');
  fs.writeFileSync(coachInputPath, JSON.stringify(inputForCoach, null, 2));
  console.log(`[eval-export] Wrote coach input to ${coachInputPath}`);

  // CSV pour judging dans Google Sheets / Excel
  const csvRows = [
    ['profile_id', 'tier', 'faceit_level', 'faceit_elo', 'ai_top_priorities', 'ai_self_score_avg'].join(','),
    ...dataset.map(d => {
      const avgScore = d.ai_self_axis_scores
        ? Object.values(d.ai_self_axis_scores).reduce((s, v) => s + (v || 0), 0) / Math.max(Object.keys(d.ai_self_axis_scores).length, 1)
        : 0;
      const prioStr = '"' + (d.ai_top_priorities || []).join(' | ').replace(/"/g, '""') + '"';
      return [d.profile_id, d.tier, d.faceit_level, d.faceit_elo || 0, prioStr, avgScore.toFixed(1)].join(',');
    }),
  ];
  const csvPath = path.join(OUT_DIR, 'eval-dataset.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`[eval-export] Wrote CSV summary to ${csvPath}`);

  // README + pseudoMap (pour debug interne uniquement, JAMAIS partage)
  const readme = `# Dataset Coach IA eval (export ${new Date().toISOString().slice(0, 10)})

- ${dataset.length} profiles
- Tiers : ${JSON.stringify(targetCounts)}
- Anonymisation : pseudos -> Player-NN, IDs sensibles retires.

## Files

- eval-dataset.json : diagnostics IA complets anonymises (pour judging).
- eval-input-for-coach.json : input minimal pour coachs humains (pas de diag IA).
- eval-dataset.csv : summary tabulaire pour planning.
- pseudo-map.private.json : mapping pseudo orig -> alias (PRIVATE, ne pas commiter).

## Protocole

Cf. docs/coach-ia-eval-rubric.md.
`;
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme);

  const pseudoMapObj = Object.fromEntries(pseudoMap);
  fs.writeFileSync(path.join(OUT_DIR, 'pseudo-map.private.json'), JSON.stringify(pseudoMapObj, null, 2));
  console.log(`[eval-export] Wrote README + pseudo-map (PRIVATE) to ${OUT_DIR}`);

  console.log('\n[eval-export] DONE. Next steps :');
  console.log('  1. Revoir eval-dataset.json + verifier anonymisation OK');
  console.log('  2. Commissionner 3-5 coachs humains (eval-input-for-coach.json)');
  console.log('  3. Setup Google Form judging (eval-dataset.csv pour template)');
  console.log('  4. Run judges sur les 50 profiles (IA blind A/B vs coach humain)');
  console.log('  5. Stats agreges + report');
}

main().catch(e => {
  console.error('[eval-export] FATAL:', e);
  process.exit(1);
});
