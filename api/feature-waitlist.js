// api/feature-waitlist.js
// Endpoint waitlist par feature (lineup-library, pro-demos, pro-benchmarks,
// prep-veto, anti-strat).
//
// GET  /api/feature-waitlist?feature=<slug>
//   -> { total, hasInterest (si auth), unlocked (false pour l'instant) }
//
// POST /api/feature-waitlist
//   body: { feature: '<slug>' }
//   -> { total, hasInterest: true }
//
// Auth optionnelle : si l'user est connecte, son interest est lie a son user_id.
// Sinon, on dedup sur anon_id = hash(ip + user-agent).

const { createClient } = require('@supabase/supabase-js');
const { createHash } = require('node:crypto');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const ALLOWED_SLUGS = new Set([
  'lineup-library',
  'pro-demos',
  'pro-benchmarks',
  'prep-veto',
  'anti-strat',
  // pro-launch : waitlist pendant que Stripe Live n'est pas encore active
  // (en attente du SIRET). Une fois live, on supprime ce slug et on remet
  // les boutons checkout sur pricing.html.
  'pro-launch',
]);

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function anonIdFromReq(req) {
  const fwd = req.headers['x-forwarded-for'] || '';
  const ip = String(fwd).split(',')[0].trim() || req.socket?.remoteAddress || '';
  const ua = req.headers['user-agent'] || '';
  return createHash('sha256').update(ip + '|' + ua).digest('hex').slice(0, 32);
}

async function getUser(authHeader) {
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await sb().auth.getUser(token);
  return data?.user || null;
}

async function countFor(feature) {
  // RPC SECURITY DEFINER (remplace l'ancienne view feature_interests_counts).
  // Retourne un array de rows (potentiellement vide si feature pas en DB).
  const { data } = await sb().rpc('feature_interest_counts', { slug: feature });
  return Number(data?.[0]?.total) || 0;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const feature = (req.method === 'GET' ? req.query?.feature : (await readBody(req)).feature) || '';
    if (!ALLOWED_SLUGS.has(feature)) {
      return res.status(400).json({ error: 'Feature slug inconnu' });
    }

    const user = await getUser(req.headers.authorization);
    const anonId = user ? null : anonIdFromReq(req);

    // GET : read total + hasInterest
    if (req.method === 'GET') {
      const total = await countFor(feature);
      let hasInterest = false;
      if (user) {
        const { data } = await sb()
          .from('feature_interests')
          .select('id')
          .eq('feature_slug', feature)
          .eq('user_id', user.id)
          .maybeSingle();
        hasInterest = !!data;
      } else if (anonId) {
        const { data } = await sb()
          .from('feature_interests')
          .select('id')
          .eq('feature_slug', feature)
          .is('user_id', null)
          .eq('anon_id', anonId)
          .maybeSingle();
        hasInterest = !!data;
      }
      return res.status(200).json({ total, hasInterest, unlocked: false });
    }

    // POST : insert idempotent (si deja inscrit, on retourne juste le total)
    if (req.method === 'POST') {
      const row = user
        ? { feature_slug: feature, user_id: user.id }
        : { feature_slug: feature, anon_id: anonId };
      const { error } = await sb().from('feature_interests').insert(row);
      // 23505 = unique_violation PostgreSQL (deja inscrit) -> idempotent
      if (error && error.code !== '23505' && !/duplicate|unique/i.test(error.message)) {
        console.error('feature-waitlist insert error', error);
        return res.status(500).json({ error: 'Impossible d\'enregistrer' });
      }
      const total = await countFor(feature);
      return res.status(200).json({ total, hasInterest: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('feature-waitlist handler error', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
