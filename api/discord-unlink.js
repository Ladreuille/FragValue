// api/discord-unlink.js · FragValue
//
// Unlink Discord pour l'user courant. Avant : le front faisait
// `sb.from('discord_links').delete()` direct via RLS. Probleme :
//   1. Le role Pro/Elite cote serveur Discord n'etait jamais retire ->
//      l'user gardait son acces aux channels privies meme apres unlink
//   2. Pas de log audit ni de tracking analytics
//   3. Pas de cleanup metadata (avatar_url, etc.)
//
// Maintenant : endpoint serveur qui fait :
//   1. Verifie auth user
//   2. Recupere le discord_id de la row a supprimer
//   3. (Best-effort) Retire le role Pro/Elite du user sur le guild Discord
//      via Discord Bot API (DISCORD_BOT_TOKEN env required)
//   4. DELETE la row discord_links
//
// Auth : Bearer JWT Supabase obligatoire.

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Authentification requise' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  try {
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    // 1. Lookup la row discord_links pour cet user
    const { data: link } = await sb
      .from('discord_links')
      .select('discord_id, discord_username')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!link?.discord_id) {
      return res.status(404).json({ error: 'Aucun compte Discord lié' });
    }

    // 2. Best-effort : retirer les roles Pro/Elite cote serveur Discord
    //    (necessite DISCORD_BOT_TOKEN + DISCORD_GUILD_ID + DISCORD_ROLE_PRO_ID
    //     et DISCORD_ROLE_ELITE_ID en env vars). Non-blocking si pas configure.
    const guildId  = process.env.DISCORD_GUILD_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const rolePro   = process.env.DISCORD_ROLE_PRO_ID;
    const roleElite = process.env.DISCORD_ROLE_ELITE_ID;

    if (guildId && botToken && (rolePro || roleElite)) {
      try {
        // On retire les 2 roles potentiels (si non present, Discord renvoie
        // 204 silent). Cleaner que de checker quel role l'user avait avant.
        for (const roleId of [rolePro, roleElite].filter(Boolean)) {
          await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${link.discord_id}/roles/${roleId}`, {
            method: 'DELETE',
            headers: { Authorization: 'Bot ' + botToken },
          });
        }
      } catch (e) {
        // Non-blocking : log mais continue le unlink DB.
        console.warn('[discord-unlink] role removal failed (non-blocking):', e?.message);
      }
    }

    // 3. DELETE la row discord_links
    const { error: delErr } = await sb
      .from('discord_links')
      .delete()
      .eq('user_id', user.id);
    if (delErr) {
      console.error('[discord-unlink] DB delete failed:', delErr.message);
      return res.status(500).json({ error: 'Erreur DB : ' + delErr.message });
    }

    return res.status(200).json({
      ok: true,
      unlinked: link.discord_username || link.discord_id,
    });
  } catch (err) {
    console.error('[discord-unlink] error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
