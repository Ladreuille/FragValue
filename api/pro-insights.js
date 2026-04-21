// api/pro-insights.js
// POST : Genere 3 conseils tactiques "ce qu'un pro aurait fait" sur les
// moments cles du match (clutches perdus ou rounds critiques ou le joueur
// avait un impact faible).
//
// Input POST body (JSON) :
//   - context : {
//       map: string, side: 'CT'|'T'|'both', targetName: string,
//       situations: [{
//         roundNum: int,
//         outcome: 'lost'|'won',
//         situationType: 'clutch'|'lost_opening'|'low_impact',
//         details: string  // description courte de la situation
//       }, ...]
//     }
// Max 3 situations par appel pour controler les couts.
//
// Plan gating : Pro/Team seulement.
// Cache : 1h (la reponse est quasi-stable pour un meme match).
// Rate limit : 5 appels/jour par user.

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const CLAUDE_MODEL = 'claude-haiku-4-5';
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const DAILY_LIMIT = 5;

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
  const ADMIN_EMAILS = ['qdreuillet@gmail.com'];
  if (user.email && ADMIN_EMAILS.includes(user.email)) return 'team';
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
    if (priceId.includes('team')) return 'team';
    return 'pro';
  } catch {
    return 'free';
  }
}

async function getTodayCount(userId) {
  const s = sb();
  const today = new Date().toISOString().slice(0, 10);
  const { count } = await s
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
  } catch (e) {
    console.warn('[pro-insights] log failed:', e.message);
  }
}

// Cache lookup : un hash du context permet de retrouver une reponse recente
// pour le meme match (1h). Evite de spammer Claude si l'user rafraichit.
async function getCached(contextHash) {
  const s = sb();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await s
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
  } catch (e) {
    console.warn('[pro-insights] cache write failed:', e.message);
  }
}

function buildPrompt(context) {
  const sits = (context.situations || []).slice(0, 3);
  const sitBlock = sits.map((s, i) => `
SITUATION ${i + 1} · Round ${s.roundNum} · ${s.situationType} · ${s.outcome}
${s.details}
`).join('\n');

  return `Tu es un coach CS2 niveau pro (Top 20 HLTV equivalent). Un joueur ${context.side || ''} ${context.targetName ? 'appele ' + context.targetName : ''} te demande ce que des joueurs pros auraient fait dans 3 situations cles de son match sur ${context.map || '?'}.

${sitBlock}

Pour CHAQUE situation, reponds au format JSON strict ci-dessous :
{
  "insights": [
    {
      "roundNum": int,
      "problem": "Diagnostic court de ce qui a mal tourne (1 phrase, 15 mots max)",
      "proApproach": "Ce qu'un pro aurait fait concretement dans cette situation (2-3 phrases, 40 mots max). Mention de positions/timings/utilities specifiques a la map quand pertinent.",
      "drill": "1 exercice concret pour travailler ca a l'entrainement (1 phrase, 20 mots max, actionnable)"
    },
    ... (3 objets)
  ]
}

REGLES STRICTES
- Reponds UNIQUEMENT avec le JSON, rien d'autre, pas de prose autour
- Chaque insight doit etre different et specifique a sa situation
- Cite des positions/timings/nades reels de ${context.map || 'la map'} quand tu peux (ex: "smoke top mid", "molo heaven", "HE ct spawn")
- Style direct, pas de langue de bois
- Parle a la 2e personne (tu), comme un coach qui debriefe
- Si une situation manque d'info, fais de ton mieux avec ce qui est donne (pas d'excuses)`;
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
      max_tokens: 1200,
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
  const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
  return { text, tokens };
}

// Extrait le JSON du texte Claude (au cas ou il ajoute du markdown)
function parseResponse(text) {
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('No JSON in response');
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (e) {
    throw new Error('JSON parse failed: ' + e.message);
  }
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
      message: 'Pro Insights est reserve aux abonnes Pro et Team.',
    });
  }

  const body = req.body || {};
  const context = body.context || {};
  const situations = Array.isArray(context.situations) ? context.situations : [];
  if (!situations.length) {
    return res.status(400).json({ error: 'Aucune situation a analyser' });
  }

  // Hash du contexte pour cache lookup
  const contextHash = crypto.createHash('sha256')
    .update(JSON.stringify({ m: context.map, s: context.side, sits: situations }))
    .digest('hex').slice(0, 32);

  // Cache 1h
  const cached = await getCached(contextHash);
  if (cached) {
    return res.status(200).json({ ...cached, cached: true });
  }

  // Rate limit (non-admin)
  const ADMIN_EMAILS = ['qdreuillet@gmail.com'];
  const isAdmin = user.email && ADMIN_EMAILS.includes(user.email);
  if (!isAdmin) {
    const todayCount = await getTodayCount(user.id);
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: 'Limite atteinte',
        message: `Tu as atteint ta limite de ${DAILY_LIMIT} analyses par jour. Reviens demain.`,
        used: todayCount,
        limit: DAILY_LIMIT,
      });
    }
  }

  try {
    const prompt = buildPrompt(context);
    const { text, tokens } = await callClaude(prompt);
    const parsed = parseResponse(text);
    if (!parsed.insights || !Array.isArray(parsed.insights)) {
      throw new Error('Reponse Claude sans champ insights');
    }
    const response = { insights: parsed.insights.slice(0, 3), model: CLAUDE_MODEL };
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
}
