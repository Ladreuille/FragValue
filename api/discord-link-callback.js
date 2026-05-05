// api/discord-link-callback.js
// Callback OAuth Discord apres que l'user ait autorise le link sur Discord.
// Discord redirect vers ici avec ?code=<authcode>&state=<csrf-state>.
//
// Flow :
//   1. Verify le state (signed HMAC) -> recupere userId Supabase
//   2. Echange le code contre un access_token Discord
//   3. GET /users/@me pour avoir le discord_id, username, global_name, avatar
//   4. Save dans la table discord_links (UPSERT par user_id)
//   5. Si user a un plan actif Pro/Elite, sync le role direct
//   6. Add l'user au guild (s'il n'est pas deja dedans) via guilds.join
//   7. Redirect vers returnUrl?discord=linked
//
// Erreurs : redirect vers returnUrl?discord=error&reason=<code>
//   reasons : state_invalid | state_expired | code_invalid | api_error |
//             config_missing | already_linked_other_user

import { createClient } from '@supabase/supabase-js';
import { verifyState } from './_lib/discord-state.js';
import {
  exchangeOAuthCode,
  getMe,
  addUserToGuild,
  syncUserPlan,
  assignRole,
  DiscordApiError,
} from './_lib/discord.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const publicUrl = process.env.PUBLIC_URL || 'https://fragvalue.com';
  const redirectUri = `${publicUrl}/api/discord-link-callback`;

  // Helper redirect vers le frontend avec status
  const redirectFront = (returnUrl, params) => {
    const safeReturn = (returnUrl || '/account.html').startsWith('/') ? returnUrl : '/account.html';
    const qp = new URLSearchParams(params).toString();
    const sep = safeReturn.includes('?') ? '&' : '?';
    return res.redirect(302, `${safeReturn}${sep}${qp}`);
  };

  // 1. Parse query params
  const { code, state, error: discordErr } = req.query || {};

  // L'user a refuse l'autorisation cote Discord -> Discord renvoie ?error=access_denied
  if (discordErr) {
    return redirectFront('/account.html', { discord: 'denied', reason: String(discordErr).slice(0, 50) });
  }

  if (!code || !state) {
    return redirectFront('/account.html', { discord: 'error', reason: 'missing_params' });
  }

  // 2. Verify le state CSRF
  const stateResult = verifyState(state);
  if (!stateResult.valid) {
    console.warn('[discord-link-callback] state invalid:', stateResult.reason);
    const reason = stateResult.reason.includes('expired') ? 'state_expired' : 'state_invalid';
    return redirectFront('/account.html', { discord: 'error', reason });
  }
  const { userId, returnUrl } = stateResult;

  // 3. Verify env vars critiques
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_BOT_TOKEN) {
    console.error('[discord-link-callback] Discord env vars missing');
    return redirectFront(returnUrl, { discord: 'error', reason: 'config_missing' });
  }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // 4. Echange du code OAuth -> access_token
    let oauthData;
    try {
      oauthData = await exchangeOAuthCode(code, redirectUri);
    } catch (err) {
      console.error('[discord-link-callback] OAuth code exchange failed:', err.message, err.body);
      return redirectFront(returnUrl, { discord: 'error', reason: 'code_invalid' });
    }
    const userAccessToken = oauthData.access_token;

    // 5. Recupere les infos du user Discord
    let discordUser;
    try {
      discordUser = await getMe(userAccessToken);
    } catch (err) {
      console.error('[discord-link-callback] getMe failed:', err.message);
      return redirectFront(returnUrl, { discord: 'error', reason: 'api_error' });
    }

    const discordId = String(discordUser.id);
    const discordUsername = discordUser.global_name || discordUser.username || null;
    const discordAvatar = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png?size=128`
      : null;

    // 6. Verifie que ce discord_id n'est pas deja lie a un AUTRE user FragValue
    // (un meme compte Discord ne peut etre rattache qu'a 1 seul compte FragValue,
    // sinon comportement du sync de role indefini).
    const { data: existingLink } = await supabase
      .from('discord_links')
      .select('user_id')
      .eq('discord_id', discordId)
      .maybeSingle();

    if (existingLink && existingLink.user_id !== userId) {
      console.warn(`[discord-link-callback] discord_id ${discordId} already linked to user ${existingLink.user_id}, requested by ${userId}`);
      return redirectFront(returnUrl, { discord: 'error', reason: 'already_linked_other_user' });
    }

    // 7. UPSERT le link dans discord_links
    const { error: upsertErr } = await supabase
      .from('discord_links')
      .upsert({
        user_id: userId,
        discord_id: discordId,
        discord_username: discordUsername ? discordUsername.slice(0, 100) : null,
        discord_avatar_url: discordAvatar,
        linked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertErr) {
      console.error('[discord-link-callback] DB upsert failed:', upsertErr);
      return redirectFront(returnUrl, { discord: 'error', reason: 'db_error' });
    }

    // 8. Recupere le plan FragValue actuel du user pour assigner le bon role
    // (colonne reelle: subscription_tier dans profiles)
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_tier')
      .eq('id', userId)
      .maybeSingle();
    const plan = profile?.subscription_tier || 'free';

    // 9. Add l'user au guild FragValue s'il n'y est pas deja (scope guilds.join)
    // Best-effort : si fail, on continue quand meme (l'user peut join manuellement)
    try {
      await addUserToGuild(discordId, userAccessToken);
    } catch (err) {
      console.warn('[discord-link-callback] addUserToGuild failed (non-blocking):', err.message);
    }

    // 10. Sync le role en fonction du plan FragValue
    try {
      const sync = await syncUserPlan(discordId, plan);
      console.log(`[discord-link-callback] synced ${userId} -> Discord ${discordId} (plan ${plan}):`, sync);
    } catch (err) {
      console.warn('[discord-link-callback] syncUserPlan failed (non-blocking):', err.message);
    }

    // 10b. Si on a un role @Early configure (DISCORD_ROLE_ID_EARLY), on l'assigne
    // a tous les nouveaux liens jusqu'a ce que la var soit retiree (= permet
    // de couper la fenetre "early" quand le serveur grossit). Best-effort.
    const roleEarly = process.env.DISCORD_ROLE_ID_EARLY;
    if (roleEarly) {
      try {
        await assignRole(discordId, roleEarly);
        console.log(`[discord-link-callback] assigned @Early to ${discordId}`);
      } catch (err) {
        console.warn('[discord-link-callback] assignRole @Early failed (non-blocking):', err.message);
      }
    }

    // 11. Redirect vers le front avec status linked
    return redirectFront(returnUrl, {
      discord: 'linked',
      username: discordUsername || '',
    });
  } catch (err) {
    console.error('[discord-link-callback] unexpected error:', err);
    const reason = err instanceof DiscordApiError ? 'api_error' : 'server_error';
    return redirectFront(returnUrl, { discord: 'error', reason });
  }
}
