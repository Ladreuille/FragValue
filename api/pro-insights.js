// api/pro-insights.js · FragValue Coach IA · PRO INSIGHTS 10/10
//
// Genere 3 conseils tactiques "ce qu'un pro aurait fait" sur des moments cles
// (clutches perdus, low impact rounds, lost opening) via Sonnet 4.6 + adaptive
// thinking + prompt caching context-stable.
//
// Plan gating : Pro/Team uniquement.
// Cache : 1h (la reponse est quasi-stable pour un meme match).
// Rate limit : 5 appels/jour par user.

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { isAdminUser } = require('./_lib/subscription');
const { callClaude, parseJsonRobust, MODELS, estimateCostUsd } = require('./_lib/claude-client');
const { buildBaseSystemPrompt, detectLocale } = require('./_lib/cs2-lexicon');
const { getBenchmarksByMap, formatBenchmarksForPrompt } = require('./_lib/pro-benchmarks');
const { getDrillsByAxis, getDrillById, listAllDrillIds } = require('./_lib/drill-library');
const { detectRole, getRoleFocus } = require('./_lib/role-detection');

// Fetch lastDiag from diagnostic_history for axe 9 (Suivi progression)
let _sb_helper = null;
function _sbHelper() {
  if (_sb_helper) return _sb_helper;
  _sb_helper = require('@supabase/supabase-js').createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb_helper;
}
async function fetchLastDiag(userId) {
  try {
    const { data } = await _sbHelper()
      .from('diagnostic_history')
      .select('top_priorities, axis_scores, generated_at')
      .eq('user_id', userId)
      .in('endpoint', ['ai-roadmap', 'pro-insights'])
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data;
  } catch (e) {
    return null;
  }
}

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const DAILY_LIMIT = 5;

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
  const { count } = await sb()
    .from('pro_insights_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', today + 'T00:00:00Z');
  return count || 0;
}

async function logCall(userId, contextHash, tokens) {
  try {
    await sb().from('pro_insights_logs').insert({
      user_id: userId, context_hash: contextHash, response_tokens: tokens,
    });
  } catch (e) { console.warn('[pro-insights] log failed:', e.message); }
}

async function getCached(contextHash) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await sb()
    .from('pro_insights_cache')
    .select('response, created_at')
    .eq('context_hash', contextHash)
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.response || null;
}

async function setCached(contextHash, response) {
  try {
    await sb().from('pro_insights_cache').insert({
      context_hash: contextHash, response,
    });
  } catch (e) { console.warn('[pro-insights] cache write failed:', e.message); }
}

function buildSystemPrompt(benchmarks, locale = 'fr') {
  const benchmarksBlock = benchmarks ? formatBenchmarksForPrompt(benchmarks) : '';
  return buildBaseSystemPrompt({
    locale,
    persona: locale === 'en'
      ? "You are FragValue Coach IA, pro-level CS2 coach (Top 20 HLTV equivalent). You analyze 3 key situations from the target player's match and show what a pro would have done. Diagnosis ultra-tactical, numerical, anchored in real map positions."
      : "Tu es FragValue Coach IA, coach CS2 niveau pro (Top 20 HLTV equivalent). Tu analyses 3 situations cles d'un match du joueur cible et lui montres ce qu'un pro aurait fait. Diagnostic ultra-tactique, chiffre, ancre dans la map et les positions reelles.",
    extraSections: `═══ DRILL LIBRARY (utilise UNIQUEMENT ces IDs) ═══

${listAllDrillIds()}

${benchmarksBlock ? `═══ BENCHMARKS PROS ═══\n\n${benchmarksBlock}\n\n` : ''}═══ FORMAT OUTPUT (JSON strict) ═══

{
  "insights": [
    {
      "roundNum": int,
      "problem": "diagnostic 1 phrase 15 mots max sur ce qui a mal tourne",
      "proApproach": "ce qu'un pro aurait fait concretement, 2-3 phrases 40 mots max. Mention positions/timings/lineups specifiques a la map. Cite un pro reel verifie (ZywOo, donk, ropz, etc.)",
      "drillId": "ID exact d'un drill de la library qui adresse cette situation",
      "drill": "1 phrase 20 mots max sur le drill (workshop + metrique cible)",
      "confidence": "high | medium | low"
    },
    ... (3 objets, un par situation)
  ]
}

REGLES :
- Tutoiement obligatoire
- Lineups CS2 reels (smoke top mid Mirage, molo banana CT Inferno, flash apps, HE pit, etc.)
- Pros 2026 uniquement (cf. liste ci-dessus)
- drillId doit matcher EXACTEMENT un ID library
- Pas de markdown, UNIQUEMENT le JSON`,
  });
}

function buildUserMessage(context, role, lastDiag) {
  const sits = (context.situations || []).slice(0, 3);
  const sitBlock = sits.map((s, i) => `
SITUATION ${i + 1} · Round ${s.roundNum} · ${s.situationType} · ${s.outcome}
${s.details}
`).join('\n');

  const roleSection = role
    ? `\nROLE DETECTE : ${role.role} (confidence ${role.confidence})
Description : ${getRoleFocus(role.role).description}
Pros similaires : ${getRoleFocus(role.role).proExamples.slice(0, 3).join(', ')}
Adapte tes proApproach a ce role.`
    : '';

  const prevSection = lastDiag
    ? `\nDIAG PRECEDENT (${new Date(lastDiag.generated_at).toISOString().slice(0, 10)})
Top priorites alors : ${(lastDiag.top_priorities || []).slice(0, 3).join(' | ')}

Si une de ces situations recoupe une priorite ancienne, mentionne-le dans proApproach (axe 9 - suivi progression).`
    : '';

  return `JOUEUR : ${context.targetName || 'anonyme'} (cote ${context.side || 'both'}) sur ${context.map || '?'}
${roleSection}${prevSection}

3 situations cles a analyser :
${sitBlock}

→ Produis le JSON insights[3] selon le schema. Pour CHAQUE situation : problem + proApproach (chiffres + lineups specifiques + role-aware) + drillId (library) + drill (1 phrase) + confidence.`;
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
      message: 'Pro Insights est reserve aux abonnes Pro et Team.',
    });
  }

  const body = req.body || {};
  const context = body.context || {};
  const situations = Array.isArray(context.situations) ? context.situations : [];
  if (!situations.length) {
    return res.status(400).json({ error: 'Aucune situation a analyser' });
  }

  const contextHash = crypto.createHash('sha256')
    .update(JSON.stringify({ m: context.map, s: context.side, sits: situations }))
    .digest('hex').slice(0, 32);

  const cached = await getCached(contextHash);
  if (cached) {
    return res.status(200).json({ ...cached, cached: true });
  }

  const isAdmin = isAdminUser(user);
  if (!isAdmin) {
    const todayCount = await getTodayCount(user.id);
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: 'Limite atteinte',
        message: `Limite de ${DAILY_LIMIT} analyses par jour atteinte. Reviens demain.`,
        used: todayCount,
        limit: DAILY_LIMIT,
      });
    }
  }

  try {
    // Fetch en parallele : benchmarks + lastDiag (axe 9)
    const [benchmarks, lastDiag] = await Promise.all([
      getBenchmarksByMap(context.map),
      fetchLastDiag(user.id),
    ]);

    // Role detection si target stats disponibles dans context.targetPlayer (axe 4)
    const tp = context.targetPlayer || {};
    const role = tp.name ? detectRole({
      firstKills: tp.fk, firstDeaths: tp.fd,
      totalKills: tp.kills, totalDeaths: tp.deaths,
      avgAdr: tp.adr, avgKast: tp.kast,
      avgKd: tp.deaths > 0 ? tp.kills / tp.deaths : 1.0,
      matches: 1,
    }) : null;

    const locale = detectLocale({
      acceptLanguage: req.headers['accept-language'],
      referer: req.headers.referer || '',
    });
    const systemPrompt = buildSystemPrompt(benchmarks, locale);
    const userMessage = buildUserMessage(context, role, lastDiag);

    // Schema JSON pour validation native Anthropic
    const insightsSchema = {
      type: 'object',
      additionalProperties: false,
      required: ['insights'],
      properties: {
        insights: {
          type: 'array',
          minItems: 1, maxItems: 3,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['roundNum', 'problem', 'proApproach', 'drillId', 'drill', 'confidence'],
            properties: {
              roundNum: { type: 'integer' },
              problem: { type: 'string' },
              proApproach: { type: 'string' },
              drillId: { type: 'string' },
              drill: { type: 'string' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
          },
        },
      },
    };

    const result = await callClaude({
      model: MODELS.SONNET_46,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 2000,
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'high',
      cacheSystem: true,
      cacheTtl: '1h',
      jsonSchema: insightsSchema,
    });

    if (result.stopReason === 'refusal') {
      console.warn('[pro-insights] Claude refusal:', result.refusalDetails);
      return res.status(422).json({
        error: 'Contenu refuse',
        message: 'Le coach IA a refuse l\'analyse (raison safety). Reformule tes situations ou reessaie.',
        refusalCategory: result.refusalDetails?.category,
      });
    }

    const parsed = parseJsonRobust(result.text);
    if (!parsed.insights || !Array.isArray(parsed.insights)) {
      throw new Error('Reponse Claude sans champ insights');
    }

    // Enrich avec drills resolus
    const insights = parsed.insights.slice(0, 3).map(ins => {
      const drillFull = ins.drillId ? getDrillById(ins.drillId) : null;
      return {
        roundNum: ins.roundNum,
        problem: ins.problem,
        proApproach: ins.proApproach,
        drillId: ins.drillId || null,
        drill: ins.drill || (drillFull ? `${drillFull.name} (${drillFull.workshop}) · ${drillFull.metric}` : null),
        drillResolved: drillFull ? {
          name: drillFull.name,
          workshop: drillFull.workshop,
          durationMin: drillFull.durationMin,
          metric: drillFull.metric,
        } : null,
        confidence: ['high', 'medium', 'low'].includes(ins.confidence) ? ins.confidence : 'medium',
      };
    });

    const tokens = (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0);
    const response = {
      insights,
      model: MODELS.SONNET_46,
      benchmarks_used: benchmarks ? {
        map: benchmarks.map,
        pro_avg_rating: benchmarks.proAvg.rating,
        pro_avg_adr: benchmarks.proAvg.adr,
        sample_size: benchmarks.sampleSize,
      } : null,
      cacheReadTokens: result.usage?.cache_read_input_tokens || 0,
      estimatedCostUsd: estimateCostUsd(MODELS.SONNET_46, result.usage),
    };

    await setCached(contextHash, response);
    await logCall(user.id, contextHash, tokens);

    return res.status(200).json({ ...response, tokensUsed: tokens, cached: false });
  } catch (e) {
    console.error('[pro-insights] error:', e.message);
    return res.status(500).json({
      error: 'Erreur Coach IA',
      message: 'Impossible de generer l\'analyse. Reessaie dans quelques instants.',
    });
  }
};
