// api/coach-qa.js
// POST : Q&A contextualise sur un match analyse. Recoit la question + un
// snapshot de stats + contexte match, appelle Claude, renvoie la reponse.
//
// Input POST body (JSON) :
//   - question : string (max 500 chars)
//   - context : {
//       map: string, score: [ct, t], winner: 'CT'|'T'|'-', rounds: int,
//       targetPlayer: { name, fvr, kast, adr, hsPct, kd, fk, fd, ... },
//       matchStats: [{name, team, fvr, kast, adr, hsPct, kills, deaths}, ...],
//       momentum: string (optionnel : resume court de la dynamique)
//     }
//
// Rate limit : 10 questions par user par jour (evite abus + control cout).
// Cache : non cache (chaque question est unique).
//
// Plan gating : Pro/Team seulement.

const { createClient } = require('@supabase/supabase-js');
const { isAdminUser } = require('./_lib/subscription');

const CLAUDE_MODEL = 'claude-haiku-4-5';
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const DAILY_LIMIT = 10;
const MAX_QUESTION_LEN = 500;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getUser(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const s = sb();
  const { data, error } = await s.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

async function resolveUserPlan(user) {
  if (!user) return 'free';
  if (isAdminUser(user)) return 'elite';
  try {
    const s = sb();
    const { data: profile } = await s
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    if (!profile?.stripe_customer_id) return 'free';
    if (!process.env.STRIPE_SECRET_KEY) return 'free';
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const subs = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      status: 'active',
      limit: 1,
    });
    if (!subs.data.length) return 'free';
    const priceId = subs.data[0].items.data[0]?.price?.id || '';
    if (priceId.includes('elite') || priceId.includes('team')) return 'elite';
    return 'pro';
  } catch {
    return 'free';
  }
}

// Rate limit : compte les questions du user aujourd'hui via coach_qa_logs
async function getTodayCount(userId) {
  const s = sb();
  const today = new Date().toISOString().slice(0, 10);
  const { count, error } = await s
    .from('coach_qa_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', today + 'T00:00:00Z');
  if (error) {
    console.warn('[coach-qa] rate limit check failed:', error.message);
    return 0;
  }
  return count || 0;
}

async function logQuestion(userId, question, responseTokens) {
  try {
    const s = sb();
    await s.from('coach_qa_logs').insert({
      user_id: userId,
      question: question.slice(0, 500),
      response_tokens: responseTokens,
    });
  } catch (e) {
    console.warn('[coach-qa] log failed:', e.message);
  }
}

// Construit le prompt Claude avec le contexte match serialise compact
function buildPrompt(question, context) {
  const you = context.targetPlayer || {};
  const stats = (context.matchStats || []).slice(0, 10);
  const statsLine = stats
    .map(p => `${p.name}(${p.team==='CT'||p.team===3?'CT':'T'}): FVR ${Number(p.fvr).toFixed(2)}, ${p.kills}K/${p.deaths}D, ADR ${p.adr}, KAST ${p.kast}%, HS ${p.hsPct}%`)
    .join('\n');

  return `Tu es un coach CS2 expert. Un joueur t'interroge sur son match. Tu reponds en francais, style direct, 120 mots max, tactique et actionnable.

CONTEXTE DU MATCH
Map: ${context.map || '?'} · Score: ${context.score?.[0] || 0}-${context.score?.[1] || 0} · Winner: ${context.winner || '-'} · ${context.rounds || '?'} rounds

LE JOUEUR (${you.name || 'anonyme'})
FV Rating: ${Number(you.fvr || 0).toFixed(2)} · ${you.kills || 0}K/${you.deaths || 0}D · ADR ${you.adr || 0} · KAST ${you.kast || 0}% · HS ${you.hsPct || 0}% · Opening ${you.fk || 0}W-${you.fd || 0}L

SCOREBOARD COMPLET
${statsLine}

${context.momentum ? 'MOMENTUM\n' + context.momentum + '\n' : ''}

QUESTION
${question}

REGLES DE REPONSE
- 120 mots max, paragraphes courts (2-3 lignes)
- Parle a la 2e personne du singulier (tu)
- Reste factuel, cite les stats du match
- Donne 1 ou 2 actions concretes a travailler
- Si la question depasse le scope (ex: matchmaking, Steam, hardware), dis-le poliment et redirige sur ce qui est dans le match
- Pas de markdown, pas de listes a puces, juste du texte coulant`;
}

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');
  const res = await fetch(CLAUDE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Claude API ' + res.status + ': ' + errText.slice(0, 200));
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  if (!text) throw new Error('Claude empty response');
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  return { text, tokens: inputTokens + outputTokens };
}

export default async function handler(req, res) {
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

  // Rate limit 10/jour (sauf admin)
  const isAdmin = isAdminUser(user);
  if (!isAdmin) {
    const todayCount = await getTodayCount(user.id);
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: 'Limite atteinte',
        message: `Tu as atteint ta limite de ${DAILY_LIMIT} questions par jour. Reviens demain.`,
        used: todayCount,
        limit: DAILY_LIMIT,
      });
    }
  }

  try {
    const prompt = buildPrompt(question, context);
    const { text, tokens } = await callClaude(prompt);
    // Log pour rate limit + analytics
    await logQuestion(user.id, question, tokens);
    return res.status(200).json({
      answer: text.trim(),
      tokensUsed: tokens,
      model: CLAUDE_MODEL,
    });
  } catch (e) {
    console.error('[coach-qa] error:', e.message);
    return res.status(500).json({
      error: 'Erreur Coach IA',
      message: 'Impossible de generer la reponse. Reessaie dans quelques instants.',
    });
  }
}
