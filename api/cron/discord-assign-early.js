// api/cron/discord-assign-early.js
//
// Assigne le role @Early aux membres du guild Discord FragValue qui ne l'ont
// pas encore. Couvre le cas des users qui rejoignent via le lien d'invitation
// direct (discord.gg/fragvalue) sans passer par le flow OAuth FragValue.
//
// Pourquoi un cron et pas un event listener :
//   - Discord ne supporte pas de webhook HTTP pour GUILD_MEMBER_ADD
//   - Seul le Gateway (WebSocket persistant) recoit cet event
//   - Vercel = serverless = pas de WebSocket persistent possible
//   - Cron toutes les 5 min = max 5 min de delai pour assigner @Early = OK
//
// Logique :
//   1. List tous les membres du guild (paginates par batch de 1000)
//   2. Pour chaque membre qui n'a PAS le role @Early dans son `roles[]` :
//      assign role
//   3. Idempotent : safe a re-run, fait rien si tout est deja synchro
//
// Conditions d'arret automatique :
//   - Si DISCORD_ROLE_ID_EARLY n'est plus configure dans env -> early-window est
//     fermee, le cron ne fait rien et retourne 200 immediatement.
//   - Pour fermer la fenetre Early : delete la var d'env Vercel + redeploy.
//     Les anciens membres gardent leur role, les nouveaux n'en auront plus.
//
// Auth : requiert le header `Authorization: Bearer <CRON_SECRET>` (Vercel cron)
//        ou `?secret=<CRON_SECRET>` en query (run manuel).
//
// Schedule : toutes les 5 min via vercel.json crons.

const { listGuildMembers, assignRole, DiscordApiError } = require('../_lib/discord.js');

module.exports = async function handler(req, res) {
  // Auth cron
  const expectedSecret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const querySecret = (req.query?.secret) || '';
  const valid =
    (expectedSecret && auth === `Bearer ${expectedSecret}`) ||
    (expectedSecret && querySecret === expectedSecret);
  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const ROLE_EARLY = process.env.DISCORD_ROLE_ID_EARLY;
  const GUILD_ID = process.env.DISCORD_GUILD_ID;
  const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

  if (!BOT_TOKEN || !GUILD_ID) {
    return res.status(503).json({ error: 'Discord env vars missing (BOT_TOKEN/GUILD_ID)' });
  }

  // Pas de role configure -> early-window fermee, on no-op proprement.
  if (!ROLE_EARLY) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'DISCORD_ROLE_ID_EARLY not set (early-window closed)',
    });
  }

  const startedAt = Date.now();
  const stats = {
    listed: 0,
    alreadyHasEarly: 0,
    assigned: 0,
    failed: 0,
    pages: 0,
    errors: [],
  };

  try {
    let after = '0';
    const PAGE_SIZE = 1000; // max autorise par Discord

    // Pagination : on continue tant qu'on recoit PAGE_SIZE elements.
    // Safety cap : 50 pages = 50k membres (largement plus que necessaire).
    for (let page = 0; page < 50; page++) {
      const members = await listGuildMembers({ limit: PAGE_SIZE, after });
      if (!Array.isArray(members) || members.length === 0) break;

      stats.pages++;
      stats.listed += members.length;

      for (const member of members) {
        const userId = member.user?.id;
        if (!userId) continue;

        // Skip les bots (Discord les expose dans la liste)
        if (member.user?.bot) continue;

        const hasEarly = Array.isArray(member.roles) && member.roles.includes(ROLE_EARLY);
        if (hasEarly) {
          stats.alreadyHasEarly++;
          continue;
        }

        try {
          await assignRole(userId, ROLE_EARLY);
          stats.assigned++;
          // Discord rate-limit : 50 reqs/sec global, on bat large 100ms entre
          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          stats.failed++;
          if (stats.errors.length < 5) {
            const errMsg = err instanceof DiscordApiError
              ? `[${err.status}] ${err.message}`
              : err.message;
            stats.errors.push({ userId, error: errMsg });
          }
        }
      }

      // Stop si la page n'est pas pleine = on a tout vu
      if (members.length < PAGE_SIZE) break;

      // Sinon : prochaine page apres le dernier user_id de la page
      after = members[members.length - 1].user?.id || after;
    }

    return res.status(200).json({ ok: true, ...stats, took_ms: Date.now() - startedAt });
  } catch (err) {
    console.error('[cron/discord-assign-early] error:', err);
    return res.status(500).json({ error: err.message, ...stats });
  }
};
