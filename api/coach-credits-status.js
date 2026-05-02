// api/coach-credits-status.js · FragValue · GET /api/coach-credits-status
//
// Retourne le solde de credits Coach IA + les packs disponibles a l'achat.
// Utilise par le frontend (analysis.html) pour afficher un compteur + UI achat.
//
// AUTH : require Pro ou Elite (Free n'a pas acces au Coach IA donc pas besoin).
// CACHE : pas de cache (le solde change souvent), Cache-Control no-store.

const { createClient } = require('@supabase/supabase-js');
const { requirePro } = require('./_lib/subscription');
const { getCreditsStatus } = require('./_lib/coach-credits');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  return _sb;
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Plan check : Pro ou Elite
  const gate = await requirePro(req, res);
  if (!gate) return;
  const { user, plan } = gate;

  try {
    const supabase = sb();
    const status = await getCreditsStatus(supabase, user.id);
    return res.status(200).json({ ...status, plan });
  } catch (e) {
    console.error('[coach-credits-status] error:', e.message);
    return res.status(500).json({ error: 'Erreur lecture credits', hint: e.message?.slice(0, 100) });
  }
};
