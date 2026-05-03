// api/parse.js - FragValue
// Proxy vers le parser Railway pour masquer l'URL backend
// Transmet le fichier .dem et retourne le resultat du parsing

export const config = {
  api: {
    bodyParser: false, // On forward le multipart tel quel
  },
};

export default async function handler(req, res) {
  // CORS multi-origin : prod (fragvalue.com) + alias/previews Vercel + dev local
  const ALLOWED_ORIGIN_RE = /^(https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)|http:\/\/localhost:(3456|5500))$/;
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const PARSER_URL = process.env.PARSER_URL || 'https://fragvalue-demo-parser-production.up.railway.app';

  // Handle /ping as a simple GET proxy
  if (req.method === 'GET') {
    try {
      const pingRes = await fetch(`${PARSER_URL}/ping`);
      const text = await pingRes.text();
      return res.status(pingRes.status).send(text);
    } catch {
      return res.status(502).json({ error: 'Parser indisponible' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // AUTH (cf. ultrareview P1.7) : avant le proxy etait OUVERT a tout le monde,
  // un attaquant pouvait forwarder du trafic illimite vers Railway et grill le
  // quota / faire payer la bande passante. Maintenant : exiger un Bearer JWT
  // Supabase valide. La parse est une feature payante donc auth obligatoire.
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentification requise' });
  }
  const token = authHeader.slice(7).trim();
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data: userData, error: userErr } = await sb.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: 'Token invalide' });
    }

    // Rate-limit basique : max 10 parses/heure par user (anti-burst).
    // Stocke en memoire process (par instance Vercel = best-effort, pas precis
    // mais suffit pour bloquer un script qui balance 100 demos/min).
    if (!global.__parseRateLimit) global.__parseRateLimit = new Map();
    const now = Date.now();
    const userKey = userData.user.id;
    const userHits = (global.__parseRateLimit.get(userKey) || []).filter(t => now - t < 3600000);
    if (userHits.length >= 10) {
      return res.status(429).json({
        error: 'Trop de parses cette heure (max 10/h). Reviens dans une heure.',
        retry_after: 3600,
      });
    }
    userHits.push(now);
    global.__parseRateLimit.set(userKey, userHits);
    // Cleanup memoire (max 1000 entries)
    if (global.__parseRateLimit.size > 1000) {
      const oldest = [...global.__parseRateLimit.entries()].sort((a, b) => (a[1][0] || 0) - (b[1][0] || 0))[0];
      if (oldest) global.__parseRateLimit.delete(oldest[0]);
    }
  } catch (e) {
    console.error('[parse] auth check failed:', e.message);
    return res.status(500).json({ error: 'Erreur auth' });
  }

  try {
    // Collect raw body from request
    const chunks = [];
    for await (const chunk of req) { chunks.push(chunk); }
    const body = Buffer.concat(chunks);

    // Forward to Railway parser
    const proxyRes = await fetch(`${PARSER_URL}/parse`, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers['content-type'],
        'Content-Length': body.length.toString(),
      },
      body,
    });

    const contentType = proxyRes.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', contentType);
    res.status(proxyRes.status);

    const data = await proxyRes.arrayBuffer();
    res.send(Buffer.from(data));

  } catch (err) {
    console.error('Parser proxy error:', err);
    res.status(502).json({ error: 'Parser indisponible' });
  }
}
