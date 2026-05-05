#!/usr/bin/env node
// scripts/discord-populate-content.js
// Populate les messages welcome / rules / pinned templates dans les channels
// du serveur Discord FragValue.
//
// Usage :
//   DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=xxx node scripts/discord-populate-content.js
//
// Idempotent : skip un channel si le bot a deja pinne au moins 1 message
// (signe que le populate a deja tourne). Pour re-populate from scratch,
// unpin manuellement les messages bot avant de relancer.
//
// Modes :
//   - DRY_RUN=1  -> log seulement
//   - VERBOSE=1  -> log les skips
//   - FORCE=1    -> repopulate meme si deja fait (ATTENTION : ne supprime
//                   pas l'existant, ajoute des doublons. Utiliser avec
//                   precaution apres avoir clean manuellement.)

const DISCORD_API = 'https://discord.com/api/v10';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID; // requis pour idempotence : check si le bot a deja poste
if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }
if (!GUILD_ID)  { console.error('Missing DISCORD_GUILD_ID'); process.exit(1); }
if (!CLIENT_ID) {
  console.warn('⚠️  DISCORD_CLIENT_ID not set : idempotence check disabled. ');
  console.warn('   Re-running without CLIENT_ID will create duplicates.');
  console.warn('   Set DISCORD_CLIENT_ID to enable safe re-runs.\n');
}

const DRY_RUN = process.env.DRY_RUN === '1';
const VERBOSE = process.env.VERBOSE === '1';
const FORCE   = process.env.FORCE === '1';

// Source de verite du contenu : module partage avec discord-update-content.js.
// Toutes les modifs typo/accent passent par scripts/discord-content.js.
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

async function getPinnedMessages(channelId) {
  return await api(`/channels/${channelId}/pins`);
}

// Check si le bot a deja poste un message dans ce channel (idempotence robuste).
// Plus fiable que le check pinned (qui rate si le pin avait foire au 1er run).
// Retourne true si on trouve au moins 1 message du bot dans les 50 derniers.
async function hasBotMessage(channelId) {
  if (!CLIENT_ID) return false; // pas de check possible sans CLIENT_ID
  try {
    const messages = await api(`/channels/${channelId}/messages?limit=50`);
    if (!messages) return false;
    return messages.some(m => m.author?.id === CLIENT_ID);
  } catch (err) {
    console.warn(`  ⚠️  hasBotMessage check failed for channel: ${err.message}`);
    return false; // fail-open : on tente le post (mieux qu'un skip silencieux)
  }
}

async function postMessage(channelId, content) {
  if (DRY_RUN) {
    console.log(`    [DRY] Would post to ${channelId}: ${content.split('\n')[0].slice(0, 60)}...`);
    return { id: 'dry-run-' + Date.now() };
  }
  return await api(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

async function pinMessage(channelId, messageId) {
  if (DRY_RUN) {
    console.log(`    [DRY] Would pin message ${messageId}`);
    return;
  }
  return await api(`/channels/${channelId}/pins/${messageId}`, {
    method: 'PUT',
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n${DRY_RUN ? '🔍 [DRY RUN] ' : '🚀 '}Populate Discord content (guild ${GUILD_ID})\n`);

  let channels;
  try {
    channels = await listChannels();
  } catch (err) {
    console.error('❌ Failed to list channels:', err.message);
    process.exit(1);
  }

  // Index par nom (pour lookup rapide)
  const channelsByName = new Map();
  for (const ch of channels) {
    if (ch.type === 0) channelsByName.set(ch.name, ch); // text channels uniquement
  }

  let stats = { posted: 0, pinned: 0, skippedAlreadyPinned: 0, channelNotFound: 0 };

  for (const entry of CONTENT) {
    const ch = channelsByName.get(entry.channel);
    if (!ch) {
      console.log(`⚠️  Channel #${entry.channel} not found (run discord-setup.js first?)`);
      stats.channelNotFound++;
      continue;
    }

    // Idempotence robuste : skip si le bot a DEJA poste au moins 1 message
    // dans ce channel (peu importe son pin status). Fix le bug du 1er run
    // ou le pin echouait silencieusement et le 2e run creait des doublons.
    if (!FORCE && CLIENT_ID) {
      const alreadyPosted = await hasBotMessage(ch.id);
      if (alreadyPosted) {
        if (VERBOSE) console.log(`✓ #${entry.channel}: skip (bot already posted here)`);
        stats.skippedAlreadyPinned++;
        continue;
      }
    } else if (!FORCE) {
      // Fallback ancien check pinned si CLIENT_ID absent (legacy)
      try {
        const pins = await getPinnedMessages(ch.id);
        if (pins && pins.length > 0) {
          if (VERBOSE) console.log(`📌 #${entry.channel}: skip (already has pins, but check incomplete sans CLIENT_ID)`);
          stats.skippedAlreadyPinned++;
          continue;
        }
      } catch (err) {
        console.warn(`  ⚠️  Could not check pins for #${entry.channel}: ${err.message}`);
      }
    }

    console.log(`📝 #${entry.channel} (${entry.messages.length} message${entry.messages.length > 1 ? 's' : ''} to post)`);

    for (const msg of entry.messages) {
      try {
        const posted = await postMessage(ch.id, msg.content);
        stats.posted++;
        if (msg.pin && posted?.id && !DRY_RUN) {
          // Le pin doit etre fait apres le post (sinon le messageId n'existe pas)
          await new Promise(r => setTimeout(r, 250)); // rate limit
          await pinMessage(ch.id, posted.id);
          stats.pinned++;
          console.log(`    📌 pinned`);
        }
        await new Promise(r => setTimeout(r, 500)); // rate limit safety
      } catch (err) {
        console.error(`    ❌ Failed: ${err.message}`);
      }
    }
  }

  console.log(`\n✅ Done. Posted ${stats.posted} messages, pinned ${stats.pinned}.`);
  if (stats.skippedAlreadyPinned > 0) console.log(`   Skipped ${stats.skippedAlreadyPinned} channels (already populated).`);
  if (stats.channelNotFound > 0) console.log(`   ⚠️  ${stats.channelNotFound} channels not found — run scripts/discord-setup.js first?`);
  console.log('');
  if (DRY_RUN) console.log('(DRY RUN — no changes applied. Re-run without DRY_RUN=1 to apply.)\n');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
