// api/_lib/claude-client.js · FragValue
// Wrapper raw HTTP pour Claude API avec defaults FragValue 10/10 :
//   - Opus 4.7 par defaut (le plus capable, adaptive thinking only)
//   - Adaptive thinking + display: summarized (transparence sur le raisonnement)
//   - Effort xhigh (recommande pour coding/agentic, +intelligence)
//   - Prompt caching auto sur le system prompt (5min TTL par defaut)
//   - Parse JSON robust (gere les fences markdown)
//
// Usage :
//   const { callClaude, parseJsonRobust } = require('./_lib/claude-client');
//   const r = await callClaude({ system, messages, maxTokens: 8000 });
//   const json = parseJsonRobust(r.text);

const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

const MODELS = {
  // Opus 4.7 : le plus capable, pour diag profonds (ai-roadmap, coach-conversational)
  // Adaptive thinking only, sampling params (temperature/top_p/top_k) removed
  OPUS_47: 'claude-opus-4-7',
  // Sonnet 4.6 : balance vitesse/intelligence, pour diag moyens (replay-summary)
  SONNET_46: 'claude-sonnet-4-6',
  // Haiku 4.5 : pour latence chat (coach-qa quick replies)
  HAIKU_45: 'claude-haiku-4-5',
};

const DEFAULTS = {
  model: MODELS.OPUS_47,
  maxTokens: 16000,
  thinking: { type: 'adaptive', display: 'summarized' },
  effort: 'xhigh',
  cacheSystem: true,
  cacheTtl: '5m', // ou '1h' pour les system prompts > 4K tokens stables
  timeoutMs: 5 * 60 * 1000, // 5 min hard timeout
};

// Build le json_schema config Anthropic pour structured output natif.
// Permet a l'API de valider que la sortie respecte le schema (sinon erreur).
// Disponible sur Opus 4.7, Sonnet 4.6, Haiku 4.5.
function jsonSchemaFormat(schema) {
  return { type: 'json_schema', schema };
}

// Sleep helper pour backoff exponentiel
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Appel principal Claude avec retry exponentiel sur 429/5xx (max 2 retries).
// Retourne { text, thinking, usage, stopReason, refusalDetails, raw }
async function callClaude(opts) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY manquant');

  const {
    model = DEFAULTS.model,
    system,
    messages,
    maxTokens = DEFAULTS.maxTokens,
    thinking = DEFAULTS.thinking,
    effort = DEFAULTS.effort,
    cacheSystem = DEFAULTS.cacheSystem,
    cacheTtl = DEFAULTS.cacheTtl,
    timeoutMs = DEFAULTS.timeoutMs,
    extraBody = {},
    maxRetries = 2,
    jsonSchema = null, // optionnel : structured output validation native Anthropic
  } = opts;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages array required and non-empty');
  }

  const body = {
    model,
    max_tokens: maxTokens,
    messages,
    ...extraBody,
  };

  // System prompt avec cache_control (5min/1h TTL configurable)
  // 5min = 1.25x write, 0.1x read · 1h = 2x write, 0.1x read
  // Pour les system prompts > 4K tokens stables (cs2-lexicon), 1h amortit mieux.
  if (system) {
    if (cacheSystem) {
      const cc = cacheTtl === '1h'
        ? { type: 'ephemeral', ttl: '1h' }
        : { type: 'ephemeral' };
      body.system = [{
        type: 'text',
        text: typeof system === 'string' ? system : String(system),
        cache_control: cc,
      }];
    } else {
      body.system = system;
    }
  }

  // Structured output validation native Anthropic.
  // Le schema doit etre additionalProperties: false sur tous les objects.
  if (jsonSchema) {
    body.output_config = body.output_config || {};
    body.output_config.format = jsonSchemaFormat(jsonSchema);
  }

  // Adaptive thinking : seul mode Opus 4.7. Haiku ne supporte pas → strip.
  if (thinking && model !== MODELS.HAIKU_45) {
    body.thinking = thinking;
  }

  // Effort : xhigh > high > medium > low. Max = Opus-tier only. Haiku skip.
  if (effort && model !== MODELS.HAIKU_45) {
    body.output_config = { effort };
  }

  // Retry exponentiel sur 429 / 5xx (rate limit, overloaded, transient)
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const baseDelay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      const jitter = Math.random() * 1000;
      await sleep(baseDelay + jitter);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let res;
    try {
      res = await fetch(CLAUDE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') {
        lastErr = new Error(`Claude API timeout (${timeoutMs}ms) attempt ${attempt + 1}`);
        if (attempt < maxRetries) continue;
        throw lastErr;
      }
      // Network errors : retry
      lastErr = e;
      if (attempt < maxRetries) continue;
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const errText = await res.text();
      const isRetryable = res.status === 429 || res.status === 529 || res.status >= 500;
      const err = new Error(`Claude API ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      err.body = errText;
      if (isRetryable && attempt < maxRetries) {
        lastErr = err;
        console.warn(`[claude-client] retry ${attempt + 1}/${maxRetries} on ${res.status}`);
        continue;
      }
      throw err;
    }

    const data = await res.json();

    // Stop reason handling :
    // - "refusal" : Claude refuse pour safety. Pas de retry, on remonte.
    // - "max_tokens" : output tronque, mais on remonte ce qu'on a.
    // - "model_context_window_exceeded" : contexte plein. Pas de retry, on remonte.
    // - "pause_turn" : server-side tool a pause, le caller doit re-send. Pas notre cas.
    const stopReason = data.stop_reason;
    let refusalDetails = null;
    if (stopReason === 'refusal' && data.stop_details) {
      refusalDetails = {
        category: data.stop_details.category,
        explanation: data.stop_details.explanation,
      };
    }

    return {
      text: extractText(data),
      thinking: extractThinking(data),
      usage: data.usage,
      stopReason,
      refusalDetails,
      model: data.model,
      raw: data,
    };
  }

  // Pas suppose arriver mais safety
  throw lastErr || new Error('Claude API: max retries exhausted');
}

function extractText(data) {
  return (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}

function extractThinking(data) {
  return (data.content || [])
    .filter(b => b.type === 'thinking')
    .map(b => b.thinking || '')
    .filter(Boolean)
    .join('\n\n');
}

// Parse JSON robust : enleve fences markdown, trouve le {} le plus large
function parseJsonRobust(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('No JSON object in response: ' + s.slice(0, 200));
  }
  return JSON.parse(s.slice(start, end + 1));
}

// Calcul du cout en $ pour observabilite (basé sur la grille publique 2026-04)
const PRICING = {
  [MODELS.OPUS_47]:   { in: 5.00, out: 25.00, cache_write: 1.25, cache_read: 0.10 },
  [MODELS.SONNET_46]: { in: 3.00, out: 15.00, cache_write: 1.25, cache_read: 0.10 },
  [MODELS.HAIKU_45]:  { in: 1.00, out:  5.00, cache_write: 1.25, cache_read: 0.10 },
};

function estimateCostUsd(model, usage) {
  if (!usage || !PRICING[model]) return null;
  const p = PRICING[model];
  const inp = (usage.input_tokens || 0) * p.in / 1_000_000;
  const out = (usage.output_tokens || 0) * p.out / 1_000_000;
  const cw = (usage.cache_creation_input_tokens || 0) * p.in * p.cache_write / 1_000_000;
  const cr = (usage.cache_read_input_tokens || 0) * p.in * p.cache_read / 1_000_000;
  return +(inp + out + cw + cr).toFixed(4);
}

module.exports = {
  callClaude,
  parseJsonRobust,
  estimateCostUsd,
  jsonSchemaFormat,
  MODELS,
  DEFAULTS,
};
