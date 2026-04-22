// api/errors.js // FragValue
// Endpoint d'ingestion des erreurs client + server.
// POST /api/errors
// Body : { source, level?, message, stack?, url?, route?, user_agent?, extra? }
//
// - Auth : optionnelle. Si Bearer token fourni et valide, on attache user_id.
//   Sinon insert anonyme (erreurs sur pages publiques comptent aussi).
// - Rate limit : 20 inserts / 5 min par IP pour eviter le spam d'erreurs.
// - Fingerprint : hash message+route pour grouper les doublons cote admin.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

// Rate limit en memoire (par instance serverless, best-effort)
const _rateMap = new Map();
const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT = 20;

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(ip) {
  const now = Date.now();
  const arr = (_rateMap.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) return false;
  arr.push(now);
  _rateMap.set(ip, arr);
  return true;
}

function makeFingerprint(message, route) {
  // Hash stable pour grouper les erreurs identiques
  const h = crypto.createHash('sha1');
  h.update(String(message || '').slice(0, 200));
  h.update('|');
  h.update(String(route || ''));
  return h.digest('hex').slice(0, 16);
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'DB non configuree' });
  }

  // Rate limit par IP
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit (max 20/5min)' });
  }

  try {
    const body = req.body || {};
    const source  = String(body.source || 'client').slice(0, 20);
    const level   = String(body.level   || 'error').slice(0, 20);
    const message = String(body.message || '').slice(0, 2000);
    if (!message) return res.status(400).json({ error: 'message requis' });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Auth optionnelle : attacher user_id si token valide
    let userId = null;
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      try {
        const { data: { user } } = await supabase.auth.getUser(auth.replace('Bearer ', ''));
        if (user) userId = user.id;
      } catch {}
    }

    const route = String(body.route || '').slice(0, 200);
    const fingerprint = makeFingerprint(message, route);

    const { error } = await supabase.from('error_logs').insert({
      source,
      level,
      message,
      stack:       body.stack      ? String(body.stack).slice(0, 5000) : null,
      url:         body.url        ? String(body.url).slice(0, 500)    : null,
      user_agent:  body.user_agent ? String(body.user_agent).slice(0, 300) : (req.headers['user-agent'] || '').slice(0, 300),
      route,
      user_id:     userId,
      extra:       body.extra      || null,
      fingerprint,
    });

    if (error) {
      console.error('[errors.js] insert failed:', error.message);
      return res.status(500).json({ error: 'Insert failed' });
    }

    return res.status(200).json({ ok: true, fingerprint });
  } catch (err) {
    console.error('[errors.js] unexpected:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
