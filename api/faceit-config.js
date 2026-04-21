// api/faceit-config.js - FragValue
// Returns the public FACEIT OAuth client ID (safe to expose, it's a public value)

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.FACEIT_CLIENT_ID;
  if (!clientId) {
    return res.status(503).json({ error: 'FACEIT_CLIENT_ID non configure sur Vercel' });
  }

  return res.status(200).json({ client_id: clientId });
}
