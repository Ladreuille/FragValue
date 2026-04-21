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
