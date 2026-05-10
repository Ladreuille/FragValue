// api/_lib/diagnostic-rubric.js · FragValue
// Rubric de qualite a 10 axes pour les diagnostics IA Coach.
// Schema JSON output strict + prompt instructions pour forcer Claude
// a produire du 10/10 sur tous les axes (axe 8 = structure output).
//
// Les 10 axes (cf. discussion produit avec Quentin) :
//   1.  Specificite tactique
//   2.  Ancrage benchmark pro
//   3.  Actionnabilite drills
//   4.  Personnalisation role/level
//   5.  Hierarchisation (top 3 priorites)
//   6.  Granularite round-by-round
//   7.  Multi-modal (eco + util + map control + tendances)
//   8.  Structure output (JSON valide)
//   9.  Suivi progression (vs diag precedent)
//   10. Calibration confiance
//
// Usage :
//   const { buildRubricInstructions, buildJsonSchema } = require('./_lib/diagnostic-rubric');

const RUBRIC_AXES = [
  { id: 1,  name: 'Specificite tactique',     short: 'specificity',  desc: 'Diagnostic ancre dans des moments precis (round X tick Y callout Z) avec details operationnels (angle, timing, util utilisee)' },
  { id: 2,  name: 'Ancrage benchmark pro',    short: 'pro_anchor',   desc: 'Compare aux benchmarks pros (HLTV/top FACEIT) sur la meme map/situation avec chiffres reels et noms reels' },
  { id: 3,  name: 'Actionnabilite drills',    short: 'drills',       desc: 'Drills concrets avec workshop map reel, duree, metrique chiffree de validation. Pas de "fais du DM"' },
  { id: 4,  name: 'Personnalisation role',    short: 'personal',     desc: 'Adapte au role detecte (entry/awp/igl/support/lurker/rifler) et level FACEIT du joueur' },
  { id: 5,  name: 'Hierarchisation',          short: 'hierarchy',    desc: 'Top 3 priorites classees par impact x effort, avec justification quanti chiffree' },
  { id: 6,  name: 'Granularite round-by-round', short: 'rounds',     desc: 'Reference des rounds specifiques (R12, R18) avec timestamps et decisions cles, pas juste agrege' },
  { id: 7,  name: 'Multi-modal',              short: 'multimodal',   desc: 'Inclut economie, momentum (clutch/multi), util usage, map control, tendances opp - pas juste les stats individuelles' },
  { id: 8,  name: 'Structure output',         short: 'structure',    desc: 'JSON valide selon schema strict, sections claires, pas de prose hors champs' },
  { id: 9,  name: 'Suivi progression',        short: 'progress',     desc: 'Compare au diag precedent (delta KAST, Flash Eff, Trade death) si dispo. Si 1er diag = noter qu\'il n\'y a pas encore d\'historique' },
  { id: 10, name: 'Calibration confiance',    short: 'confidence',   desc: 'Chaque insight declare son niveau de conf (high/medium/low) + n d\'observations. "On a haute conf sur X (n=147), faible sur Y (n=12)"' },
];

// Instruction principale a injecter dans le system prompt
function buildRubricInstructions() {
  const lines = RUBRIC_AXES.map(a => `${a.id}. ${a.name} : ${a.desc}`);
  return `RUBRIC DE QUALITE COACH IA — chaque axe est NOTE 1 a 10 :
${lines.join('\n')}

REGLES STRICTES :
- Tu DOIS noter ta propre reponse dans le champ "axisScores" (1-10 sur chaque axe)
- Vise 10/10 sur TOUS les axes
- Si tu ne peux pas atteindre 10 sur un axe (ex: pas d'historique pour axe 9), explique-le dans le champ "axisNotes" du JSON
- Si tu fais 8 ou moins sur un axe, RETRAVAILLE la reponse avant de finaliser
- L'axe 8 (Structure) doit etre 10 OBLIGATOIREMENT (JSON valide, schema respecte)`;
}

// Schema JSON commun pour tous les endpoints. Adaptable via extraFields.
function buildJsonSchema(opts = {}) {
  const {
    requireProgressTracking = false, // true si on a un previousDiag a comparer
    extraRequired = [],
    extraProperties = {},
  } = opts;

  const baseRequired = [
    'topPriorities',
    'strengths',
    'deepDive',
    'drills',
    'proRefs',
    'summary',
    'axisScores',
    'axisNotes',
    'confidence',
    ...extraRequired,
  ];
  if (requireProgressTracking) baseRequired.push('progressTracking');

  return {
    type: 'object',
    additionalProperties: false,
    required: baseRequired,
    properties: {
      strengths: {
        type: 'array',
        minItems: 2, maxItems: 5,
        description: 'Points forts du joueur (chiffres + comparaison benchmark). Affiche dans l\'UI legacy.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['axis', 'evidence', 'vsBenchmark'],
          properties: {
            axis: { type: 'string' },
            evidence: { type: 'string', description: 'Stat chiffree' },
            vsBenchmark: { type: 'string', description: 'Comparaison benchmark tier ou pro' },
          },
        },
      },
      topPriorities: {
        type: 'array',
        minItems: 3, maxItems: 3,
        description: 'Top 3 priorites classees par impact x effort (axe 5)',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rank', 'axis', 'problem', 'impact', 'evidence', 'confidence', 'sampleSize'],
          properties: {
            rank: { type: 'integer', minimum: 1, maximum: 3 },
            axis: {
              type: 'string',
              enum: ['aim', 'crosshair', 'spray', 'utility', 'positioning', 'gamesense', 'economy', 'mental', 'movement', 'comms', 'reaction'],
            },
            problem: { type: 'string', description: 'Diagnostic precis avec chiffres' },
            impact: { type: 'string', description: 'Pourquoi cette priorite : ROI estime ELO/winrate' },
            evidence: { type: 'string', description: 'Round/tick/stat citee (axe 6)' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            sampleSize: { type: 'integer', description: 'n d observations (axe 10)' },
          },
        },
      },
      deepDive: {
        type: 'array',
        minItems: 2, maxItems: 5,
        description: 'Analyses profondes par axe avec round refs (axe 1, 6)',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['axis', 'observation', 'proComparison', 'roundRefs'],
          properties: {
            axis: { type: 'string' },
            observation: { type: 'string' },
            proComparison: {
              type: 'string',
              description: 'Reference HLTV avec chiffres reels (axe 2). Ex: "donk fait 92 ADR sur Inferno T, toi 71 (delta -23%)"',
            },
            roundRefs: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Numeros de rounds cites en exemple',
            },
          },
        },
      },
      drills: {
        type: 'array',
        minItems: 3, maxItems: 5,
        description: 'Drills selectionnes depuis la library (axe 3)',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['drillId', 'reason', 'targetMetric'],
          properties: {
            drillId: {
              type: 'string',
              description: 'ID exact du drill dans la library (cf. liste fournie)',
            },
            reason: { type: 'string', description: 'Pourquoi ce drill pour CE joueur' },
            targetMetric: {
              type: 'string',
              description: 'Metrique chiffree a atteindre apres N matchs',
            },
          },
        },
      },
      proRefs: {
        type: 'array',
        minItems: 1, maxItems: 3,
        description: 'Pros similaires en style/role (axe 2, 4)',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['proName', 'team', 'similarity', 'why'],
          properties: {
            proName: { type: 'string', description: 'Nom reel pro 2026' },
            team: { type: 'string' },
            similarity: { type: 'string', enum: ['style', 'role', 'stats'] },
            why: { type: 'string' },
          },
        },
      },
      progressTracking: {
        type: ['object', 'null'],
        additionalProperties: false,
        description: 'Comparaison vs diag precedent (axe 9). Null si premier diag.',
        properties: {
          previousDiagDate: { type: ['string', 'null'] },
          deltas: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['metric', 'before', 'after', 'delta', 'verdict'],
              properties: {
                metric: { type: 'string' },
                before: { type: ['number', 'string'] },
                after: { type: ['number', 'string'] },
                delta: { type: ['number', 'string'] },
                verdict: { type: 'string', enum: ['improved', 'regressed', 'stable'] },
              },
            },
          },
          notes: { type: 'string' },
        },
      },
      summary: {
        type: 'string',
        maxLength: 800,
        description: 'Resume 2-3 phrases · style HLTV direct · cite top priorite',
      },
      axisScores: {
        type: 'object',
        additionalProperties: false,
        description: 'Auto-evaluation 1-10 sur les 10 axes du rubric (axe 8)',
        required: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        properties: {
          1:  { type: 'integer', minimum: 1, maximum: 10 },
          2:  { type: 'integer', minimum: 1, maximum: 10 },
          3:  { type: 'integer', minimum: 1, maximum: 10 },
          4:  { type: 'integer', minimum: 1, maximum: 10 },
          5:  { type: 'integer', minimum: 1, maximum: 10 },
          6:  { type: 'integer', minimum: 1, maximum: 10 },
          7:  { type: 'integer', minimum: 1, maximum: 10 },
          8:  { type: 'integer', minimum: 1, maximum: 10 },
          9:  { type: 'integer', minimum: 1, maximum: 10 },
          10: { type: 'integer', minimum: 1, maximum: 10 },
        },
      },
      axisNotes: {
        type: 'string',
        description: 'Justification courte des notes < 10 (ex: "axe 9 = 5 car premier diag, pas d historique")',
      },
      confidence: {
        type: 'number',
        minimum: 0, maximum: 1,
        description: 'Confiance globale dans le diagnostic [0-1] (axe 10)',
      },
      ...extraProperties,
    },
  };
}

// Extrait les axes faibles (< threshold) pour la regen ciblee
function getWeakAxes(axisScores, threshold = 10) {
  if (!axisScores) return [];
  return Object.entries(axisScores)
    .filter(([, score]) => score < threshold)
    .map(([id, score]) => {
      const axis = RUBRIC_AXES.find(a => a.id === parseInt(id, 10));
      return {
        id: parseInt(id, 10),
        score,
        name: axis?.name || `Axe ${id}`,
        desc: axis?.desc || '',
      };
    });
}

// Calcul moyenne et min des notes
function summarizeAxisScores(axisScores) {
  if (!axisScores) return { avg: null, min: null, max: null };
  const values = Object.values(axisScores).map(Number).filter(n => !isNaN(n));
  if (!values.length) return { avg: null, min: null, max: null };
  return {
    avg: +(values.reduce((s, v) => s + v, 0) / values.length).toFixed(1),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

module.exports = {
  RUBRIC_AXES,
  buildRubricInstructions,
  buildJsonSchema,
  getWeakAxes,
  summarizeAxisScores,
};
