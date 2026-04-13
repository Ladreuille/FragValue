// api/faceit-profile.js — FragValue
// Proxy pour recuperer le profil FACEIT public d'un joueur via FACEIT_API_KEY
// Evite d'exposer la cle API cote client

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const nickname = req.query.nickname;
  if (!nickname) return res.status(400).json({ error: 'nickname requis' });

  const apiKey = process.env.FACEIT_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'FACEIT_API_KEY non configure' });

  try {
    const r = await fetch(
      `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}&game=cs2`,
      { headers: { 'Authorization': `Bearer ${apiKey}` } }
    );
    if (!r.ok) return res.status(r.status).json({ error: 'Joueur non trouve' });
    const data = await r.json();

    return res.status(200).json({
      nickname: data.nickname,
      avatar: data.avatar,
      country: data.country,
      elo: data.games?.cs2?.faceit_elo || null,
      level: data.games?.cs2?.skill_level || null,
    });
  } catch (e) {
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
