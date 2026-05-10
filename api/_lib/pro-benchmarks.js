// api/_lib/pro-benchmarks.js · FragValue
// Recupere benchmarks pros HLTV par map depuis pro_match_players.
// Calcule top 5 + moyenne + distribution percentile (p25/p50/p75/p95).
// Cache memoire 1h (les benchmarks pros bougent peu sur cette echelle).
//
// Pour le rubric Coach IA, axe 2 (Ancrage benchmark pro) :
// permet a Claude de comparer le user au top 50 HLTV avec chiffres reels
// au lieu de generalites "comme les pros".

const { createClient } = require('@supabase/supabase-js');

const _cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

// Normalise le nom de map : "de_inferno" / "Inferno" / "INFERNO" → "inferno"
function normalizeMap(map) {
  if (!map) return null;
  return String(map).replace(/^de_/i, '').toLowerCase().trim();
}

// Recupere benchmarks pros pour une map. Returns null si pas de data.
async function getBenchmarksByMap(map) {
  const normalized = normalizeMap(map);
  if (!normalized) return null;

  const cached = _cache.get(normalized);
  if (cached && Date.now() - cached.t < CACHE_TTL_MS) return cached.v;

  try {
    // Filtre temporel 6 mois en 2 etapes :
    // 1. Get les match IDs recents (pro_matches.match_date >= 6 mois)
    // 2. Get les pro_match_players via les map_ids correspondants
    // PostgREST ne supporte pas .gte() fiable sur deep-nested join donc 2-step.
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

    // Etape 1 : map_ids recents pour cette map
    const { data: maps, error: mapsErr } = await sb()
      .from('pro_match_maps')
      .select('id, pro_matches!inner(match_date)')
      .ilike('map_name', normalized)
      .gte('pro_matches.match_date', sixMonthsAgo)
      .limit(500);

    if (mapsErr) {
      console.warn('[pro-benchmarks] maps fetch error:', mapsErr.message);
      _cache.set(normalized, { t: Date.now(), v: null });
      return null;
    }
    if (!maps || maps.length === 0) {
      _cache.set(normalized, { t: Date.now(), v: null });
      return null;
    }
    const recentMapIds = maps.map(m => m.id);

    // Etape 2 : pro_match_players pour ces maps
    const { data, error } = await sb()
      .from('pro_match_players')
      .select('nickname, hltv_rating, adr, kast_pct, kills, deaths, first_kills, first_deaths, clutches, multi_kills, match_map_id')
      .in('match_map_id', recentMapIds)
      .order('hltv_rating', { ascending: false })
      .limit(300);

    if (error) {
      console.warn('[pro-benchmarks]', error.message);
      _cache.set(normalized, { t: Date.now(), v: null });
      return null;
    }

    if (!data || data.length === 0) {
      _cache.set(normalized, { t: Date.now(), v: null });
      return null;
    }

    // Aggrégation par nickname (un pro a plusieurs matchs)
    const byPlayer = new Map();
    for (const r of data) {
      const k = r.nickname;
      if (!byPlayer.has(k)) {
        byPlayer.set(k, {
          nickname: k, samples: 0,
          rating: 0, adr: 0, kast: 0, kills: 0, deaths: 0,
          fk: 0, fd: 0, clutches: 0, multi: 0,
        });
      }
      const a = byPlayer.get(k);
      a.samples++;
      a.rating += parseFloat(r.hltv_rating) || 0;
      a.adr    += parseFloat(r.adr) || 0;
      a.kast   += parseFloat(r.kast_pct) || 0;
      a.kills  += r.kills || 0;
      a.deaths += r.deaths || 0;
      a.fk     += r.first_kills || 0;
      a.fd     += r.first_deaths || 0;
      a.clutches += r.clutches || 0;
      a.multi  += r.multi_kills || 0;
    }

    const players = [...byPlayer.values()]
      .filter(p => p.samples >= 1)
      .map(p => ({
        nickname: p.nickname,
        avgRating: +(p.rating / p.samples).toFixed(2),
        avgAdr:    +(p.adr / p.samples).toFixed(0),
        avgKast:   +(p.kast / p.samples).toFixed(0),
        avgKd:     p.deaths > 0 ? +(p.kills / p.deaths).toFixed(2) : null,
        openingRatio: (p.fk + p.fd) > 0 ? +((p.fk / (p.fk + p.fd)) * 100).toFixed(0) : null,
        clutchPerMatch: +(p.clutches / p.samples).toFixed(2),
        multiPerMatch:  +(p.multi / p.samples).toFixed(2),
        samples: p.samples,
      }))
      .sort((a, b) => b.avgRating - a.avgRating);

    if (players.length === 0) {
      _cache.set(normalized, { t: Date.now(), v: null });
      return null;
    }

    const top5 = players.slice(0, 5);
    const totalSamples = players.reduce((s, p) => s + p.samples, 0);

    // Moyenne ponderee par nb de samples (pros qui ont plus de matchs comptent plus)
    const weightedAvg = (key) =>
      +(players.reduce((s, p) => s + p[key] * p.samples, 0) / Math.max(totalSamples, 1)).toFixed(2);

    const proAvg = {
      rating: weightedAvg('avgRating'),
      adr:    Math.round(weightedAvg('avgAdr')),
      kast:   Math.round(weightedAvg('avgKast')),
      kd:     weightedAvg('avgKd'),
      openingRatio: Math.round(weightedAvg('openingRatio')),
    };

    // Distribution percentile sur le rating (pour situer le user)
    const sortedRatings = players.map(p => p.avgRating).sort((a, b) => a - b);
    const pct = (q) => sortedRatings[Math.max(0, Math.min(sortedRatings.length - 1, Math.floor(q * sortedRatings.length)))];

    const result = {
      map: normalized,
      sampleSize: totalSamples,
      uniquePlayers: players.length,
      top5,
      proAvg,
      distribution: {
        rating_p25: pct(0.25),
        rating_p50: pct(0.50),
        rating_p75: pct(0.75),
        rating_p95: pct(0.95),
      },
    };

    _cache.set(normalized, { t: Date.now(), v: result });
    return result;
  } catch (e) {
    console.warn('[pro-benchmarks] error:', e.message);
    return null;
  }
}

// Place une valeur user dans la distribution pros
// Returns 'below_p25' | 'p25-50' | 'p50-75' | 'p75-95' | 'above_p95' | null
function classifyVsPro(userValue, distribution) {
  if (userValue == null || !distribution) return null;
  if (userValue < distribution.rating_p25) return 'below_p25';
  if (userValue < distribution.rating_p50) return 'p25-50';
  if (userValue < distribution.rating_p75) return 'p50-75';
  if (userValue < distribution.rating_p95) return 'p75-95';
  return 'above_p95';
}

// Format compact pour injection dans le prompt Claude
function formatBenchmarksForPrompt(benchmarks) {
  if (!benchmarks || !benchmarks.top5?.length) return '';
  const top = benchmarks.top5
    .map(p => `  - ${p.nickname}: rating ${p.avgRating}, ${p.avgAdr} ADR, ${p.avgKast}% KAST, ${p.avgKd ?? 'n/a'} K/D, opening ratio ${p.openingRatio ?? 'n/a'}%`)
    .join('\n');
  const dist = benchmarks.distribution
    ? `Distribution rating pros (n=${benchmarks.sampleSize}): p25=${benchmarks.distribution.rating_p25}, p50=${benchmarks.distribution.rating_p50}, p75=${benchmarks.distribution.rating_p75}, p95=${benchmarks.distribution.rating_p95}`
    : '';
  const avg = benchmarks.proAvg;
  return `BENCHMARKS PROS HLTV — ${benchmarks.map.toUpperCase()} (${benchmarks.sampleSize} performances pros, ${benchmarks.uniquePlayers} joueurs)

Pro average sur la map: rating ${avg.rating}, ${avg.adr} ADR, ${avg.kast}% KAST, ${avg.kd} K/D, opening ratio ${avg.openingRatio}%
${dist}

TOP 5 sur cette map:
${top}

Cite des chiffres pros precis quand pertinent: "${benchmarks.top5[0].nickname} fait ${benchmarks.top5[0].avgAdr} ADR sur ${benchmarks.map}, toi tu es a X (delta -Y%)". Cite les vrais noms.`;
}

module.exports = {
  getBenchmarksByMap,
  classifyVsPro,
  normalizeMap,
  formatBenchmarksForPrompt,
};
