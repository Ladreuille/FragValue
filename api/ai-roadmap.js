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

const CLAUDE_MODEL = 'claude-haiku-4-5';
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
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
async function resolveUserPlan(user) {
  if (!user) return { plan: 'free', isAdmin: false };
  const ADMIN_EMAILS = ['qdreuillet@gmail.com'];
  if (user.email && ADMIN_EMAILS.includes(user.email)) {
    return { plan: 'team', isAdmin: true };
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
    if (priceId.includes('team') || priceId === process.env.STRIPE_PRICE_TEAM_MONTHLY || priceId === process.env.STRIPE_PRICE_TEAM_ANNUEL) plan = 'team';
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

// ── Prompt construction + Claude call ────────────────────────────────────
function buildPrompt(stats) {
  const nextLevel = Math.min((stats.level || 1) + 1, 11);
  const eloTarget = stats.level >= 10 ? 2400 : LEVEL_TARGETS_ELO[stats.level];
  const eloGap = Math.max(0, eloTarget - (stats.elo || 0));

  return `Tu es un coach CS2 experimente et bienveillant. Ton role est de produire un diagnostic de progression personnalise pour un joueur FACEIT qui veut passer au niveau superieur. Tu reponds UNIQUEMENT en JSON valide, sans texte avant ou apres, sans markdown, sans code fence.

Voici les stats du joueur sur ses 20 derniers matchs FACEIT :

Pseudo : ${stats.nickname}
Niveau FACEIT actuel : ${stats.level}
ELO : ${stats.elo} (cible niveau ${nextLevel} : ${eloTarget}, soit ${eloGap} ELO a gagner)
Matchs analyses : ${stats.matchesAnalyzed}
Win rate : ${stats.winRate}%
K/D ratio moyen : ${stats.avgKd}
ADR moyen : ${stats.avgAdr}
HS% moyen : ${stats.avgHs}%
KAST moyen : ${stats.avgKast}%
K/R ratio : ${stats.avgKr}
Total kills : ${stats.totalKills}
Total deaths : ${stats.totalDeaths}
Total assists : ${stats.totalAssists}
Total rounds joues : ${stats.totalRounds}

Lifetime :
- Total matchs : ${stats.lifetime.matches}
- Win rate lifetime : ${stats.lifetime.winRate}%
- K/D lifetime : ${stats.lifetime.avgKd}
- Plus longue serie de victoires : ${stats.lifetime.longestStreak}

Stats par map (derniers 20 matchs) :
${stats.mapStats.map(m => `- ${m.map} : ${m.matches} matchs, ${m.winRate}% winrate`).join('\n')}

Ta tache : produire un diagnostic JSON structure avec 6 champs obligatoires.

Format de reponse JSON attendu (respecte EXACTEMENT cette structure) :
{
  "summary": "2 a 3 phrases resumant le profil du joueur et son levier principal de progression. Tutoie le joueur (\"tu as\", \"ton K/D\"). Maximum 280 caracteres.",
  "strengths": [
    "Point fort 1 avec chiffre precis",
    "Point fort 2 avec chiffre precis",
    "Point fort 3 avec chiffre precis"
  ],
  "weaknesses": [
    "Faiblesse 1 avec chiffre precis et contexte",
    "Faiblesse 2 avec chiffre precis et contexte",
    "Faiblesse 3 avec chiffre precis et contexte"
  ],
  "actions": [
    {
      "title": "Action concrete 1",
      "detail": "Comment la mettre en oeuvre, en 1 phrase. Specifique au profil du joueur."
    },
    {
      "title": "Action concrete 2",
      "detail": "Comment la mettre en oeuvre."
    },
    {
      "title": "Action concrete 3",
      "detail": "Comment la mettre en oeuvre."
    },
    {
      "title": "Action concrete 4",
      "detail": "Comment la mettre en oeuvre."
    }
  ],
  "weeklyGoal": "Un objectif chiffre a atteindre sur les 5 prochains matchs. Exemple : \"Atteindre K/D 1.15 sur les 5 prochains matchs\" ou \"Gagner 3 pistol rounds cette semaine\".",
  "mapTip": {
    "map": "nom de la map avec le pire winrate parmi celles jouees >= 3 fois, OU la map avec le meilleur winrate si tout est OK",
    "advice": "Conseil specifique sur cette map, 1 a 2 phrases. Peut mentionner positions, strats, utility. Si le joueur la joue peu, propose plutot de la delaisser."
  }
}

Regles strictes :
- Tutoiement obligatoire.
- Aucun emoji, aucun accent sur les mots techniques (kast, adr, elo, hs).
- Les chiffres precis dans les faiblesses / forces (ex : "K/D 1.05", "KAST 68%").
- Les actions doivent etre specifiques au profil, pas generiques. Si K/D faible, propose du DM. Si KAST faible, propose de travailler le positionnement. Adapte au niveau : un joueur lvl 4 a besoin de conseils differents d'un lvl 9.
- Si le joueur n'a pas de faiblesse evidente (toutes les stats au niveau cible), focus les actions sur la regularite et les facteurs ELO (streak, pistol, tilt).
- Le weeklyGoal doit etre realiste et mesurable.
- mapTip : obligatoire de choisir une map parmi celles listees ci-dessus.
- Pas de phrases types "vous etes un bon joueur", reste factuel et actionnable.

Reponds UNIQUEMENT par le JSON, rien d'autre.`;
}

async function callClaude(prompt, apiKey) {
  const res = await fetch(CLAUDE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
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
  // Pro / Team : refresh illimite.
  const { plan, isAdmin } = await resolveUserPlan(user);
  const isPro = plan === 'pro' || plan === 'team' || isAdmin;

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
    // 1. Fetch stats FACEIT fraiches (20 derniers matchs + lifetime + per-map)
    const stats = await fetchFaceitStats(nickname, process.env.FACEIT_API_KEY);

    // 2. Build prompt + call Claude
    const prompt = buildPrompt(stats);
    const diagnosis = await callClaude(prompt, process.env.ANTHROPIC_API_KEY);

    // 3. Cache pour 7 jours
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
