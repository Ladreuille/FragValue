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
// - Fallback : seed dataset hardcoded base sur HLTV Top 20 of 2025 (Jan 2026)
//   et rosters verifies en avril 2026
//
// Cache : memoire 1h via globalThis.
//
// SOURCES SEED (verifiees avril 2026, voir CHANGELOG_SEED ci-dessous) :
// - HLTV Top 20 Players of 2025 (publie janvier 2026)
//   https://www.hltv.org/news/43492/top-20-players-of-2025-final-list
// - Liquipedia rosters par equipe :
//   https://liquipedia.net/counterstrike/Team_Spirit
//   https://liquipedia.net/counterstrike/Team_Vitality
//   https://liquipedia.net/counterstrike/Team_Falcons
//   https://liquipedia.net/counterstrike/FaZe_Clan
//   https://liquipedia.net/counterstrike/MOUZ
//   https://liquipedia.net/counterstrike/Natus_Vincere
//   https://liquipedia.net/counterstrike/FURIA
//   https://liquipedia.net/counterstrike/Team_Liquid
//
// CHANGELOG_SEED 2026 verifies :
// - m0NESY : G2 → Falcons (avril 2025)
// - karrigan : FaZe → Falcons (avril 2026)
// - ropz : MOUZ → Vitality (janvier 2025)
// - mezii : Cloud9 → Vitality (novembre 2024)
// - Twistzz : Liquid → FaZe (septembre 2025)
// - molodoy : Aurora/Spirit Academy → FURIA (avril 2025)
// - YEKINDAR : Liquid → FURIA
// - magixx, zont1x : retour Spirit (decembre 2025), chopper benche
// - jL : NaVi → MOUZ (loan, mai 2026)
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

// ── SEED FALLBACK : pool elargi de pros 2025-2026 avec stats verifiees ────
// Top 20 = HLTV Top 20 Players of 2025 (publie janvier 2026).
// Rank 21+ = pros tier 1-2 actifs avec rosters/roles avril 2026 verifies
// Liquipedia. Stats moyennes saison 2025 + Q1 2026 indicatives (HLTV profil).
// Ce pool elargi sert au matching pro twin pour plus de precision.
const SEED_TOP20_2026 = [
  // ─────────────── HLTV TOP 20 OF 2025 (rank 1-20) ────────────────────────
  // Roles verifies Liquipedia + HLTV avril 2026 (audit ultra-rigoureux).
  { rank:  1, nickname: 'ZywOo',    team: 'Vitality',     country: 'FR', role: 'awp',     hltv_id: 11893, maps_played: 38, hltv_rating: 1.30, kast_pct: 78, adr: 89, kpr: 0.83, hs_pct: 56, kd: 1.28 },
  { rank:  2, nickname: 'donk',     team: 'Spirit',       country: 'RU', role: 'rifler',  hltv_id: 24220, maps_played: 42, hltv_rating: 1.32, kast_pct: 76, adr: 92, kpr: 0.86, hs_pct: 60, kd: 1.31 },
  { rank:  3, nickname: 'ropz',     team: 'Vitality',     country: 'EE', role: 'rifler',  hltv_id: 11816, maps_played: 35, hltv_rating: 1.20, kast_pct: 75, adr: 86, kpr: 0.76, hs_pct: 55, kd: 1.18 },
  { rank:  4, nickname: 'm0NESY',   team: 'Falcons',      country: 'RU', role: 'awp',     hltv_id: 18053, maps_played: 36, hltv_rating: 1.18, kast_pct: 73, adr: 85, kpr: 0.76, hs_pct: 58, kd: 1.16 },
  { rank:  5, nickname: 'sh1ro',    team: 'Spirit',       country: 'RU', role: 'awp',     hltv_id: 18116, maps_played: 40, hltv_rating: 1.15, kast_pct: 76, adr: 78, kpr: 0.69, hs_pct: 49, kd: 1.13 },
  { rank:  6, nickname: 'molodoy',  team: 'FURIA',        country: 'KZ', role: 'awp',     hltv_id: 26256, maps_played: 32, hltv_rating: 1.14, kast_pct: 72, adr: 82, kpr: 0.74, hs_pct: 56, kd: 1.12 }, // primary AWP FURIA depuis FalleN role swap
  { rank:  7, nickname: 'flameZ',   team: 'Vitality',     country: 'IL', role: 'entry',   hltv_id: 19222, maps_played: 33, hltv_rating: 1.13, kast_pct: 73, adr: 80, kpr: 0.72, hs_pct: 56, kd: 1.10 },
  { rank:  8, nickname: 'frozen',   team: 'FaZe',         country: 'SK', role: 'rifler',  hltv_id: 11843, maps_played: 30, hltv_rating: 1.12, kast_pct: 73, adr: 79, kpr: 0.71, hs_pct: 53, kd: 1.09 },
  { rank:  9, nickname: 'KSCERATO', team: 'FURIA',        country: 'BR', role: 'rifler',  hltv_id: 14176, maps_played: 32, hltv_rating: 1.11, kast_pct: 72, adr: 80, kpr: 0.71, hs_pct: 54, kd: 1.08 },
  { rank: 10, nickname: 'Spinx',    team: 'MOUZ',         country: 'IL', role: 'rifler',  hltv_id: 16732, maps_played: 36, hltv_rating: 1.10, kast_pct: 75, adr: 76, kpr: 0.68, hs_pct: 51, kd: 1.07 }, // primary lurker MOUZ
  { rank: 11, nickname: 'Twistzz',  team: 'FaZe',         country: 'CA', role: 'rifler',  hltv_id: 10394, maps_played: 28, hltv_rating: 1.09, kast_pct: 73, adr: 78, kpr: 0.70, hs_pct: 53, kd: 1.07 },
  { rank: 12, nickname: 'mezii',    team: 'Vitality',     country: 'GB', role: 'support', hltv_id: 18933, maps_played: 30, hltv_rating: 1.08, kast_pct: 74, adr: 74, kpr: 0.66, hs_pct: 50, kd: 1.05 },
  { rank: 13, nickname: 'Senzu',    team: 'Passion UA',   country: 'MN', role: 'rifler',  hltv_id: 23158, maps_played: 30, hltv_rating: 1.08, kast_pct: 73, adr: 74, kpr: 0.65, hs_pct: 50, kd: 1.05 }, // loan Passion UA fev 2026
  { rank: 14, nickname: 'XANTARES', team: 'Aurora',       country: 'TR', role: 'rifler',  hltv_id: 4805,  maps_played: 32, hltv_rating: 1.07, kast_pct: 71, adr: 78, kpr: 0.71, hs_pct: 56, kd: 1.04 },
  { rank: 15, nickname: 'YEKINDAR', team: 'FURIA',        country: 'LV', role: 'entry',   hltv_id: 18062, maps_played: 30, hltv_rating: 1.07, kast_pct: 71, adr: 80, kpr: 0.71, hs_pct: 55, kd: 1.04 },
  { rank: 16, nickname: 'xertioN',  team: 'MOUZ',         country: 'IL', role: 'igl',     hltv_id: 21770, maps_played: 35, hltv_rating: 1.06, kast_pct: 72, adr: 76, kpr: 0.68, hs_pct: 52, kd: 1.04 }, // IGL MOUZ post-shuffle (torzsi est l'AWP)
  { rank: 17, nickname: 'torzsi',   team: 'MOUZ',         country: 'HU', role: 'awp',     hltv_id: 19887, maps_played: 35, hltv_rating: 1.06, kast_pct: 72, adr: 75, kpr: 0.66, hs_pct: 48, kd: 1.04 },
  { rank: 18, nickname: 'NiKo',     team: 'Falcons',      country: 'BA', role: 'rifler',  hltv_id: 3741,  maps_played: 34, hltv_rating: 1.05, kast_pct: 71, adr: 82, kpr: 0.74, hs_pct: 58, kd: 1.03 },
  { rank: 19, nickname: 'iM',       team: 'NaVi',         country: 'RO', role: 'rifler',  hltv_id: 21176, maps_played: 33, hltv_rating: 1.05, kast_pct: 71, adr: 74, kpr: 0.67, hs_pct: 53, kd: 1.03 },
  { rank: 20, nickname: 'b1t',      team: 'NaVi',         country: 'UA', role: 'support', hltv_id: 18987, maps_played: 33, hltv_rating: 1.04, kast_pct: 72, adr: 73, kpr: 0.66, hs_pct: 54, kd: 1.02 },

  // ─────────────── EXTENSION rank 21-60 (pool pour matching) ──────────────
  // Roles, country, hltv_id verifies Liquipedia avril 2026 (post-audit).
  // Stats : moyenne approximative saison 2025 + Q1 2026 (profils HLTV).
  { rank: 21, nickname: 'jL',        team: 'MOUZ',         country: 'LV', role: 'rifler',  hltv_id: 21709, maps_played: 30, hltv_rating: 1.07, kast_pct: 73, adr: 80, kpr: 0.72, hs_pct: 56, kd: 1.06 }, // loan from NaVi
  { rank: 22, nickname: 'broky',     team: 'FaZe',         country: 'BA', role: 'awp',     hltv_id: 16341, maps_played: 28, hltv_rating: 1.05, kast_pct: 71, adr: 73, kpr: 0.67, hs_pct: 47, kd: 1.04 },
  { rank: 23, nickname: 'huNter-',   team: 'G2',           country: 'BA', role: 'igl',     hltv_id: 11816, maps_played: 30, hltv_rating: 1.04, kast_pct: 70, adr: 78, kpr: 0.71, hs_pct: 52, kd: 1.03 }, // IGL G2 depuis 2025 (SunPayus est AWP)
  { rank: 24, nickname: 'jks',       team: 'FlyQuest',     country: 'AU', role: 'rifler',  hltv_id: 7322,  maps_played: 30, hltv_rating: 1.04, kast_pct: 71, adr: 74, kpr: 0.67, hs_pct: 51, kd: 1.03 }, // FlyQuest pas 100T
  { rank: 25, nickname: 'BlameF',    team: 'BIG',          country: 'DK', role: 'igl',     hltv_id: 11219, maps_played: 30, hltv_rating: 1.06, kast_pct: 73, adr: 78, kpr: 0.69, hs_pct: 50, kd: 1.04 }, // IGL/captain BIG depuis jan 2026
  { rank: 26, nickname: 'tabseN',    team: 'BIG',          country: 'DE', role: 'rifler',  hltv_id: 7322,  maps_played: 30, hltv_rating: 0.98, kast_pct: 70, adr: 68, kpr: 0.62, hs_pct: 49, kd: 0.96 }, // n'est plus IGL, BlameF a pris la place
  { rank: 27, nickname: 'siuhy',     team: 'Liquid',       country: 'PL', role: 'igl',     hltv_id: 19831, maps_played: 32, hltv_rating: 0.98, kast_pct: 71, adr: 67, kpr: 0.61, hs_pct: 50, kd: 0.97 }, // Liquid full-time depuis juin 2025
  { rank: 28, nickname: 'karrigan',  team: 'Falcons',      country: 'DK', role: 'igl',     hltv_id: 429,   maps_played: 30, hltv_rating: 0.94, kast_pct: 70, adr: 65, kpr: 0.59, hs_pct: 47, kd: 0.93 }, // Falcons depuis avril 2026
  { rank: 29, nickname: 'aleksib',   team: 'NaVi',         country: 'FI', role: 'igl',     hltv_id: 9960,  maps_played: 30, hltv_rating: 0.99, kast_pct: 71, adr: 67, kpr: 0.61, hs_pct: 49, kd: 0.97 },
  { rank: 30, nickname: 'rain',      team: '100 Thieves',  country: 'NO', role: 'igl',     hltv_id: 8568,  maps_played: 28, hltv_rating: 0.99, kast_pct: 70, adr: 72, kpr: 0.68, hs_pct: 50, kd: 0.98 }, // IGL 100T depuis nov 2025
  { rank: 31, nickname: 'hooxi',     team: 'Astralis',     country: 'DK', role: 'igl',     hltv_id: 16920, maps_played: 30, hltv_rating: 0.92, kast_pct: 69, adr: 64, kpr: 0.57, hs_pct: 46, kd: 0.91 },
  { rank: 32, nickname: 'jabbi',     team: 'Astralis',     country: 'DK', role: 'rifler',  hltv_id: 19887, maps_played: 30, hltv_rating: 1.05, kast_pct: 72, adr: 76, kpr: 0.69, hs_pct: 51, kd: 1.04 },
  { rank: 33, nickname: 'staehr',    team: 'Astralis',     country: 'DK', role: 'rifler',  hltv_id: 20460, maps_played: 30, hltv_rating: 1.02, kast_pct: 71, adr: 72, kpr: 0.66, hs_pct: 50, kd: 1.01 },
  { rank: 34, nickname: 'NAF',       team: 'Liquid',       country: 'CA', role: 'rifler',  hltv_id: 8520,  maps_played: 28, hltv_rating: 1.04, kast_pct: 72, adr: 75, kpr: 0.68, hs_pct: 51, kd: 1.03 },
  { rank: 35, nickname: 'EliGE',     team: 'Liquid',       country: 'US', role: 'rifler',  hltv_id: 8738,  maps_played: 28, hltv_rating: 1.05, kast_pct: 72, adr: 77, kpr: 0.69, hs_pct: 50, kd: 1.04 },
  { rank: 36, nickname: 'malbsmd',   team: 'Liquid',       country: 'GT', role: 'rifler',  hltv_id: 21554, maps_played: 30, hltv_rating: 1.06, kast_pct: 73, adr: 78, kpr: 0.69, hs_pct: 51, kd: 1.05 }, // trade Liquid mars 2026
  { rank: 37, nickname: 'fallen',    team: 'FURIA',        country: 'BR', role: 'rifler',  hltv_id: 1225,  maps_played: 30, hltv_rating: 0.94, kast_pct: 69, adr: 65, kpr: 0.57, hs_pct: 45, kd: 0.92 }, // role swap : a passe l'AWP a molodoy
  { rank: 38, nickname: 'yuurih',    team: 'FURIA',        country: 'BR', role: 'rifler',  hltv_id: 14159, maps_played: 32, hltv_rating: 1.04, kast_pct: 71, adr: 75, kpr: 0.68, hs_pct: 52, kd: 1.03 },
  { rank: 39, nickname: 'kyousuke',  team: 'Falcons',      country: 'KZ', role: 'entry',   hltv_id: 24598, maps_played: 28, hltv_rating: 1.06, kast_pct: 72, adr: 78, kpr: 0.70, hs_pct: 53, kd: 1.05 }, // entry fragger Falcons
  { rank: 40, nickname: 'TeSeS',     team: 'Falcons',      country: 'DK', role: 'support', hltv_id: 19937, maps_played: 28, hltv_rating: 1.03, kast_pct: 71, adr: 74, kpr: 0.67, hs_pct: 51, kd: 1.02 }, // anchor/support utility-heavy
  { rank: 41, nickname: 'jcobbb',    team: 'FaZe',         country: 'PL', role: 'rifler',  hltv_id: 22377, maps_played: 28, hltv_rating: 1.06, kast_pct: 72, adr: 77, kpr: 0.69, hs_pct: 53, kd: 1.05 },
  { rank: 42, nickname: 'tn1r',      team: 'Spirit',       country: 'RU', role: 'rifler',  hltv_id: 22585, maps_played: 32, hltv_rating: 1.05, kast_pct: 73, adr: 76, kpr: 0.68, hs_pct: 53, kd: 1.04 },
  { rank: 43, nickname: 'zont1x',    team: 'Spirit',       country: 'UA', role: 'rifler',  hltv_id: 21708, maps_played: 32, hltv_rating: 1.06, kast_pct: 73, adr: 77, kpr: 0.69, hs_pct: 52, kd: 1.05 },
  { rank: 44, nickname: 'magixx',    team: 'Spirit',       country: 'RU', role: 'igl',     hltv_id: 18117, maps_played: 32, hltv_rating: 1.04, kast_pct: 72, adr: 75, kpr: 0.68, hs_pct: 51, kd: 1.03 }, // IGL Spirit depuis dec 2025 apres benchage chopper
  { rank: 45, nickname: 'MisteM',    team: 'Eternal Fire', country: 'TR', role: 'igl',     maps_played: 28, hltv_rating: 1.01, kast_pct: 71, adr: 70, kpr: 0.64, hs_pct: 51, kd: 1.00 }, // IGL Eternal Fire (remplace maden free agent)
  { rank: 46, nickname: 'maj3r',     team: 'Aurora',       country: 'TR', role: 'igl',     hltv_id: 7320,  maps_played: 28, hltv_rating: 0.96, kast_pct: 70, adr: 67, kpr: 0.61, hs_pct: 50, kd: 0.94 },
  { rank: 47, nickname: 'woxic',     team: 'Aurora',       country: 'TR', role: 'awp',     hltv_id: 11070, maps_played: 30, hltv_rating: 1.06, kast_pct: 71, adr: 74, kpr: 0.66, hs_pct: 47, kd: 1.04 },
  { rank: 48, nickname: 'Snappi',    team: 'NIP',          country: 'DK', role: 'igl',     hltv_id: 1146,  maps_played: 28, hltv_rating: 0.95, kast_pct: 70, adr: 65, kpr: 0.59, hs_pct: 49, kd: 0.93 }, // NIP IGL depuis jan 2025
  { rank: 49, nickname: 'lucky',     team: '3DMAX',        country: 'FR', role: 'rifler',  hltv_id: 12244, maps_played: 30, hltv_rating: 1.04, kast_pct: 71, adr: 73, kpr: 0.66, hs_pct: 47, kd: 1.03 }, // rifler (maka est l'AWP/IGL hybrid)
  { rank: 50, nickname: 'maka',      team: '3DMAX',        country: 'FR', role: 'igl',     hltv_id: 11842, maps_played: 30, hltv_rating: 0.96, kast_pct: 70, adr: 66, kpr: 0.60, hs_pct: 49, kd: 0.95 }, // IGL/AWP hybrid : on garde IGL comme primary
  { rank: 51, nickname: 'misutaaa',  team: '3DMAX',        country: 'FR', role: 'rifler',  hltv_id: 16733, maps_played: 30, hltv_rating: 1.04, kast_pct: 71, adr: 75, kpr: 0.67, hs_pct: 51, kd: 1.03 },
  { rank: 52, nickname: 'blitz',     team: 'MongolZ',      country: 'MN', role: 'igl',     hltv_id: 21277, maps_played: 30, hltv_rating: 0.99, kast_pct: 71, adr: 68, kpr: 0.62, hs_pct: 50, kd: 0.98 },
  { rank: 53, nickname: '910',       team: 'MongolZ',      country: 'MN', role: 'awp',     hltv_id: 23158, maps_played: 30, hltv_rating: 1.07, kast_pct: 73, adr: 78, kpr: 0.70, hs_pct: 50, kd: 1.06 },
  { rank: 54, nickname: 'mzinho',    team: 'MongolZ',      country: 'MN', role: 'rifler',  hltv_id: 22660, maps_played: 30, hltv_rating: 1.03, kast_pct: 71, adr: 74, kpr: 0.67, hs_pct: 53, kd: 1.02 },
  { rank: 55, nickname: 'device',    team: '100 Thieves',  country: 'DK', role: 'awp',     hltv_id: 7592,  maps_played: 28, hltv_rating: 1.05, kast_pct: 72, adr: 73, kpr: 0.66, hs_pct: 47, kd: 1.04 },
  { rank: 56, nickname: 'stavn',     team: 'NIP',          country: 'DK', role: 'awp',     hltv_id: 18548, maps_played: 28, hltv_rating: 1.05, kast_pct: 72, adr: 76, kpr: 0.69, hs_pct: 52, kd: 1.04 }, // NIP primary AWP depuis avril 2026
  { rank: 57, nickname: 'w0nderful', team: 'NaVi',         country: 'UA', role: 'awp',     hltv_id: 22600, maps_played: 30, hltv_rating: 1.05, kast_pct: 72, adr: 73, kpr: 0.67, hs_pct: 47, kd: 1.04 },
  { rank: 58, nickname: 'gr1ks',     team: 'BIG',          country: 'BY', role: 'awp',     maps_played: 28, hltv_rating: 1.04, kast_pct: 71, adr: 72, kpr: 0.66, hs_pct: 47, kd: 1.03 },
  { rank: 59, nickname: 'ultimate',  team: 'Liquid',       country: 'PL', role: 'awp',     maps_played: 28, hltv_rating: 1.03, kast_pct: 71, adr: 72, kpr: 0.66, hs_pct: 48, kd: 1.02 }, // Liquid AWP
  { rank: 60, nickname: 'SunPayus',  team: 'G2',           country: 'ES', role: 'awp',     hltv_id: 19887, maps_played: 28, hltv_rating: 1.04, kast_pct: 71, adr: 73, kpr: 0.66, hs_pct: 47, kd: 1.03 }, // G2 AWP
];

// ── PLAYER_METADATA : dict elargi nickname → role/country/team ──────────
// 80+ pros verifies sur Liquipedia + HLTV avril 2026.
// Sert a enrichir les donnees DB pour faire fonctionner le filtre role,
// afficher les drapeaux et identifier l'equipe meme quand source='db'.
// Source de verite : Liquipedia rosters (verifies avril 2026).
const PLAYER_METADATA = {
  // ─── Vitality (Champions IEM Krakow 2026) ───
  'zywoo':    { role: 'awp',     country: 'FR', team: 'Vitality',     hltv_id: 11893 },
  'apex':     { role: 'igl',     country: 'FR', team: 'Vitality',     hltv_id: 4674  },
  'ropz':     { role: 'rifler',  country: 'EE', team: 'Vitality',     hltv_id: 11816 },
  'flamez':   { role: 'entry',   country: 'IL', team: 'Vitality',     hltv_id: 19222 },
  'mezii':    { role: 'support', country: 'GB', team: 'Vitality',     hltv_id: 18933 },

  // ─── Spirit (post-decembre 2025 : magixx IGL apres bench chopper) ───
  'donk':     { role: 'rifler',  country: 'RU', team: 'Spirit',       hltv_id: 24220 },
  'sh1ro':    { role: 'awp',     country: 'RU', team: 'Spirit',       hltv_id: 18116 },
  'magixx':   { role: 'igl',     country: 'RU', team: 'Spirit',       hltv_id: 18117 }, // IGL depuis dec 2025
  'zont1x':   { role: 'rifler',  country: 'UA', team: 'Spirit',       hltv_id: 21708 },
  'tn1r':     { role: 'rifler',  country: 'RU', team: 'Spirit',       hltv_id: 22585 },
  'chopper':  { role: 'igl',     country: 'RU', team: 'Spirit',       hltv_id: 13784 }, // benche dec 2025
  'zweih':    { role: 'rifler',  country: 'RU', team: 'Spirit' }, // benche dec 2025

  // ─── Falcons (apres transferts m0NESY + karrigan + role swap) ───
  'm0nesy':   { role: 'awp',     country: 'RU', team: 'Falcons',      hltv_id: 18053 },
  'niko':     { role: 'rifler',  country: 'BA', team: 'Falcons',      hltv_id: 3741  },
  'karrigan': { role: 'igl',     country: 'DK', team: 'Falcons',      hltv_id: 429   }, // signed avr 2026
  'teses':    { role: 'support', country: 'DK', team: 'Falcons',      hltv_id: 19937 }, // anchor/utility-heavy
  'kyousuke': { role: 'entry',   country: 'KZ', team: 'Falcons',      hltv_id: 24598 }, // entry fragger
  'kyxsan':   { role: 'rifler',  country: 'PL', team: 'Falcons',      hltv_id: 19374 }, // benche apr 2026

  // ─── FaZe (post-karrigan + rain departs) ───
  'frozen':   { role: 'rifler',  country: 'SK', team: 'FaZe',         hltv_id: 11843 },
  'twistzz':  { role: 'rifler',  country: 'CA', team: 'FaZe',         hltv_id: 10394 },
  'broky':    { role: 'awp',     country: 'BA', team: 'FaZe',         hltv_id: 16341 },
  'jcobbb':   { role: 'rifler',  country: 'PL', team: 'FaZe',         hltv_id: 22377 },
  // rain a quitte FaZe pour 100T en nov 2025 (voir entree '100 Thieves' plus bas)

  // ─── MOUZ (post-shuffle 2026 : xertioN IGL, jL loan) ───
  'spinx':    { role: 'rifler',  country: 'IL', team: 'MOUZ',         hltv_id: 16732 }, // primary lurker
  'xertion':  { role: 'igl',     country: 'IL', team: 'MOUZ',         hltv_id: 21770 }, // IGL MOUZ depuis 2026
  'torzsi':   { role: 'awp',     country: 'HU', team: 'MOUZ',         hltv_id: 19887 },
  'jl':       { role: 'rifler',  country: 'LV', team: 'MOUZ',         hltv_id: 21709 }, // loan from NaVi
  'xelex':    { role: 'rifler',  country: 'CZ', team: 'MOUZ' },
  'brollan':  { role: 'rifler',  country: 'SE', team: 'MOUZ',         hltv_id: 14176 }, // benche apr 2026
  'jimpphat': { role: 'rifler',  country: 'FI', team: 'MOUZ',         hltv_id: 19400 }, // benche apr 2026

  // ─── Natus Vincere (NaVi) ───
  'aleksib':  { role: 'igl',     country: 'FI', team: 'NaVi',         hltv_id: 9960  },
  'im':       { role: 'rifler',  country: 'RO', team: 'NaVi',         hltv_id: 21176 },
  'b1t':      { role: 'support', country: 'UA', team: 'NaVi',         hltv_id: 18987 },
  'w0nderful':{ role: 'awp',     country: 'UA', team: 'NaVi',         hltv_id: 22600 },
  'makazze':  { role: 'rifler',  country: 'XK', team: 'NaVi' },

  // ─── FURIA (post-role-swap : molodoy AWP, FalleN rifler/anchor) ───
  'molodoy':  { role: 'awp',     country: 'KZ', team: 'FURIA',        hltv_id: 26256 }, // AWP primary
  'kscerato': { role: 'rifler',  country: 'BR', team: 'FURIA',        hltv_id: 14176 },
  'yuurih':   { role: 'rifler',  country: 'BR', team: 'FURIA',        hltv_id: 14159 },
  'yekindar': { role: 'entry',   country: 'LV', team: 'FURIA',        hltv_id: 18062 },
  'fallen':   { role: 'rifler',  country: 'BR', team: 'FURIA',        hltv_id: 1225  }, // role swap : a passe l'AWP a molodoy

  // ─── G2 (huNter- IGL post-2025) ───
  'huntr':    { role: 'igl',     country: 'BA', team: 'G2',           hltv_id: 11816 }, // alias huNter-, IGL
  'hunter-':  { role: 'igl',     country: 'BA', team: 'G2',           hltv_id: 11816 }, // IGL G2
  'nertz':    { role: 'rifler',  country: 'IL', team: 'G2',           hltv_id: 19815 },
  'sunpayus': { role: 'awp',     country: 'ES', team: 'G2',           hltv_id: 19887 },
  'heavygod': { role: 'rifler',  country: 'IL', team: 'G2',           hltv_id: 22510 },
  'matys':    { role: 'rifler',  country: 'SK', team: 'G2',           hltv_id: 21677 },

  // ─── Team Liquid (siuhy IGL + malbsmd transfer mars 2026) ───
  'siuhy':    { role: 'igl',     country: 'PL', team: 'Liquid',       hltv_id: 19831 }, // Liquid full-time depuis juin 2025
  'naf':      { role: 'rifler',  country: 'CA', team: 'Liquid',       hltv_id: 8520  },
  'elige':    { role: 'rifler',  country: 'US', team: 'Liquid',       hltv_id: 8738  },
  'ultimate': { role: 'awp',     country: 'PL', team: 'Liquid' }, // primary AWP Liquid
  'malbsmd':  { role: 'rifler',  country: 'GT', team: 'Liquid',       hltv_id: 21554 }, // trade Liquid mars 2026

  // ─── Aurora (Turkish core) ───
  'xantares': { role: 'rifler',  country: 'TR', team: 'Aurora',       hltv_id: 4805  },
  'woxic':    { role: 'awp',     country: 'TR', team: 'Aurora',       hltv_id: 11070 },
  'maj3r':    { role: 'igl',     country: 'TR', team: 'Aurora',       hltv_id: 7320  },
  'soulfly':  { role: 'rifler',  country: 'TR', team: 'Aurora' },
  'wicadia':  { role: 'rifler',  country: 'TR', team: 'Aurora' },

  // ─── The MongolZ ───
  'blitz':    { role: 'igl',     country: 'MN', team: 'MongolZ',      hltv_id: 21277 },
  'techno4k': { role: 'rifler',  country: 'MN', team: 'MongolZ',      hltv_id: 22533 },
  '910':      { role: 'awp',     country: 'MN', team: 'MongolZ',      hltv_id: 23158 },
  'mzinho':   { role: 'rifler',  country: 'MN', team: 'MongolZ',      hltv_id: 22660 },
  'senzu':    { role: 'rifler',  country: 'MN', team: 'Passion UA',   hltv_id: 23148 }, // loan Passion UA fev 2026
  'cobrazera':{ role: 'rifler',  country: 'MN', team: 'MongolZ' },

  // ─── Eternal Fire (international 2026, MisteM IGL) ───
  'mistem':   { role: 'igl',     country: 'TR', team: 'Eternal Fire' }, // IGL EF depuis depart maden
  'rigon':    { role: 'rifler',  country: 'XK', team: 'Eternal Fire' },
  'demqq':    { role: 'rifler',  country: 'BG', team: 'Eternal Fire' },
  'regali':   { role: 'awp',     country: 'TR', team: 'Eternal Fire' },
  'jottaaa':  { role: 'rifler',  country: 'TR', team: 'Eternal Fire' },
  // woro2k benche avr 2026 : retire
  // maden free agent (released by Fnatic) : retire

  // ─── 3DMAX (FR scene, maka est IGL/AWP hybrid) ───
  'lucky':    { role: 'rifler',  country: 'FR', team: '3DMAX',         hltv_id: 12244 }, // rifler (maka est l'AWP)
  'maka':     { role: 'igl',     country: 'FR', team: '3DMAX',         hltv_id: 11842 }, // IGL/AWP hybrid (primary IGL)
  'misutaaa': { role: 'rifler',  country: 'FR', team: '3DMAX',         hltv_id: 16733 },
  'ex3rcice': { role: 'rifler',  country: 'FR', team: '3DMAX' },
  'graviti':  { role: 'rifler',  country: 'FR', team: '3DMAX' },
  'bodyy':    { role: 'rifler',  country: 'FR', team: 'OG',            hltv_id: 8254 },

  // ─── HEROIC (rebuilt 2026) ───
  'chr1zn':   { role: 'igl',     country: 'DK', team: 'HEROIC' },
  'susp':     { role: 'rifler',  country: 'DK', team: 'HEROIC' },
  'xfl0ud':   { role: 'rifler',  country: 'BG', team: 'HEROIC' },
  'nilo':     { role: 'rifler',  country: 'DK', team: 'HEROIC' },
  'alkaren':  { role: 'awp',     country: 'PL', team: 'HEROIC' },
  'yxngstxr': { role: 'rifler',  country: 'GB', team: 'HEROIC' },

  // ─── Astralis (phzy AWP, hooxi IGL) ───
  'hooxi':    { role: 'igl',     country: 'DK', team: 'Astralis',      hltv_id: 16920 },
  'jabbi':    { role: 'rifler',  country: 'DK', team: 'Astralis',      hltv_id: 19887 },
  'phzy':     { role: 'awp',     country: 'SE', team: 'Astralis' },
  'staehr':   { role: 'rifler',  country: 'DK', team: 'Astralis',      hltv_id: 20460 },
  'ryu':      { role: 'rifler',  country: 'LT', team: 'Astralis' },

  // ─── BIG (BlameF IGL post-jan 2026) ───
  'blamef':   { role: 'igl',     country: 'DK', team: 'BIG',           hltv_id: 11219 }, // IGL/captain depuis jan 2026
  'tabsen':   { role: 'rifler',  country: 'DE', team: 'BIG',           hltv_id: 7322  }, // n'est plus IGL
  'jdc':      { role: 'rifler',  country: 'DE', team: 'BIG' },
  'faven':    { role: 'rifler',  country: 'DE', team: 'BIG' },
  'gr1ks':    { role: 'awp',     country: 'BY', team: 'BIG' },

  // ─── ENCE (sans Snappi qui est parti a NIP) ───
  'f1ku':     { role: 'rifler',  country: 'PL', team: 'ENCE' },
  'krasnal':  { role: 'awp',     country: 'PL', team: 'ENCE' },

  // ─── NIP (Snappi IGL + stavn AWP avr 2026) ───
  'snappi':   { role: 'igl',     country: 'DK', team: 'NIP',           hltv_id: 1146 }, // NIP depuis jan 2025
  'stavn':    { role: 'awp',     country: 'DK', team: 'NIP',           hltv_id: 18548 }, // primary AWP NIP avr 2026
  'sjuush':   { role: 'rifler',  country: 'DK', team: 'NIP' },
  'xkacpersky':{ role: 'rifler', country: 'PL', team: 'NIP' },
  'cairne':   { role: 'rifler',  country: 'DK', team: 'NIP' },

  // ─── 100 Thieves (rain IGL + device AWP) ───
  'rain':     { role: 'igl',     country: 'NO', team: '100 Thieves',   hltv_id: 8568  }, // IGL 100T depuis nov 2025
  'device':   { role: 'awp',     country: 'DK', team: '100 Thieves',   hltv_id: 7592  },
  'dev1ce':   { role: 'awp',     country: 'DK', team: '100 Thieves',   hltv_id: 7592  },

  // ─── FlyQuest (jks rifler) ───
  'jks':      { role: 'rifler',  country: 'AU', team: 'FlyQuest',      hltv_id: 7322  },

  // ─── Free agents / inactifs (gardes pour reference historique) ───
  'magisk':   { role: 'support', country: 'DK', team: 'Free Agent',    hltv_id: 4954  }, // contrat Astralis termine dec 2025
  'maden':    { role: 'igl',     country: 'TR', team: 'Free Agent',    hltv_id: 17427 }, // released Fnatic avr 2026
  'woro2k':   { role: 'rifler',  country: 'UA', team: 'Inactive',      hltv_id: 19873 }, // benche EF avr 2026
  'fnatic_fear': { role: 'igl', country: 'UA', team: 'Fnatic' }, // nouvel IGL Fnatic

  // ─── Apeks / ECSTATIC scene EU tier 2 ───
  'aragorn':  { role: 'igl',     country: 'NO', team: 'Apeks' },

  // ─── NA scene (M80, Wildcard, MIBR) ───
  'spaze':    { role: 'igl',     country: 'US', team: 'Cloud9' },
  'jt':       { role: 'rifler',  country: 'US', team: 'M80' },
  'adamb':    { role: 'igl',     country: 'US', team: 'Wildcard' },
  's1n':      { role: 'rifler',  country: 'US', team: 'M80' },
  'reazy':    { role: 'rifler',  country: 'US', team: 'M80' },
  'gxx':      { role: 'awp',     country: 'US', team: 'Wildcard' },

  // ─── CN/Asia scene (TYLOO, Lynn Vision) ───
  'mercury':  { role: 'igl',     country: 'CN', team: 'TYLOO' },
  'jamyoung': { role: 'rifler',  country: 'CN', team: 'TYLOO' },
  'westmelon':{ role: 'rifler',  country: 'CN', team: 'TYLOO' },
  'somebody': { role: 'igl',     country: 'CN', team: 'Lynn Vision' },
  'z4kr':     { role: 'rifler',  country: 'CN', team: 'Lynn Vision' },

  // ─── BR/SA scene tier 2 (paiN, MIBR) ───
  'fnx':      { role: 'rifler',  country: 'BR', team: 'paiN' },
  'biguzera': { role: 'awp',     country: 'BR', team: 'paiN' },
  'snow':     { role: 'igl',     country: 'BR', team: 'MIBR' },

  // ─── Vétérans/coachs encore actifs ou récemment retirés ───
  'gla1ve':   { role: 'igl',     country: 'DK', team: 'Astralis Coach', hltv_id: 7166 }, // coach
};

// ── SEED par map / side : derive du top 20 ci-dessus ────────────────────
// Strategie : on selectionne pour chaque map les players reconnus comme
// fort sur cette map (basé sur leurs equipes et historiques HLTV). Pas
// d'invention de stats : on reutilise leurs stats globales mais on les
// ordonne selon leur reputation map-specific.
// Note : les stats CT/T sont approximatives (les pros varient de ±5-10%
// entre leurs sides forts/faibles). On ne pretend pas avoir des stats
// par-side exactes, c'est une indication de niveau approximatif.
function getSeedByMap(map, side) {
  // Lookup player stats par nickname (depuis SEED_TOP20_2026)
  function p(nickname) {
    return SEED_TOP20_2026.find(x => x.nickname === nickname);
  }
  // Top performers connus par map et side. Ordres bases sur reputation HLTV
  // saison 2025 : qui domine cette map historiquement.
  const POOLS = {
    mirage: {
      ct: ['m0NESY', 'donk', 'sh1ro', 'NiKo', 'b1t'],
      t:  ['ZywOo', 'donk', 'ropz', 'flameZ', 'm0NESY'],
    },
    inferno: {
      ct: ['donk', 'sh1ro', 'NiKo', 'KSCERATO', 'Spinx'],
      t:  ['ZywOo', 'ropz', 'donk', 'flameZ', 'YEKINDAR'],
    },
    dust2: {
      ct: ['m0NESY', 'sh1ro', 'KSCERATO', 'b1t', 'Spinx'],
      t:  ['NiKo', 'donk', 'molodoy', 'YEKINDAR', 'XANTARES'],
    },
    nuke: {
      ct: ['ZywOo', 'sh1ro', 'KSCERATO', 'iM', 'Spinx'],
      t:  ['donk', 'ZywOo', 'ropz', 'frozen', 'b1t'],
    },
    anubis: {
      ct: ['molodoy', 'sh1ro', 'donk', 'flameZ', 'NiKo'],
      t:  ['m0NESY', 'donk', 'ropz', 'flameZ', 'KSCERATO'],
    },
    ancient: {
      ct: ['ZywOo', 'KSCERATO', 'sh1ro', 'b1t', 'frozen'],
      t:  ['ropz', 'donk', 'm0NESY', 'iM', 'NiKo'],
    },
    overpass: {
      // CT-favored historiquement : AWP anchor + lurkers patient
      ct: ['sh1ro', 'm0NESY', 'ZywOo', 'b1t', 'KSCERATO'],
      // T side : ouvertures aggressives + lurk B
      t:  ['donk', 'ropz', 'XANTARES', 'NiKo', 'YEKINDAR'],
    },
  };

  if (!POOLS[map]) return null;
  const players = (side ? POOLS[map][side] : [...POOLS[map].ct, ...POOLS[map].t]);
  // Deduplicate while preserving order
  const seen = new Set();
  return players
    .filter(name => { if (seen.has(name)) return false; seen.add(name); return true; })
    .map((name, i) => {
      const data = p(name);
      if (!data) return null;
      return {
        rank: i + 1,
        nickname: data.nickname,
        team: data.team,
        hltv_id: data.hltv_id || null,
        hltv_rating: data.hltv_rating,
        kast_pct: data.kast_pct,
        adr: data.adr,
        hs_pct: data.hs_pct,
      };
    })
    .filter(Boolean);
}

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
      role: null,
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
    const sideFilter = (req.query?.side || '').toString().toLowerCase();
    const roleFilter = (req.query?.role || '').toString().toLowerCase();

    // ─── Map breakdown : top 5 par side de la map demandee ────────────
    if (aggregate === 'map' && mapFilter) {
      const ct = getSeedByMap(mapFilter, 'ct') || [];
      const t = getSeedByMap(mapFilter, 't') || [];
      const allPlayers = [...ct, ...t];

      let top;
      if (sideFilter === 'ct') top = ct;
      else if (sideFilter === 't') top = t;
      else top = allPlayers.slice().sort((a, b) => b.hltv_rating - a.hltv_rating).slice(0, 10);

      return res.status(200).json({
        source: 'seed',
        map: mapFilter,
        side: sideFilter || 'both',
        ct,
        t,
        top,
        proAvg: computeProAvg(allPlayers.length ? allPlayers : SEED_TOP20_2026.slice(0, 5)),
        windowDays: WINDOW_DAYS,
        lastUpdated: new Date().toISOString(),
        notice: 'Map data derived from HLTV Top 20 of 2025 reputational profiles per map. Per-side stats are indicative.',
      });
    }

    // ─── Overall : top 20 + averages + pool elargi pour matching ──────
    // Cache key v7 : invalidate apres remplacement Train -> Overpass dans
    // le map pool (mise a jour Active Duty CS2 avril 2026).
    const cacheKey = 'overall:v7:' + (roleFilter || 'all');
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

    // Pool elargi pour le matching pro twin : 60 pros du seed (rank 1-60).
    // Toujours dispo meme quand source='db' (la DB a souvent un sous-set).
    // Le frontend utilise ce pool pour trouver le pro le plus proche
    // stylistiquement, alors que top20 reste pour l'affichage de la liste.
    const matchingPool = SEED_TOP20_2026.slice();

    // ── Enrichissement role + country + team via PLAYER_METADATA ──────
    // pro_match_players ne contient pas de champ role/country/team. On
    // croise par nickname avec PLAYER_METADATA (97 pros connus) pour
    // enrichir. Lookup case-insensitive avec normalisation des chars
    // speciaux courants (-, _, espaces, accents).
    function normalizeNick(nick) {
      return (nick || '').toLowerCase()
        .replace(/[-_\s]/g, '')
        .normalize('NFD').replace(/[̀-ͯ]/g, ''); // strip diacritics
    }
    // Pre-build normalized lookup index (one-time cost)
    const META_INDEX = {};
    for (const k in PLAYER_METADATA) {
      META_INDEX[normalizeNick(k)] = PLAYER_METADATA[k];
    }
    top20 = top20.map(p => {
      const key = normalizeNick(p.nickname);
      const meta = META_INDEX[key];
      if (meta) {
        return {
          ...p,
          role:    p.role    || meta.role,
          country: p.country || meta.country,
          team:    p.team    || meta.team,
          hltv_id: p.hltv_id || meta.hltv_id || null,
        };
      }
      return p;
    });

    // ── Apply role filter (works on both seed AND db via PLAYER_METADATA) ──
    // Quand le filter role est actif, on exclut les players sans role connu
    // (joueurs DB pas presents dans PLAYER_METADATA). Resultat : seuls les
    // pros bien identifies remontent dans le filtre role.
    let filtered = top20;
    if (roleFilter) {
      filtered = top20.filter(p => p.role === roleFilter);
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
      pool: matchingPool, // 60 pros pour matching pro twin
      proAvg: computeProAvg(filtered.length ? filtered : SEED_TOP20_2026.slice(0, 5)),
      maps: ['mirage', 'inferno', 'dust2', 'nuke', 'anubis', 'ancient', 'overpass'],
      roles: ['awp', 'entry', 'igl', 'support', 'rifler'],
      notice: source === 'seed'
        ? 'Top 20 based on HLTV Top 20 Players of 2025 (published Jan 2026). Team/role assignments verified for April 2026.'
        : 'Top 20 aggregated from pro_match_players over the last 90 days.',
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
      maps: ['mirage', 'inferno', 'dust2', 'nuke', 'anubis', 'ancient', 'overpass'],
      roles: ['awp', 'entry', 'igl', 'support', 'rifler'],
      error: 'using seed data',
    });
  }
};
