#!/usr/bin/env node
// scripts/discord-update-content.js
// Edit IN-PLACE le message du bot dans chaque channel pour appliquer les
// corrections typo / accents / wording sans creer de doublons.
//
// Strategie :
//   1. Charge le CONTENT depuis scripts/discord-content.js (source de verite)
//   2. Pour chaque entry, fetch les 50 derniers messages du channel
//   3. Cherche le 1er message dont author.id === DISCORD_CLIENT_ID
//   4. Si le content est deja identique → skip (idempotent, safe a re-run)
//   5. Sinon → PATCH /channels/{channel.id}/messages/{message.id}
//
// Usage :
//   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... DISCORD_CLIENT_ID=... \
//     node scripts/discord-update-content.js
//
// Modes :
//   - DRY_RUN=1  -> log le diff sans patcher
//   - VERBOSE=1  -> log les skips (no-op channels)
//
// Limitations :
//   - Discord API limite l'edition aux messages postes par le bot lui-meme
//     (CLIENT_ID requis pour identifier ces messages).
//   - Si un message a ete supprime manuellement, le script log juste un skip.
//     Dans ce cas, lance discord-populate-content.js pour repost.

const DISCORD_API = 'https://discord.com/api/v10';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }
if (!GUILD_ID)  { console.error('Missing DISCORD_GUILD_ID'); process.exit(1); }
if (!CLIENT_ID) { console.error('Missing DISCORD_CLIENT_ID (required to identify bot messages)'); process.exit(1); }

const DRY_RUN = process.env.DRY_RUN === '1';
const VERBOSE = process.env.VERBOSE === '1';

const { CONTENT } = require('./discord-content.js');

// ============================================================================
// API helpers
// ============================================================================

async function api(path, options = {}) {
  const url = `${DISCORD_API}${path}`;
  const headers = {
    'Authorization': `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord API ${options.method || 'GET'} ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listChannels() {
  return await api(`/guilds/${GUILD_ID}/channels`);
}

// Cherche le premier message du bot dans un channel (les 50 derniers).
// Renvoie null si rien trouve.
async function findBotMessage(channelId) {
  try {
    const messages = await api(`/channels/${channelId}/messages?limit=50`);
    if (!messages || messages.length === 0) return null;
    // On prefere le message epingle s'il y en a un (= 1er post du populate),
    // sinon le plus ancien message du bot dans la liste recente.
    const botMessages = messages.filter(m => m.author?.id === CLIENT_ID);
    if (botMessages.length === 0) return null;
    // Prefere le pinned, sinon le plus ancien (= premier post historique)
    const pinned = botMessages.find(m => m.pinned);
    if (pinned) return pinned;
    return botMessages[botMessages.length - 1]; // plus ancien
  } catch (err) {
    console.warn(`  ⚠️  findBotMessage failed: ${err.message}`);
    return null;
  }
}

async function patchMessage(channelId, messageId, content) {
  if (DRY_RUN) {
    console.log(`    [DRY] Would PATCH /channels/${channelId}/messages/${messageId}`);
    return null;
  }
  return await api(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n${DRY_RUN ? '🔍 [DRY RUN] ' : '✏️  '}Update Discord content in-place (guild ${GUILD_ID})\n`);

  let channels;
  try {
    channels = await listChannels();
  } catch (err) {
    console.error('❌ Failed to list channels:', err.message);
    process.exit(1);
  }

  const channelsByName = new Map();
  for (const ch of channels) {
    if (ch.type === 0) channelsByName.set(ch.name, ch);
  }

  const stats = { updated: 0, skippedNoChange: 0, skippedNoBotMessage: 0, channelNotFound: 0, failed: 0 };

  for (const entry of CONTENT) {
    const ch = channelsByName.get(entry.channel);
    if (!ch) {
      console.log(`⚠️  Channel #${entry.channel} not found`);
      stats.channelNotFound++;
      continue;
    }

    // On ne traite que le 1er message de l'entry (= le pinned welcome)
    const targetMsg = entry.messages[0];
    if (!targetMsg) continue;

    const botMsg = await findBotMessage(ch.id);
    if (!botMsg) {
      console.log(`⚠️  #${entry.channel}: no bot message found (run populate-content first)`);
      stats.skippedNoBotMessage++;
      continue;
    }

    if (botMsg.content === targetMsg.content) {
      if (VERBOSE) console.log(`✓ #${entry.channel}: already up-to-date`);
      stats.skippedNoChange++;
      continue;
    }

    try {
      console.log(`✏️  #${entry.channel}: patching message ${botMsg.id}`);
      await patchMessage(ch.id, botMsg.id, targetMsg.content);
      stats.updated++;
      await new Promise(r => setTimeout(r, 400)); // rate-limit safety
    } catch (err) {
      console.error(`    ❌ Failed: ${err.message}`);
      stats.failed++;
    }
  }

  console.log(`\n✅ Done. Updated ${stats.updated}, skipped ${stats.skippedNoChange} (no change).`);
  if (stats.skippedNoBotMessage > 0) console.log(`   ⚠️  ${stats.skippedNoBotMessage} channels without bot message · run discord-populate-content.js`);
  if (stats.channelNotFound > 0) console.log(`   ⚠️  ${stats.channelNotFound} channels not found`);
  if (stats.failed > 0) console.log(`   ❌ ${stats.failed} failures`);
  console.log('');
  if (DRY_RUN) console.log('(DRY RUN · no changes applied. Re-run without DRY_RUN=1 to apply.)\n');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
