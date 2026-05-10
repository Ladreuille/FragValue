// api/_lib/self-eval.js · FragValue
// Wrapper auto-evaluation pour les diagnostics Coach IA :
//   1. Genere une reponse via Claude (avec extended thinking + caching)
//   2. Parse le JSON et extrait les axisScores
//   3. Si une note < threshold (10 par defaut), regen une fois max
//      avec instructions ciblees sur les axes faibles
//   4. Retourne le meilleur effort + meta (attempts, costs)
//
// Pattern recommande par doc Anthropic : Claude est tres bon a self-eval
// quand on lui donne un rubric explicite et qu'on lui demande de re-noter.

const { callClaude, parseJsonRobust, estimateCostUsd } = require('./claude-client');
const { getWeakAxes, summarizeAxisScores } = require('./diagnostic-rubric');

// Genere + auto-eval + regen si needed.
//
// opts = {
//   ...claudeOpts,           // tout ce que callClaude accepte
//   threshold = 10,          // note minimum acceptable sur tous les axes
//   maxRetries = 1,          // 1 retry max (cap cout)
//   onAttempt = (n, r) => {} // callback pour logger
// }
//
// Returns : {
//   diagnosis,        // JSON parse
//   attempts,         // 1 ou 2
//   weakAxes,         // axes < threshold (vide si tout 10)
//   axisScoresSummary,// {avg, min, max}
//   usageTotal,       // somme des usages des appels
//   estimatedCostUsd, // somme cout
//   thinking,         // dernier thinking text
//   raw,              // dernier raw response
// }
async function withSelfEval(opts) {
  const {
    threshold = 10,
    maxRetries = 1,
    // Cap dur sur le cout cumule. Default 0.60 calibre pour Opus 4.7 +
    // effort xhigh + thinking : 1 essai = ~$0.30, 2 essais = ~$0.60.
    // Si le 1er essai depasse deja, on ne tente pas le 2eme.
    maxCostUsd = 0.60,
    onAttempt,
    ...claudeOpts
  } = opts;

  let attempts = 0;
  let lastDiagnosis = null;
  let lastResult = null;
  let totalUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  let totalCost = 0;

  let messages = [...(claudeOpts.messages || [])];

  while (attempts <= maxRetries) {
    attempts++;

    const result = await callClaude({
      ...claudeOpts,
      messages,
    });
    lastResult = result;

    if (result.usage) {
      totalUsage.input_tokens += result.usage.input_tokens || 0;
      totalUsage.output_tokens += result.usage.output_tokens || 0;
      totalUsage.cache_creation_input_tokens += result.usage.cache_creation_input_tokens || 0;
      totalUsage.cache_read_input_tokens += result.usage.cache_read_input_tokens || 0;
      const cost = estimateCostUsd(result.model || claudeOpts.model, result.usage);
      if (cost) totalCost += cost;
    }

    // Cap dur APRES l'appel : si on a depasse, on ne fait pas de retry meme
    // si le diag est faible. Eviter explosion cout sur prompt mal calibre.
    if (totalCost > maxCostUsd && attempts <= maxRetries) {
      console.warn(`[self-eval] cost cap reached after attempt ${attempts}: $${totalCost.toFixed(2)} > $${maxCostUsd}, no more retries`);
      // On va laisser cette attempt jouer son role mais on ne regenera pas
      // → set maxRetries effectif a attempts pour bloquer le loop
    }

    // Refusal handling
    if (result.stopReason === 'refusal') {
      throw new Error(`Claude refused: ${result.refusalDetails?.explanation || 'safety reason'}`);
    }

    let diag;
    try {
      diag = parseJsonRobust(result.text);
    } catch (e) {
      console.warn('[self-eval] JSON parse failed on attempt', attempts, ':', e.message);
      if (attempts > maxRetries) {
        throw new Error('Self-eval failed: JSON parse error after ' + attempts + ' attempts: ' + e.message);
      }
      messages = [
        ...messages,
        { role: 'assistant', content: result.text },
        {
          role: 'user',
          content: `Ta reponse precedente n'est pas un JSON valide (parse error: ${e.message.slice(0, 100)}). Regenere UNIQUEMENT le JSON valide selon le schema demande, sans markdown fences, sans prose autour.`,
        },
      ];
      continue;
    }

    lastDiagnosis = diag;

    if (onAttempt) {
      try { onAttempt(attempts, diag); } catch {}
    }

    // Validation : axisScores doit etre present et complet.
    // Si manquant ou vide, on considere comme weak et on trigger regen.
    const hasValidScores = diag.axisScores
      && typeof diag.axisScores === 'object'
      && Object.keys(diag.axisScores).length >= 10;

    if (!hasValidScores) {
      console.warn('[self-eval] axisScores missing or incomplete on attempt', attempts);
      if (attempts > maxRetries) {
        // Pas de regen possible, on throw pour eviter de retourner un diag silencieusement degradé
        throw new Error('Self-eval failed: axisScores missing or incomplete after ' + attempts + ' attempts');
      }
      messages = [
        ...messages,
        { role: 'assistant', content: result.text },
        {
          role: 'user',
          content: `Ta reponse precedente n'a pas le champ "axisScores" complet (10 cles requises de "1" a "10", chacune note 1-10 entier). C'est OBLIGATOIRE pour l'auto-evaluation. Regenere le JSON complet avec axisScores valide.`,
        },
      ];
      continue;
    }

    const weakAxes = getWeakAxes(diag.axisScores, threshold);

    if (weakAxes.length === 0) {
      // Top - tout est >= threshold
      return {
        diagnosis: diag,
        attempts,
        weakAxes: [],
        axisScoresSummary: summarizeAxisScores(diag.axisScores),
        usageTotal: totalUsage,
        estimatedCostUsd: +totalCost.toFixed(4),
        thinking: result.thinking,
        model: result.model,
      };
    }

    if (attempts > maxRetries || totalCost > maxCostUsd) {
      // Plus de retry (max attempts ou cost cap), on retourne best effort
      const reason = totalCost > maxCostUsd
        ? `cost cap $${totalCost.toFixed(2)} > $${maxCostUsd}`
        : `max retries ${maxRetries}`;
      console.warn(`[self-eval] stopping (${reason}), weak axes:`, weakAxes.map(a => a.id).join(','));
      return {
        diagnosis: diag,
        attempts,
        weakAxes,
        axisScoresSummary: summarizeAxisScores(diag.axisScores),
        usageTotal: totalUsage,
        estimatedCostUsd: +totalCost.toFixed(4),
        thinking: result.thinking,
        model: result.model,
        warning: `Min axis score: ${Math.min(...weakAxes.map(w => w.score))} (threshold: ${threshold}, stopped: ${reason})`,
      };
    }

    // Prepare regen ciblee
    const weakDescr = weakAxes
      .map(a => `  - Axe ${a.id} ${a.name} (note ${a.score}/10) : ${a.desc}`)
      .join('\n');

    messages = [
      ...messages,
      { role: 'assistant', content: result.text },
      {
        role: 'user',
        content: `Ta reponse a obtenu < ${threshold}/10 sur ces axes :
${weakDescr}

Regenere une nouvelle version qui ATTEINT ${threshold}/10 sur CHAQUE axe faible ci-dessus, ainsi que sur tous les autres axes deja a 10. Ameliorations concretes attendues :

${weakAxes.map(a => regenHintForAxis(a.id)).join('\n')}

Reponds UNIQUEMENT avec le JSON valide selon le schema, sans markdown fences, sans prose autour. Le nouveau axisScores DOIT refleter une vraie amelioration.`,
      },
    ];
  }

  // Safety net : si on sort du loop sans return (cap cout atteint avant 1er retour)
  if (lastDiagnosis) {
    return {
      diagnosis: lastDiagnosis,
      attempts,
      weakAxes: getWeakAxes(lastDiagnosis.axisScores, threshold),
      axisScoresSummary: summarizeAxisScores(lastDiagnosis.axisScores),
      usageTotal: totalUsage,
      estimatedCostUsd: +totalCost.toFixed(4),
      thinking: lastResult?.thinking || '',
      model: lastResult?.model,
      warning: `Cost cap hit at $${totalCost.toFixed(2)}/$${maxCostUsd}`,
    };
  }
  throw new Error('Self-eval: no valid diagnosis produced');
}

// Hints specifiques par axe pour aider Claude a reparer ce qui manque
function regenHintForAxis(axisId) {
  const hints = {
    1: '- Axe 1: Cite des moments precis (round X, tick Y, callout Z, util utilisee, angle peeke). Pas de generalites.',
    2: '- Axe 2: Cite des chiffres pros HLTV reels avec noms (donk, ZywOo, m0NESY, etc.) et delta vs user.',
    3: '- Axe 3: Selectionne uniquement des drillId valides depuis la library. Workshop maps reelles. Metrique chiffree.',
    4: '- Axe 4: Adapte au role detecte (entry/awp/igl/support/lurker/rifler) et au level FACEIT. Drills + pros differents par role.',
    5: '- Axe 5: Top 3 priorites strictement, classees par impact x effort, avec justification quanti.',
    6: '- Axe 6: Cite explicitement des numeros de rounds (R12, R18, R23) avec ce qui s y est passe.',
    7: '- Axe 7: Inclus economy + util usage + map control + tendances opp, pas juste les stats individuelles.',
    8: '- Axe 8: JSON strictement valide. Schema respecte. Aucun champ oublie. additionalProperties: false respecte.',
    9: '- Axe 9: Compare au diag precedent avec deltas chiffres si fourni. Si premier diag, indique-le explicitement (axisScore = 7-8 max c\'est OK).',
    10: '- Axe 10: Chaque insight a un niveau de confidence (high/medium/low) + sampleSize (n d observations). Distingue tendance forte vs premier signal.',
  };
  return hints[axisId] || `- Axe ${axisId}: ameliore-le selon le rubric.`;
}

module.exports = { withSelfEval };
