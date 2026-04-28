// api/coach-conversational.js · FragValue · AI Coach Conversational
// Multi-turn chat sur une demo specifique avec context match + history
// persistante + citations cliquables [R12] qui ouvrent le replay 2D au
// bon round.
//
// ENDPOINTS :
//   POST /api/coach-conversational
//   Body :
//     - demo_id          : UUID demo concernee (1 conversation par demo)
//     - message          : string (la question du user, max 500 chars)
//     - context          : objet match context (stats, scoreboard, momentum)
//                          Optionnel apres le 1er message (cache server-side)
//     - reset            : bool (optionnel, reset la conversation pour cette demo)
//   Response :
//     - conversation_id  : UUID
//     - message_id       : BIGINT du message assistant cree
//     - answer           : texte de la reponse Claude
//     - refs             : { rounds: [12,18], pro_twin: 'ZywOo' } parsing des refs
//     - tokens           : { in: N, out: N }
//     - history_count    : N (nb total de messages dans la conversation)
//
//   GET /api/coach-conversational?demo_id=<uuid>
//   Response :
//     - conversation_id  : UUID (null si pas de conversation pour cette demo)
//     - messages         : [{ role, content, refs, created_at }, ...]
//     - history_count    : N
//
// AUTH : require Pro/Elite. Free = redirect upgrade.
// RATE LIMIT :
//   - Pro    : 60 messages/jour (limite douce, cost control)
//   - Elite  : 200 messages/jour
//   - Admin  : illimite
//   - Reset  : un user peut reset 1 conversation/heure
// COST CONTROL :
//   - Modele : Claude Haiku 4.5 par defaut (fast + cheap)
//   - Soft cap conversation : 50 messages max (UI prompt user pour reset)
//   - Context max : 10 derniers messages dans le prompt (rolling window)
//   - Prompt caching : a integrer Phase H quand stable
//
// PROMPT ENGINEERING :
//   - Coaching style direct, factuel, 150 mots max par reponse
//   - Instruction explicite : citer les rounds avec [R<num>] format pour
//     que le frontend parse et rende cliquable
//   - Ground sur les stats reelles du match (pas d'invention)
//   - Refus poli si question hors-scope (matchmaking, hardware, etc.)

const { createClient } = require('@supabase/supabase-js');
const { requirePro, getUserPlan } = require('./_lib/subscription');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
// Sonnet 4.5 par defaut : qualite >> Haiku pour coaching contextualise.
// Haiku reserve aux taches utilitaires (intent classification, suggestions
// follow-up, titre auto). Cf. ultrareview report.
const CLAUDE_MODEL    = 'claude-sonnet-4-5';
const CLAUDE_MODEL_FAST = 'claude-haiku-4-5'; // pour suggestions/classifications
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MAX_MESSAGE_LEN = 500;
const MAX_RESPONSE_TOKENS = 700;
const ROLLING_WINDOW = 10; // nb messages d'historique inclus dans le prompt
const SOFT_CAP_CONVERSATION = 50;
const ADMIN_EMAILS = ['qdreuillet@gmail.com'];

// Hard caps tier-aware (cf. ultrareview cost analysis : 1000 users x 50 q/jour
// avec cache 1h = ~$750/jour, soutenable). Soft warning UX cote frontend.
const DAILY_LIMITS = {
  pro:   100,
  elite: 200,
};
const HARD_LIMIT_ABSOLUTE = 250; // anti-abuse meme admin override possible

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Parse les XML cite tags emis par Claude. Format Anthropic-recommended
// (cf. ultrareview : Claude est entraine sur XML, parser SAX-like trivial).
//
// Tags reconnus :
//   <cite r="12">round 12</cite>           -> round single
//   <cite r="12" t="34567">moment</cite>   -> round + tick precis
//   <cite duel="r12-d3">le 1v3</cite>       -> reference duel structure
//   <cite pro="zywoo-r5">[▶]</cite>         -> clip pro
//   <cite pos="A-site">A-site</cite>         -> position map
//
// Retourne un objet refs structure pour le frontend + le texte avec tags
// preserves (le frontend les rendera en boutons cliquables).
function parseRefs(text) {
  const refs = { rounds: [], ticks: {}, duels: [], pros: [], positions: [] };
  if (!text) return refs;

  // Match <cite ...>...</cite> tags
  const citeRegex = /<cite\s+([^>]+)>([^<]*)<\/cite>/g;
  let m;
  const seenRounds = new Set();
  while ((m = citeRegex.exec(text)) !== null) {
    const attrs = m[1];
    // Parse attributes : key="value"
    const attrMap = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = attrRegex.exec(attrs)) !== null) {
      attrMap[am[1]] = am[2];
    }
    if (attrMap.r) {
      const r = parseInt(attrMap.r, 10);
      if (!isNaN(r) && r >= 0 && r <= 50 && !seenRounds.has(r)) {
        refs.rounds.push(r); seenRounds.add(r);
        if (attrMap.t) {
          const t = parseInt(attrMap.t, 10);
          if (!isNaN(t)) refs.ticks[r] = t;
        }
      }
    }
    if (attrMap.duel) refs.duels.push(attrMap.duel);
    if (attrMap.pro) refs.pros.push(attrMap.pro);
    if (attrMap.pos) refs.positions.push(attrMap.pos);
  }

  // Backward compat : [R12] format (au cas ou Claude utilise l'ancien)
  const legacyRegex = /\[R(\d+)(?:-R(\d+))?\]/g;
  while ((m = legacyRegex.exec(text)) !== null) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    for (let r = start; r <= end && r <= 50; r++) {
      if (!seenRounds.has(r)) { refs.rounds.push(r); seenRounds.add(r); }
    }
  }

  return refs;
}

// Construit le contexte demo si pas encore cache dans la conversation.
// Lit demos + match_players pour avoir scoreboard + stats target player.
async function buildDemoContext(supabase, demoId, userId) {
  try {
    // 1. Demo metadata
    const { data: demo } = await supabase.from('demos')
      .select('id, map, rounds, total_kills, fv_rating, analysed_at, user_id')
      .eq('id', demoId)
      .maybeSingle();
    if (!demo) return null;

    // Verification ownership : seul l'owner peut chatter sur sa demo
    if (demo.user_id !== userId) return { error: 'forbidden' };

    // 2. Tente de fetcher le match associe (matches table) pour stats detaillees
    // Note : pas tous les demos ont un match associe, c'est OK
    const { data: matches } = await supabase.from('matches')
      .select('faceit_match_id, score_ct, score_t, winner, rounds, demo_data')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);
    const match = matches?.[0] || null;

    // 3. Scoreboard depuis match_players si match dispo
    let scoreboard = [];
    let targetPlayer = null;
    if (match?.faceit_match_id) {
      const { data: players } = await supabase.from('match_players')
        .select('user_id, faceit_player_id, nickname, team, kills, deaths, assists, kast, adr, hs_pct, fv_rating, first_kills')
        .eq('match_id', match.faceit_match_id);
      if (players) {
        scoreboard = players.map(p => ({
          name: p.nickname,
          team: p.team,
          kills: p.kills, deaths: p.deaths, assists: p.assists,
          kast: p.kast, adr: p.adr, hsPct: p.hs_pct,
          fvr: p.fv_rating, fk: p.first_kills,
          isUser: p.user_id === userId,
        }));
        targetPlayer = scoreboard.find(p => p.isUser) || null;
      }
    }

    // 4. Pro twin (best-effort) : lit le profile.faceit_nickname + appellera
    // logique pro_benchmarks plus tard. Pour MVP, on injecte juste si dispo.
    const { data: profile } = await supabase.from('profiles')
      .select('faceit_nickname, faceit_level, faceit_elo')
      .eq('id', userId)
      .maybeSingle();

    return {
      demo: {
        id: demo.id,
        map: demo.map,
        rounds: demo.rounds,
        totalKills: demo.total_kills,
        fvRating: demo.fv_rating,
      },
      match: match ? {
        scoreCt: match.score_ct,
        scoreT: match.score_t,
        winner: match.winner,
      } : null,
      scoreboard,
      targetPlayer,
      profile: profile ? {
        nickname: profile.faceit_nickname,
        level: profile.faceit_level,
        elo: profile.faceit_elo,
      } : null,
    };
  } catch (e) {
    console.warn('[coach-conv] buildDemoContext failed:', e.message);
    return null;
  }
}

// Construit le system prompt + demo data en 2 blocks separes pour le
// prompt caching (cf. ultrareview : 90% savings sur context repete).
//
// Retourne { systemBlocks, demoDataBlock } ou :
// - systemBlocks : array de blocks system avec cache_control sur le block stable
// - demoDataBlock : message user content avec cache_control (la demo)
function buildPromptBlocks(context) {
  // Block 1 : instructions + persona (STABLE, change rarement -> cache 1h)
  const systemInstructions = `Tu es FragValue Coach, un coach CS2 professionnel qui aide les joueurs a comprendre leurs matchs et progresser. Tu raisonnes selon le framework SBI (Situation-Behavior-Impact-Recommendation).

═══ STYLE DE REPONSE ═══

- Francais, tutoiement, direct, tactique
- 150 mots max par reponse, paragraphes courts (2-3 lignes)
- Pas de markdown, pas de listes a puces, juste du texte coulant
- Tone : coach experimente qui veut faire progresser, jamais paternaliste
- Honnete : si bien joue, dis-le ; si mal joue, explique factuellement pourquoi
- Donne TOUJOURS 1 action concrete a travailler (sauf question purement informative)

═══ CITATIONS XML ═══

IMPORTANT : tu DOIS utiliser le format XML <cite> pour referencer des moments du match. Le frontend parse ces tags et les rend en boutons cliquables qui ouvrent le replay 2D au moment exact.

Format des tags :
- <cite r="12">round 12</cite>             pour citer un round
- <cite r="12" t="34567">moment</cite>     pour preciser un tick exact dans le round
- <cite duel="r12-d3">le 1v3</cite>         pour referencer un duel structure
- <cite pos="A-site">A-site</cite>          pour referencer une position map
- <cite pro="zywoo-r5">[▶]</cite>            UNIQUEMENT si pro_demos disponibles dans le contexte

<example>
Bon : "Round 12 <cite r="12">[R12]</cite>, tu as push connect seul sans trade. Resultat : -1 et l'eco perdu."
Mauvais : "Round 12, tu as push..." (pas de citation, donc pas de lien cliquable vers le replay)
</example>

═══ GROUNDING STRICT ═══

- Base toi UNIQUEMENT sur le <demo_data> fourni dans le message user + l'historique de la conversation.
- N'invente JAMAIS un round qui n'a pas eu lieu, un kill, une stat ou une position non documentee.
- Si l'user demande quelque chose qui necessite des donnees absentes (ex: "qui voyait quoi"), dis-le : "Cette info specifique n'est pas dans la demo data."
- Pour les pro_demos : utilise UNIQUEMENT les ids exactement listes dans le <pro_library> si fourni. Sinon, ne cite pas de pro.

═══ SCOPE ═══

- Reponds aux questions sur le match charge UNIQUEMENT (ce match-ci, son gameplay, les decisions, les stats).
- Si la question deborde (matchmaking, hardware, sensi, account FACEIT), refuse poliment et redirige : "Concentrons-nous sur ce match, je peux t'aider sur [...]".
- Pas de conseils sur match en cours (live), exploits, cheats, skin scams.
- Si l'user demande une comparaison cross-demo, indique que c'est une feature V2.`;

  // Block 2 : demo data (CHANGE par demo mais cache 1h pour la conversation)
  let demoDataBlock = '<demo_data>\n';
  if (context && context.demo) {
    const d = context.demo;
    const m = context.match;
    const you = context.targetPlayer;
    const sb = context.scoreboard || [];

    demoDataBlock += `<match map="${d.map || '?'}" rounds="${d.rounds || 0}" winner="${m?.winner || '-'}" score_ct="${m?.scoreCt || 0}" score_t="${m?.scoreT || 0}" />\n`;

    if (you) {
      demoDataBlock += `<you name="${you.name}" fvr="${you.fvr?.toFixed(2) || '-'}" kills="${you.kills || 0}" deaths="${you.deaths || 0}" adr="${you.adr || 0}" kast="${you.kast || 0}" hs="${you.hsPct || 0}" first_kills="${you.fk || 0}" first_deaths="${you.fd || 0}" />\n`;
    }

    if (sb.length) {
      demoDataBlock += '<scoreboard>\n';
      sb.slice(0, 10).forEach(p => {
        demoDataBlock += `  <player name="${p.name}" team="${p.team}" fvr="${p.fvr?.toFixed(2) || '-'}" k="${p.kills || 0}" d="${p.deaths || 0}" a="${p.assists || 0}" adr="${p.adr || 0}" kast="${p.kast || 0}" hs="${p.hsPct || 0}" first_kills="${p.fk || 0}" is_user="${p.isUser ? 'true' : 'false'}" />\n`;
      });
      demoDataBlock += '</scoreboard>\n';
    }

    if (context.profile) {
      demoDataBlock += `<user_profile faceit_nickname="${context.profile.nickname || ''}" faceit_level="${context.profile.level || 0}" faceit_elo="${context.profile.elo || 0}" />\n`;
    }
  } else {
    demoDataBlock += '<warning>No demo data available, ask user for clarification</warning>\n';
  }
  demoDataBlock += '</demo_data>';

  return { systemInstructions, demoDataBlock };
}

// Recupere ou cree la conversation pour ce (user, demo)
async function getOrCreateConversation(supabase, userId, demoId, demoContext) {
  // Tentative SELECT
  const { data: existing } = await supabase.from('coach_conversations')
    .select('id, demo_context, message_count')
    .eq('user_id', userId)
    .eq('demo_id', demoId)
    .maybeSingle();

  if (existing) {
    // Si demo_context vide et qu'on a un context calcule, on update
    if (!existing.demo_context && demoContext) {
      await supabase.from('coach_conversations')
        .update({ demo_context: demoContext, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return { id: existing.id, isNew: false, messageCount: existing.message_count };
  }

  // Insert nouvelle conversation
  const { data: created, error } = await supabase.from('coach_conversations')
    .insert({
      user_id: userId,
      demo_id: demoId,
      demo_context: demoContext,
    })
    .select('id')
    .single();
  if (error) throw new Error('conv create failed: ' + error.message);
  return { id: created.id, isNew: true, messageCount: 0 };
}

// Charge les N derniers messages de la conversation pour le rolling window
async function loadRecentMessages(supabase, conversationId, limit = ROLLING_WINDOW) {
  const { data } = await supabase.from('coach_messages')
    .select('role, content, refs, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  // Garde les N derniers (chronologique)
  if (!data) return [];
  return data.slice(-limit);
}

// Append un message a la conversation
async function appendMessage(supabase, conversationId, role, content, refs, tokensIn, tokensOut) {
  const { data, error } = await supabase.from('coach_messages')
    .insert({
      conversation_id: conversationId,
      role,
      content: String(content).slice(0, 4000),
      refs: refs || {},
      tokens_in: tokensIn || 0,
      tokens_out: tokensOut || 0,
    })
    .select('id, created_at')
    .single();
  if (error) throw new Error('msg insert failed: ' + error.message);
  return data;
}

// Compte les messages user envoyes aujourd'hui par cet user (rate limit)
async function countTodayUserMessages(supabase, userId) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase.from('coach_messages')
    .select('*, coach_conversations!inner(user_id)', { count: 'exact', head: true })
    .eq('role', 'user')
    .eq('coach_conversations.user_id', userId)
    .gte('created_at', today.toISOString());
  return count || 0;
}

// Appel Claude Sonnet 4.5 avec prompt caching 1h sur les 2 blocks stables
// (system instructions + demo data). Permet 90% de savings sur les questions
// 2-N de la meme conversation (le cache hit reduit le cout d'input de
// $3/Mtok -> $0.30/Mtok pour les blocks caches).
//
// Cache TTL 1h paid : ideal pour une session de review qui dure 20-40 min.
async function callClaude(systemInstructions, demoDataBlock, conversationMessages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');

  // Construction des messages : on injecte le demo_data en 1er user message
  // pour pouvoir le cacher, puis on append l'historique conversation.
  const filtered = conversationMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: String(m.content) }));

  // Inject demo_data block au debut du 1er user message (ou cree un 1er message)
  let messages;
  if (filtered.length === 0) {
    // Fallback : pas de message, on ajoute le demo_data + un primer
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: demoDataBlock, cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: 'Bonjour, je vais te poser des questions sur cette demo.' },
      ],
    }];
  } else {
    // Pre-pend demo_data a la 1re user message avec cache_control
    const firstUserIdx = filtered.findIndex(m => m.role === 'user');
    messages = filtered.map((m, i) => {
      if (i === firstUserIdx) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: demoDataBlock, cache_control: { type: 'ephemeral', ttl: '1h' } },
            { type: 'text', text: m.content },
          ],
        };
      }
      return m;
    });
  }

  // System prompt en array avec cache_control 1h sur les instructions stables
  const system = [
    {
      type: 'text',
      text: systemInstructions,
      cache_control: { type: 'ephemeral', ttl: '1h' },
    },
  ];

  const res = await fetch(CLAUDE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // Header obligatoire pour activer prompt caching avec ttl='1h'
      'anthropic-beta': 'extended-cache-ttl-2025-04-11',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_RESPONSE_TOKENS,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Claude API ' + res.status + ': ' + errText.slice(0, 200));
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  if (!text) throw new Error('Claude empty response');
  return {
    text,
    tokensIn: data.usage?.input_tokens || 0,
    tokensOut: data.usage?.output_tokens || 0,
    cacheCreationTokens: data.usage?.cache_creation_input_tokens || 0,
    cacheReadTokens: data.usage?.cache_read_input_tokens || 0,
    model: CLAUDE_MODEL,
  };
}

// ─── HANDLER ────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET : lecture de l'historique d'une conversation ──
  if (req.method === 'GET') {
    const { plan, user } = await getUserPlan(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'Auth requise' });

    const demoId = req.query?.demo_id;
    if (!demoId) return res.status(400).json({ error: 'demo_id requis' });

    const supabase = sb();
    const { data: conv } = await supabase.from('coach_conversations')
      .select('id, message_count')
      .eq('user_id', user.id)
      .eq('demo_id', demoId)
      .maybeSingle();
    if (!conv) {
      return res.status(200).json({ conversation_id: null, messages: [], history_count: 0, plan });
    }
    const { data: msgs } = await supabase.from('coach_messages')
      .select('id, role, content, refs, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: true });
    return res.status(200).json({
      conversation_id: conv.id,
      messages: msgs || [],
      history_count: conv.message_count,
      plan,
    });
  }

  // ── POST : nouveau message dans la conversation ──
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Plan check : require Pro ou Elite (Free n'a pas acces, c'est un Pro feature)
  const gate = await requirePro(req, res);
  if (!gate) return; // 401/403 deja envoye
  const { user, plan } = gate;
  const isAdmin = user.email && ADMIN_EMAILS.includes(user.email);

  // Body parsing
  let body = req.body || {};
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const demoId = body.demo_id;
  const message = String(body.message || '').trim();
  const reset = !!body.reset;
  const inboundContext = body.context || null;

  if (!demoId) return res.status(400).json({ error: 'demo_id requis' });
  if (!reset && !message) return res.status(400).json({ error: 'message vide' });
  if (message.length > MAX_MESSAGE_LEN) {
    return res.status(400).json({ error: `Message trop long (max ${MAX_MESSAGE_LEN} chars)` });
  }

  const supabase = sb();

  // Reset : delete la conversation existante (cascade messages)
  if (reset) {
    await supabase.from('coach_conversations')
      .delete()
      .eq('user_id', user.id)
      .eq('demo_id', demoId);
    return res.status(200).json({ ok: true, reset: true });
  }

  // Rate limit (Pro 60/jour, Elite 200/jour, admin illimite)
  if (!isAdmin) {
    const limit = DAILY_LIMITS[plan] || DAILY_LIMITS.pro;
    const used = await countTodayUserMessages(supabase, user.id);
    if (used >= limit) {
      return res.status(429).json({
        error: 'Limite quotidienne atteinte',
        message: `Tu as atteint ta limite de ${limit} messages par jour (plan ${plan}). ${plan === 'pro' ? 'Passe en Elite pour 200/jour.' : 'Reviens demain.'}`,
        used, limit, plan,
      });
    }
  }

  try {
    // 1. Build/fetch context demo
    let demoContext = inboundContext;
    if (!demoContext) {
      demoContext = await buildDemoContext(supabase, demoId, user.id);
      if (demoContext?.error === 'forbidden') {
        return res.status(403).json({ error: 'Cette demo ne t\'appartient pas' });
      }
    }

    // 2. Get/create conversation (1 par demo)
    const conv = await getOrCreateConversation(supabase, user.id, demoId, demoContext);

    // Soft cap : si conversation est trop longue, prompt user pour reset
    if (conv.messageCount >= SOFT_CAP_CONVERSATION) {
      return res.status(429).json({
        error: 'Conversation trop longue',
        code: 'soft_cap_reached',
        message: `Cette conversation contient deja ${conv.messageCount} messages. Reset-la pour repartir a neuf.`,
        suggested_action: 'reset',
      });
    }

    // 3. Append user message d'abord (pour persister meme si Claude fail)
    const userMsg = await appendMessage(supabase, conv.id, 'user', message, {}, 0, 0);

    // 4. Charge l'historique recent (rolling window) pour Claude
    const history = await loadRecentMessages(supabase, conv.id, ROLLING_WINDOW);

    // 5. Build prompt blocks (system stable + demo_data cacheable)
    const { systemInstructions, demoDataBlock } = buildPromptBlocks(demoContext);

    // 6. Call Claude Sonnet 4.5 avec prompt caching 1h
    const { text, tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens, model } =
      await callClaude(systemInstructions, demoDataBlock, history);

    // 7. Parse refs depuis la reponse
    const refs = parseRefs(text);

    // 8. Append assistant message
    const assistantMsg = await appendMessage(
      supabase, conv.id, 'assistant', text.trim(), refs, tokensIn, tokensOut
    );

    return res.status(200).json({
      conversation_id: conv.id,
      message_id: assistantMsg.id,
      answer: text.trim(),
      refs,
      tokens: {
        in: tokensIn,
        out: tokensOut,
        cache_read: cacheReadTokens || 0,
        cache_creation: cacheCreationTokens || 0,
      },
      model: model || CLAUDE_MODEL,
      history_count: conv.messageCount + 2, // +1 user +1 assistant
      plan,
    });
  } catch (e) {
    console.error('[coach-conversational] error:', e.message);
    return res.status(500).json({
      error: 'Erreur Coach IA',
      message: 'Impossible de generer la reponse. Reessaie dans quelques instants.',
      hint: e.message?.slice(0, 100),
    });
  }
};
