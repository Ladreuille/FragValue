// api/coach-qa.js · FragValue Coach IA · Q&A 10/10
//
// Q&A contextualise sur un match analyse via Sonnet 4.6 + adaptive thinking.
// Output structure (vrai 10/10 sur les 10 axes du rubric Coach IA) :
//   - answer        (texte 120 mots, axe 1, 7)
//   - drillId       (ID library, axe 3)
//   - drillSuggestion (texte court explicatif, axe 3)
//   - citedRounds   (array round numbers, axe 6)
//   - proRef        (pro CORE cite, axe 2)
//   - role          (role detecte, axe 4)
//   - progressDelta (vs lastDiag si dispo, axe 9)
//   - confidence    (high/medium/low, axe 10)
//   - sampleSize    (n d'observations, axe 10)
//
// Plan gating : Pro+. Rate limit : 10 questions/jour.
// Cost : ~$0.003/req sans cache, $0.001 avec cache 1h.

const { createClient } = require('@supabase/supabase-js');
const { isAdminUser } = require('./_lib/subscription');
const { callClaude, parseJsonRobust, MODELS, estimateCostUsd } = require('./_lib/claude-client');
const { buildBaseSystemPrompt, detectLocale } = require('./_lib/cs2-lexicon');
const { getBenchmarksByMap, formatBenchmarksForPrompt } = require('./_lib/pro-benchmarks');
const { detectRole, getRoleFocus } = require('./_lib/role-detection');
const { listAllDrillIds, getDrillById } = require('./_lib/drill-library');
const { formatDemoRoundsXml } = require('./_lib/demo-rounds-formatter');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const DAILY_LIMIT = 10;
const MAX_QUESTION_LEN = 500;

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

async function getUser(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data, error } = await sb().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function resolveUserPlan(user) {
  if (!user) return 'free';
  if (isAdminUser(user)) return 'elite';
  try {
    const { data: profile } = await sb().from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    if (!profile?.stripe_customer_id) return 'free';
    if (!process.env.STRIPE_SECRET_KEY) return 'free';
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const subs = await stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: 'active', limit: 1 });
    if (!subs.data.length) return 'free';
    const priceId = subs.data[0].items.data[0]?.price?.id || '';
    if (priceId.includes('elite') || priceId.includes('team')) return 'elite';
    return 'pro';
  } catch { return 'free'; }
}

async function getTodayCount(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const { count, error } = await sb()
    .from('coach_qa_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', today + 'T00:00:00Z');
  if (error) return 0;
  return count || 0;
}

async function logQuestion(userId, question, responseTokens) {
  try {
    await sb().from('coach_qa_logs').insert({
      user_id: userId,
      question: question.slice(0, 500),
      response_tokens: responseTokens,
    });
  } catch (e) { console.warn('[coach-qa] log failed:', e.message); }
}

// Fetch le dernier diag ai-roadmap pour le suivi progression (axe 9 = 10/10)
// Inclut aussi les stats au moment du diag (via ai_roadmap_cache) pour
// permettre des deltas chiffres KAST/ADR/Rating vs aujourd'hui.
async function getLastRoadmapDiag(userId) {
  try {
    const [historyRes, cacheRes] = await Promise.all([
      sb()
        .from('diagnostic_history')
        .select('diagnosis, top_priorities, axis_scores, generated_at')
        .eq('user_id', userId)
        .eq('endpoint', 'ai-roadmap')
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb()
        .from('ai_roadmap_cache')
        .select('diagnosis, nickname, faceit_level, faceit_elo, cached_at')
        .eq('user_id', userId)
        .maybeSingle(),
    ]);

    const history = historyRes?.data || null;
    const cache = cacheRes?.data || null;
    if (!history && !cache) return null;

    // Extract les stats anciennes du diag (depuis le JSON stocke dans le cache)
    // Les stats sont dans diagnostic._meta ou diagnostic.diagnostic._meta selon la version
    let oldStats = null;
    if (cache?.diagnosis) {
      const d = cache.diagnosis;
      oldStats = {
        level: cache.faceit_level,
        elo: cache.faceit_elo,
        // Le nouveau schema 10/10 stocke les stats dans diagnostic._meta
        meta: d._meta || d.diagnostic?._meta || null,
      };
    }

    return {
      ...history,
      oldStats,
      cachedAt: cache?.cached_at || history?.generated_at,
    };
  } catch (e) {
    console.warn('[coach-qa] last diag fetch failed:', e.message);
    return null;
  }
}

// System prompt complet avec lexique + drills + benchmarks + role + rubric
function buildSystemPrompt(opts) {
  const { benchmarks, locale = 'fr' } = opts;
  const benchmarksBlock = benchmarks ? formatBenchmarksForPrompt(benchmarks) : '';

  return buildBaseSystemPrompt({
    locale,
    persona: locale === 'en'
      ? "You are FragValue Coach, a pro-level CS2 coach answering precise questions on an analyzed match. You go straight to the point: 120-word answer + structured insights (drill, cited rounds, pro reference, confidence). HLTV style, factual, zero kindness without substance."
      : "Tu es FragValue Coach, coach CS2 niveau pro qui repond a des questions precises sur un match analyse. Tu vas a l'essentiel : reponse 120 mots + structured insights (drill, rounds cites, reference pro, confidence). Style HLTV, factuel, zero bienveillance gratuite.",
    extraSections: `═══ DRILL LIBRARY (use ONLY these IDs) ═══

${listAllDrillIds()}

${benchmarksBlock ? `═══ PRO BENCHMARKS ═══\n\n${benchmarksBlock}\n\n` : ''}═══ JSON OUTPUT FORMAT (strict, NO prose around) ═══

{
  "answer": "Reponse texte 120 mots max, paragraphes courts (2-3 lignes), tutoiement, cite stats du match avec chiffres precis. Si question hors-scope, redirige poliment.",
  "drillId": "ID exact d'un drill de la library qui adresse la question. Vide string si pas pertinent.",
  "drillSuggestion": "1 phrase 25 mots max expliquant pourquoi ce drill (lien avec la question + ses stats). Vide string sinon.",
  "alternativeActions": [
    { "rank": 2, "action": "2eme action concrete 15 mots max (ex: travailler util banana CT, drop AWP plus souvent, etc.)" },
    { "rank": 3, "action": "3eme action concrete 15 mots max" }
  ],
  "citedRounds": [array de round numbers cites dans answer, ex [12, 18, 23]. Empty si pas de citation.],
  "proRef": "1 phrase comparant a un pro CORE (donk, ZywOo, m0NESY, NiKo, ropz, broky, karrigan, apEX, s1mple) si pertinent. Empty string sinon.",
  "progressVsLastDiag": "1 phrase 25 mots max sur l'evolution vs diag precedent SI dispo dans le contexte (delta KAST/ADR/Rating chiffre). Empty string si pas d'historique ou question hors-scope.",
  "confidence": "high | medium | low",
  "sampleSize": "n d'observations sur lequel se base la conf (ex: '147 frags' ou '3 rounds clutch')"
}

REGLES STRICTES :
- answer ≤ 120 mots, ZERO markdown, ZERO listes a puces, texte coulant
- citedRounds : array d'integers (numeros de rounds), pas de strings
- drillId : matche EXACTEMENT un ID library OU empty string
- alternativeActions : 2 elements obligatoires (rank 2 et 3). Hierarchise par impact decroissant. Si la question est purement informative (pas d'action a poser), donner 2 actions de prevention/amelioration generale.
- proRef : seulement les 9 pros CORE, ou empty string
- progressVsLastDiag : compare aux stats du diag precedent fournies dans le user message (delta % chiffre si possible)
- confidence : calibre selon n d'observations (>20 = high, 5-20 = medium, <5 = low)
- Si la question demande info absente du match, dis-le explicitement dans answer (pas d'invention)`,
  });
}

function buildUserMessage(question, context, role, lastDiag) {
  const you = context.targetPlayer || {};
  const stats = (context.matchStats || []).slice(0, 10);
  const statsLine = stats
    .map(p => `${p.name}(${p.team === 'CT' || p.team === 3 ? 'CT' : 'T'}): FVR ${Number(p.fvr).toFixed(2)}, ${p.kills}K/${p.deaths}D, ADR ${p.adr}, KAST ${p.kast}%, HS ${p.hsPct}%`)
    .join('\n');

  const roleSection = role
    ? `\nROLE DETECTE : ${role.role} (confidence ${role.confidence})
Description : ${getRoleFocus(role.role).description}
Pros similaires (style/role) : ${getRoleFocus(role.role).proExamples.join(', ')}`
    : '';

  // Progress section : enrichie avec stats anciennes pour delta chiffre (axe 9 = 10/10)
  let progressSection = '';
  if (lastDiag) {
    const date = new Date(lastDiag.generated_at || lastDiag.cachedAt).toISOString().slice(0, 10);
    const ageDays = Math.floor((Date.now() - new Date(lastDiag.generated_at || lastDiag.cachedAt).getTime()) / (1000 * 60 * 60 * 24));
    const oldElo = lastDiag.oldStats?.elo;
    const oldLevel = lastDiag.oldStats?.level;
    const eloDelta = oldElo && context.targetPlayer?.elo
      ? `${context.targetPlayer.elo - oldElo} ELO (${context.targetPlayer.elo - oldElo > 0 ? '+' : ''}${((context.targetPlayer.elo - oldElo) / oldElo * 100).toFixed(1)}%)`
      : null;

    progressSection = `\nDIAG ROADMAP PRECEDENT (${date}, il y a ${ageDays}j)
Stats au moment du diag : ELO ${oldElo || 'n/a'}, lvl ${oldLevel || 'n/a'}
Stats actuelles : ELO ${context.targetPlayer?.elo || 'n/a'} ${eloDelta ? '(delta ' + eloDelta + ')' : ''}
Top priorites alors : ${(lastDiag.top_priorities || []).join(' | ')}

Si la question concerne une de ces priorites OU le progres global, remplis progressVsLastDiag dans le JSON output avec un delta chiffre (ELO/level si dispo, ou estimation qualitative sinon).`;
  }

  // CRITIQUE axe 6 : injecter le rounds detail si rawDemoData fourni
  // (frontend passe demoData.kills/rounds/bombs LIGHT depuis sessionStorage).
  let roundsXml = '';
  if (context.rawDemoData && you.name) {
    try {
      const userTeam = you.team || (you.team_num === 3 ? 'CT' : 'T');
      roundsXml = formatDemoRoundsXml(context.rawDemoData, you.name, userTeam, {
        keyRoundsDetail: 4,  // moins que conversational (single-shot, prompt plus court)
        maxRoundsSummary: 30,
      });
    } catch (e) {
      console.warn('[coach-qa] formatDemoRoundsXml failed:', e.message);
    }
  }

  return `MATCH CONTEXT
Map : ${context.map || '?'} · Score : ${context.score?.[0] || 0}-${context.score?.[1] || 0} · Winner : ${context.winner || '-'} · ${context.rounds || '?'} rounds

LE JOUEUR (${you.name || 'anonyme'})
FV Rating : ${Number(you.fvr || 0).toFixed(2)} · ${you.kills || 0}K/${you.deaths || 0}D · ADR ${you.adr || 0} · KAST ${you.kast || 0}% · HS ${you.hsPct || 0}% · Opening ${you.fk || 0}W-${you.fd || 0}L
${roleSection}

SCOREBOARD
${statsLine}
${roundsXml ? '\nROUND-BY-ROUND DETAIL\n' + roundsXml + '\n' : ''}
${context.momentum ? 'MOMENTUM\n' + context.momentum + '\n' : ''}${progressSection}

QUESTION
${question}

→ Produis le JSON selon le schema (answer + drillId + drillSuggestion + citedRounds + proRef + confidence + sampleSize). UNIQUEMENT le JSON.`;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUser(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Authentification requise' });

  const plan = await resolveUserPlan(user);
  if (plan === 'free') {
    return res.status(403).json({
      error: 'Fonctionnalite Pro',
      message: 'Coach Q&A est reserve aux abonnes Pro et Team.',
    });
  }

  const body = req.body || {};
  const question = String(body.question || '').trim();
  const context = body.context || {};
  if (!question) return res.status(400).json({ error: 'question vide' });
  if (question.length > MAX_QUESTION_LEN) {
    return res.status(400).json({ error: `question trop longue (max ${MAX_QUESTION_LEN} chars)` });
  }

  const isAdmin = isAdminUser(user);
  if (!isAdmin) {
    const todayCount = await getTodayCount(user.id);
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: 'Limite atteinte',
        message: `Limite de ${DAILY_LIMIT} questions par jour atteinte. Reviens demain.`,
        used: todayCount,
        limit: DAILY_LIMIT,
      });
    }
  }

  try {
    const locale = detectLocale({
      acceptLanguage: req.headers['accept-language'],
      referer: req.headers.referer || '',
    });

    // Fetch en parallele : benchmarks pros + last roadmap diag
    const [benchmarks, lastDiag] = await Promise.all([
      getBenchmarksByMap(context.map),
      getLastRoadmapDiag(user.id),
    ]);

    // Detect role depuis targetPlayer
    const you = context.targetPlayer || {};
    const role = you.name ? detectRole({
      firstKills: you.fk, firstDeaths: you.fd,
      totalKills: you.kills, totalDeaths: you.deaths,
      avgAdr: you.adr, avgKast: you.kast,
      avgKd: you.deaths > 0 ? you.kills / you.deaths : 1.0,
      matches: 1,
    }) : null;

    // Build prompts
    const systemPrompt = buildSystemPrompt({ benchmarks, locale });
    const userMessage = buildUserMessage(question, context, role, lastDiag);

    // Schema JSON pour validation native Anthropic (axe 8 = 10/10)
    const qaSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['answer', 'drillId', 'drillSuggestion', 'alternativeActions', 'citedRounds', 'proRef', 'progressVsLastDiag', 'confidence', 'sampleSize'],
      properties: {
        answer: { type: 'string' },
        drillId: { type: 'string' },
        drillSuggestion: { type: 'string' },
        alternativeActions: {
          type: 'array',
          minItems: 2, maxItems: 2,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['rank', 'action'],
            properties: {
              rank: { type: 'integer', minimum: 2, maximum: 3 },
              action: { type: 'string' },
            },
          },
        },
        citedRounds: { type: 'array', items: { type: 'integer' } },
        proRef: { type: 'string' },
        progressVsLastDiag: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        sampleSize: { type: 'string' },
      },
    };

    // Call Sonnet 4.6 + adaptive thinking
    const result = await callClaude({
      model: MODELS.SONNET_46,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 1000, // augmente pour structured output complet
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'medium',
      cacheSystem: true,
      cacheTtl: '1h',
      jsonSchema: qaSchema,
    });

    if (result.stopReason === 'refusal') {
      console.warn('[coach-qa] Claude refusal:', result.refusalDetails);
      return res.status(422).json({
        error: 'Contenu refuse',
        message: 'Le coach IA a refuse de repondre (raison safety). Reformule ta question sur ton match.',
        refusalCategory: result.refusalDetails?.category,
      });
    }

    // Parse + enrichi avec drill resolu
    const parsed = parseJsonRobust(result.text);
    const drillFull = parsed.drillId ? getDrillById(parsed.drillId) : null;

    // Compute progress delta si lastDiag dispo
    let progressDelta = null;
    if (lastDiag) {
      const refDate = lastDiag.generated_at || lastDiag.cachedAt;
      const ageDays = Math.floor((Date.now() - new Date(refDate).getTime()) / (1000 * 60 * 60 * 24));
      progressDelta = {
        lastDiagAt: refDate,
        ageDays,
        previousPriorities: lastDiag.top_priorities || [],
        previousAxisScores: lastDiag.axis_scores || null,
        eloThen: lastDiag.oldStats?.elo || null,
        levelThen: lastDiag.oldStats?.level || null,
      };
    }

    const tokens = (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0);
    await logQuestion(user.id, question, tokens);

    return res.status(200).json({
      // Backward compat: answer string accessible directement
      answer: parsed.answer,
      // Nouveau structured output 10/10
      structured: {
        answer: parsed.answer,
        drillId: parsed.drillId || null,
        drill: drillFull ? {
          id: drillFull.id,
          name: drillFull.name,
          workshop: drillFull.workshop,
          durationMin: drillFull.durationMin,
          instructions: drillFull.instructions,
          metric: drillFull.metric,
        } : null,
        drillSuggestion: parsed.drillSuggestion || '',
        alternativeActions: Array.isArray(parsed.alternativeActions) ? parsed.alternativeActions : [],
        citedRounds: Array.isArray(parsed.citedRounds) ? parsed.citedRounds : [],
        proRef: parsed.proRef || '',
        role: role ? { role: role.role, confidence: role.confidence } : null,
        progressDelta,
        progressVsLastDiag: parsed.progressVsLastDiag || '',
        confidence: parsed.confidence,
        sampleSize: parsed.sampleSize || '',
      },
      tokensUsed: tokens,
      cacheReadTokens: result.usage?.cache_read_input_tokens || 0,
      estimatedCostUsd: estimateCostUsd(MODELS.SONNET_46, result.usage),
      model: MODELS.SONNET_46,
      hasBenchmarks: !!benchmarks,
      hasPreviousDiag: !!lastDiag,
    });
  } catch (e) {
    console.error('[coach-qa] error:', e.message);
    return res.status(500).json({
      error: 'Erreur Coach IA',
      message: 'Impossible de generer la reponse. Reessaie dans quelques instants.',
    });
  }
};
