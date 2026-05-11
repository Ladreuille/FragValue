// api/_lib/embeddings.js · FragValue
// Wrapper embeddings text → vector(1024) pour RAG pros démos.
//
// Provider primaire : Voyage AI (voyage-3.5, 1024 dim, $0.06/M tokens)
//   - voyage-3.5 et voyage-3.5-lite sortent en 1024 dim natifs (matrioshka)
//   - input_type "document" (indexation seed) vs "query" (recherche) → asymetrique,
//     ameliore la qualite retrieval de 5-15% vs un seul type unifie.
//   - max 32K tokens par input
//
// Provider fallback : OpenAI text-embedding-3-small ($0.020/M, dimensions=1024)
//   - utilise quand VOYAGE_API_KEY manque ou que Voyage timeout/erreur
//   - dimensions=1024 (au lieu du 1536 natif) pour match notre HNSW index pgvector
//
// Choix architectural :
//   - Voyage primaire car +3-5pts MTEB vs OpenAI sur retrieval domaine specifique
//   - 1024 dim pour balance qualite/cout/storage Supabase (HNSW friendly)
//   - Cosine similarity (vector_cosine_ops dans l'index)
//
// Usage :
//   const { embed, embedBatch } = require('./_lib/embeddings');
//   const v = await embed('round 13 pistol round AWP setup', { inputType: 'query' });
//   const vs = await embedBatch(['s1', 's2', ...], { inputType: 'document' });

const { fetchWithTimeout } = require('./fetch-with-timeout');

const VOYAGE_ENDPOINT = 'https://api.voyageai.com/v1/embeddings';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/embeddings';

const TARGET_DIMENSIONS = 1024; // doit matcher vector(1024) dans pro_demo_situations

const DEFAULTS = {
  // voyage-3.5 = balance perf/cout. voyage-3.5-lite = -50% cout, -2pts MTEB.
  // Pour notre corpus de ~50-200 situations, on prend la qualite.
  voyageModel: 'voyage-3.5',
  openaiModel: 'text-embedding-3-small',
  timeoutMs: 30 * 1000,
  maxRetries: 2,
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Embed un seul texte. inputType:
//   - 'document' : pour indexer (seed corpus). On instruit le modele de produire
//                  une representation optimisee pour etre matchee par des queries.
//   - 'query'    : pour rechercher. Representation optimisee pour matcher des docs.
//   - null       : symetrique (deconseille si on a le choix)
async function embed(text, opts = {}) {
  const vectors = await embedBatch([text], opts);
  return vectors[0];
}

// Embed un batch. Voyage accepte jusqu'a 128 inputs par appel, OpenAI 2048.
// On chunke a 100 pour rester safe et pas exploser le payload.
async function embedBatch(texts, opts = {}) {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error('embedBatch: texts must be a non-empty array');
  }
  // IMPORTANT : on ne filter PAS les empty texts (sinon les indices misalignent
  // avec ceux passes par l'appelant). On throw si un input est vide pour eviter
  // un bug silencieux ou le seed insere des embeddings sur les mauvaises rows.
  const cleaned = texts.map(t => String(t || '').trim());
  for (let i = 0; i < cleaned.length; i++) {
    if (!cleaned[i]) throw new Error(`embedBatch: input ${i} is empty after trimming`);
  }

  const { inputType = 'document', provider = null } = opts;

  // Selection du provider : explicite > Voyage si key dispo > OpenAI fallback
  const useVoyage = provider === 'voyage' || (!provider && !!process.env.VOYAGE_API_KEY);
  const useOpenAI = provider === 'openai' || (!useVoyage && !!process.env.OPENAI_API_KEY);

  if (!useVoyage && !useOpenAI) {
    throw new Error('embeddings: neither VOYAGE_API_KEY nor OPENAI_API_KEY is set');
  }

  // Chunking : batches de 100 max
  const CHUNK = 100;
  const out = [];
  for (let i = 0; i < cleaned.length; i += CHUNK) {
    const slice = cleaned.slice(i, i + CHUNK);
    let vectors;
    if (useVoyage) {
      try {
        vectors = await callVoyage(slice, inputType);
      } catch (e) {
        // Fallback automatique sur OpenAI si Voyage echoue et qu'on a la key
        if (process.env.OPENAI_API_KEY && provider !== 'voyage') {
          console.warn('[embeddings] Voyage failed, falling back to OpenAI:', e.message);
          vectors = await callOpenAI(slice);
        } else {
          throw e;
        }
      }
    } else {
      vectors = await callOpenAI(slice);
    }
    out.push(...vectors);
  }

  // Validation : tous les vecteurs doivent etre 1024 dim
  for (let i = 0; i < out.length; i++) {
    if (!Array.isArray(out[i]) || out[i].length !== TARGET_DIMENSIONS) {
      throw new Error(`embeddings: vector ${i} has ${out[i]?.length} dims, expected ${TARGET_DIMENSIONS}`);
    }
  }

  return out;
}

// ─── Voyage AI ─────────────────────────────────────────────────────────────

async function callVoyage(texts, inputType) {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY manquant');

  const body = {
    input: texts,
    model: DEFAULTS.voyageModel,
    output_dimension: TARGET_DIMENSIONS, // matrioshka : voyage-3.5 supporte 256/512/1024/2048
    // input_type ameliore retrieval. Voyage accepte 'document' | 'query' | null.
    ...(inputType ? { input_type: inputType } : {}),
  };

  let lastErr = null;
  for (let attempt = 0; attempt <= DEFAULTS.maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
    }
    let res;
    try {
      res = await fetchWithTimeout(VOYAGE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }, DEFAULTS.timeoutMs);
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError' && attempt < DEFAULTS.maxRetries) continue;
      if (attempt < DEFAULTS.maxRetries) continue;
      throw e;
    }

    if (!res.ok) {
      const errText = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      const err = new Error(`Voyage API ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      if (retryable && attempt < DEFAULTS.maxRetries) {
        lastErr = err;
        console.warn(`[embeddings] Voyage retry ${attempt + 1} on ${res.status}`);
        continue;
      }
      throw err;
    }

    const data = await res.json();
    // Voyage retourne { data: [{ embedding: [...], index: 0 }, ...], usage: { total_tokens } }
    if (!Array.isArray(data.data)) {
      throw new Error('Voyage: malformed response (no data array)');
    }
    // Tri par index pour garantir l'ordre (Voyage le fait deja mais safety)
    const sorted = [...data.data].sort((a, b) => (a.index || 0) - (b.index || 0));
    return sorted.map(d => d.embedding);
  }
  throw lastErr || new Error('Voyage: max retries exhausted');
}

// ─── OpenAI fallback ───────────────────────────────────────────────────────

async function callOpenAI(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY manquant');

  const body = {
    input: texts,
    model: DEFAULTS.openaiModel,
    dimensions: TARGET_DIMENSIONS, // text-embedding-3-* supporte matrioshka via param dimensions
  };

  let lastErr = null;
  for (let attempt = 0; attempt <= DEFAULTS.maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
    }
    let res;
    try {
      res = await fetchWithTimeout(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      }, DEFAULTS.timeoutMs);
    } catch (e) {
      lastErr = e;
      if (attempt < DEFAULTS.maxRetries) continue;
      throw e;
    }

    if (!res.ok) {
      const errText = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      const err = new Error(`OpenAI Embeddings ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      if (retryable && attempt < DEFAULTS.maxRetries) {
        lastErr = err;
        console.warn(`[embeddings] OpenAI retry ${attempt + 1} on ${res.status}`);
        continue;
      }
      throw err;
    }

    const data = await res.json();
    if (!Array.isArray(data.data)) {
      throw new Error('OpenAI: malformed response (no data array)');
    }
    const sorted = [...data.data].sort((a, b) => (a.index || 0) - (b.index || 0));
    return sorted.map(d => d.embedding);
  }
  throw lastErr || new Error('OpenAI: max retries exhausted');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

// Cosine similarity entre deux vecteurs (pour debug / tests locaux).
// L'index pgvector le fait nativement, mais utile pour valider seed.
function cosineSim(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    throw new Error('cosineSim: vectors must be same length arrays');
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Estimation du cout en USD pour observabilite seed.
// Voyage : $0.06/M tokens (voyage-3.5)
// OpenAI : $0.020/M tokens (text-embedding-3-small)
function estimateCostUsd(provider, totalTokens) {
  const rate = provider === 'voyage' ? 0.06 : 0.020;
  return +((totalTokens || 0) * rate / 1_000_000).toFixed(6);
}

module.exports = {
  embed,
  embedBatch,
  cosineSim,
  estimateCostUsd,
  TARGET_DIMENSIONS,
};
