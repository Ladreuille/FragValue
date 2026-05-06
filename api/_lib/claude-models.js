// api/_lib/claude-models.js
//
// Source unique des IDs de modeles Claude utilises par FragValue.
//
// Pourquoi : avant, chaque route declarait son propre `const CLAUDE_MODEL = '...'`
// et plusieurs fichiers utilisaient le meme nom de constante pour des modeles
// differents (sonnet vs haiku). Resultat : migration de version eclatee, oublis
// possibles. Maintenant tout converge ici.
//
// Convention :
// - COACH = Sonnet (heavy lift : conversation longue, raisonnement complexe).
// - FAST  = Haiku (taches utilitaires : Q&A courts, classifications, summaries).
//
// Pour migrer un model : changer la valeur ici, redeployer. Cf. ai-roadmap.js
// qui utilise les deux selon le plan user (Free=FAST, Pro=COACH).

const COACH = 'claude-sonnet-4-5';
const FAST  = 'claude-haiku-4-5';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

module.exports = { COACH, FAST, ENDPOINT };
