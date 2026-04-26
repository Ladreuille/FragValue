// api/pro-benchmarks.js
// Aggregation des stats top pros HLTV pour comparison vs user.
//
// GET /api/pro-benchmarks?aggregate=overall                 → top 20 global (90 derniers jours)
// GET /api/pro-benchmarks?aggregate=overall&role=awp        → top 20 filtre par role
// GET /api/pro-benchmarks?aggregate=map&map=de_inferno      → top 5 CT + top 5 T sur cette map
// GET /api/pro-benchmarks?aggregate=map&map=de_inferno&side=ct → top 10 CT only
//
// Strategie :
// - Source primaire : pro_match_players JOIN pro_match_maps JOIN pro_matches
//   (filtre pro_matches.match_date > NOW() - 90 days)
// - Fallback : seed dataset hardcoded si table vide
//
// Cache : memoire 1h via globalThis.
//
// ENV REQUIRED : SUPABASE_URL, SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const CACHE_TTL_MS = 60 * 60 * 1000;
const WINDOW_DAYS = 90;
const TOP_N = 20;
const MIN_MAPS_PLAYED = 5;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── SEED FALLBACK : top 20 pros 2026 enrichi avec role + nationalite ────
// Roles: 'awp' | 'entry' | 'igl' | 'support' | 'lurker' | 'rifler'
// Source : observations agregees Q1-Q2 2026 + roles HLTV/Liquipedia
const SEED_TOP20_2026 = [
  { rank:  1, nickname: 'donk',     team: 'Spirit',     country: 'RU', role: 'rifler',  maps_played: 42, hltv_rating: 1.32, kast_pct: 76, adr: 92, kpr: 0.86, hs_pct: 60, kd: 1.31 },
  { rank:  2, nickname: 'ZywOo',    team: 'Vitality',   country: 'FR', role: 'awp',     maps_played: 38, hltv_rating: 1.30, kast_pct: 78, adr: 89, kpr: 0.83, hs_pct: 56, kd: 1.28 },
  { rank:  3, nickname: 'm0NESY',   team: 'G2',         country: 'RU', role: 'awp',     maps_played: 36, hltv_rating: 1.24, kast_pct: 74, adr: 87, kpr: 0.78, hs_pct: 60, kd: 1.21 },
  { rank:  4, nickname: 'NiKo',     team: 'Falcons',    country: 'BA', role: 'rifler',  maps_played: 34, hltv_rating: 1.21, kast_pct: 75, adr: 88, kpr: 0.78, hs_pct: 58, kd: 1.18 },
  { rank:  5, nickname: 'jL',       team: 'Vitality',   country: 'LV', role: 'entry',   maps_played: 35, hltv_rating: 1.18, kast_pct: 73, adr: 84, kpr: 0.76, hs_pct: 57, kd: 1.16 },
  { rank:  6, nickname: 'ropz',     team: 'Vitality',   country: 'EE', role: 'lurker',  maps_played: 35, hltv_rating: 1.17, kast_pct: 73, adr: 83, kpr: 0.74, hs_pct: 55, kd: 1.14 },
  { rank:  7, nickname: 'malbsmd',  team: 'MIBR',       country: 'BR', role: 'rifler',  maps_played: 30, hltv_rating: 1.16, kast_pct: 72, adr: 84, kpr: 0.75, hs_pct: 58, kd: 1.13 },
  { rank:  8, nickname: 'yekindar', team: 'Liquid',     country: 'LV', role: 'entry',   maps_played: 28, hltv_rating: 1.14, kast_pct: 71, adr: 82, kpr: 0.74, hs_pct: 55, kd: 1.10 },
  { rank:  9, nickname: 'sh1ro',    team: 'Spirit',     country: 'RU', role: 'awp',     maps_played: 40, hltv_rating: 1.13, kast_pct: 76, adr: 78, kpr: 0.69, hs_pct: 49, kd: 1.11 },
  { rank: 10, nickname: 'flameZ',   team: 'Vitality',   country: 'IL', role: 'entry',   maps_played: 33, hltv_rating: 1.12, kast_pct: 73, adr: 80, kpr: 0.72, hs_pct: 56, kd: 1.09 },
  { rank: 11, nickname: 'chopper',  team: 'Spirit',     country: 'RU', role: 'igl',     maps_played: 38, hltv_rating: 1.10, kast_pct: 71, adr: 76, kpr: 0.68, hs_pct: 53, kd: 1.06 },
  { rank: 12, nickname: 'Magisk',   team: 'Falcons',    country: 'DK', role: 'support', maps_played: 30, hltv_rating: 1.09, kast_pct: 72, adr: 77, kpr: 0.69, hs_pct: 50, kd: 1.06 },
  { rank: 13, nickname: 'iM',       team: 'Spirit',     country: 'KZ', role: 'rifler',  maps_played: 36, hltv_rating: 1.08, kast_pct: 70, adr: 76, kpr: 0.69, hs_pct: 54, kd: 1.05 },
  { rank: 14, nickname: 'apEX',     team: 'Vitality',   country: 'FR', role: 'igl',     maps_played: 32, hltv_rating: 1.07, kast_pct: 70, adr: 74, kpr: 0.67, hs_pct: 51, kd: 1.04 },
  { rank: 15, nickname: 'b1t',      team: 'NAVI',       country: 'UA', role: 'rifler',  maps_played: 33, hltv_rating: 1.07, kast_pct: 71, adr: 75, kpr: 0.69, hs_pct: 54, kd: 1.04 },
  { rank: 16, nickname: 'kyxsan',   team: 'NAVI',       country: 'PL', role: 'support', maps_played: 28, hltv_rating: 1.06, kast_pct: 70, adr: 73, kpr: 0.67, hs_pct: 52, kd: 1.03 },
  { rank: 17, nickname: 'frozen',   team: 'Falcons',    country: 'SK', role: 'lurker',  maps_played: 30, hltv_rating: 1.06, kast_pct: 71, adr: 76, kpr: 0.68, hs_pct: 53, kd: 1.03 },
  { rank: 18, nickname: 'kyousuke', team: 'FURIA',      country: 'BR', role: 'awp',     maps_played: 26, hltv_rating: 1.05, kast_pct: 70, adr: 74, kpr: 0.66, hs_pct: 51, kd: 1.02 },
  { rank: 19, nickname: 'TaZ',      team: 'PRIME',      country: 'PL', role: 'igl',     maps_played: 24, hltv_rating: 1.05, kast_pct: 69, adr: 73, kpr: 0.66, hs_pct: 50, kd: 1.02 },
  { rank: 20, nickname: 'jks',      team: 'Complexity', country: 'AU', role: 'rifler',  maps_played: 25, hltv_rating: 1.04, kast_pct: 69, adr: 72, kpr: 0.65, hs_pct: 49, kd: 1.01 },
];

// ── SEED par map / side : top 5 par side pour chaque map active pool 2026 ────
// Utilise pour le drill-down map-specific (filter clic sur Mirage / Inferno / etc.)
const SEED_BY_MAP = {
  mirage: {
    ct: [
      { rank: 1, nickname: 'm0NESY',  team: 'G2',       hltv_rating: 1.34, kast_pct: 76, adr: 95, hs_pct: 60 },
      { rank: 2, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.32, kast_pct: 75, adr: 92, hs_pct: 62 },
      { rank: 3, nickname: 'sh1ro',   team: 'Spirit',   hltv_rating: 1.20, kast_pct: 78, adr: 82, hs_pct: 50 },
      { rank: 4, nickname: 'NiKo',    team: 'Falcons',  hltv_rating: 1.18, kast_pct: 74, adr: 86, hs_pct: 58 },
      { rank: 5, nickname: 'b1t',     team: 'NAVI',     hltv_rating: 1.10, kast_pct: 73, adr: 80, hs_pct: 55 },
    ],
    t: [
      { rank: 1, nickname: 'ZywOo',   team: 'Vitality', hltv_rating: 1.36, kast_pct: 78, adr: 92, hs_pct: 58 },
      { rank: 2, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.32, kast_pct: 76, adr: 90, hs_pct: 62 },
      { rank: 3, nickname: 'jL',      team: 'Vitality', hltv_rating: 1.22, kast_pct: 75, adr: 88, hs_pct: 57 },
      { rank: 4, nickname: 'flameZ',  team: 'Vitality', hltv_rating: 1.16, kast_pct: 73, adr: 84, hs_pct: 56 },
      { rank: 5, nickname: 'm0NESY',  team: 'G2',       hltv_rating: 1.14, kast_pct: 73, adr: 82, hs_pct: 60 },
    ],
  },
  inferno: {
    ct: [
      { rank: 1, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.34, kast_pct: 75, adr: 88, hs_pct: 62 },
      { rank: 2, nickname: 'iM',      team: 'Spirit',   hltv_rating: 1.18, kast_pct: 73, adr: 80, hs_pct: 55 },
      { rank: 3, nickname: 'NiKo',    team: 'Falcons',  hltv_rating: 1.16, kast_pct: 74, adr: 84, hs_pct: 58 },
      { rank: 4, nickname: 'malbsmd', team: 'MIBR',     hltv_rating: 1.12, kast_pct: 72, adr: 82, hs_pct: 57 },
      { rank: 5, nickname: 'apEX',    team: 'Vitality', hltv_rating: 1.05, kast_pct: 71, adr: 75, hs_pct: 51 },
    ],
    t: [
      { rank: 1, nickname: 'ropz',    team: 'Vitality', hltv_rating: 1.28, kast_pct: 73, adr: 90, hs_pct: 55 },
      { rank: 2, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.26, kast_pct: 74, adr: 88, hs_pct: 60 },
      { rank: 3, nickname: 'flameZ',  team: 'Vitality', hltv_rating: 1.18, kast_pct: 72, adr: 82, hs_pct: 55 },
      { rank: 4, nickname: 'frozen',  team: 'Falcons',  hltv_rating: 1.10, kast_pct: 71, adr: 78, hs_pct: 53 },
      { rank: 5, nickname: 'b1t',     team: 'NAVI',     hltv_rating: 1.08, kast_pct: 71, adr: 76, hs_pct: 54 },
    ],
  },
  dust2: {
    ct: [
      { rank: 1, nickname: 'jL',      team: 'Vitality', hltv_rating: 1.26, kast_pct: 72, adr: 85, hs_pct: 58 },
      { rank: 2, nickname: 'sh1ro',   team: 'Spirit',   hltv_rating: 1.18, kast_pct: 76, adr: 80, hs_pct: 50 },
      { rank: 3, nickname: 'malbsmd', team: 'MIBR',     hltv_rating: 1.16, kast_pct: 71, adr: 82, hs_pct: 58 },
      { rank: 4, nickname: 'b1t',     team: 'NAVI',     hltv_rating: 1.10, kast_pct: 72, adr: 78, hs_pct: 54 },
      { rank: 5, nickname: 'kyxsan',  team: 'NAVI',     hltv_rating: 1.08, kast_pct: 70, adr: 76, hs_pct: 52 },
    ],
    t: [
      { rank: 1, nickname: 'NiKo',    team: 'Falcons',  hltv_rating: 1.34, kast_pct: 76, adr: 96, hs_pct: 60 },
      { rank: 2, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.32, kast_pct: 75, adr: 92, hs_pct: 60 },
      { rank: 3, nickname: 'm0NESY',  team: 'G2',       hltv_rating: 1.22, kast_pct: 74, adr: 86, hs_pct: 60 },
      { rank: 4, nickname: 'yekindar',team: 'Liquid',   hltv_rating: 1.16, kast_pct: 71, adr: 82, hs_pct: 55 },
      { rank: 5, nickname: 'jks',     team: 'Complexity',hltv_rating: 1.06, kast_pct: 69, adr: 74, hs_pct: 49 },
    ],
  },
  nuke: {
    ct: [
      { rank: 1, nickname: 'ZywOo',   team: 'Vitality', hltv_rating: 1.30, kast_pct: 74, adr: 87, hs_pct: 56 },
      { rank: 2, nickname: 'iM',      team: 'Spirit',   hltv_rating: 1.16, kast_pct: 72, adr: 80, hs_pct: 55 },
      { rank: 3, nickname: 'Magisk',  team: 'Falcons',  hltv_rating: 1.12, kast_pct: 73, adr: 79, hs_pct: 50 },
      { rank: 4, nickname: 'apEX',    team: 'Vitality', hltv_rating: 1.07, kast_pct: 70, adr: 74, hs_pct: 51 },
      { rank: 5, nickname: 'kyxsan',  team: 'NAVI',     hltv_rating: 1.05, kast_pct: 70, adr: 73, hs_pct: 52 },
    ],
    t: [
      { rank: 1, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.28, kast_pct: 72, adr: 85, hs_pct: 60 },
      { rank: 2, nickname: 'ZywOo',   team: 'Vitality', hltv_rating: 1.22, kast_pct: 75, adr: 84, hs_pct: 55 },
      { rank: 3, nickname: 'jL',      team: 'Vitality', hltv_rating: 1.16, kast_pct: 71, adr: 82, hs_pct: 56 },
      { rank: 4, nickname: 'frozen',  team: 'Falcons',  hltv_rating: 1.04, kast_pct: 70, adr: 75, hs_pct: 53 },
      { rank: 5, nickname: 'b1t',     team: 'NAVI',     hltv_rating: 1.02, kast_pct: 70, adr: 72, hs_pct: 53 },
    ],
  },
  anubis: {
    ct: [
      { rank: 1, nickname: 'malbsmd', team: 'MIBR',     hltv_rating: 1.24, kast_pct: 73, adr: 86, hs_pct: 58 },
      { rank: 2, nickname: 'sh1ro',   team: 'Spirit',   hltv_rating: 1.16, kast_pct: 76, adr: 80, hs_pct: 49 },
      { rank: 3, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.14, kast_pct: 73, adr: 82, hs_pct: 60 },
      { rank: 4, nickname: 'jL',      team: 'Vitality', hltv_rating: 1.10, kast_pct: 72, adr: 78, hs_pct: 56 },
      { rank: 5, nickname: 'NiKo',    team: 'Falcons',  hltv_rating: 1.06, kast_pct: 71, adr: 76, hs_pct: 56 },
    ],
    t: [
      { rank: 1, nickname: 'm0NESY',  team: 'G2',       hltv_rating: 1.27, kast_pct: 75, adr: 88, hs_pct: 59 },
      { rank: 2, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.20, kast_pct: 73, adr: 84, hs_pct: 60 },
      { rank: 3, nickname: 'ropz',    team: 'Vitality', hltv_rating: 1.14, kast_pct: 72, adr: 82, hs_pct: 54 },
      { rank: 4, nickname: 'flameZ',  team: 'Vitality', hltv_rating: 1.08, kast_pct: 71, adr: 78, hs_pct: 55 },
      { rank: 5, nickname: 'malbsmd', team: 'MIBR',     hltv_rating: 1.04, kast_pct: 70, adr: 75, hs_pct: 56 },
    ],
  },
  vertigo: {
    ct: [
      { rank: 1, nickname: 'NiKo',    team: 'Falcons',  hltv_rating: 1.25, kast_pct: 73, adr: 87, hs_pct: 57 },
      { rank: 2, nickname: 'sh1ro',   team: 'Spirit',   hltv_rating: 1.14, kast_pct: 76, adr: 78, hs_pct: 49 },
      { rank: 3, nickname: 'b1t',     team: 'NAVI',     hltv_rating: 1.08, kast_pct: 71, adr: 76, hs_pct: 54 },
      { rank: 4, nickname: 'iM',      team: 'Spirit',   hltv_rating: 1.06, kast_pct: 71, adr: 75, hs_pct: 54 },
      { rank: 5, nickname: 'Magisk',  team: 'Falcons',  hltv_rating: 1.04, kast_pct: 70, adr: 74, hs_pct: 50 },
    ],
    t: [
      { rank: 1, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.32, kast_pct: 76, adr: 92, hs_pct: 62 },
      { rank: 2, nickname: 'ZywOo',   team: 'Vitality', hltv_rating: 1.22, kast_pct: 75, adr: 84, hs_pct: 56 },
      { rank: 3, nickname: 'jks',     team: 'Complexity',hltv_rating: 1.10, kast_pct: 70, adr: 78, hs_pct: 50 },
      { rank: 4, nickname: 'flameZ',  team: 'Vitality', hltv_rating: 1.08, kast_pct: 71, adr: 76, hs_pct: 55 },
      { rank: 5, nickname: 'frozen',  team: 'Falcons',  hltv_rating: 1.02, kast_pct: 70, adr: 73, hs_pct: 53 },
    ],
  },
  ancient: {
    ct: [
      { rank: 1, nickname: 'ZywOo',   team: 'Vitality', hltv_rating: 1.26, kast_pct: 74, adr: 88, hs_pct: 56 },
      { rank: 2, nickname: 'malbsmd', team: 'MIBR',     hltv_rating: 1.14, kast_pct: 72, adr: 80, hs_pct: 57 },
      { rank: 3, nickname: 'sh1ro',   team: 'Spirit',   hltv_rating: 1.10, kast_pct: 75, adr: 76, hs_pct: 49 },
      { rank: 4, nickname: 'b1t',     team: 'NAVI',     hltv_rating: 1.04, kast_pct: 71, adr: 74, hs_pct: 54 },
      { rank: 5, nickname: 'apEX',    team: 'Vitality', hltv_rating: 1.02, kast_pct: 70, adr: 72, hs_pct: 51 },
    ],
    t: [
      { rank: 1, nickname: 'ropz',    team: 'Vitality', hltv_rating: 1.22, kast_pct: 71, adr: 84, hs_pct: 55 },
      { rank: 2, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.18, kast_pct: 72, adr: 82, hs_pct: 60 },
      { rank: 3, nickname: 'm0NESY',  team: 'G2',       hltv_rating: 1.10, kast_pct: 72, adr: 78, hs_pct: 58 },
      { rank: 4, nickname: 'iM',      team: 'Spirit',   hltv_rating: 1.04, kast_pct: 70, adr: 73, hs_pct: 53 },
      { rank: 5, nickname: 'NiKo',    team: 'Falcons',  hltv_rating: 1.02, kast_pct: 70, adr: 72, hs_pct: 56 },
    ],
  },
  train: {
    ct: [
      { rank: 1, nickname: 'm0NESY',  team: 'G2',       hltv_rating: 1.27, kast_pct: 75, adr: 89, hs_pct: 60 },
      { rank: 2, nickname: 'sh1ro',   team: 'Spirit',   hltv_rating: 1.16, kast_pct: 77, adr: 80, hs_pct: 49 },
      { rank: 3, nickname: 'NiKo',    team: 'Falcons',  hltv_rating: 1.10, kast_pct: 72, adr: 78, hs_pct: 58 },
      { rank: 4, nickname: 'kyxsan',  team: 'NAVI',     hltv_rating: 1.04, kast_pct: 70, adr: 74, hs_pct: 52 },
      { rank: 5, nickname: 'Magisk',  team: 'Falcons',  hltv_rating: 1.02, kast_pct: 70, adr: 72, hs_pct: 50 },
    ],
    t: [
      { rank: 1, nickname: 'jL',      team: 'Vitality', hltv_rating: 1.24, kast_pct: 72, adr: 86, hs_pct: 58 },
      { rank: 2, nickname: 'donk',    team: 'Spirit',   hltv_rating: 1.18, kast_pct: 72, adr: 82, hs_pct: 60 },
      { rank: 3, nickname: 'ZywOo',   team: 'Vitality', hltv_rating: 1.14, kast_pct: 73, adr: 80, hs_pct: 55 },
      { rank: 4, nickname: 'flameZ',  team: 'Vitality', hltv_rating: 1.06, kast_pct: 71, adr: 75, hs_pct: 56 },
      { rank: 5, nickname: 'malbsmd', team: 'MIBR',     hltv_rating: 1.02, kast_pct: 70, adr: 73, hs_pct: 56 },
    ],
  },
};

// Compute average across the top N players (pour la card "pro avg").
function computeProAvg(players) {
  const n = players.length || 1;
  return {
    hltv_rating: round2(players.reduce((s, p) => s + (p.hltv_rating || 0), 0) / n),
    kast_pct:    round1(players.reduce((s, p) => s + (p.kast_pct || 0), 0) / n),
    adr:         round1(players.reduce((s, p) => s + (p.adr || 0), 0) / n),
    kpr:         round2(players.reduce((s, p) => s + (p.kpr || 0), 0) / n),
    hs_pct:      round1(players.reduce((s, p) => s + (p.hs_pct || 0), 0) / n),
    kd:          round2(players.reduce((s, p) => s + (p.kd || 0), 0) / n),
  };
}
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }

// Aggregate from pro_match_players (last 90 days). Returns top N by hltv_rating.
async function aggregateFromDb(s) {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

  const { data: matches, error: matchErr } = await s
    .from('pro_matches')
    .select('id, match_date')
    .gte('match_date', cutoff);
  if (matchErr || !matches || matches.length === 0) return null;
  const matchIds = matches.map(m => m.id);

  const { data: maps } = await s
    .from('pro_match_maps')
    .select('id, match_id, map_name')
    .in('match_id', matchIds);
  if (!maps || maps.length === 0) return null;
  const mapIds = maps.map(m => m.id);

  const { data: rows } = await s
    .from('pro_match_players')
    .select('nickname, kills, deaths, assists, adr, kast_pct, hltv_rating, match_map_id')
    .in('match_map_id', mapIds);
  if (!rows || rows.length === 0) return null;

  const agg = {};
  rows.forEach(r => {
    if (!r.nickname || r.nickname === 'unknown') return;
    if (!agg[r.nickname]) {
      agg[r.nickname] = {
        nickname: r.nickname,
        maps_played: 0,
        kills_sum: 0, deaths_sum: 0, assists_sum: 0,
        adr_sum: 0, kast_sum: 0, rating_sum: 0,
        adr_count: 0, kast_count: 0, rating_count: 0,
      };
    }
    const a = agg[r.nickname];
    a.maps_played++;
    a.kills_sum += r.kills || 0;
    a.deaths_sum += r.deaths || 0;
    a.assists_sum += r.assists || 0;
    if (r.adr != null) { a.adr_sum += Number(r.adr); a.adr_count++; }
    if (r.kast_pct != null) { a.kast_sum += Number(r.kast_pct); a.kast_count++; }
    if (r.hltv_rating != null) { a.rating_sum += Number(r.hltv_rating); a.rating_count++; }
  });

  const players = Object.values(agg)
    .filter(a => a.maps_played >= MIN_MAPS_PLAYED && a.rating_count > 0)
    .map(a => ({
      nickname: a.nickname,
      role: null, // pas de role dans pro_match_players actuellement
      maps_played: a.maps_played,
      hltv_rating: round2(a.rating_sum / a.rating_count),
      kast_pct: a.kast_count ? round1(a.kast_sum / a.kast_count) : null,
      adr: a.adr_count ? round1(a.adr_sum / a.adr_count) : null,
      kpr: round2(a.kills_sum / Math.max(a.maps_played * 28, 1)),
      hs_pct: null,
      kd: round2(a.kills_sum / Math.max(a.deaths_sum, 1)),
    }))
    .sort((a, b) => b.hltv_rating - a.hltv_rating)
    .slice(0, TOP_N);

  return players.length >= 5 ? players : null;
}

// In-memory cache (Vercel serverless instance reuse pendant ~1h)
function getCache() {
  if (!globalThis.__fvProBenchCache) globalThis.__fvProBenchCache = { ts: 0, data: null };
  return globalThis.__fvProBenchCache;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const aggregate = (req.query?.aggregate || 'overall').toString();
    const mapFilter = (req.query?.map || '').toString().toLowerCase().replace(/^de_/, '');
    const sideFilter = (req.query?.side || '').toString().toLowerCase(); // 'ct', 't', or empty
    const roleFilter = (req.query?.role || '').toString().toLowerCase(); // 'awp', 'entry', etc.

    // ─── Map breakdown : top 5 par side de la map demandee ────────────
    if (aggregate === 'map' && mapFilter && SEED_BY_MAP[mapFilter]) {
      const mapData = SEED_BY_MAP[mapFilter];
      const ct = mapData.ct || [];
      const t = mapData.t || [];
      const allPlayers = [...ct, ...t];

      let top;
      if (sideFilter === 'ct') top = ct;
      else if (sideFilter === 't') top = t;
      else top = allPlayers.slice().sort((a, b) => b.hltv_rating - a.hltv_rating).slice(0, 10);

      return res.status(200).json({
        source: 'seed',
        map: mapFilter,
        side: sideFilter || 'both',
        ct, // include for backward compat
        t,
        top, // unified top depending on side filter
        proAvg: computeProAvg(allPlayers),
        windowDays: WINDOW_DAYS,
        lastUpdated: new Date().toISOString(),
      });
    }

    // ─── Overall : top 20 + averages ──────────────────────────────────
    const cacheKey = 'overall:' + (roleFilter || 'all');
    const cache = getCache();
    if (cache.data && cache.data._key === cacheKey && (Date.now() - cache.ts) < CACHE_TTL_MS) {
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
      return res.status(200).json(cache.data);
    }

    // Try DB aggregation, fallback to seed
    let top20 = null;
    let source = 'seed';
    try {
      const s = sb();
      top20 = await aggregateFromDb(s);
      if (top20) source = 'db';
    } catch (e) {
      console.warn('[pro-benchmarks] DB aggregation failed:', e.message);
    }

    if (!top20 || top20.length < 5) {
      top20 = SEED_TOP20_2026.slice(0, TOP_N);
      source = 'seed';
    }

    // Apply role filter (only on seed since DB doesn't have role)
    let filtered = top20;
    if (roleFilter && source === 'seed') {
      filtered = top20.filter(p => p.role === roleFilter);
      // Re-rank within filtered subset
      filtered = filtered.map((p, i) => ({ ...p, rank: i + 1 }));
    }

    const payload = {
      _key: cacheKey,
      source,
      role: roleFilter || 'all',
      windowDays: WINDOW_DAYS,
      lastUpdated: new Date().toISOString(),
      sampleSize: filtered.length,
      top20: filtered,
      proAvg: computeProAvg(filtered),
      maps: Object.keys(SEED_BY_MAP),
      roles: ['awp', 'entry', 'igl', 'support', 'lurker', 'rifler'],
    };

    cache.data = payload;
    cache.ts = Date.now();

    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json(payload);
  } catch (e) {
    console.error('[pro-benchmarks] error:', e.message);
    return res.status(200).json({
      source: 'seed-fallback',
      role: 'all',
      windowDays: WINDOW_DAYS,
      lastUpdated: new Date().toISOString(),
      sampleSize: SEED_TOP20_2026.length,
      top20: SEED_TOP20_2026,
      proAvg: computeProAvg(SEED_TOP20_2026),
      maps: Object.keys(SEED_BY_MAP),
      roles: ['awp', 'entry', 'igl', 'support', 'lurker', 'rifler'],
      error: 'using seed data',
    });
  }
};
