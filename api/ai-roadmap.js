// api/ai-roadmap.js · FragValue Coach IA · ROADMAP DIAGNOSTIC 10/10
//
// Genere un diagnostic CS2 personnalise (niveau coach pro humain) via Claude Opus 4.7
// avec adaptive thinking + extended thinking + self-eval loop sur rubric 10 axes.
//
// Pipeline :
//   1. Fetch FACEIT stats (20 last matches) + FragValue Demos + Pro benchmarks (HLTV)
//   2. Detect role (entry/awp/igl/support/lurker/rifler) + level tier
//   3. Get drill candidates depuis library (axes prioritaires du role)
//   4. Fetch previous diagnosis from diagnostic_history (progress tracking)
//   5. Build prompt systeme (rubric + drill IDs + pro benchmarks - stable, cached 1h)
//   6. Call Claude Opus 4.7 via withSelfEval (regen 1x si axe < 10)
//   7. Save to diagnostic_history (axe 9) + ai_roadmap_cache (legacy)
//   8. Return enrichi avec backward compat fields pour le frontend
//
// Models par plan :
//   - Free  : Sonnet 4.6 + adaptive thinking + effort high  (cap a 1 diag/mois)
//   - Pro   : Opus 4.7 + adaptive thinking + effort xhigh   (refresh illimite)
//   - Elite : Opus 4.7 + adaptive thinking + effort max     (refresh illimite)
//
// Cost estimation par diagnostic Pro/Elite :
//   - Input  : ~5K tokens (cache hit ~80% sur system prompt = ~$0.005)
//   - Output : ~8K tokens (avec thinking)  = ~$0.20
//   - Total  : ~$0.20-0.25/diag · acceptable vu valeur perçue
//
// ENV VARS requises :
//   - ANTHROPIC_API_KEY · FACEIT_API_KEY · SUPABASE_URL · SUPABASE_SERVICE_KEY · STRIPE_SECRET_KEY

const { createClient } = require('@supabase/supabase-js');
const { isAdminUser } = require('./_lib/subscription');
const { callClaude, MODELS, estimateCostUsd } = require('./_lib/claude-client');
const { withSelfEval } = require('./_lib/self-eval');
const { getBenchmarksByMap, formatBenchmarksForPrompt } = require('./_lib/pro-benchmarks');
const { detectRole, getRoleFocus } = require('./_lib/role-detection');
const { getDrillsByAxis, listAllDrillIds, getDrillById } = require('./_lib/drill-library');
const { buildRubricInstructions, buildJsonSchema } = require('./_lib/diagnostic-rubric');
const { buildBaseSystemPrompt, detectLocale } = require('./_lib/cs2-lexicon');

const FACEIT_BASE = 'https://open.faceit.com/data/v4';
const CACHE_TTL_DAYS = 7;
const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

// FACEIT level → ELO target table (aligne avec levels.html)
const LEVEL_TARGETS_ELO = {
  1: 501, 2: 751, 3: 901, 4: 1051, 5: 1201,
  6: 1351, 7: 1531, 8: 1751, 9: 2001, 10: 2401,
};

function getTier(level) {
  if (level >= 9) return 'elite';
  if (level >= 7) return 'high';
  if (level >= 5) return 'mid';
  return 'low';
}

// Auth
async function getUser(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await sb().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function resolveUserPlan(user) {
  if (!user) return { plan: 'free', isAdmin: false };
  if (isAdminUser(user)) return { plan: 'elite', isAdmin: true };
  try {
    const { data: profile } = await sb()
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (!profile?.stripe_customer_id) return { plan: 'free', isAdmin: false };
    if (!process.env.STRIPE_SECRET_KEY) return { plan: 'free', isAdmin: false };
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const subs = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'active',
      limit: 1,
    });
    if (!subs.data.length) return { plan: 'free', isAdmin: false };
    const priceId = subs.data[0].items.data[0]?.price?.id || '';
    if (priceId.includes('elite') || priceId.includes('team')) return { plan: 'elite', isAdmin: false };
    return { plan: 'pro', isAdmin: false };
  } catch {
    return { plan: 'free', isAdmin: false };
  }
}

// Cache lookup (table existante ai_roadmap_cache)
async function readCache(userId) {
  const { data } = await sb()
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
  } catch (e) { console.warn('[ai-roadmap] cache write error:', e.message); }
}

// History pour progress tracking (axe 9)
async function getPreviousDiagnostic(userId) {
  try {
    const { data } = await sb()
      .from('diagnostic_history')
      .select('diagnosis, top_priorities, axis_scores, generated_at')
      .eq('user_id', userId)
      .eq('endpoint', 'ai-roadmap')
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data || null;
  } catch (e) {
    console.warn('[ai-roadmap] previous diag fetch failed:', e.message);
    return null;
  }
}

async function saveDiagnosticHistory(userId, diagnosis, model, usage) {
  try {
    const topPriorities = (diagnosis.topPriorities || []).map(p => p.problem || '').slice(0, 3);
    await sb().from('diagnostic_history').insert({
      user_id: userId,
      endpoint: 'ai-roadmap',
      diagnosis,
      top_priorities: topPriorities,
      axis_scores: diagnosis.axisScores || null,
      confidence_avg: diagnosis.confidence || null,
      model,
      output_tokens: usage?.output_tokens || null,
    });
  } catch (e) {
    console.warn('[ai-roadmap] history insert failed:', e.message);
  }
}

// FACEIT stats fetch (20 last matches)
async function fetchFaceitStats(nickname, apiKey) {
  const h = { Authorization: 'Bearer ' + apiKey };
  const pRes = await fetch(`${FACEIT_BASE}/players?nickname=${encodeURIComponent(nickname)}`, { headers: h });
  if (!pRes.ok) throw new Error('FACEIT player lookup failed ' + pRes.status);
  const player = await pRes.json();
  const playerId = player.player_id;
  const cs2 = player.games?.cs2 || {};

  const [recentRes, lifetimeRes] = await Promise.all([
    fetch(`${FACEIT_BASE}/players/${playerId}/games/cs2/stats?limit=20`, { headers: h }),
    fetch(`${FACEIT_BASE}/players/${playerId}/stats/cs2`, { headers: h }),
  ]);
  const recent = recentRes.ok ? await recentRes.json() : { items: [] };
  const lifetime = lifetimeRes.ok ? await lifetimeRes.json() : {};

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
  return {
    nickname: player.nickname,
    country: (player.country || '').toUpperCase(),
    elo: cs2.faceit_elo || null,
    level: cs2.skill_level || null,
    matchesAnalyzed: n,
    winRate: Math.round((wins / n) * 100),
    avgKd:  +(sum(it => it.stats?.['K/D Ratio']) / n).toFixed(2),
    avgAdr: +(sum(it => it.stats?.['ADR']) / n).toFixed(0),
    avgHs:  +(sum(it => it.stats?.['Headshots %']) / n).toFixed(0),
    avgKast: +(sum(it => it.stats?.['KAST']) / n).toFixed(0) || null,
    avgKr:  +(sum(it => it.stats?.['K/R Ratio']) / n).toFixed(2),
    totalKills:  sum(it => it.stats?.['Kills']),
    totalDeaths: sum(it => it.stats?.['Deaths']),
    totalAssists: sum(it => it.stats?.['Assists']),
    totalRounds: sum(it => it.stats?.['Rounds']),
    firstKills:  sum(it => it.stats?.['Entry Wins']),  // FACEIT entry frags
    firstDeaths: sum(it => it.stats?.['Entry Losses']),
    lifetime: {
      matches: parseInt(lifetime.lifetime?.['Matches']) || null,
      winRate: parseFloat(lifetime.lifetime?.['Win Rate %']) || null,
      avgKd: parseFloat(lifetime.lifetime?.['Average K/D Ratio']) || null,
      longestStreak: parseInt(lifetime.lifetime?.['Longest Win Streak']) || null,
    },
    mapStats: mapStats.slice(0, 6),
  };
}

// FragValue demos context (FV Rating moyen + key rounds via matches.demo_data)
// Pour l'axe 6 (granularite round-by-round), on extract les rounds cles
// (clutch, multi-kill, eco win, force win) des 3 derniers matches du user.
async function fetchFragValueDemos(userId) {
  try {
    // Fetch en parallele : demos agreg + matches.demo_data (rounds detail)
    const [demosRes, matchesRes] = await Promise.all([
      sb()
        .from('demos')
        .select('id, map, fv_rating, analysed_at, total_kills, rounds')
        .eq('user_id', userId)
        .order('analysed_at', { ascending: false })
        .limit(20),
      sb()
        .from('matches')
        .select('id, faceit_match_id, map, winner, rounds, demo_data, created_at')
        .eq('user_id', userId)
        .not('demo_data', 'is', null)
        .order('created_at', { ascending: false })
        .limit(3),
    ]);

    const data = demosRes?.data || [];
    if (data.length === 0) return null;

    const withRating = data.filter(d => d.fv_rating != null);
    const avgFvRating = withRating.length > 0
      ? +(withRating.reduce((s, d) => s + Number(d.fv_rating), 0) / withRating.length).toFixed(2)
      : null;

    const byMap = {};
    data.forEach(d => {
      const m = d.map || 'unknown';
      byMap[m] = (byMap[m] || 0) + 1;
    });
    const topMap = Object.entries(byMap).sort((a, b) => b[1] - a[1])[0]?.[0];

    // Extract key rounds depuis matches.demo_data (axe 6 = 10/10)
    const keyRounds = extractKeyRounds(matchesRes?.data || []);

    return {
      demosCount:     data.length,
      avgFvRating,
      topMap:         topMap && topMap !== 'unknown' ? topMap : null,
      lastDemoMap:    data[0].map || null,
      lastDemoRating: data[0].fv_rating != null ? Number(data[0].fv_rating).toFixed(2) : null,
      recentDemos: data.slice(0, 5).map(d => ({
        map: d.map, fvr: d.fv_rating, kills: d.total_kills, rounds: d.rounds,
      })),
      keyRounds, // [{ matchMap, roundNum, type, description }, ...]
    };
  } catch (e) {
    console.warn('[ai-roadmap] fetchFragValueDemos failed:', e.message);
    return null;
  }
}

// Extract rounds cles des matches.demo_data : clutch, multi, eco win, opening
// Retourne max 8 rounds avec description courte (1 phrase) pour injection prompt.
function extractKeyRounds(matches) {
  const result = [];
  for (const m of matches) {
    if (!m.demo_data) continue;
    const d = m.demo_data;
    const matchMap = (m.map || '').replace('de_', '');

    // demo_data structure varie selon le parser. On essaie plusieurs paths.
    const rounds = d.rounds || d.roundsData || d.matchRounds || [];
    if (!Array.isArray(rounds)) continue;

    for (const r of rounds.slice(0, 24)) {
      const num = r.number || r.round || r.roundNum;
      if (!num) continue;

      // Detect le type de round notable
      let type = null, description = null;
      const roundKills = r.kills || r.roundKills || [];
      const userKills = roundKills.filter(k => k.user_kill === true || k.byUser === true).length;
      const userDeath = roundKills.find(k => k.user_death === true || k.userDeath === true);

      if (r.clutch === true || r.clutchRound) {
        type = 'clutch';
        description = `R${num} ${matchMap}: clutch ${r.clutchType || ''} ${r.won ? 'gagne' : 'perdu'}`;
      } else if (userKills >= 3) {
        type = 'multi';
        description = `R${num} ${matchMap}: ${userKills}K (multi-kill), round ${r.won ? 'gagne' : 'perdu'}`;
      } else if (r.eco_win === true || (r.economy === 'eco' && r.won)) {
        type = 'eco_win';
        description = `R${num} ${matchMap}: eco-win, ${userKills}K`;
      } else if (r.opening_kill === true && userDeath) {
        type = 'opening_loss';
        description = `R${num} ${matchMap}: opening loss (mort early ${userDeath.callout || ''})`;
      }

      if (type && description) {
        result.push({ matchMap, roundNum: num, type, description });
        if (result.length >= 8) return result;
      }
    }
  }
  return result;
}

// Construit le SYSTEM PROMPT (stable - cache 1h via cache_control)
//
// Contient :
//   - Persona coach pro CS2
//   - Style guide HLTV / lexique CS2
//   - Rubric 10 axes
//   - Drill library complete (IDs + axes + level + duree)
//   - Schema JSON output
//   - Pro benchmarks pour la map cle (si dispo)
//
// Cache hit = ~5K tokens reutilises (~80% reduction cout)
function buildSystemPrompt(opts) {
  const { benchmarks, locale = 'fr' } = opts;
  const benchmarksBlock = benchmarks ? formatBenchmarksForPrompt(benchmarks) : '';

  // buildBaseSystemPrompt fournit : persona + style + lexique CS2 + pros CORE + map pool
  return buildBaseSystemPrompt({
    locale,
    persona: locale === 'en'
      ? "You are FragValue Coach IA, pro-level CS2 coach (FACEIT lvl 10, ex semi-pro EU, 15y competitive). You analyze players from their FACEIT stats and demos to produce a personalized diagnosis worthy of a human pro coach (Top 20 HLTV equivalent rating). This diagnosis is FragValue's signature: it MUST be flawless."
      : "Tu es FragValue Coach IA, coach CS2 niveau professionnel (lvl 10 FACEIT, ex-joueur semi-pro EU, 15 ans competitive). Tu analyses des joueurs sur la base de leurs stats FACEIT et demos pour produire un diagnostic personnalise digne d'un coach pro humain (rating Top 20 HLTV equivalent). Ce diagnostic est la marque de fabrique FragValue : il doit etre IRREPROCHABLE.",
    extraSections: `═══ DRILL LIBRARY (use ONLY these IDs) ═══

${listAllDrillIds()}

You MUST pick 3-5 drills from THIS LIST ONLY. No invention. drillId in JSON output must match EXACTLY.

${benchmarksBlock ? `═══ PRO BENCHMARKS FOR KEY MAP ═══\n\n${benchmarksBlock}\n\n` : ''}═══ RUBRIC 10 AXES (each scored 1-10) ═══

${buildRubricInstructions()}

Target 10/10 on ALL axes. If you can't (e.g. no history for axis 9), explain in axisNotes. Axis 8 (Structure) must be 10 mandatory.`,
  });
}

// User message : stats specifiques user (volatile, pas cache)
function buildUserMessage(opts) {
  const { stats, fvContext, role, previousDiag, drillCandidates } = opts;
  const tier = getTier(stats.level || 1);
  const nextLevel = Math.min((stats.level || 1) + 1, 11);
  const eloTarget = stats.level >= 10 ? 2400 : LEVEL_TARGETS_ELO[stats.level];
  const eloGap = Math.max(0, eloTarget - (stats.elo || 0));

  const keyRoundsBlock = (fvContext?.keyRounds || []).length > 0
    ? `\n\nROUNDS CLES (3 derniers matches FragValue, axe 6 round-by-round)
${fvContext.keyRounds.map(r => `- ${r.description}`).join('\n')}

Cite ces rounds specifiques quand tu identifies des patterns (ex: "Sur ${fvContext.keyRounds[0]?.matchMap || 'tes maps'} R${fvContext.keyRounds[0]?.roundNum || 'X'}, tu as eu un ${fvContext.keyRounds[0]?.type || 'pattern'}, qui montre que...").`
    : '';

  const fvSection = fvContext && fvContext.demosCount > 0
    ? `\n\nFRAGVALUE DEMOS (n=${fvContext.demosCount} parsees)
- FV Rating moyen : ${fvContext.avgFvRating ?? 'n/a'} (echelle HLTV 2.1 : 0.80 faible / 1.00 moyen / 1.15 bon / 1.30+ pro)
- Map la plus jouee : ${fvContext.topMap || 'n/a'}
- Derniere demo : ${fvContext.lastDemoMap || 'n/a'} (FV Rating ${fvContext.lastDemoRating ?? 'n/a'})
- Demos recentes : ${(fvContext.recentDemos || []).map(d => `${d.map} (FV ${d.fvr ?? 'n/a'}, ${d.kills}K/${d.rounds}R)`).join(' | ')}${keyRoundsBlock}`
    : '';

  const previousSection = previousDiag
    ? `\n\nDIAG PRECEDENT (${new Date(previousDiag.generated_at).toISOString().slice(0, 10)})
Top priorites alors : ${(previousDiag.top_priorities || []).join(' | ')}
Axis scores : ${JSON.stringify(previousDiag.axis_scores || {})}

Pour l'axe 9 (Suivi progression), compare les stats actuelles aux stats du diag precedent et produis des deltas chiffres dans progressTracking.`
    : `\n\nDIAG PRECEDENT : aucun (premier diag pour ce joueur)
Pour l'axe 9, indique progressTracking: null et axisScore axe 9 = 7/10 max (pas de baseline a comparer).`;

  const drillSuggestions = drillCandidates && drillCandidates.length
    ? `\n\nDRILLS CANDIDATS (selection pre-filtree par role+level, choisis-en 3-5 dans le JSON output) :
${drillCandidates.map(d => `- ${d.id} (${d.axes.join('+')}, ${d.durationMin}min) : ${d.name}`).join('\n')}`
    : '';

  return `JOUEUR A DIAGNOSTIQUER

IDENTITE
- Pseudo : ${stats.nickname}
- Niveau FACEIT : ${stats.level} (tier ${tier})
- ELO : ${stats.elo} (cible lvl ${nextLevel} : ${eloTarget}, gap : ${eloGap} ELO)
- Role detecte : ${role.role} (confidence ${role.confidence}, signaux ${JSON.stringify(role.signals)})
- Description role : ${getRoleFocus(role.role).description}
- Pros similaires (style/role) : ${getRoleFocus(role.role).proExamples.join(', ')}

PERFORMANCE 20 DERNIERS MATCHS
- Matchs : ${stats.matchesAnalyzed} · Winrate : ${stats.winRate}%
- K/D : ${stats.avgKd} · ADR : ${stats.avgAdr} · HS% : ${stats.avgHs}% · KAST : ${stats.avgKast}% · K/R : ${stats.avgKr}
- Opening : ${stats.firstKills}W vs ${stats.firstDeaths}L (ratio ${role.metrics.openingRatio})
- Volume : ${stats.totalKills}K / ${stats.totalDeaths}D / ${stats.totalAssists}A sur ${stats.totalRounds} rounds

LIFETIME
- Total matchs : ${stats.lifetime.matches} · Winrate : ${stats.lifetime.winRate}% · K/D : ${stats.lifetime.avgKd} · Longest streak : ${stats.lifetime.longestStreak}

MAP POOL (20 derniers matchs)
${stats.mapStats.map(m => `- de_${m.map} : ${m.matches} matchs, winrate ${m.winRate}%`).join('\n')}${fvSection}${previousSection}${drillSuggestions}

═══ INSTRUCTIONS ═══

Produis un diagnostic JSON STRICT selon le schema (cf. system prompt) qui vise 10/10 sur les 10 axes du rubric.

Points critiques :
- topPriorities : 3 priorites strictement, classees par impact x effort (axe 5)
- deepDive : 2-5 analyses avec proComparison citant chiffres pros (axe 1, 2, 6)
- drills : 3-5 drillId valides depuis la library (axe 3)
- proRefs : 1-3 pros similaires en style/role (axe 4)
- progressTracking : compare au diag precedent si dispo (axe 9), sinon null
- axisScores : auto-evaluation 1-10 sur les 10 axes (axe 8 = 10 obligatoire)
- axisNotes : justification courte si une note < 10
- confidence : confiance globale [0-1]

Reponds UNIQUEMENT avec le JSON valide, sans markdown fences, sans prose autour.`;
}

// Map le nouveau schema 10/10 → champs legacy attendus par le frontend
// Garde la backward compat tout en exposant la nouvelle richesse via diagnostic.*
function mapToLegacyFormat(d, opts = {}) {
  const { stats } = opts;

  // Charge les drills complets pour exposer leurs details au frontend
  const drillsResolved = (d.drills || []).map(dr => {
    const full = getDrillById(dr.drillId);
    if (!full) return { duration: '?', task: dr.reason };
    return {
      duration: `${full.durationMin} min`,
      task: `${full.name} (${full.workshop}) · ${full.instructions} · cible: ${dr.targetMetric}`,
    };
  });

  // Forces : utilise le nouveau schema strengths[] (axe rubric)
  const strengths = (d.strengths || []).map(s =>
    `${s.evidence} · ${s.vsBenchmark} (${s.axis})`
  );

  // Faiblesses : top priorites avec details chiffres
  const weaknesses = (d.topPriorities || []).map(p =>
    `${p.problem} (impact: ${p.impact}, conf: ${p.confidence}, n=${p.sampleSize})`
  );

  const actions = (d.topPriorities || []).map((p, i) => ({
    title: `Priorite ${i + 1} : ${p.axis}`,
    detail: `${p.problem} · ${p.impact} · evidence: ${p.evidence}`,
  }));

  // Map tip : prend la map la plus faible du user (winrate min, >= 3 matchs)
  // Si le deepDive cite une map specifique, on prefere ca
  let weakestMap = null;
  if (stats?.mapStats?.length) {
    const candidates = stats.mapStats.filter(m => m.matches >= 3).sort((a, b) => a.winRate - b.winRate);
    weakestMap = candidates[0] || stats.mapStats[stats.mapStats.length - 1];
  }
  const mapDive = (d.deepDive || []).find(dd => dd.roundRefs && dd.roundRefs.length > 0) || (d.deepDive || [])[0];
  const mapTip = (weakestMap || mapDive) ? {
    map: weakestMap ? `de_${weakestMap.map}` : null,
    advice: mapDive ? `${mapDive.observation} · ${mapDive.proComparison}` : 'Travaille les lineups + prefire angles principaux',
  } : null;

  // Pro reference principale
  const mainProRef = (d.proRefs || [])[0];
  const proReference = mainProRef ? {
    name: mainProRef.proName,
    team: mainProRef.team,
    why: mainProRef.why,
  } : null;

  // Roadmap 7 jours : repartie sur 7 jours (mix drills + match + review)
  const roadmap7days = [];
  for (let i = 0; i < 7; i++) {
    if (i < drillsResolved.length) {
      roadmap7days.push({
        day: `Jour ${i + 1}`,
        title: drillsResolved[i].duration,
        detail: drillsResolved[i].task.slice(0, 200),
      });
    } else if (i === 5) {
      roadmap7days.push({ day: `Jour 6`, title: 'Match', detail: '2 matchs FACEIT · applique les drills · note 3 erreurs' });
    } else if (i === 6) {
      roadmap7days.push({ day: `Jour 7`, title: 'Review', detail: 'Analyse des 3 dernieres demos via FragValue · ajustements semaine 2' });
    } else {
      roadmap7days.push({ day: `Jour ${i + 1}`, title: 'Repos actif', detail: '1h DM + visionnage demos pros HLTV (donk / ZywOo)' });
    }
  }

  return {
    // Legacy fields (frontend actuel)
    summary: d.summary,
    strengths,
    weaknesses,
    actions,
    weeklyGoal: d.topPriorities?.[0]?.impact || null,
    mapTip,
    proReference,
    warmupRoutine: drillsResolved.slice(0, 4),
    roadmap7days,
    mapSetups: null,
    mentalTip: d.topPriorities?.find(p => p.axis === 'mental')?.problem || null,

    // Nouveaux champs 10/10 (frontend peut migrer)
    diagnostic: {
      strengths: d.strengths,
      topPriorities: d.topPriorities,
      deepDive: d.deepDive,
      drills: d.drills,
      drillsResolved,
      proRefs: d.proRefs,
      progressTracking: d.progressTracking,
      axisScores: d.axisScores,
      axisNotes: d.axisNotes,
      confidence: d.confidence,
    },
  };
}

// Handler principal
module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Non authentifie' });

  // Resolve nickname
  let nickname = null;
  try {
    const { data: profile } = await sb().from('profiles').select('faceit_nickname').eq('id', user.id).single();
    nickname = profile?.faceit_nickname;
  } catch {}
  if (!nickname) return res.status(400).json({ error: 'Aucun compte FACEIT lie' });

  // Plan gating
  const { plan, isAdmin } = await resolveUserPlan(user);
  const isPro = plan === 'pro' || plan === 'elite' || isAdmin;

  const cached = await readCache(user.id);
  const forceRefresh = req.query.refresh === '1';

  if (forceRefresh && !isPro && cached) {
    const cachedAgeDays = (Date.now() - new Date(cached.cached_at).getTime()) / (1000 * 60 * 60 * 24);
    if (cachedAgeDays < 30) {
      const nextAvailable = new Date(new Date(cached.cached_at).getTime() + 30 * 24 * 60 * 60 * 1000);
      return res.status(429).json({
        error: 'Limite mensuelle atteinte',
        code: 'ai_limit_reached',
        plan: 'free',
        message: 'Plan Free permet 1 diagnostic IA par mois. Passe a Pro pour refresh illimite.',
        nextAvailableAt: nextAvailable.toISOString(),
        currentDiagnosis: cached.diagnosis,
      });
    }
  }

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

  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'ANTHROPIC_API_KEY non configure' });
  if (!process.env.FACEIT_API_KEY) return res.status(503).json({ error: 'FACEIT_API_KEY non configure' });

  try {
    // 1. Fetch en parallele : FACEIT stats + FragValue demos + previous diag
    const [stats, fvContext, previousDiag] = await Promise.all([
      fetchFaceitStats(nickname, process.env.FACEIT_API_KEY),
      fetchFragValueDemos(user.id),
      getPreviousDiagnostic(user.id),
    ]);

    // 2. Pro benchmarks pour la map la plus jouee
    const topMap = stats.mapStats?.[0]?.map || fvContext?.topMap;
    const benchmarks = await getBenchmarksByMap(topMap);

    // 3. Detect role + select drill candidates
    const role = detectRole(stats);
    const roleFocus = getRoleFocus(role.role);
    const drillCandidates = getDrillsByAxis(roleFocus.primaryAxes, stats.level || 5, 8);

    // 4. Detection locale + Build prompts (system stable, cache 1h)
    const locale = detectLocale({
      acceptLanguage: req.headers['accept-language'],
      referer: req.headers.referer || '',
    });
    const systemPrompt = buildSystemPrompt({ benchmarks, locale });
    const userMessage = buildUserMessage({
      stats, fvContext, role, previousDiag, drillCandidates,
    });

    // 5. Model selection par plan
    const model = isPro ? MODELS.OPUS_47 : MODELS.SONNET_46;
    const effort = isAdmin || plan === 'elite' ? 'max' : isPro ? 'xhigh' : 'high';
    // maxTokens : 8000 pour rester sous le timeout Vercel function 60s
    // (avec adaptive thinking + effort xhigh, > 8K peut depasser 60s)
    const maxTokens = 8000;

    // 6. Call Claude avec self-eval loop (regen 1x si axe < threshold)
    // + cap cout dur a $1 pour eviter les explosions (regen recursive)
    // + JSON schema natif Anthropic pour validation API
    const evalResult = await withSelfEval({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens,
      effort,
      thinking: { type: 'adaptive', display: 'summarized' },
      cacheSystem: true,
      // Pas de cacheTtl 1h ici : ai-roadmap est appele 1×/sem max par user.
      // Le cache TTL 5min default suffit (entre regen + retry self-eval).
      // 1h coute 2× write vs 1.25× pour 5min, sans benefit ici.
      jsonSchema: buildJsonSchema({ requireProgressTracking: false }),
      threshold: 9, // 9-10 acceptes (10 difficile garanti structurellement)
      maxRetries: 1,
      maxCostUsd: 0.60, // cap dur : abort si depasse (vs $1.00 trop laxe)
      onAttempt: (n, d) => {
        if (n > 1) console.log(`[ai-roadmap] regen attempt ${n}, axisScores:`, d.axisScores);
      },
    });

    const { diagnosis, attempts, axisScoresSummary, usageTotal, estimatedCostUsd, weakAxes } = evalResult;

    // 7. Map vers schema legacy + nouveau (avec stats pour mapTip pertinent)
    const finalDiagnosis = mapToLegacyFormat(diagnosis, { stats });
    finalDiagnosis._meta = {
      model: evalResult.model || model,
      generatedAt: new Date().toISOString(),
      hasFvContext: !!fvContext,
      hasBenchmarks: !!benchmarks,
      benchmarksMap: benchmarks?.map || null,
      role: role.role,
      roleConfidence: role.confidence,
      hasPreviousDiag: !!previousDiag,
      attempts,
      axisScoresSummary,
      weakAxes: weakAxes.map(a => a.id),
      tokensTotal: (usageTotal?.input_tokens || 0) + (usageTotal?.output_tokens || 0),
      cacheReadTokens: usageTotal?.cache_read_input_tokens || 0,
      estimatedCostUsd,
      thinkingExcerpt: (evalResult.thinking || '').slice(0, 500),
    };

    // 8. Save to caches
    await Promise.all([
      writeCache(user.id, stats, finalDiagnosis),
      saveDiagnosticHistory(user.id, diagnosis, evalResult.model || model, usageTotal),
    ]);

    return res.status(200).json({
      diagnosis: finalDiagnosis,
      cached: false,
      cachedAt: new Date().toISOString(),
      nickname: stats.nickname,
      userLevel: stats.level,
      userElo: stats.elo,
      plan,
    });
  } catch (err) {
    console.error('[ai-roadmap] error:', err);
    return res.status(500).json({ error: 'Erreur serveur', detail: String(err.message || err).slice(0, 200) });
  }
};
