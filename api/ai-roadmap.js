// api/ai-roadmap.js
// Genere un diagnostic de roadmap personnalise unique par user via Claude API.
// Cache Supabase 7 jours pour contenir le cout et accelerer les rendus.
//
// Input  : GET /api/ai-roadmap (Authorization: Bearer <supabase_jwt>)
//          + optionnel ?refresh=1 pour forcer un recompute
// Output : { diagnosis: {...}, cached: bool, cachedAt: ISO, userLevel, eloTarget }
//
// ENV VARS requises :
//   - ANTHROPIC_API_KEY (Claude API)
//   - FACEIT_API_KEY    (pour fetch stats)
//   - SUPABASE_URL / SUPABASE_SERVICE_KEY

const { createClient } = require('@supabase/supabase-js');

// Modele par plan :
// - Free : Haiku 4.5 (rapide, cache 30j, cout faible)
// - Pro / Elite : Sonnet 4.5 (raisonnement plus fin, meilleures references
//   pros, analyse tactique plus profonde - difference visible avec langage HLTV)
const CLAUDE_MODEL_FREE = 'claude-haiku-4-5';
const CLAUDE_MODEL_PRO  = 'claude-sonnet-4-5';
const CLAUDE_ENDPOINT   = 'https://api.anthropic.com/v1/messages';
const FACEIT_BASE = 'https://open.faceit.com/data/v4';
const CACHE_TTL_DAYS = 7;
const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── FACEIT level ELO ranges (aligne avec levels.html) ─────────────────────
const LEVEL_TARGETS_ELO = {
  1: 501,  2: 751,  3: 901,  4: 1051, 5: 1201,
  6: 1351, 7: 1531, 8: 1751, 9: 2001, 10: 2401,
};

// ── Resolve auth + cache lookup ──────────────────────────────────────────
async function getUser(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const s = sb();
  const { data, error } = await s.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// Determine le plan de l'utilisateur (free / pro / team) via Stripe.
// Retourne aussi isAdmin pour l'admin bypass.
const { isAdminUser } = require('./_lib/subscription');
async function resolveUserPlan(user) {
  if (!user) return { plan: 'free', isAdmin: false };
  if (isAdminUser(user)) {
    return { plan: 'elite', isAdmin: true };
  }
  try {
    const s = sb();
    const { data: profile } = await s
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (!profile?.stripe_customer_id) return { plan: 'free', isAdmin: false };

    // Check abonnement actif via Stripe (source de verite)
    if (!process.env.STRIPE_SECRET_KEY) return { plan: 'free', isAdmin: false };
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const subs = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'active',
      limit: 1,
    });
    if (!subs.data.length) return { plan: 'free', isAdmin: false };

    const sub = subs.data[0];
    const priceId = sub.items.data[0]?.price?.id || '';
    let plan = 'free';
    const eliceM = process.env.STRIPE_PRICE_ELITE_MONTHLY || process.env.STRIPE_PRICE_TEAM_MONTHLY;
    const eliceY = process.env.STRIPE_PRICE_ELITE_ANNUEL  || process.env.STRIPE_PRICE_TEAM_ANNUEL;
    if (priceId.includes('elite') || priceId.includes('team') || priceId === eliceM || priceId === eliceY) plan = 'elite';
    else if (priceId.includes('pro') || sub.items.data[0]?.price?.unit_amount >= 500) plan = 'pro';
    return { plan, isAdmin: false };
  } catch { return { plan: 'free', isAdmin: false }; }
}

// Check combien de diagnostics IA l'user a genere ce mois-ci.
// Utilise la colonne cached_at de la derniere generation.
// Pour les Free, on se base sur le cached_at : si < 30 jours, pas de regen.
function monthsAgo(dateStr, n) {
  if (!dateStr) return true;
  const ageMs = Date.now() - new Date(dateStr).getTime();
  return ageMs > n * 30 * 24 * 60 * 60 * 1000;
}

async function readCache(userId) {
  const s = sb();
  const { data } = await s
    .from('ai_roadmap_cache')
    .select('diagnosis, cached_at, nickname, faceit_level, faceit_elo')
    .eq('user_id', userId)
    .single();
  if (!data) return null;
  const ageDays = (Date.now() - new Date(data.cached_at).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > CACHE_TTL_DAYS) return null;
  return data;
}

async function writeCache(userId, profile, diagnosis) {
  try {
    await sb().from('ai_roadmap_cache').upsert({
      user_id:      userId,
      nickname:     profile.nickname,
      faceit_level: profile.level || null,
      faceit_elo:   profile.elo || null,
      diagnosis,
      cached_at:    new Date().toISOString(),
    }, { onConflict: 'user_id' });
  } catch (e) { console.warn('ai-roadmap cache write error:', e.message); }
}

// ── FACEIT stats fetch (20 last matches) ─────────────────────────────────
async function fetchFaceitStats(nickname, apiKey) {
  const h = { Authorization: 'Bearer ' + apiKey };

  // Player basic info
  const pRes = await fetch(`${FACEIT_BASE}/players?nickname=${encodeURIComponent(nickname)}`, { headers: h });
  if (!pRes.ok) throw new Error('FACEIT player lookup failed ' + pRes.status);
  const player = await pRes.json();
  const playerId = player.player_id;
  const cs2 = player.games?.cs2 || {};

  // Recent stats (20 last matches) + lifetime
  const [recentRes, lifetimeRes] = await Promise.all([
    fetch(`${FACEIT_BASE}/players/${playerId}/games/cs2/stats?limit=20`, { headers: h }),
    fetch(`${FACEIT_BASE}/players/${playerId}/stats/cs2`, { headers: h }),
  ]);
  const recent = recentRes.ok ? await recentRes.json() : { items: [] };
  const lifetime = lifetimeRes.ok ? await lifetimeRes.json() : {};

  // Aggregate the 20 last matches
  const items = recent.items || [];
  const n = items.length || 1;
  const sum = (getter) => items.reduce((s, it) => s + (parseFloat(getter(it)) || 0), 0);

  // Per-map stats
  const byMap = {};
  items.forEach(it => {
    const m = (it.stats?.['Map'] || '').replace('de_', '');
    if (!m) return;
    if (!byMap[m]) byMap[m] = { matches: 0, wins: 0 };
    byMap[m].matches++;
    if ((it.stats?.['Result'] || '') === '1') byMap[m].wins++;
  });
  const mapStats = Object.entries(byMap)
    .map(([map, s]) => ({ map, matches: s.matches, winRate: Math.round((s.wins / s.matches) * 100) }))
    .sort((a, b) => b.matches - a.matches);

  const wins = sum(it => (it.stats?.['Result'] || '') === '1' ? 1 : 0);
  const stats = {
    nickname: player.nickname,
    country: (player.country || '').toUpperCase(),
    elo: cs2.faceit_elo || null,
    level: cs2.skill_level || null,
    matchesAnalyzed: n,
    winRate: Math.round((wins / n) * 100),
    avgKd: +(sum(it => it.stats?.['K/D Ratio']) / n).toFixed(2),
    avgAdr: +(sum(it => it.stats?.['ADR']) / n).toFixed(0),
    avgHs: +(sum(it => it.stats?.['Headshots %']) / n).toFixed(0),
    avgKast: +(sum(it => it.stats?.['KAST']) / n).toFixed(0) || null,
    avgKr:  +(sum(it => it.stats?.['K/R Ratio']) / n).toFixed(2),
    totalKills: sum(it => it.stats?.['Kills']),
    totalDeaths: sum(it => it.stats?.['Deaths']),
    totalAssists: sum(it => it.stats?.['Assists']),
    totalRounds: sum(it => it.stats?.['Rounds']),
    lifetime: {
      matches: parseInt(lifetime.lifetime?.['Matches']) || null,
      winRate: parseFloat(lifetime.lifetime?.['Win Rate %']) || null,
      avgKd: parseFloat(lifetime.lifetime?.['Average K/D Ratio']) || null,
      longestStreak: parseInt(lifetime.lifetime?.['Longest Win Streak']) || null,
    },
    mapStats: mapStats.slice(0, 6),
  };

  return stats;
}

// ── FragValue Demos context (option C partielle) ─────────────────────────
// Recupere les demos analysees par le user via notre parser Railway et
// calcule quelques stats qu'on injecte dans le prompt Claude. Differenciateur
// cle vs les coachs IA concurrents qui ne voient que les stats FACEIT agregees.
async function fetchFragValueDemos(userId) {
  try {
    const s = sb();
    const { data, error } = await s
      .from('demos')
      .select('map, fv_rating, analysed_at')
      .eq('user_id', userId)
      .order('analysed_at', { ascending: false })
      .limit(20);
    if (error || !data || data.length === 0) return null;

    const withRating = data.filter(d => d.fv_rating != null);
    const avgFvRating = withRating.length > 0
      ? +(withRating.reduce((sum, d) => sum + Number(d.fv_rating), 0) / withRating.length).toFixed(2)
      : null;

    // Map la plus jouee
    const byMap = {};
    data.forEach(d => {
      const m = d.map || 'unknown';
      byMap[m] = (byMap[m] || 0) + 1;
    });
    const topMap = Object.entries(byMap).sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      demosCount:     data.length,
      avgFvRating,
      topMap:         topMap && topMap !== 'unknown' ? topMap : null,
      lastDemoMap:    data[0].map || null,
      lastDemoRating: data[0].fv_rating != null ? Number(data[0].fv_rating).toFixed(2) : null,
    };
  } catch (e) {
    console.warn('[ai-roadmap] fetchFragValueDemos failed:', e.message);
    return null;
  }
}

// ── Prompt construction + Claude call ────────────────────────────────────
// ── Benchmarks FACEIT par niveau (references HLTV/pros amateurs 2026) ─────
// Utilises dans le prompt pour que Claude classe les stats de l'user en
// "faible / moyen / bon / excellent" selon son vrai niveau. Evite les
// conseils hors-contexte ("K/D 1.05 faible" pour un lvl 4 c'est faux).
const LEVEL_BENCHMARKS = {
  low:    { elo: '800-1200',   kd: '0.85-1.00', adr: '60-72',  hs: '28-40', kast: '62-68' }, // lvl 3-4
  mid:    { elo: '1200-1530',  kd: '1.00-1.15', adr: '72-85',  hs: '35-45', kast: '68-72' }, // lvl 5-6
  high:   { elo: '1530-2000',  kd: '1.10-1.25', adr: '85-100', hs: '40-50', kast: '72-76' }, // lvl 7-8
  elite:  { elo: '2000-2400+', kd: '1.20-1.45', adr: '95-115', hs: '45-55', kast: '75-82' }, // lvl 9-10
};
function getTier(level) {
  if (level >= 9) return 'elite';
  if (level >= 7) return 'high';
  if (level >= 5) return 'mid';
  return 'low';
}

function buildPrompt(stats, fvContext) {
  const nextLevel = Math.min((stats.level || 1) + 1, 11);
  const eloTarget = stats.level >= 10 ? 2400 : LEVEL_TARGETS_ELO[stats.level];
  const eloGap = Math.max(0, eloTarget - (stats.elo || 0));
  const tier = getTier(stats.level || 1);
  const b = LEVEL_BENCHMARKS[tier];

  // Section optionnelle : donnees FragValue Demos (si l'user a analyse des demos)
  const fvSection = fvContext && fvContext.demosCount > 0
    ? `\nFragValue Demos (analyses locales depuis le parser FV) :
- Demos analysees : ${fvContext.demosCount}
- FV Rating moyen : ${fvContext.avgFvRating ?? 'n/a'} (echelle HLTV 2.1 style : 0.80 faible, 1.00 moyen, 1.15 bon, 1.30+ pro-level)
- Map la plus jouee : ${fvContext.topMap || 'n/a'}
- Derniere demo analysee : ${fvContext.lastDemoMap || 'n/a'} (FV Rating ${fvContext.lastDemoRating ?? 'n/a'})`
    : '';

  return `Tu es un coach CS2 professionnel ecrit pour FragValue. Ton profil : 15 ans de competitive (lvl 10 FACEIT, ex-joueur semi-pro EU), expert des stats HLTV et de la meta CS2 2026. Tu connais par coeur les rosters Vitality, G2, FaZe, Spirit, NaVi, MOUZ, Heroic, Cloud9 et les patterns de donk (Spirit), ZywOo (Vitality), m0NESY (G2), ropz (FaZe), broky (FaZe), NiKo (G2), s1mple, magixx, apEX, cadiaN, Aleksib, HObbit.

Ton ton : direct, factuel, pas bienveillant pour rien. Tu parles comme un analyste HLTV. Si un joueur a un aim moyen tu lui dis "ton aim c'est du lvl 5 standard, pas pro". Pas de compliments gratuits. Pas d'emojis.

Voici les stats FACEIT du joueur (20 derniers matchs CS2) :

IDENTITE
- Pseudo : ${stats.nickname}
- Niveau FACEIT : ${stats.level} (tier ${tier})
- ELO : ${stats.elo} (cible lvl ${nextLevel} : ${eloTarget}, gap : ${eloGap} ELO)

PERFORMANCE (20 derniers matchs)
- Matchs : ${stats.matchesAnalyzed}, winrate ${stats.winRate}%
- K/D : ${stats.avgKd} (benchmark tier ${tier} : ${b.kd})
- ADR : ${stats.avgAdr} (benchmark : ${b.adr})
- HS% : ${stats.avgHs}% (benchmark : ${b.hs})
- KAST : ${stats.avgKast}% (benchmark : ${b.kast})
- K/R : ${stats.avgKr}
- Volume : ${stats.totalKills} kills, ${stats.totalDeaths} deaths, ${stats.totalAssists} assists sur ${stats.totalRounds} rounds

LIFETIME
- Total matchs : ${stats.lifetime.matches}
- Winrate lifetime : ${stats.lifetime.winRate}%
- K/D lifetime : ${stats.lifetime.avgKd}
- Longest win streak : ${stats.lifetime.longestStreak}

MAP POOL (20 derniers matchs)
${stats.mapStats.map(m => `- de_${m.map} : ${m.matches} matchs, winrate ${m.winRate}%`).join('\n')}
${fvSection}

ANALYSE ATTENDUE
Produis un diagnostic JSON au format exact ci-dessous. Tutoiement obligatoire. Langage HLTV : utilise Rating 2.1, Impact, KAST, ADR, opening duels, entry fragger, trade kill, clutch, multi-kill, utility damage, crosshair placement, spray control, prefire, pre-aim, crosshair placement, peek (wide/jiggle/shoulder peek), off-angle, retake, execute, stack, rotate, trade bait, flash pop, wallbang. Pas d'accents sur les termes techniques (kast, adr, hltv, elo, cs).

{
  "summary": "2 a 3 phrases style analyse HLTV. Identifie le ROLE implicite du joueur (entry fragger / rifler support / AWPer / lurker / IGL) d'apres ses stats, pointe le levier n1. Max 320 caracteres.",
  "strengths": [
    "Point fort 1 avec chiffre ET contexte HLTV. Ex: 'ADR 89 au-dessus du benchmark lvl 6 (72-85), profil entry/impact'",
    "Point fort 2 similaire",
    "Point fort 3 similaire"
  ],
  "weaknesses": [
    "Faiblesse 1 avec chiffre ET diagnostic. Ex: 'KAST 64% sous le benchmark (68-72), tu meurs trop souvent sans trade, positionnement a travailler'",
    "Faiblesse 2",
    "Faiblesse 3"
  ],
  "actions": [
    {
      "title": "Action courte imperative (max 6 mots)",
      "detail": "Implementation concrete avec REFERENCE pro ou map/workshop specifique. Ex: 'Fais 400 kills/jour sur aim_botz map USP + AK, style crosshair placement comme ropz. Vise 45% HS sur 5 matchs'. Pas de 'fais du DM', toujours specifique."
    },
    {
      "title": "Action 2",
      "detail": "Detail specifique"
    },
    {
      "title": "Action 3",
      "detail": "Detail specifique"
    },
    {
      "title": "Action 4",
      "detail": "Detail specifique (peut concerner mental, tilt, pistol, utility)"
    }
  ],
  "weeklyGoal": "Objectif chiffre measurable sur 5 prochains matchs. Format HLTV : 'Atteindre KAST 72% sur 5 matchs' ou 'Gagner 3/5 pistol rounds'. Aligne sur la faiblesse n1.",
  "mapTip": {
    "map": "Map la plus faible (winrate le plus bas parmi celles avec >= 3 matchs). Si winrate partout bon, prend la moins jouee (< 2 matchs) qui appartient a l'Active Duty.",
    "advice": "Conseil tactique 2-3 phrases : cite 1 position forte, 1 utility essentielle avec nom precis (ex: 'molo connector mirage CT', 'smoke xbox long dust2'), et 1 reference pro qui excelle sur cette map (ex: 'Regarde donk sur mirage T side mid control')."
  },
  "proReference": {
    "name": "Nom d'un pro actuel qui a un STYLE similaire au joueur (pas juste meilleur, similaire en role/stats/approach).",
    "team": "Team actuelle du pro",
    "why": "Pourquoi ce pro : 1 phrase qui relie le profil du joueur au style du pro. Ex: 'Comme ropz, tu as un K/D solide mais un impact par round (KR) qui pourrait monter avec plus d'agressivite early round'."
  },
  "warmupRoutine": [
    { "duration": "5 min", "task": "Tache precise 1 (ex: aim_botz map pistol + rifle 200 kills)" },
    { "duration": "10 min", "task": "Tache 2 (ex: DM FFA 1 match sur AIM_BOTZ ou Warmup.cfg)" },
    { "duration": "10 min", "task": "Tache 3 (ex: prefire map dust2 long lineup)" },
    { "duration": "5 min", "task": "Tache 4 (ex: reflex cooldown, crosshair placement static)" }
  ],
  "roadmap7days": [
    { "day": "Jour 1", "title": "Titre court", "detail": "Action du jour (max 80 chars)" },
    { "day": "Jour 2", "title": "Titre", "detail": "Action" },
    { "day": "Jour 3", "title": "Titre", "detail": "Action" },
    { "day": "Jour 4", "title": "Titre", "detail": "Action" },
    { "day": "Jour 5", "title": "Titre", "detail": "Action" },
    { "day": "Jour 6", "title": "Titre", "detail": "Action (dimanche : match official)" },
    { "day": "Jour 7", "title": "Review", "detail": "Analyse des 3 dernieres demos + ajustements semaine 2" }
  ],
  "mapSetups": {
    "map": "Meme map que mapTip",
    "setups": [
      { "name": "Nom lineup precis (ex: 'Molo Connector CT Mirage')", "role": "CT ou T", "why": "Impact : ce que ca empeche / ouvre" },
      { "name": "2e lineup", "role": "CT ou T", "why": "Impact" }
    ]
  },
  "mentalTip": "1 conseil mental / discipline / tilt management specifique au profil. Ex: 'Tu as un winrate 42% en T-side vs 58% CT. Arrete de forcer des entry fragger ton role quand tu es IGL-passif. Accepte ton style support.'"
}

REGLES STRICTES
- Tutoiement obligatoire partout.
- Aucun emoji, aucune phrase type ("tu es un bon joueur", "continue comme ca").
- Chiffres precis obligatoires dans strengths/weaknesses (ex: "K/D 1.05", "KAST 68%", "ADR 76").
- References pros reelles 2026 (donk, ZywOo, m0NESY, ropz, broky, NiKo, s1mple, magixx, apEX, cadiaN, HObbit, Aleksib, karrigan, b1t, Jame, sh1ro).
- Lineup/setups avec noms precis (ex: "smoke Xbox long dust2", "molo banana inferno", "flash popflash A apps mirage").
- Workshop maps pour warmup : aim_botz, Yprac Arena, prefire_series, FastAim/Reflex training.
- roadmap7days doit etre progressif : jour 1-2 fondamentaux, jour 3-4 tactique, jour 5-6 match, jour 7 review.
- Adapte au tier :
  * tier low (lvl 3-4) : focus aim/crosshair placement/spray control, utility basique
  * tier mid (lvl 5-6) : focus KAST/positioning/trade/util lineups
  * tier high (lvl 7-8) : focus tactique/map knowledge/clutch/pistol/anti-eco
  * tier elite (lvl 9-10) : focus meta/IGL micro-decisions/mental/consistency pro-level
- Si la stat est DANS le benchmark tier, ne la marque pas comme faiblesse.
- mapSetups : toujours 2 lineups reels CS2 (pas inventes).
- proReference : reference un pro dont le PROFIL colle, pas juste le meilleur joueur.

Reponds UNIQUEMENT par le JSON valide, sans texte avant/apres, sans markdown fence.`;
}

async function callClaude(prompt, apiKey, model) {
  const res = await fetch(CLAUDE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: model || CLAUDE_MODEL_FREE,
      // JSON enrichi (pro_reference, warmup, roadmap7days, mapSetups,
      // mentalTip) demande plus de tokens. 3000 couvre large.
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Claude API ' + res.status + ': ' + errText.slice(0, 200));
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  if (!text) throw new Error('Claude returned empty content');

  // Tentative de parse JSON. Le prompt demande JSON strict mais on
  // robustifie en virant d eventuelles fences markdown.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Claude response not valid JSON: ' + text.slice(0, 200));
  }
}

// ── Handler principal ─────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth obligatoire
  const user = await getUser(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Non authentifie' });

  // Resolve FACEIT nickname depuis profiles
  let nickname = null;
  try {
    const { data: profile } = await sb().from('profiles')
      .select('faceit_nickname')
      .eq('id', user.id).single();
    nickname = profile?.faceit_nickname;
  } catch {}
  if (!nickname) return res.status(400).json({ error: 'Aucun compte FACEIT lie' });

  // ── Gating par plan ────────────────────────────────────────────────────
  // Free : 1 diagnostic par mois maximum. Le cache existant est renvoye,
  //        mais le bouton Refresh est bloque (429 ai_limit_reached).
  // Pro / Elite : refresh illimite.
  const { plan, isAdmin } = await resolveUserPlan(user);
  const isPro = plan === 'pro' || plan === 'elite' || plan === 'team' || isAdmin;

  const cached = await readCache(user.id);
  const forceRefresh = req.query.refresh === '1';

  // Si refresh demande ET plan Free : verifier qu'on a pas deja un diagnostic
  // genere dans les 30 derniers jours. Si oui -> 429 avec code upgrade.
  if (forceRefresh && !isPro && cached) {
    const cachedAgeMs = Date.now() - new Date(cached.cached_at).getTime();
    const cachedAgeDays = cachedAgeMs / (1000 * 60 * 60 * 24);
    if (cachedAgeDays < 30) {
      const nextAvailable = new Date(new Date(cached.cached_at).getTime() + 30 * 24 * 60 * 60 * 1000);
      return res.status(429).json({
        error: 'Limite mensuelle atteinte',
        code: 'ai_limit_reached',
        plan: 'free',
        message: 'Le plan Free permet 1 diagnostic IA par mois. Passe a Pro pour refresh illimite.',
        nextAvailableAt: nextAvailable.toISOString(),
        currentDiagnosis: cached.diagnosis,
      });
    }
  }

  // Cas normal : on sert le cache si dispo et pas de refresh demande
  if (!forceRefresh && cached) {
    return res.status(200).json({
      diagnosis: cached.diagnosis,
      cached: true,
      cachedAt: cached.cached_at,
      nickname: cached.nickname,
      userLevel: cached.faceit_level,
      userElo: cached.faceit_elo,
      plan,
    });
  }

  // Si plan Free et PAS de cache : autoriser la premiere generation
  // Si plan Free et cache < 30j (sans forceRefresh) : on a deja renvoye
  //   le cache au-dessus, donc on arrive ici seulement si cache expire
  //   (>30j) ou forceRefresh=true (deja gere).

  // Verif env vars avant de commencer
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY non configure' });
  }
  if (!process.env.FACEIT_API_KEY) {
    return res.status(503).json({ error: 'FACEIT_API_KEY non configure' });
  }

  try {
    // 1. Fetch en parallele :
    //    - stats FACEIT fraiches (20 matchs + lifetime + per-map)
    //    - context FragValue Demos (FV Rating moyen, maps analysees)
    const [stats, fvContext] = await Promise.all([
      fetchFaceitStats(nickname, process.env.FACEIT_API_KEY),
      fetchFragValueDemos(user.id),
    ]);

    // 2. Build prompt enrichi + call Claude avec le bon model selon plan
    const prompt = buildPrompt(stats, fvContext);
    const model = (plan === 'pro' || plan === 'elite' || plan === 'team' || isAdmin)
      ? CLAUDE_MODEL_PRO
      : CLAUDE_MODEL_FREE;
    const diagnosis = await callClaude(prompt, process.env.ANTHROPIC_API_KEY, model);

    // 3. Cache pour 7 jours (inclut le model utilise pour debug/analytics)
    diagnosis._meta = { model, generatedAt: new Date().toISOString(), hasFvContext: !!fvContext };
    await writeCache(user.id, stats, diagnosis);

    return res.status(200).json({
      diagnosis,
      cached: false,
      cachedAt: new Date().toISOString(),
      nickname: stats.nickname,
      userLevel: stats.level,
      userElo: stats.elo,
      plan,
    });
  } catch (err) {
    console.error('ai-roadmap error:', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: err.message.slice(0, 200) });
  }
};
