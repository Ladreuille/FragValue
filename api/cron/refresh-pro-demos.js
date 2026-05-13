// api/cron/refresh-pro-demos.js · FragValue · Option B Phase 5
//
// Cron Vercel hebdo qui orchestre le refresh du corpus RAG pro_demo_situations
// depuis les nouveaux matchs pros ingerees.
//
// IMPORTANT : ce cron NE fait PAS le download des .dem (HLTV bloque Vercel).
// Il oriente le pipeline en :
//   1. Detectant les nouveaux pro_matches (avec demos discoverable)
//   2. Triggant le parser Railway sur les pro_demos en status='parsing' (apres
//      qu'un humain ait run discover + download en local)
//   3. Lancant la pattern detection sur les events fraichement parsees
//   4. Generant les entries corpus via Claude + Voyage
//
// Schedule : 0 5 * * 1  (lundi 5h UTC, 1h apres pro-benchmarks-refresh)
//
// Active dans vercel.json :
//   "crons": [ { "path": "/api/cron/refresh-pro-demos", "schedule": "0 5 * * 1" } ]
//
// Workflow humain hebdomadaire (Quentin) :
//   1. Run local : node scripts/discover-pro-demos.js --limit=20
//   2. Run local : node scripts/download-pro-demos.js --limit=5
//   3. (Le cron trigger le parser + pattern detection + generation auto)
//
// Securite : Bearer CRON_SECRET (Vercel injecte auto).

const { createClient } = require('@supabase/supabase-js');

const PARSER_URL = process.env.PARSER_URL || 'https://fragvalue-demo-parser-production.up.railway.app';
const PARSER_SECRET = process.env.PARSER_SECRET;
const SITE_URL = process.env.SITE_URL || 'https://fragvalue.com';

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

module.exports = async function handler(req, res) {
  // ─── Auth cron Vercel ─────────────────────────────────────────────────
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('[cron refresh-pro-demos] CRON_SECRET non configure');
    return res.status(503).json({ error: 'Cron secret not configured' });
  }
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = Date.now();
  const report = {
    parser_triggered: 0,
    parser_completed: 0,
    parser_failed: 0,
    new_patterns_detected: 0,
    new_entries_generated: 0,
    errors: [],
  };

  try {
    // ─── Etape 1 : Trigger parser sur les pro_demos en status='parsing' ────
    // L'humain a deja run discover + download localement, donc les .dem sont
    // dans Supabase Storage. On notifie Railway pour parser.
    if (PARSER_URL && PARSER_SECRET) {
      const { data: pending } = await sb()
        .from('pro_demos')
        .select('id, pro_match_map_id, storage_path')
        .eq('status', 'parsing')
        .not('storage_path', 'is', null)
        .order('created_at', { ascending: true })
        .limit(10);

      if (pending && pending.length > 0) {
        console.log(`[cron] triggering parser on ${pending.length} pending demos`);

        for (const demo of pending) {
          try {
            // Generate signed URL pour le parser (valide 2h)
            const { data: signedUrlData } = await sb().storage
              .from('pro-demos')
              .createSignedUrl(demo.storage_path, 2 * 60 * 60);

            if (!signedUrlData?.signedUrl) {
              throw new Error('signed URL gen failed');
            }

            const parserRes = await fetch(`${PARSER_URL}/process-pro-demo`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${PARSER_SECRET}`,
              },
              body: JSON.stringify({
                proMatchMapId: demo.pro_match_map_id,
                demoUrl: signedUrlData.signedUrl,
                tickRate: 64,  // pro demos
                callbackUrl: `${SITE_URL}/api/admin/pro-demo-parsed`,
              }),
            });

            if (parserRes.ok) {
              report.parser_triggered++;
            } else {
              const text = await parserRes.text();
              report.errors.push(`parser ${demo.id}: ${parserRes.status} ${text.slice(0, 100)}`);
            }
          } catch (e) {
            report.errors.push(`trigger ${demo.id}: ${e.message}`);
          }
        }
      }
    }

    // ─── Etape 2 : Stats patterns + corpus pour observabilite ──────────────
    const { count: parsedCount } = await sb()
      .from('pro_demos')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'parsed');

    const { count: eventsCount } = await sb()
      .from('pro_demo_events')
      .select('*', { count: 'exact', head: true });

    const { count: patternsCount } = await sb()
      .from('pro_demo_patterns')
      .select('*', { count: 'exact', head: true });

    const { count: corpusCount } = await sb()
      .from('pro_demo_situations')
      .select('*', { count: 'exact', head: true });

    const { count: unlinkedPatterns } = await sb()
      .from('pro_demo_patterns')
      .select('*', { count: 'exact', head: true })
      .is('pro_demo_situation_id', null)
      .gte('confidence', 0.4);

    report.stats = {
      parsed_demos: parsedCount || 0,
      raw_events: eventsCount || 0,
      patterns: patternsCount || 0,
      corpus_entries: corpusCount || 0,
      unlinked_patterns_eligible: unlinkedPatterns || 0,
    };

    // ─── Etape 3 : Note sur pattern detection + auto-generation ────────────
    // Pattern detection + auto-gen ne tourne PAS sur ce cron (necessite Voyage
    // API qui peut etre lent, et la detection SQL doit etre run en local pour
    // l'instant). On log juste l'etat.
    report.note = 'Pattern detection + auto-generation : run en local via node scripts/detect-pro-patterns.js + node scripts/generate-pattern-entries.js';

    const durationMs = Date.now() - startedAt;
    console.log(`[cron refresh-pro-demos] DONE ${durationMs}ms`, JSON.stringify(report));

    return res.status(200).json({
      ok: true,
      duration_ms: durationMs,
      ...report,
    });
  } catch (e) {
    console.error('[cron refresh-pro-demos] FATAL:', e);
    return res.status(500).json({ error: e.message, report });
  }
};
