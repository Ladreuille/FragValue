// api/faceit-auth.js — FragValue
// Échange le code OAuth FACEIT contre un token et récupère le profil
// Le Client Secret ne quitte jamais le serveur

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://frag-value.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, code_verifier } = req.body;
  const redirect_uri = 'https://frag-value.vercel.app/faceit-callback.html';
  if (!code) return res.status(400).json({ error: 'Code manquant' });

  const CLIENT_ID     = process.env.FACEIT_CLIENT_ID;
  const CLIENT_SECRET = process.env.FACEIT_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({ error: 'Configuration OAuth manquante' });
  }

  try {
    // ── Étape 1 : Échange du code contre un access token ─────────────────
    const tokenRes = await fetch('https://api.faceit.com/auth/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // PKCE flow: no client_secret in header, use Basic auth only if secret available
        ...(CLIENT_SECRET ? { 'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64') } : {}),
      },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri,
        client_id:     CLIENT_ID,
        ...(code_verifier ? { code_verifier } : {}),
      }).toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('Token error:', err);
      return res.status(400).json({ error: 'Échange de token échoué' });
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // ── Étape 2 : Récupère le profil FACEIT ───────────────────────────────
    const profileRes = await fetch('https://api.faceit.com/auth/v1/resources/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!profileRes.ok) {
      return res.status(400).json({ error: 'Récupération du profil échouée' });
    }

    const profile = await profileRes.json();

    // ── Étape 3 : Récupère les stats CS2 via l'API FACEIT ─────────────────
    const nickname = profile.nickname;
    let faceitStats = null;

    if (nickname) {
      try {
        const statsRes = await fetch(
          `https://open.faceit.com/data/v4/players?nickname=${encodeURIComponent(nickname)}&game=cs2`,
          { headers: { 'Authorization': `Bearer ${process.env.FACEIT_API_KEY}` } }
        );
        if (statsRes.ok) faceitStats = await statsRes.json();
      } catch(e) {
        // Stats non critiques — on continue sans
      }
    }

    // ── Retourne les données utiles ────────────────────────────────────────
    return res.status(200).json({
      success:  true,
      nickname: profile.nickname,
      playerId: profile.guid || profile.sub,
      email:    profile.email,
      country:  profile.country,
      avatar:   profile.picture,
      elo:      faceitStats?.games?.cs2?.faceit_elo || null,
      level:    faceitStats?.games?.cs2?.skill_level || null,
    });

  } catch (err) {
    console.error('FACEIT OAuth error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
