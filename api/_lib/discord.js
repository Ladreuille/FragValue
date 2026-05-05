// api/_lib/discord.js
// Helpers Discord API pour FragValue : assignment/removal de roles, ajout
// de membres au guild via OAuth, sync plan -> role.
//
// Utilise par :
// - api/discord-link-callback.js (apres OAuth user, assign role + add to guild)
// - api/stripe-webhook.js (sur paiement / cancel, sync le role)
//
// Auth : DISCORD_BOT_TOKEN (header `Authorization: Bot <token>`)
// Doc : https://discord.com/developers/docs/resources/guild

const DISCORD_API = 'https://discord.com/api/v10';

class DiscordApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'DiscordApiError';
    this.status = status;
    this.body = body;
  }
}

function getBotToken() {
  const t = process.env.DISCORD_BOT_TOKEN;
  if (!t) throw new DiscordApiError('DISCORD_BOT_TOKEN not configured');
  return t;
}

function getGuildId() {
  const id = process.env.DISCORD_GUILD_ID;
  if (!id) throw new DiscordApiError('DISCORD_GUILD_ID not configured');
  return id;
}

// Map plan FragValue -> Discord role ID.
// Si plan inconnu/free, retourne le role @Free (peut etre null si pas configure).
function planToRoleId(plan) {
  const ROLE_PRO   = process.env.DISCORD_ROLE_ID_PRO;
  const ROLE_ELITE = process.env.DISCORD_ROLE_ID_ELITE;
  const ROLE_FREE  = process.env.DISCORD_ROLE_ID_FREE || null;
  if (!plan) return ROLE_FREE;
  const p = String(plan).toLowerCase();
  if (p.startsWith('elite') || p.startsWith('team')) return ROLE_ELITE;
  if (p.startsWith('pro')) return ROLE_PRO;
  return ROLE_FREE;
}

// Liste de tous les role IDs FragValue qu'on gere (pour cleanup avant assign).
function getAllManagedRoleIds() {
  return [
    process.env.DISCORD_ROLE_ID_PRO,
    process.env.DISCORD_ROLE_ID_ELITE,
    process.env.DISCORD_ROLE_ID_FREE,
  ].filter(Boolean);
}

// Assign un role a un user dans le guild FragValue.
// PUT /guilds/{guild.id}/members/{user.id}/roles/{role.id}
// Retourne 204 No Content si succes (idempotent : si role deja assigne, OK).
async function assignRole(discordUserId, roleId) {
  if (!discordUserId || !roleId) {
    throw new DiscordApiError('discordUserId and roleId required');
  }
  const url = `${DISCORD_API}/guilds/${getGuildId()}/members/${discordUserId}/roles/${roleId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bot ${getBotToken()}` },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '');
    throw new DiscordApiError(`assignRole failed: ${res.status}`, { status: res.status, body });
  }
  return true;
}

// Retire un role d'un user.
// DELETE /guilds/{guild.id}/members/{user.id}/roles/{role.id}
// 204 No Content si succes. 404 si role pas assigne (on tolere).
async function removeRole(discordUserId, roleId) {
  if (!discordUserId || !roleId) {
    throw new DiscordApiError('discordUserId and roleId required');
  }
  const url = `${DISCORD_API}/guilds/${getGuildId()}/members/${discordUserId}/roles/${roleId}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bot ${getBotToken()}` },
  });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new DiscordApiError(`removeRole failed: ${res.status}`, { status: res.status, body });
  }
  return true;
}

// Ajoute un user au guild via son OAuth access_token (scope guilds.join requis).
// PUT /guilds/{guild.id}/members/{user.id}
// 201 Created = ajoute, 204 No Content = deja dans le guild.
// Permet a un user qui s'inscrit Pro/Elite sans etre dans le serveur d'etre
// auto-ajoute au moment du link Discord.
async function addUserToGuild(discordUserId, userAccessToken) {
  if (!discordUserId || !userAccessToken) {
    throw new DiscordApiError('discordUserId and userAccessToken required');
  }
  const url = `${DISCORD_API}/guilds/${getGuildId()}/members/${discordUserId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bot ${getBotToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: userAccessToken }),
  });
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    const body = await res.text().catch(() => '');
    throw new DiscordApiError(`addUserToGuild failed: ${res.status}`, { status: res.status, body });
  }
  return res.status === 201; // true si vraiment ajoute (false si deja dans le guild)
}

// Sync le role d'un user en fonction de son plan FragValue actuel.
// Retire les autres roles manages (Pro/Elite/Free) et assigne le bon.
// Idempotent : safe a appeler plusieurs fois.
async function syncUserPlan(discordUserId, plan) {
  if (!discordUserId) throw new DiscordApiError('discordUserId required');
  const targetRoleId = planToRoleId(plan);
  if (!targetRoleId) {
    // Pas de role configure pour ce plan : on retire juste les autres
    for (const r of getAllManagedRoleIds()) {
      await removeRole(discordUserId, r).catch(() => {});
    }
    return { assigned: null, removed: 'all' };
  }

  // Retire les autres roles FragValue (mais pas le target)
  const allRoles = getAllManagedRoleIds();
  const removedFrom = [];
  for (const r of allRoles) {
    if (r !== targetRoleId) {
      await removeRole(discordUserId, r).catch(() => removedFrom.push(`${r} (failed)`));
      removedFrom.push(r);
    }
  }

  await assignRole(discordUserId, targetRoleId);
  return { assigned: targetRoleId, removed: removedFrom };
}

// Liste les membres du guild avec pagination.
// GET /guilds/{guild.id}/members?limit=1000&after=<lastUserId>
// Retourne array de { user: {id, username, ...}, roles: [...], joined_at, ... }.
// Le bot doit avoir l'intent privilegie GUILD_MEMBERS active dans le Dev Portal.
async function listGuildMembers({ limit = 1000, after = '0' } = {}) {
  const url = `${DISCORD_API}/guilds/${getGuildId()}/members?limit=${limit}&after=${after}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bot ${getBotToken()}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DiscordApiError(`listGuildMembers failed: ${res.status}`, { status: res.status, body });
  }
  return res.json();
}

// Echange le code OAuth contre un access_token Discord.
// Doc : https://discord.com/developers/docs/topics/oauth2#authorization-code-grant
async function exchangeOAuthCode(code, redirectUri) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new DiscordApiError('DISCORD_CLIENT_ID or DISCORD_CLIENT_SECRET not configured');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DiscordApiError(`OAuth code exchange failed: ${res.status}`, { status: res.status, body });
  }
  return res.json(); // { access_token, token_type, expires_in, refresh_token, scope }
}

// GET /users/@me · recupere les infos du user (id, username, global_name, avatar).
// Doit etre appele avec le user access_token (pas le bot token).
async function getMe(userAccessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { 'Authorization': `Bearer ${userAccessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new DiscordApiError(`getMe failed: ${res.status}`, { status: res.status, body });
  }
  return res.json(); // { id, username, global_name, avatar, email?, ... }
}

module.exports = {
  DiscordApiError,
  assignRole,
  removeRole,
  addUserToGuild,
  syncUserPlan,
  planToRoleId,
  getAllManagedRoleIds,
  listGuildMembers,
  exchangeOAuthCode,
  getMe,
};
