#!/usr/bin/env node
// scripts/discord-setup.js
// Crée toutes les categories + channels du serveur Discord FragValue de
// maniere idempotente. Skip ce qui existe deja, cree ce qui manque.
//
// Usage :
//   DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=xxx node scripts/discord-setup.js
//
// Variables requises :
//   - DISCORD_BOT_TOKEN  : Bot token (Developer Portal > Bot > Reset Token)
//   - DISCORD_GUILD_ID   : Server ID (right-click serveur > Copy Server ID)
//
// Variables optionnelles (lies aux roles, sinon on cree pas les channels gates) :
//   - DISCORD_ROLE_ID_PRO    : ID du role @Pro
//   - DISCORD_ROLE_ID_ELITE  : ID du role @Elite
//   - DISCORD_ROLE_ID_FREE   : ID du role @Free (optionnel, defaut everyone)
//
// Strategie :
//   1. Liste les channels et categories existants du guild
//   2. Pour chaque category dans le plan : skip si existe, sinon cree
//   3. Pour chaque channel : skip si existe (par nom + category_id), sinon cree
//   4. Applique les permission overrides pour les channels Pro/Elite gated
//
// Run-mode :
//   - DRY_RUN=1 -> log seulement, pas de creation
//   - VERBOSE=1 -> log tous les skips

const DISCORD_API = 'https://discord.com/api/v10';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;
const ROLE_PRO   = process.env.DISCORD_ROLE_ID_PRO;
const ROLE_ELITE = process.env.DISCORD_ROLE_ID_ELITE;

if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }
if (!GUILD_ID)  { console.error('Missing DISCORD_GUILD_ID');  process.exit(1); }

const DRY_RUN = process.env.DRY_RUN === '1';
const VERBOSE = process.env.VERBOSE === '1';

// Plan complet du serveur. Categories ordonnees, channels par category.
// Type 0 = text channel, 2 = voice, 4 = category.
// gated: 'pro' | 'elite' applique des permission overrides au channel.
const PLAN = [
  {
    name: '📍 INFOS',
    channels: [
      { name: 'announcements',   type: 0, topic: 'Annonces officielles FragValue · changelog · features' },
      { name: 'rules',           type: 0, topic: 'Lis les regles avant de poster' },
      { name: 'changelog',       type: 0, topic: 'Releases & nouvelles features de fragvalue.com' },
      { name: 'roadmap',         type: 0, topic: 'Ce qui arrive · feature requests dans #feature-requests' },
    ],
  },
  {
    name: '🎮 COMMUNITY',
    channels: [
      { name: 'general',         type: 0, topic: 'Discussion generale · presentations bienvenues' },
      { name: 'highlights',      type: 0, topic: 'Tes meilleurs clips, screenshots, ace, clutchs' },
      { name: 'team-finding',    type: 0, topic: 'Cherche des coequipiers FACEIT a ton niveau' },
      { name: 'voice-lobby',     type: 2 }, // voice channel
    ],
  },
  {
    name: '📊 FRAGVALUE',
    channels: [
      { name: 'help-support',    type: 0, topic: 'Questions sur l\'app FragValue' },
      { name: 'feature-requests',type: 0, topic: 'Suggere des features. Vote avec :+1: / :-1:' },
      { name: 'bug-reports',     type: 0, topic: 'Bug FragValue ? Decris le contexte (URL, browser, steps)' },
      { name: 'share-your-rating', type: 0, topic: 'Partage ton FV Rating, compare avec la commu' },
    ],
  },
  {
    name: '🎓 IMPROVEMENT',
    channels: [
      { name: 'coach-ia-tips',   type: 0, topic: 'Insights de ton diagnostic Coach IA · partage avec la commu' },
      { name: 'map-strats',      type: 0, topic: 'Lineups, smokes, tactiques par map' },
      { name: 'progression',     type: 0, topic: 'Objectifs hebdo · accountability · progres' },
      { name: 'demo-reviews',    type: 0, topic: 'Demo review collective dimanche 19h CET' },
    ],
  },
  {
    name: '🏆 PRO SCENE',
    channels: [
      { name: 'match-of-the-day', type: 0, topic: 'Le match pro du jour · discussions' },
      { name: 'events',          type: 0, topic: 'Major, Blast, ESL Pro League, IEM' },
      { name: 'pro-replays-discussion', type: 0, topic: 'Decortiquer les rounds des pros' },
    ],
  },
  {
    name: '💼 PROS / ELITE',
    channels: [
      { name: 'elite-lounge',    type: 0, topic: 'Channel reserve aux abonnes Elite', gated: 'elite' },
      { name: 'team-coaching',   type: 0, topic: 'Sessions de coaching collectif Elite', gated: 'elite' },
      { name: 'pre-match-prep',  type: 0, topic: 'Prep ante-match Elite (anti-strat, prep veto)', gated: 'elite' },
      { name: 'pro-private',     type: 0, topic: 'Channel reserve aux abonnes Pro et Elite', gated: 'pro' },
    ],
  },
  {
    name: '🛠️ MODERATION',
    channels: [
      { name: 'mod-log',         type: 0, topic: 'Logs de moderation (private)' },
      { name: 'reports',         type: 0, topic: 'Signaler un user ou un message' },
    ],
  },
];

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

async function createCategory(name) {
  if (DRY_RUN) {
    console.log(`  [DRY] Would create category: ${name}`);
    return { id: 'dry-run-' + name, name };
  }
  return await api(`/guilds/${GUILD_ID}/channels`, {
    method: 'POST',
    body: JSON.stringify({ name, type: 4 }),
  });
}

async function createChannel(name, type, parentId, topic, gated) {
  // Permission overrides : si gated 'elite', deny @everyone et allow @Elite.
  // Si gated 'pro', deny @everyone et allow @Pro + @Elite.
  let permission_overwrites = undefined;
  if (gated === 'elite' && ROLE_ELITE) {
    permission_overwrites = [
      { id: GUILD_ID, type: 0, allow: '0', deny: '1024' }, // VIEW_CHANNEL deny @everyone
      { id: ROLE_ELITE, type: 0, allow: '1024', deny: '0' }, // VIEW_CHANNEL allow @Elite
    ];
  } else if (gated === 'pro' && ROLE_PRO) {
    permission_overwrites = [
      { id: GUILD_ID, type: 0, allow: '0', deny: '1024' },
      { id: ROLE_PRO, type: 0, allow: '1024', deny: '0' },
    ];
    if (ROLE_ELITE) {
      // Elite a aussi acces aux channels Pro
      permission_overwrites.push({ id: ROLE_ELITE, type: 0, allow: '1024', deny: '0' });
    }
  }
  const payload = { name, type };
  if (parentId) payload.parent_id = parentId;
  if (topic && type === 0) payload.topic = topic;
  if (permission_overwrites) payload.permission_overwrites = permission_overwrites;

  if (DRY_RUN) {
    console.log(`    [DRY] Would create channel: ${name} (type ${type})${gated ? ` [gated:${gated}]` : ''}`);
    return { id: 'dry-run-' + name, name };
  }
  return await api(`/guilds/${GUILD_ID}/channels`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function main() {
  console.log(`\n${DRY_RUN ? '🔍 [DRY RUN] ' : '🚀 '}Setup Discord FragValue (guild ${GUILD_ID})\n`);

  // 1. Liste l'existant
  let existing;
  try {
    existing = await listChannels();
  } catch (err) {
    console.error('❌ Failed to list channels:', err.message);
    process.exit(1);
  }
  console.log(`Found ${existing.length} existing channels/categories.`);

  const existingByName = new Map();
  for (const ch of existing) {
    const key = `${ch.parent_id || 'root'}:${ch.name}:${ch.type}`;
    existingByName.set(key, ch);
  }

  // 2. Process le plan
  let createdCategories = 0, createdChannels = 0, skippedCategories = 0, skippedChannels = 0;

  for (const cat of PLAN) {
    // Cherche si la category existe deja
    const catKey = `root:${cat.name}:4`;
    let catObj = existingByName.get(catKey);

    if (catObj) {
      skippedCategories++;
      if (VERBOSE) console.log(`📂 ${cat.name} (skip, exists)`);
    } else {
      console.log(`📂 ${cat.name} (creating...)`);
      try {
        catObj = await createCategory(cat.name);
        createdCategories++;
        existingByName.set(catKey, catObj);
        await new Promise(r => setTimeout(r, 250)); // rate limit safety
      } catch (err) {
        console.error(`  ❌ Failed to create category ${cat.name}: ${err.message}`);
        continue;
      }
    }

    for (const ch of cat.channels) {
      const chKey = `${catObj.id}:${ch.name}:${ch.type}`;
      if (existingByName.has(chKey)) {
        skippedChannels++;
        if (VERBOSE) console.log(`  └─ #${ch.name} (skip, exists)`);
        continue;
      }
      console.log(`  └─ #${ch.name} (creating...)${ch.gated ? ` [gated:${ch.gated}]` : ''}`);
      try {
        await createChannel(ch.name, ch.type, catObj.id, ch.topic, ch.gated);
        createdChannels++;
        await new Promise(r => setTimeout(r, 250)); // rate limit safety
      } catch (err) {
        console.error(`    ❌ Failed: ${err.message}`);
      }
    }
  }

  console.log(`\n✅ Done. Created ${createdCategories} categories + ${createdChannels} channels. Skipped ${skippedCategories} categories + ${skippedChannels} channels (already existed).\n`);
  if (DRY_RUN) console.log('(DRY RUN · no changes applied. Re-run without DRY_RUN=1 to apply.)\n');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
