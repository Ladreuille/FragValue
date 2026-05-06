// api/_lib/cors.js
//
// Source unique pour la regex de validation CORS et le helper setCors.
//
// Avant : 53 routes API dupliquaient la meme regex et le meme bloc setCors,
// avec des micro-divergences sur les Methods autorises. Tout changement de
// domaine (ex : ajout d'un sous-domaine, retrait d'un staging) impliquait
// 53 edits avec risque d'oubli. Maintenant la regex vit ici.
//
// Usage CJS (la majorite des routes _lib utilisent CommonJS) :
//   const { setCors, ALLOWED_ORIGIN_RE } = require('./_lib/cors');
//   ...
//   setCors(req, res, 'GET, POST, OPTIONS');
//
// Usage ESM (routes admin qui utilisent import) :
//   import { setCors, ALLOWED_ORIGIN_RE } from './_lib/cors.js';
//
// Migration progressive : les fichiers existants gardent leur regex inline
// jusqu'a ce qu'ils soient touches. Un nouveau fichier doit utiliser ce helper.

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

// methods : chaine 'GET, POST, OPTIONS' (varie selon la route).
// Par defaut on autorise tout ce qui est commun. A specifier explicitement
// pour les routes qui ne prennent qu'une methode (ex: 'POST, OPTIONS' sur
// les webhooks Stripe / Discord, 'GET, OPTIONS' sur les endpoints lecture seule).
function setCors(req, res, methods = 'GET, POST, OPTIONS') {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = { ALLOWED_ORIGIN_RE, setCors };
