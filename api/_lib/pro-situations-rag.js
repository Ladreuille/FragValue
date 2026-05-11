// api/_lib/pro-situations-rag.js · FragValue
// RAG sur situations pros notables : trouve les 3-5 demos pros les plus
// similaires au contexte du user (map, side, type situation, axes) et formate
// pour injection dans le prompt Coach IA.
//
// Fondations :
//   - Table pro_demo_situations (migration 2026-05-10-pro-demo-situations-rag)
//   - pgvector v0.8.0 + HNSW index (cosine similarity)
//   - SQL function search_pro_situations(query_embedding, ...) avec filtres
//   - Embeddings via _lib/embeddings.js (Voyage AI primaire, OpenAI fallback)
//
// Quand l'utiliser :
//   - coach-conversational.js : user pose une question sur un round / une
//     situation → on cherche 3 pros qui ont vecu une situation similaire et
//     on les cite avec replay_link.
//   - ai-roadmap.js : on identifie 2-3 axes faibles + on injecte pour chaque
//     axe une demo pro qui demontre l'execution exemplaire (axe 6 du rubric).
//
// Pourquoi RAG plutot que prompt statique :
//   - Le corpus est de ~50-200 situations curees. Tout coller dans le prompt
//     consommerait 30-50K tokens et tuerait le cache.
//   - Vector search ramene seulement les 3-5 pertinents → contexte cible,
//     citations precises, qualite "marque de fabrique" sans bloat.
//
// Usage :
//   const { findRelevantProSituations, formatSituationsForPrompt } = require('./_lib/pro-situations-rag');
//   const sits = await findRelevantProSituations(supabase, {
//     map: 'inferno',
//     side: 'CT',
//     situationType: 'retake_3v2',
//     axes: ['utility', 'positioning'],
//     userQueryHint: 'pourquoi j ai perdu le retake banane 3v2',
//   }, { k: 3, minNotable: 7 });
//   const promptSnippet = formatSituationsForPrompt(sits);

const { embed } = require('./embeddings');
const { normalizeMap } = require('./pro-benchmarks');

const DEFAULTS = {
  k: 3,                      // nombre de situations a ramener
  minNotable: 6,             // notable_rating min (1-10), 6 = "bon ex pedagogique"
  similarityThreshold: 0.55, // cosine similarity min (0-1), sous ca le match est trop faible
};

// ─── Query Building ────────────────────────────────────────────────────────
// On construit un texte naturel qui ressemble a une "description de situation"
// pour matcher au mieux les embeddings du corpus (qui ont ete embedded avec
// input_type='document' a partir de descriptions similaires).
//
// Exemple sortie :
//   "Retake 3v2 cote CT sur Inferno banane. Utility coordination critique :
//    smokes, flashes, molotov. Decision sous pression, timing entry, focus
//    sur positioning et utility usage."
function buildSituationQuery(ctx) {
  const parts = [];
  const map = normalizeMap(ctx.map);
  if (ctx.situationType) {
    const t = String(ctx.situationType).replace(/_/g, ' ');
    parts.push(t);
  }
  if (ctx.side) parts.push(`cote ${String(ctx.side).toUpperCase()}`);
  if (map) parts.push(`sur ${cap(map)}`);
  if (ctx.bombsite) parts.push(`bombsite ${ctx.bombsite.toUpperCase()}`);
  if (ctx.economy) parts.push(`economy ${ctx.economy}`); // 'eco' | 'force' | 'full' | 'anti-eco'
  if (Array.isArray(ctx.axes) && ctx.axes.length) {
    parts.push(`Axes critiques : ${ctx.axes.join(', ')}`);
  }
  if (ctx.userQueryHint) {
    parts.push(String(ctx.userQueryHint).slice(0, 400));
  }
  if (ctx.role) parts.push(`role ${ctx.role}`);
  // CT/T side defaults par map peuvent enrichir le matching
  if (ctx.roundType) parts.push(`type round ${ctx.roundType}`); // 'pistol' | 'anti-eco' | 'gun' | 'force'
  return parts.filter(Boolean).join('. ');
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// ─── Core search ───────────────────────────────────────────────────────────
// Embed le query texte + appel search_pro_situations() RPC Supabase.
// Returns liste triee par similarity desc avec score (0-1).
async function findRelevantProSituations(supabase, ctx, opts = {}) {
  if (!supabase) {
    console.warn('[pro-situations-rag] supabase client missing');
    return [];
  }
  const {
    k = DEFAULTS.k,
    minNotable = DEFAULTS.minNotable,
    similarityThreshold = DEFAULTS.similarityThreshold,
  } = opts;

  try {
    const queryText = buildSituationQuery(ctx);
    if (!queryText || queryText.length < 5) {
      console.warn('[pro-situations-rag] query too short, skipping RAG');
      return [];
    }

    // 1. Embed la query (input_type='query' → optimise pour matcher des docs)
    let queryEmbedding;
    try {
      queryEmbedding = await embed(queryText, { inputType: 'query' });
    } catch (e) {
      console.warn('[pro-situations-rag] embedding failed:', e.message);
      return [];
    }

    // 2. RPC vers search_pro_situations() avec filtres optionnels.
    // Signature SQL : (query_embedding, query_map, query_side, query_situation_type,
    //                  match_count, min_similarity, min_notable_rating, query_axes)
    const rpcParams = {
      query_embedding: queryEmbedding,
      match_count: k,
      min_similarity: similarityThreshold,
      min_notable_rating: minNotable,
    };
    const map = normalizeMap(ctx.map);
    if (map) rpcParams.query_map = map;
    if (ctx.side) rpcParams.query_side = String(ctx.side).toUpperCase();
    if (ctx.situationType) rpcParams.query_situation_type = ctx.situationType;
    if (Array.isArray(ctx.axes) && ctx.axes.length) rpcParams.query_axes = ctx.axes;

    const { data, error } = await supabase.rpc('search_pro_situations', rpcParams);
    if (error) {
      console.warn('[pro-situations-rag] RPC error:', error.message);
      return [];
    }
    if (!Array.isArray(data) || data.length === 0) return [];

    // La RPC applique deja min_similarity → on garde tout
    const filtered = data.slice(0, k);

    // Si le strict filter map+side+type a renvoye 0 hits avec assez de
    // similarity, on retente sans filtres durs (semantic-only). Souvent une
    // situation T-side anubis a beaucoup a apprendre d'une T-side mirage si
    // l'axe est le meme.
    if (filtered.length === 0 && (rpcParams.query_map || rpcParams.query_situation_type)) {
      const fallbackParams = {
        query_embedding: queryEmbedding,
        match_count: k,
        min_similarity: similarityThreshold,
        min_notable_rating: minNotable,
      };
      if (Array.isArray(ctx.axes) && ctx.axes.length) fallbackParams.query_axes = ctx.axes;
      const { data: data2 } = await supabase.rpc('search_pro_situations', fallbackParams);
      if (Array.isArray(data2)) return data2.slice(0, k);
    }

    return filtered;
  } catch (e) {
    console.warn('[pro-situations-rag] error:', e.message);
    return [];
  }
}

// ─── Prompt formatting ─────────────────────────────────────────────────────
// Compact + cite-friendly. Le Coach IA doit pouvoir citer le pro et le replay
// link sans gymnastique. On limite la verbosite pour ne pas peter le cache.
function formatSituationsForPrompt(situations) {
  if (!Array.isArray(situations) || situations.length === 0) return '';

  const blocks = situations.map((s, i) => {
    const callouts = Array.isArray(s.key_callouts) && s.key_callouts.length
      ? ` Callouts cles: ${s.key_callouts.join(', ')}.`
      : '';
    const axes = Array.isArray(s.axes_demonstrated) && s.axes_demonstrated.length
      ? ` Axes demontres: ${s.axes_demonstrated.join(', ')}.`
      : '';
    const replay = s.replay_link ? ` Replay: ${s.replay_link}` : '';
    const sim = typeof s.similarity === 'number' ? ` [sim ${(s.similarity * 100).toFixed(0)}%]` : '';
    return `[REF-${i + 1}]${sim} ${s.pro_name} — ${s.map?.toUpperCase()} ${s.side} ${s.situation_type} (R${s.round_num ?? '?'}${s.match_event ? ', ' + s.match_event : ''})
${s.description}
${s.tactical_notes || ''}${callouts}${axes}${replay}`.trim();
  });

  return `DEMOS PROS PERTINENTES (RAG):
Cite-les avec [REF-N] quand tu fais une recommandation, et inclus le replay_link s'il existe.
Ton role : montrer "comment le pro le fait" pour ancrer le conseil. Ne cite jamais une demo sans citer un fait concret de la demo.

${blocks.join('\n\n')}

Regle : si une demo est marquee [sim < 65%], elle est moins pertinente — utilise-la seulement comme contexte secondaire, ne la cite pas comme preuve principale.`;
}

// ─── Format compact (1-liner) pour ai-roadmap ──────────────────────────────
// Quand on veut juste 1 pro par axe faible sans bloat. Renvoie un mapping
// axis → bestSituation.
function pickBestPerAxis(situations, axes) {
  const out = {};
  if (!Array.isArray(situations) || !Array.isArray(axes)) return out;
  for (const axis of axes) {
    const match = situations.find(s =>
      Array.isArray(s.axes_demonstrated) && s.axes_demonstrated.includes(axis)
    );
    if (match) out[axis] = match;
  }
  return out;
}

module.exports = {
  findRelevantProSituations,
  formatSituationsForPrompt,
  buildSituationQuery,
  pickBestPerAxis,
  DEFAULTS,
};
