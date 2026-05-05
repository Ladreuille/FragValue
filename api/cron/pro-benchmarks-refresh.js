// api/cron/pro-benchmarks-refresh.js
// Cron Vercel hebdo qui invalide le cache memoire des Pro Benchmarks et
// force un re-fetch depuis pro_match_players (data fraiche apres la
// semaine de matchs S-tier).
//
// Schedule : 0 4 * * 1  (lundi 4h UTC = 5h/6h Paris)
// Active dans vercel.json :
//   "crons": [ { "path": "/api/cron/pro-benchmarks-refresh", "schedule": "0 4 * * 1" } ]
//
// Securise par Vercel CRON_SECRET : Vercel envoie automatiquement un
// header Authorization: Bearer <CRON_SECRET> lors de l'execution.
//
// Strategie : touch le cache pour forcer un cold start au prochain GET.
// Le prochain visiteur de /api/pro-benchmarks declenchera l'aggregation
// DB live (avec fallback seed si vide). Ainsi pas de timeout serverless.
//
// Future : on peut ajouter ici un appel HLTV scraper (scripts/hltv-playwright.js)
// pour mettre a jour le seed dataset en cas de fenetre 90j vide cote DB.

module.exports = async function handler(req, res) {
  // Auth Vercel cron FAIL-CLOSED (cf. ultrareview P0.1).
  // Si CRON_SECRET non set, on refuse (anti DoS / grilling endpoint).
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!expected) {
    console.error('[cron pro-benchmarks-refresh] CRON_SECRET non configure - refus 503');
    return res.status(503).json({ error: 'Cron secret not configured' });
  }
  if (auth !== `Bearer ${expected}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Invalide le cache memoire (sera repopule au prochain GET)
    if (globalThis.__fvProBenchCache) {
      globalThis.__fvProBenchCache = { ts: 0, data: null };
    }

    // Trigger a warm-up : fetch our own endpoint pour pre-populer le cache
    const baseUrl = process.env.VERCEL_URL
      ? 'https://' + process.env.VERCEL_URL
      : 'https://fragvalue.com';
    let warmed = false;
    try {
      const r = await fetch(baseUrl + '/api/pro-benchmarks?aggregate=overall');
      warmed = r.ok;
    } catch (e) {
      console.warn('[cron pro-benchmarks-refresh] warm-up failed:', e.message);
    }

    return res.status(200).json({
      ok: true,
      timestamp: new Date().toISOString(),
      cacheInvalidated: true,
      warmedUp: warmed,
      note: 'Cache memoire invalide, prochain GET /api/pro-benchmarks declenchera un re-fetch depuis pro_match_players.',
    });
  } catch (e) {
    console.error('[cron pro-benchmarks-refresh] error:', e.message);
    try {
      const { sendAlert } = require('../_lib/alert.js');
      await sendAlert({
        severity: 'error',
        title: 'Cron pro-benchmarks-refresh crashed',
        details: { error: e.message, stack: e.stack?.slice(0, 600) },
        source: 'cron/pro-benchmarks-refresh',
      });
    } catch (_) {}
    return res.status(500).json({ error: 'Refresh failed', detail: e.message });
  }
};
