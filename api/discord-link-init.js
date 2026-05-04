// api/discord-link-init.js
// Lance le flow OAuth Discord pour link le compte FragValue d'un user a son
// compte Discord.
//
// Auth : JWT Supabase (le user doit etre logge sur fragvalue.com).
// Flow :
//   1. User logge clique "Link Discord" sur /account.html
//   2. Le front POST ici avec son JWT
//   3. On genere un state CSRF signe contenant son userId
//   4. On retourne l'URL OAuth Discord vers laquelle rediriger
//   5. Le front redirect le user vers Discord
//   6. Discord renvoie sur /api/discord-link-callback avec ?code= + ?state=
//
// Scopes demandes :
//   - identify   : pour avoir l'user.id Discord
//   - guilds.join : pour pouvoir add l'user au serveur FragValue meme s'il
//                   n'est pas deja dedans (au moment du callback).

import { createClient } from '@supabase/supabase-js';
import { makeState } from './_lib/discord-state.js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return res.status(503).json({ error: 'DISCORD_CLIENT_ID not configured' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authentification requise' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    // returnUrl optionnel (par defaut /account.html). Permet de revenir vers
    // une autre page apres link (genre /demo.html si link initie depuis la-bas).
    const body = req.body || {};
    const returnUrl = String(body.returnUrl || '/account.html').slice(0, 200);
    if (!returnUrl.startsWith('/')) {
      return res.status(400).json({ error: 'returnUrl must be a relative path starting with /' });
    }

    const state = makeState(user.id, returnUrl);

    // Construit l'URL OAuth Discord
    const publicUrl = process.env.PUBLIC_URL || 'https://fragvalue.com';
    const redirectUri = `${publicUrl}/api/discord-link-callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'identify guilds.join',
      state,
      prompt: 'consent', // force consent screen meme si user a deja autorise
    });
    const oauthUrl = `https://discord.com/api/oauth2/authorize?${params.toString()}`;

    return res.status(200).json({ ok: true, oauthUrl });
  } catch (err) {
    console.error('[discord-link-init] error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
