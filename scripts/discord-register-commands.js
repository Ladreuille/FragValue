#!/usr/bin/env node
// scripts/discord-register-commands.js
// Enregistre les slash commands FragValue aupres de Discord (one-shot).
//
// Usage :
//   DISCORD_BOT_TOKEN=xxx DISCORD_CLIENT_ID=xxx node scripts/discord-register-commands.js
//
// Optionnel :
//   DISCORD_GUILD_ID=xxx -> register en GUILD scope (instant)
//   sinon                -> register en GLOBAL scope (peut prendre 1h pour propager)
//
// Re-runable : Discord remplace les commandes existantes par celles fournies
// (PUT bulk-overwrite), donc relancer le script met a jour les definitions.

const DISCORD_API = 'https://discord.com/api/v10';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;

if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }
if (!CLIENT_ID) { console.error('Missing DISCORD_CLIENT_ID'); process.exit(1); }

// Definitions des commandes. type: 1 = CHAT_INPUT (slash command).
const COMMANDS = [
  {
    name: 'help',
    type: 1,
    description: 'Liste les commandes du bot FragValue',
  },
  {
    name: 'fvrating',
    type: 1,
    description: 'Affiche ton FV Rating moyen sur tes 20 derniers matchs',
  },
  {
    name: 'myplan',
    type: 1,
    description: 'Affiche ton plan FragValue actuel (Free/Pro/Elite)',
  },
  {
    name: 'upload',
    type: 1,
    description: 'Link rapide vers fragvalue.com/demo.html pour analyser une demo',
  },
  {
    name: 'demo-review',
    type: 1,
    description: 'Affiche la prochaine demo review collective (dimanche 19h CET)',
  },
];

async function main() {
  const scope = GUILD_ID ? `guild ${GUILD_ID}` : 'global';
  console.log(`\n🚀 Registering ${COMMANDS.length} slash commands (${scope} scope)\n`);

  const url = GUILD_ID
    ? `${DISCORD_API}/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`
    : `${DISCORD_API}/applications/${CLIENT_ID}/commands`;

  const res = await fetch(url, {
    method: 'PUT', // bulk overwrite : remplace toutes les commandes existantes
    headers: {
      'Authorization': `Bot ${BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(COMMANDS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`❌ Failed: ${res.status}\n${body}`);
    process.exit(1);
  }

  const registered = await res.json();
  console.log(`✅ Registered ${registered.length} commands :`);
  for (const cmd of registered) {
    console.log(`  /${cmd.name.padEnd(15)} — ${cmd.description}`);
  }
  console.log(`\n${GUILD_ID
    ? '⚡ Guild commands : disponibles immediatement dans le serveur.'
    : '⏳ Global commands : peuvent prendre jusqu\'a 1h pour propager dans tous les serveurs.'}\n`);
}

main().catch(err => {
  console.error('\n❌ Fatal:', err.message);
  process.exit(1);
});
