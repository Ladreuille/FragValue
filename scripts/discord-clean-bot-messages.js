#!/usr/bin/env node
// scripts/discord-clean-bot-messages.js
// Supprime TOUS les messages postes par le bot FragValue dans les channels
// du serveur. Utile pour cleanup avant un re-run de populate-content.
//
// Usage :
//   DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=xxx DISCORD_CLIENT_ID=xxx \
//     node scripts/discord-clean-bot-messages.js
//
// Modes :
//   - DRY_RUN=1  : log seulement les messages qui seraient supprimes
//   - KEEP_LAST=1 : garde le dernier message du bot par channel (le plus recent),
//                   delete les autres. Utile si le populate a poste plusieurs
//                   versions et tu veux garder la derniere.
//
// IMPORTANT :
//   - Action destructive. Le DRY_RUN d'abord est fortement recommande.
//   - Limite Discord : ne peut pas delete les messages > 14 jours via bulk delete.
//     On utilise DELETE individuel donc pas de limite, mais c'est plus lent
//     (~200ms par message).

const DISCORD_API = 'https://discord.com/api/v10';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!BOT_TOKEN)  { console.error('Missing DISCORD_BOT_TOKEN');  process.exit(1); }
if (!GUILD_ID)   { console.error('Missing DISCORD_GUILD_ID');   process.exit(1); }
if (!CLIENT_ID)  { console.error('Missing DISCORD_CLIENT_ID');  process.exit(1); }

const DRY_RUN   = process.env.DRY_RUN === '1';
const KEEP_LAST = process.env.KEEP_LAST === '1';

async function api(path, options = {}) {
  const headers = {
    'Authorization': `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const res = await fetch(`${DISCORD_API}${path}`, { ...options, headers });
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`${options.method || 'GET'} ${path}: ${res.status} ${body.slice(0, 200)}`);
  }
  if (res.status === 204 || res.status === 404) return null;
  return res.json();
}

async function listAllMessages(channelId) {
  const all = [];
  let before = null;
  while (true) {
    const url = `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`;
    let batch;
    try {
      batch = await api(url);
    } catch (err) {
      console.warn(`  ⚠️  list messages failed: ${err.message}`);
      break;
    }
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    before = batch[batch.length - 1].id;
    await new Promise(r => setTimeout(r, 250));
  }
  return all;
}

async function unpinIfPinned(channelId, messageId, isPinned) {
  if (!isPinned) return;
  if (DRY_RUN) {
    console.log(`    [DRY] Would unpin ${messageId}`);
    return;
  }
  await api(`/channels/${channelId}/pins/${messageId}`, { method: 'DELETE' });
  await new Promise(r => setTimeout(r, 200));
}

async function deleteMessage(channelId, messageId) {
  if (DRY_RUN) {
    console.log(`    [DRY] Would delete ${messageId}`);
    return;
  }
  await api(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
}

async function main() {
  console.log(`\n${DRY_RUN ? '🔍 [DRY RUN] ' : '🧹 '}Clean bot messages from guild ${GUILD_ID}`);
  console.log(`Bot client_id : ${CLIENT_ID}`);
  console.log(`Mode : ${KEEP_LAST ? 'keep latest, delete older' : 'delete all'}\n`);

  const channels = await api(`/guilds/${GUILD_ID}/channels`);
  const textChannels = channels.filter(c => c.type === 0);
  console.log(`Found ${textChannels.length} text channels.\n`);

  let totalDeleted = 0, totalKept = 0, totalErrors = 0;

  for (const ch of textChannels) {
    const messages = await listAllMessages(ch.id);
    const botMessages = messages.filter(m => m.author?.id === CLIENT_ID);

    if (botMessages.length === 0) {
      // Skip silently
      continue;
    }

    // Sort par date DESC (plus recent en 1er)
    botMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    let toDelete = botMessages;
    if (KEEP_LAST && botMessages.length > 0) {
      toDelete = botMessages.slice(1); // garde le 1er (le plus recent)
      totalKept++;
      console.log(`📝 #${ch.name}: ${botMessages.length} bot messages -> keep 1 latest (${botMessages[0].id}), delete ${toDelete.length}`);
    } else {
      console.log(`🗑️  #${ch.name}: ${botMessages.length} bot messages -> delete all`);
    }

    for (const msg of toDelete) {
      try {
        // Unpin d'abord si pinned (sinon le delete echoue)
        await unpinIfPinned(ch.id, msg.id, msg.pinned);
        await deleteMessage(ch.id, msg.id);
        totalDeleted++;
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error(`    ❌ ${msg.id}: ${err.message}`);
        totalErrors++;
      }
    }
  }

  console.log(`\n✅ Done. Deleted ${totalDeleted} bot messages.`);
  if (KEEP_LAST) console.log(`   Kept ${totalKept} latest messages (1 per channel).`);
  if (totalErrors > 0) console.log(`   ⚠️  ${totalErrors} errors.`);
  console.log('');
  if (DRY_RUN) console.log('(DRY RUN — no changes applied. Re-run without DRY_RUN=1 to apply.)\n');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
