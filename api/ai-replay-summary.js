// api/ai-replay-summary.js · FragValue Coach IA · ROUND TACTICAL ANALYSIS 10/10
//
// Analyse tactique d'un round par Claude Sonnet 4.6 + adaptive thinking.
// Recoit le contexte round (kills, side, score, joueur, callouts) et retourne
// un objet structure { force, axe, action, drillId, proRef, confidence }.
//
// Utilise par replay.html (Sprint 3.3) : bouton "Coach IA" dans la sidebar,
// click sur un bookmark/round → appel cet endpoint → affiche le panel.
//
// Plan gating : Pro+ uniquement.
// Rate limit : 30 resumes/user/jour (vs 20 avant, on monte la valeur Pro).
// Cache : par (demoId, roundNum) en sessionStorage cote client.

const { createClient } = require('@supabase/supabase-js');
const { ADMIN_EMAILS } = require('./_lib/subscription');
const { callClaude, parseJsonRobust, MODELS, estimateCostUsd } = require('./_lib/claude-client');
const { buildBaseSystemPrompt, detectLocale } = require('./_lib/cs2-lexicon');
const { getBenchmarksByMap, formatBenchmarksForPrompt } = require('./_lib/pro-benchmarks');
const { getDrillsByAxis, getDrillById, listAllDrillIds } = require('./_lib/drill-library');
const { detectRole, getRoleFocus } = require('./_lib/role-detection');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const DAILY_LIMIT = 30;

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
  if (user.email && ADMIN_EMAILS.includes((user.email || '').toLowerCase().trim())) return 'elite';
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
    .gte('created_at', today + 'T00:00:00Z')
    .like('question', 'replay-summary:%');
  if (error) return 0;
  return count || 0;
}

async function logSummary(userId, demoId, round, tokens) {
  try {
    await sb().from('coach_qa_logs').insert({
      user_id: userId,
      question: ('replay-summary:' + demoId + ':r' + round).slice(0, 500),
      response_tokens: tokens,
    });
  } catch (e) { console.warn('[ai-replay-summary] log failed:', e.message); }
}

// System prompt : style FragValue + lexique CS2 + format JSON strict.
// Inclut la drill library complete pour eviter que Claude invente des drillIds.
function buildSystemPrompt(benchmarks, locale = 'fr') {
  const benchmarksBlock = benchmarks ? formatBenchmarksForPrompt(benchmarks) : '';

  return buildBaseSystemPrompt({
    locale,
    persona: locale === 'en'
      ? "You are FragValue Coach IA. You analyze ONE specific CS2 round from the target player's perspective. Your diagnosis must be tactical, numerical, anchored in precise round moments (kills, callouts, timings). HLTV style: direct, factual, zero empty kindness."
      : "Tu es FragValue Coach IA. Tu analyses UN round CS2 specifique du point de vue du joueur cible. Ton diagnostic doit etre tactique, chiffre, ancre dans des moments precis du round (kills, callouts, timings). Style HLTV : direct, factuel, 0 bienveillance gratuite.",
    extraSections: `═══ DRILL LIBRARY (use ONLY these IDs / utilise UNIQUEMENT ces IDs) ═══

${listAllDrillIds()}

${benchmarksBlock ? `═══ PRO BENCHMARKS / BENCHMARKS PROS ═══\n\n${benchmarksBlock}\n\n` : ''}═══ JSON OUTPUT FORMAT (strict, NO prose) ═══

{
  "force": "1 sentence ≤25 words on tactical strength this round (number + zone)",
  "axe": "1 sentence ≤25 words on key error or missed opportunity (precise callout + timing)",
  "action": "1 sentence ≤25 words concrete action to test next similar round",
  "drillId": "exact drill ID from library above",
  "proRef": "1 sentence comparing to a CORE-list pro (ZywOo, donk, m0NESY, NiKo, ropz, broky, karrigan, apEX, s1mple) with context. Empty string if no natural comparison.",
  "confidence": "high | medium | low"
}

STRICT RULES :
- 2nd person (you/tu) addressing the target player
- Cite specific callouts (Long, Connector, Banana, A site, etc.)
- No inventions: if info missing, say so ("missing post-plant info")
- proRef: only the 9 CORE pros from the system prompt
- drillId: MUST match EXACTLY a library ID above`,
  });
}

function buildUserMessage(context) {
  const tp = context.targetPlayer || {};

  // Role detection sur les stats du joueur (axe 4 → 10/10)
  const role = tp.name ? detectRole({
    firstKills: tp.fk, firstDeaths: tp.fd,
    totalKills: tp.kills, totalDeaths: tp.deaths,
    avgAdr: tp.adr, avgKast: tp.kast,
    avgKd: tp.deaths > 0 ? tp.kills / tp.deaths : 1.0,
    matches: 1,
  }) : null;
  const roleFocus = role ? getRoleFocus(role.role) : null;

  const kills = (context.roundKills || []).slice(0, 30);
  const killsLine = kills.length
    ? kills.map(k => {
        const sec = Math.max(0, Math.round((k.tick - (kills[0].tick || 0)) / 64));
        const minSec = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
        const attacker = k.attacker || '?';
        const victim = k.victim || '?';
        const weapon = (k.weapon || '').replace('weapon_', '');
        const tags = [];
        if (k.isHeadshot) tags.push('HS');
        if (k.thruSmoke) tags.push('through smoke');
        if (k.isWallbang) tags.push('wallbang');
        const attackerLoc = k.attackerCallout ? ` (${k.attackerCallout})` : '';
        const victimLoc = k.victimCallout ? ` (${k.victimCallout})` : '';
        return `${minSec} ${attacker}${attackerLoc} kills ${victim}${victimLoc} (${weapon}${tags.length ? ', ' + tags.join(', ') : ''})`;
      }).join('\n')
    : 'Aucun kill ce round';

  const bombStatus = context.bombDefused ? 'desamorcee'
    : context.bombExploded ? 'explosee'
    : context.bombPlanted ? 'plantee, non resolue'
    : 'non plantee';

  const scoreCT = context.score?.[0] ?? 0;
  const scoreT = context.score?.[1] ?? 0;
  const sideStr = context.side === 'CT' ? 'CT' : 'T';
  const wonStr = context.won ? 'gagne' : 'perdu';
  const durStr = context.roundDurationSec ? Math.floor(context.roundDurationSec) + 's' : '?';

  const calloutsList = (context.mapCallouts || []).slice(0, 40);
  const calloutsStr = calloutsList.length
    ? `Callouts dispo : ${calloutsList.join(' · ')}`
    : '';

  // Eco/util context (axe 7 → 10/10) si dispo dans le contexte
  const ecoState = context.economy || context.ecoState || null;
  const utilUsed = context.utilUsed || context.utility || null;
  const opp = context.oppTendency || null;
  const multimodal = (ecoState || utilUsed || opp)
    ? `\nMULTI-MODAL CONTEXT
${ecoState ? `Eco state user side: ${ecoState}` : ''}
${utilUsed ? `Util usage round: ${JSON.stringify(utilUsed).slice(0, 200)}` : ''}
${opp ? `Opp tendency observed: ${opp}` : ''}`
    : '';

  const roleSection = role
    ? `\nROLE DETECTE : ${role.role} (confidence ${role.confidence}, ${roleFocus.description})
Pros similaires : ${roleFocus.proExamples.slice(0, 3).join(', ')}`
    : '';

  // Previous round same match si dispo (axe 9 → 9/10, on a le precedent round dans context.previousRound si frontend le passe)
  const prev = context.previousRound;
  const prevSection = prev
    ? `\nROUND PRECEDENT (R${prev.round}) DU MEME MATCH : ${prev.outcome} - ${prev.kills || 0}K user. Compare la decision/positioning vs ce round.`
    : '';

  return `ROUND ${context.round || '?'} A ANALYSER

CONTEXTE
Map : ${context.map || '?'} · Round duree : ${durStr}
Score apres ce round : ${scoreCT}-${scoreT} (CT-T)
Joueur cible : ${tp.name || 'anonyme'} (cote ${sideStr})
Round ${wonStr} par son cote.
Bombe : ${bombStatus}

STATS DU JOUEUR CIBLE SUR LE ROUND
${tp.kills || 0} kills · ${tp.deaths || 0} deaths · ${tp.adr || 0} ADR
${roleSection}

${calloutsStr}

DEROULEMENT (chronologique, format : timing attacker (zone) kills victim (zone) (arme, tags))
${killsLine}
${multimodal}${prevSection}

→ Produis le JSON tactique selon le schema (force, axe, action, drillId, proRef, confidence). UNIQUEMENT le JSON.`;
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
      message: 'Coach IA replay est reserve aux abonnes Pro et Team.',
    });
  }

  const body = req.body || {};
  const demoId = String(body.demoId || '').slice(0, 100);
  const round = parseInt(body.round, 10);
  const context = body.context || {};

  if (!demoId) return res.status(400).json({ error: 'demoId manquant' });
  if (isNaN(round) || round < 0) return res.status(400).json({ error: 'round invalide' });
  if (!context.targetPlayer || !context.targetPlayer.name) {
    return res.status(400).json({ error: 'context.targetPlayer manquant' });
  }

  const isAdmin = user.email && ADMIN_EMAILS.includes((user.email || '').toLowerCase().trim());
  if (!isAdmin) {
    const todayCount = await getTodayCount(user.id);
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: 'Limite atteinte',
        message: `Limite de ${DAILY_LIMIT} analyses Coach IA atteinte aujourd hui. Reviens demain.`,
        used: todayCount,
        limit: DAILY_LIMIT,
      });
    }
  }

  try {
    // Fetch benchmarks pros pour la map (axe 2 - ancrage benchmark)
    const benchmarks = await getBenchmarksByMap(context.map);

    // Detection locale : profile.locale > Accept-Language > URL prefix > FR default
    const locale = detectLocale({
      acceptLanguage: req.headers['accept-language'],
      referer: req.headers.referer || '',
    });

    // Build prompt + call Sonnet 4.6 avec adaptive thinking + cache 1h sur system
    const systemPrompt = buildSystemPrompt(benchmarks, locale);
    const userMessage = buildUserMessage({ ...context, round });

    // Schema JSON pour validation native Anthropic + parse robust en fallback
    const replaySchema = {
      type: 'object',
      additionalProperties: false,
      required: ['force', 'axe', 'action', 'drillId', 'proRef', 'confidence'],
      properties: {
        force: { type: 'string' },
        axe: { type: 'string' },
        action: { type: 'string' },
        drillId: { type: 'string' },
        proRef: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    };

    const result = await callClaude({
      model: MODELS.SONNET_46,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 800,
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'high',
      cacheSystem: true,
      cacheTtl: '1h', // ~5K tokens stables → 1h optimal
      jsonSchema: replaySchema, // validation native Anthropic
    });

    // Handle refusal (safety) AVANT le parse JSON pour erreur explicite
    if (result.stopReason === 'refusal') {
      console.warn('[ai-replay-summary] Claude refusal:', result.refusalDetails);
      return res.status(422).json({
        error: 'Contenu refuse',
        message: 'Le coach IA a refuse d\'analyser ce round (raison safety). Reessaie sur un autre round.',
        refusalCategory: result.refusalDetails?.category,
      });
    }

    const parsed = parseJsonRobust(result.text);

    // Sanitize + enrichi avec drill resolu
    const sanitize = (s) => String(s || '').slice(0, 300).trim();
    const drillFull = parsed.drillId ? getDrillById(parsed.drillId) : null;

    const summary = {
      force: sanitize(parsed.force) || 'Aucun point fort identifie sur ce round.',
      axe: sanitize(parsed.axe) || 'Pas d\'axe d\'amelioration evident.',
      action: sanitize(parsed.action) || 'Continue d\'entrainer ce style de jeu.',
      drillId: parsed.drillId || null,
      drill: drillFull ? {
        id: drillFull.id,
        name: drillFull.name,
        workshop: drillFull.workshop,
        durationMin: drillFull.durationMin,
        instructions: drillFull.instructions,
        metric: drillFull.metric,
      } : null,
      proRef: sanitize(parsed.proRef),
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
    };

    const tokens = (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0);
    await logSummary(user.id, demoId, round, tokens);

    return res.status(200).json({
      summary,
      tokensUsed: tokens,
      cacheReadTokens: result.usage?.cache_read_input_tokens || 0,
      estimatedCostUsd: estimateCostUsd(MODELS.SONNET_46, result.usage),
      model: MODELS.SONNET_46,
      hasBenchmarks: !!benchmarks,
    });
  } catch (e) {
    console.error('[ai-replay-summary] error:', e.message);
    return res.status(500).json({
      error: 'Erreur Coach IA',
      message: 'Impossible de generer l\'analyse. Reessaie dans quelques instants.',
    });
  }
};
