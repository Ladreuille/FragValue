// api/ai-replay-summary.js
// POST : analyse tactique d'un round par Claude. Recoit le contexte du round
// (kills, side, score, joueur cible) et retourne un objet structure :
//   { force, axe, action } - 3 phrases courtes en francais.
//
// Utilise par replay.html (Sprint 3.3) : bouton "Coach IA" dans la sidebar,
// click sur un bookmark/round -> appel cet endpoint -> affiche le panel.
//
// Input POST body (JSON) :
//   - demoId    : string (identifiant demo, pour cache potentiel future)
//   - round     : int (round number)
//   - context   : {
//       map: string, side: 'CT'|'T', score: [ct, t], won: bool,
//       targetPlayer: { name, fvr, kills, deaths, kast, adr, hsPct },
//       roundKills: [{ tick, attacker, victim, weapon, isHeadshot, thruSmoke }],
//       bombPlanted: bool, bombDefused: bool, bombExploded: bool,
//       roundDurationSec: int,
//     }
//
// Plan gating : Pro+ uniquement (cout par appel ~$0.002 mais on protege).
// Rate limit : 20 resumes / user / jour via table coach_qa_logs reutilisee
//   avec un prefix de question 'replay-summary:' (evite de creer une table
//   dediee pour MVP).

const { createClient } = require('@supabase/supabase-js');

const CLAUDE_MODEL = 'claude-haiku-4-5';
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const DAILY_LIMIT = 20;
const { ADMIN_EMAILS } = require('./_lib/subscription');

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
  if (user.email && ADMIN_EMAILS.includes((user.email||"").toLowerCase().trim())) return 'elite';
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

// Rate limit : reutilise coach_qa_logs pour eviter de creer une table dediee.
// Les entries replay-summary sont prefixees 'replay-summary:' dans le champ
// question pour les distinguer des Q&A classiques.
async function getTodayCount(userId) {
  const s = sb();
  const today = new Date().toISOString().slice(0, 10);
  const { count, error } = await s
    .from('coach_qa_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', today + 'T00:00:00Z')
    .like('question', 'replay-summary:%');
  if (error) {
    console.warn('[ai-replay-summary] rate limit check failed:', error.message);
    return 0;
  }
  return count || 0;
}

async function logSummary(userId, demoId, round, tokens) {
  try {
    const s = sb();
    await s.from('coach_qa_logs').insert({
      user_id: userId,
      question: ('replay-summary:' + demoId + ':r' + round).slice(0, 500),
      response_tokens: tokens,
    });
  } catch (e) {
    console.warn('[ai-replay-summary] log failed:', e.message);
  }
}

// Construit le prompt Claude pour une analyse tactique de round.
// Format attendu en sortie : JSON avec 3 cles { force, axe, action }.
// On force la sortie JSON via instruction stricte dans le prompt.
function buildPrompt(context) {
  const tp = context.targetPlayer || {};
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
        // Annotation tactique : ou s est passe le kill (zones de la map).
        // Format : "attacker (Long) kills victim (A Site)" pour donner du contexte
        // spatial precis a Claude. Si pas de call-out, on omet.
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

  // Liste des call-outs disponibles sur la map (pour que Claude puisse les
  // referencer meme pour des positions tactiques hors kills, comme "tu aurais
  // du jouer Long" ou "anti-eco vers Tunnels"). Limite a 40 noms pour eviter
  // de bloater le prompt sur les maps tres detaillees (Vertigo / Inferno).
  const calloutsList = (context.mapCallouts || []).slice(0, 40);
  const calloutsStr = calloutsList.length
    ? `ZONES DE LA MAP (call-outs CS2 standards de ${context.map || 'la map'}) :\n${calloutsList.join(' · ')}\n\nUtilise ces noms pour referer aux positions tactiques.`
    : '';

  return `Tu es un coach CS2 expert. Analyse tactiquement ce round du point de vue du joueur cible.

CONTEXTE
Map: ${context.map || '?'}
Round: ${context.round || '?'} - duree: ${durStr}
Score apres ce round: ${scoreCT}-${scoreT} (CT-T)
Joueur cible: ${tp.name || 'anonyme'} (cote ${sideStr})
Round ${wonStr} par son cote.
Bombe: ${bombStatus}

STATS DU JOUEUR CIBLE SUR LE ROUND
${tp.kills || 0} kills, ${tp.deaths || 0} deaths, ${tp.adr || 0} ADR (round)

${calloutsStr}

DEROULEMENT DU ROUND (kills par ordre chronologique)
Format : minute attacker (zone_attacker) kills victim (zone_victim) (arme, tags)
${killsLine}

CONSIGNE
Reponds STRICTEMENT en JSON valide avec 3 cles, sans markdown ni texte autour.
Format exact :
{"force":"...","axe":"...","action":"..."}

- force : 1 phrase courte (max 25 mots) sur le point fort tactique du joueur cible ce round
- axe : 1 phrase courte (max 25 mots) sur l'erreur ou opportunite manquee
- action : 1 phrase courte (max 25 mots) sur l'action concrete a tester au prochain round similaire

REGLES
- Parle en francais a la 2e personne (tu)
- Reste tactique CS2 (positionning, timing, utility, peek pattern, info gathering)
- Cite des elements concrets du deroulement avec les NOMS DE ZONES quand pertinent
  (ex: "tu peek Long sans flash", "ton anti-eco a Tunnels a marche")
- Pas de generalites bidons type "joue mieux", reste specifique
- Si le joueur n'a pas eu d'impact (0K, mort tot), focus sur ce qu'il aurait du faire
- Pas de markdown, pas de listes, juste le JSON {"force":"...","axe":"...","action":"..."}`;
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

// Parse la reponse Claude qui doit etre du JSON. Robuste si Claude entoure
// son JSON de ```json ... ``` ou ajoute du texte avant/apres.
function parseSummary(rawText) {
  let txt = String(rawText || '').trim();
  // Strip markdown code fences si presentes
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Trouver le premier { et le dernier } pour extraire le JSON
  const start = txt.indexOf('{');
  const end = txt.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('JSON non trouve dans la reponse');
  }
  const jsonStr = txt.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('JSON invalide: ' + e.message);
  }
  // Sanitize : 3 cles attendues, strings, max 200 chars
  const sanitize = (s) => String(s || '').slice(0, 300).trim();
  return {
    force: sanitize(parsed.force) || 'Aucun point fort identifie sur ce round.',
    axe: sanitize(parsed.axe) || 'Pas d axe d amelioration evident.',
    action: sanitize(parsed.action) || 'Continue d entrainer ce style de jeu.',
  };
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

  // Rate limit 20/jour (sauf admin)
  const isAdmin = user.email && ADMIN_EMAILS.includes((user.email||"").toLowerCase().trim());
  if (!isAdmin) {
    const todayCount = await getTodayCount(user.id);
    if (todayCount >= DAILY_LIMIT) {
      return res.status(429).json({
        error: 'Limite atteinte',
        message: `Tu as atteint ta limite de ${DAILY_LIMIT} analyses Coach IA aujourd hui. Reviens demain.`,
        used: todayCount,
        limit: DAILY_LIMIT,
      });
    }
  }

  try {
    const prompt = buildPrompt({ ...context, round });
    const { text, tokens } = await callClaude(prompt);
    const summary = parseSummary(text);
    await logSummary(user.id, demoId, round, tokens);
    return res.status(200).json({
      summary,
      tokensUsed: tokens,
      model: CLAUDE_MODEL,
    });
  } catch (e) {
    console.error('[ai-replay-summary] error:', e.message);
    return res.status(500).json({
      error: 'Erreur Coach IA',
      message: 'Impossible de generer l analyse. Reessaie dans quelques instants.',
    });
  }
};
