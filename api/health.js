// api/health.js · FragValue
// Endpoint public read-only qui check les dependances critiques en parallele.
// Retourne 200 toujours (meme si degraded) avec { components: { name: status, latency_ms } }.
//
// Public : no auth. CORS open. Caches 30s pour limiter les calls.
//
// Usage : /status.html consomme cet endpoint en client-side toutes les 30s.
// Sortie consommable aussi par uptimerobot ou autre monitor externe.

const { createClient } = require('@supabase/supabase-js');

async function timeIt(fn, timeoutMs = 5000) {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const result = await fn(ctrl.signal);
    clearTimeout(t);
    return { ok: !!result, latency_ms: Date.now() - start };
  } catch (e) {
    return { ok: false, latency_ms: Date.now() - start, error: String(e.message || e).slice(0, 100) };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');

  const started = Date.now();

  // Supabase : un SELECT trivial sur une table publique (faceit_leaderboard_cache RLS=public read).
  // Si Supabase est down, ca echoue dans les 5s.
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY);
  const supabaseCheck = timeIt(async () => {
    const { error } = await supabase.from('faceit_leaderboard_cache').select('region', { count: 'exact', head: true }).limit(1);
    return !error;
  });

  // Parser Railway : GET /ping (existant).
  const PARSER_URL = process.env.PARSER_URL || 'https://fragvalue-demo-parser-production.up.railway.app';
  const parserCheck = timeIt(async (signal) => {
    const r = await fetch(`${PARSER_URL}/ping`, { signal });
    return r.ok;
  });

  // FACEIT Data API : check anon endpoint (no auth required pour /games/cs2).
  // Si FACEIT est down, on saura.
  const faceitCheck = timeIt(async (signal) => {
    const r = await fetch('https://open.faceit.com/data/v4/games/cs2', {
      signal,
      headers: { 'Authorization': `Bearer ${process.env.FACEIT_API_KEY || ''}` },
    });
    return r.ok;
  });

  // Anthropic : on ne fait PAS de call (coute des credits). On check juste que ANTHROPIC_API_KEY est set.
  // Pour un vrai monitoring c'est insuffisant mais ca evite de cramer du budget.
  const anthropicCheck = {
    ok: !!process.env.ANTHROPIC_API_KEY,
    latency_ms: 0,
    note: 'API key presence only (no actual ping to save credits)',
  };

  // Stripe : check public health endpoint (Stripe expose status.stripe.com).
  // Pour simplicite on check juste que la key Stripe est set + format valide.
  const stripeCheck = {
    ok: !!process.env.STRIPE_SECRET_KEY && /^sk_/.test(process.env.STRIPE_SECRET_KEY),
    latency_ms: 0,
    note: 'Key presence/format check only',
  };

  const [supabase_res, parser_res, faceit_res] = await Promise.all([supabaseCheck, parserCheck, faceitCheck]);

  const components = {
    supabase: supabase_res,
    parser_railway: parser_res,
    faceit_api: faceit_res,
    anthropic: anthropicCheck,
    stripe: stripeCheck,
  };

  const allOk = Object.values(components).every(c => c.ok);
  const someOk = Object.values(components).some(c => c.ok);
  const status = allOk ? 'operational' : (someOk ? 'degraded' : 'major_outage');

  return res.status(200).json({
    status,
    components,
    checked_at: new Date().toISOString(),
    total_latency_ms: Date.now() - started,
  });
};
