// api/faceit-auth.js - FragValue
// Echange le code OAuth FACEIT contre un token, recupere le profil,
// et cree/connecte automatiquement le compte Supabase
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// CORS : autorise prod (fragvalue.com) + toutes les URLs Vercel du projet
// (frag-value.vercel.app + previews). Pattern-match pour ne pas lister chaque
// preview manuellement.
function allowedOrigin(reqOrigin) {
  if (!reqOrigin) return null;
  if (reqOrigin === 'https://fragvalue.com') return reqOrigin;
  if (reqOrigin === 'https://www.fragvalue.com') return reqOrigin;
  if (/^https:\/\/frag-value(-[a-z0-9]+)*(-qdreuillet-9752s-projects)?\.vercel\.app$/.test(reqOrigin)) return reqOrigin;
  return null;
}

export default async function handler(req, res) {
  // CORS
  const origin = allowedOrigin(req.headers.origin);
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, code_verifier, redirect_uri: clientRedirectUri } = req.body;
  if (!code) return res.status(400).json({ error: 'Code manquant' });

  // Le redirect_uri envoye a FACEIT pour l'echange DOIT correspondre EXACTEMENT
  // a celui utilise lors de la requete d'autorisation initiale. Le client nous
  // le passe pour supporter prod (fragvalue.com) et preview (frag-value.vercel.app)
  // avec le meme code. On valide qu'il pointe bien sur un /faceit-callback.html
  // d'une origine autorisee pour eviter l'open redirect.
  let redirect_uri = clientRedirectUri || '';
  if (!redirect_uri.endsWith('/faceit-callback.html') || !allowedOrigin(redirect_uri.replace(/\/faceit-callback\.html$/, ''))) {
    // Fallback : utilise l'origine de la requete si le client n'a rien envoye
    const reqOrigin = req.headers.origin && allowedOrigin(req.headers.origin);
    if (reqOrigin) redirect_uri = reqOrigin + '/faceit-callback.html';
    else return res.status(400).json({ error: 'redirect_uri invalide' });
  }

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
        // Stats non critiques - on continue sans
      }
    }

    // -- Auto-login Supabase : creer le compte si besoin + generer un token --
    let sessionToken = null;
    const faceitEmail = profile.email;

    if (faceitEmail) {
      try {
        // Creer l'utilisateur s'il n'existe pas (ignore l'erreur si deja existant)
        await supabaseAdmin.auth.admin.createUser({
          email: faceitEmail,
          email_confirm: true,
          user_metadata: { faceit_nickname: profile.nickname },
        });
      } catch (_) {}

      try {
        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email: faceitEmail,
        });
        sessionToken = linkData?.properties?.hashed_token || null;
      } catch (e) {
        console.warn('generateLink error:', e.message);
      }
    }

    // -- Retourne les donnees utiles + token de session --
    return res.status(200).json({
      success:  true,
      nickname: profile.nickname,
      playerId: profile.guid || profile.sub,
      email:    faceitEmail,
      country:  profile.country,
      avatar:   profile.picture,
      elo:      faceitStats?.games?.cs2?.faceit_elo || null,
      level:    faceitStats?.games?.cs2?.skill_level || null,
      sessionToken,
    });

  } catch (err) {
    console.error('FACEIT OAuth error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
