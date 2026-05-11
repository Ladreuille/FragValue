#!/usr/bin/env node
// scripts/test-rag.js · FragValue
// Smoke test du RAG pro_demo_situations : embed N queries + RPC search + print results.
// Use cases :
//   - Valider qu'un nouveau seed a bien populated les embeddings
//   - Verifier la qualite des matches (similarity scores raisonnables)
//   - Detecter rate limits Voyage AI / OpenAI
//   - Tester de nouveaux query patterns avant de les coder dans inferSituationContext
//
// Usage : node scripts/test-rag.js
// Env : SUPABASE_URL, SUPABASE_SERVICE_KEY, VOYAGE_API_KEY (ou OPENAI_API_KEY)

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
const { findRelevantProSituations } = require('../api/_lib/pro-situations-rag.js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Queries de reference, couvrant les cas typiques que le Coach IA va voir.
// Augmente cette liste quand tu identifies de nouveaux patterns.
const TEST_QUERIES = [
  { label: 'Retake banane Inferno', ctx: { map: 'inferno', side: 'CT', situationType: 'retake_won', axes: ['utility'], userQueryHint: "pourquoi j'ai perdu le retake banane 3v2" } },
  { label: 'Opening AWP Mirage CT mid', ctx: { map: 'mirage', side: 'CT', situationType: 'opening_kill', axes: ['aim', 'crosshair'], userQueryHint: "comment hold mid AWP Mirage" } },
  { label: 'Execute T Nuke', ctx: { map: 'nuke', side: 'T', situationType: 'execute_won', axes: ['utility', 'comms'], userQueryHint: "comment B execute Nuke depuis outside" } },
  { label: 'Clutch 1v3 generique (no map filter)', ctx: { axes: ['mental', 'gamesense'], userQueryHint: "1v3 clutch comment garder calme" } },
  { label: 'Anti-eco CT Inferno', ctx: { map: 'inferno', side: 'CT', situationType: 'anti_eco', axes: ['economy', 'aim'], userQueryHint: "anti-eco quoi stack" } },
  { label: 'Aim duel pattern (no specifics)', ctx: { situationType: 'aim_duel', axes: ['aim', 'crosshair'], userQueryHint: "comment ameliorer mon aim" } },
  { label: 'Edge: map inconnue (cobblestone)', ctx: { map: 'cobblestone', axes: ['aim'], userQueryHint: "test fallback semantic — map devrait fallback semantic" } },
];

(async () => {
  console.log(`Running ${TEST_QUERIES.length} smoke tests against pro_demo_situations RAG\n`);
  let totalHits = 0, totalLatencyMs = 0, errors = 0;
  for (const t of TEST_QUERIES) {
    console.log('━'.repeat(70));
    console.log('TEST :', t.label);
    console.log('  Context :', JSON.stringify(t.ctx));
    const t0 = Date.now();
    try {
      const sits = await findRelevantProSituations(supabase, t.ctx, {
        k: 3, minNotable: 6, similarityThreshold: 0.40, // threshold abaisse pour visibilite tests
      });
      const dt = Date.now() - t0;
      totalLatencyMs += dt;
      totalHits += sits.length;
      console.log(`  Latence : ${dt}ms · Hits : ${sits.length}`);
      if (sits.length === 0) {
        console.log('  (aucun hit au threshold 0.40)');
        continue;
      }
      sits.forEach((s, i) => {
        const sim = (s.similarity * 100).toFixed(0);
        const flag = s.similarity < 0.55 ? ' ⚠️ <55% (weak)' : s.similarity > 0.70 ? ' ✓ strong' : '';
        console.log(`  [${i + 1}] ${s.pro_name} · ${s.map}/${s.side}/${s.situation_type} · sim ${sim}%${flag} · notable ${s.notable_rating}/10`);
        console.log(`      ${s.description.slice(0, 120)}...`);
      });
    } catch (e) {
      errors++;
      console.error('  ERROR :', e.message);
    }
  }
  console.log('━'.repeat(70));
  console.log('\nSUMMARY');
  console.log(`  Tests run    : ${TEST_QUERIES.length}`);
  console.log(`  Errors       : ${errors}`);
  console.log(`  Total hits   : ${totalHits} (avg ${(totalHits / TEST_QUERIES.length).toFixed(1)} per query)`);
  console.log(`  Avg latency  : ${Math.round(totalLatencyMs / TEST_QUERIES.length)}ms`);
  console.log(`  Status       : ${errors === 0 && totalHits >= TEST_QUERIES.length ? '✅ healthy' : errors > 0 ? '⚠️ errors detected' : '⚠️ low hit rate'}`);
  process.exit(0);
})();
