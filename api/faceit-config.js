// api/faceit-config.js - FragValue
// Returns the public FACEIT OAuth client ID (safe to expose, it's a public value)

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.FACEIT_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'FACEIT_CLIENT_ID non configure sur Vercel' });
  }

  return res.status(200).json({ client_id: clientId });
}
