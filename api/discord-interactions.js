// api/discord-interactions.js
// Endpoint receiver pour les Discord HTTP Interactions (slash commands).
//
// Discord envoie POST a cet endpoint a chaque /command tape par un user.
// On valide la signature Ed25519 (Discord requirement strict), on dispatch
// la commande, et on retourne une reponse en < 3 sec (sinon timeout).
//
// Doc :
//   https://discord.com/developers/docs/interactions/receiving-and-responding
//
// Setup cote Discord (one-shot) :
//   1. Developer Portal > ton app > General Information :
//      - Copy "Public Key" -> DISCORD_PUBLIC_KEY env var
//   2. Set "Interactions Endpoint URL" :
//      - https://fragvalue.com/api/discord-interactions
//      - Discord va PING l'endpoint au moment du save : il doit retourner
//        type=1 (PONG) avec signature valide. Notre handler le fait correctement.
//   3. Run scripts/discord-register-commands.js pour register les commands.
//
// Slash commands implemented :
//   /fvrating        : recupere son FV Rating moyen (DM)
//   /myplan          : affiche son plan FragValue + lien Discord
//   /upload          : link rapide vers /demo.html
//   /help            : aide / commandes dispo
//   /demo-review     : prochain demo review schedule

import crypto from 'node:crypto';

// Vercel ne parse pas le body : on a besoin du raw pour ed25519 verify
export const config = { api: { bodyParser: false } };

const DISCORD_API = 'https://discord.com/api/v10';

const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  MODAL_SUBMIT: 5,
};

const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  EPHEMERAL: 64, // flag pour reponse visible uniquement par l'invoker
};

const MessageFlags = {
  EPHEMERAL: 64,
};

async function readRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Verifie la signature Ed25519 d'une interaction Discord avec le crypto natif
// Node (>= 14). Discord signe : timestamp + body avec sa clef publique Ed25519.
// Format de la cle Discord : 32 bytes hex.
function verifySignature(rawBody, signatureHex, timestamp, publicKeyHex) {
  if (!signatureHex || !timestamp || !publicKeyHex) return false;
  try {
    const message = Buffer.from(timestamp + rawBody, 'utf8');
    const signature = Buffer.from(signatureHex, 'hex');

    // Discord donne la cle publique en raw 32 bytes hex.
    // crypto.createPublicKey attend un format SPKI (DER) ou JWK ou PEM.
    // On wrap les 32 bytes raw avec le prefix DER Ed25519 (12 bytes) pour
    // construire une cle SPKI valide.
    const ED25519_DER_PREFIX = Buffer.from([
      0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ]);
    const rawKey = Buffer.from(publicKeyHex, 'hex');
    if (rawKey.length !== 32) {
      console.error('[discord-interactions] public key must be 32 bytes raw, got', rawKey.length);
      return false;
    }
    const spkiKey = Buffer.concat([ED25519_DER_PREFIX, rawKey]);
    const publicKey = crypto.createPublicKey({
      key: spkiKey,
      format: 'der',
      type: 'spki',
    });

    // Pour Ed25519, l'argument algorithm doit etre null (signature = sig pure).
    return crypto.verify(null, message, publicKey, signature);
  } catch (e) {
    console.error('[discord-interactions] verify error:', e.message);
    return false;
  }
}

function ephemeralResponse(content) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: MessageFlags.EPHEMERAL,
    },
  };
}

function publicResponse(content) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content },
  };
}

// ============================================================================
// Command handlers
// ============================================================================

async function handleHelp() {
  return ephemeralResponse(
    `# 🤖 Commandes FragValue Bot\n\n` +
    `**\`/fvrating\`** · Affiche ton FV Rating moyen (lie ton compte FragValue d'abord)\n` +
    `**\`/myplan\`** · Affiche ton plan actuel (Free/Pro/Elite)\n` +
    `**\`/upload\`** · Link direct vers fragvalue.com/demo.html pour analyser une demo\n` +
    `**\`/demo-review\`** · Le prochain schedule de demo review collective (dimanche 19h CET)\n` +
    `**\`/help\`** · Cette liste\n\n` +
    `## 🎯 Pas encore inscrit ?\n` +
    `https://fragvalue.com · diagnostic Coach IA gratuit, 3 analyses / mois.\n\n` +
    `## 💎 Pour les abonnes Pro / Elite\n` +
    `Lie ton compte sur https://fragvalue.com/account.html -> ton role Discord est sync auto en 5-10 sec.`,
  );
}

async function handleUpload() {
  return ephemeralResponse(
    `# 🎮 Analyser une demo\n\n` +
    `**Glisse ton .dem FACEIT** ou colle l'URL d'un match :\n` +
    `https://fragvalue.com/demo.html\n\n` +
    `🎯 Tu obtiens en ~90s : FV Rating, KAST, ADR, heatmaps, replay 2D, 4 actions concretes du Coach IA.\n\n` +
    `**Free** : 3 analyses / mois\n` +
    `**Pro** : illimite + Diagnostic IA refresh par match\n` +
    `**Elite** : tout Pro + Chat IA 30 msg/jour + outils equipe`,
  );
}

async function handleDemoReview() {
  // Calcule le prochain dimanche 19h CET
  const now = new Date();
  const next = new Date(now);
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
  next.setDate(now.getDate() + daysUntilSunday);
  next.setHours(19, 0, 0, 0);
  const formatted = next.toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
  });
  return ephemeralResponse(
    `# 📺 Prochaine demo review collective\n\n` +
    `🕐 **${formatted}** (heure de Paris / CET)\n\n` +
    `Voice channel **#voice-lobby** + screen share Discord stream.\n` +
    `~45-60 min : decortique d'une demo pro (Major / BLAST / ESL).\n\n` +
    `📋 Plus de details dans **#demo-reviews**.\n` +
    `Tu peux suggerer une demo a decortiquer avec un lien HLTV.`,
  );
}

async function handleMyPlan(interaction) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return ephemeralResponse('Erreur : impossible de te identifier sur Discord.');

  // Lookup plan via Supabase service key (server-side)
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return ephemeralResponse('Service temporairement indisponible (config Supabase).');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Recupere le link Discord -> user FragValue
  const { data: link } = await sb
    .from('discord_links')
    .select('user_id, discord_username')
    .eq('discord_id', userId)
    .maybeSingle();

  if (!link?.user_id) {
    return ephemeralResponse(
      `# 🔗 Compte FragValue non lie\n\n` +
      `Tu n'as pas encore lie ton compte FragValue a Discord.\n\n` +
      `1. Va sur https://fragvalue.com/account.html\n` +
      `2. Click "Lier mon Discord"\n` +
      `3. Autorise sur Discord\n\n` +
      `Ton role Pro/Elite sera assigne auto en 5-10 sec.`,
    );
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('subscription_tier, faceit_nickname')
    .eq('id', link.user_id)
    .maybeSingle();

  const plan = profile?.subscription_tier || 'free';
  const planEmoji = plan === 'elite' ? '💎' : plan === 'pro' ? '⭐' : '🎮';
  const planLabel = plan === 'elite' ? 'Elite' : plan === 'pro' ? 'Pro' : 'Free';
  const nickname = profile?.faceit_nickname ? `@${profile.faceit_nickname}` : '';

  return ephemeralResponse(
    `# ${planEmoji} Ton plan FragValue\n\n` +
    `**Plan actuel** : ${planLabel}\n` +
    (nickname ? `**FACEIT** : ${nickname}\n` : '') +
    `**Discord lie** : <@${userId}>\n\n` +
    (plan === 'free'
      ? `🎯 Tu es en Free.\n- 3 analyses / mois\n- 1 Diagnostic IA / mois\n- Heatmaps basiques\n\nPasse Pro pour tout debloquer : https://fragvalue.com/pricing.html`
      : plan === 'pro'
      ? `🎯 Tu es Pro. Acces complet :\n- Upload demos sans limite\n- Diagnostic IA refresh par match\n- Chat Coach IA 5 msg/jour\n- Replay 2D + heatmaps avancees\n\nUpgrade Elite pour les outils equipe : https://fragvalue.com/pricing.html`
      : `💎 Tu es Elite. **GG**.\n- Tout Pro\n- Chat Coach IA 30 msg/jour\n- Outils equipe (anti-strat, prep veto)\n- Sessions coaching mensuelles\n- Acces channels Elite Discord\n\nMerci pour ton support 🙏`),
  );
}

async function handleFvRating(interaction) {
  const userId = interaction.member?.user?.id || interaction.user?.id;
  if (!userId) return ephemeralResponse('Erreur : impossible de te identifier sur Discord.');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return ephemeralResponse('Service temporairement indisponible (config Supabase).');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: link } = await sb
    .from('discord_links')
    .select('user_id')
    .eq('discord_id', userId)
    .maybeSingle();

  if (!link?.user_id) {
    return ephemeralResponse(
      `# 🔗 Lie d'abord ton compte\n\n` +
      `Pour voir ton FV Rating ici, lie ton compte FragValue : https://fragvalue.com/account.html`,
    );
  }

  // Recupere les 20 dernieres demos analysees du user
  const { data: demos } = await sb
    .from('demos')
    .select('fv_rating, map, analysed_at')
    .eq('user_id', link.user_id)
    .not('fv_rating', 'is', null)
    .order('analysed_at', { ascending: false })
    .limit(20);

  if (!demos || demos.length === 0) {
    return ephemeralResponse(
      `# 📊 Pas encore de demo analysee\n\n` +
      `Upload ta premiere demo pour avoir ton FV Rating :\n` +
      `https://fragvalue.com/demo.html`,
    );
  }

  const ratings = demos.map(d => Number(d.fv_rating)).filter(r => !isNaN(r));
  const avg = (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2);
  const max = Math.max(...ratings).toFixed(2);
  const min = Math.min(...ratings).toFixed(2);
  const last = ratings[0].toFixed(2);

  // Mapping rating -> niveau
  const avgN = parseFloat(avg);
  const tier = avgN >= 1.25 ? 'Semi-pro / pro 🏆'
            : avgN >= 1.15 ? 'Top 5% de ton level 🔥'
            : avgN >= 1.05 ? 'Tu carry regulierement ⭐'
            : avgN >= 0.95 ? 'Tu fais ton job 👍'
            : avgN >= 0.85 ? 'Tu tiens ta place 💪'
            : 'A bosser 🎯';

  return ephemeralResponse(
    `# 📊 Ton FV Rating\n\n` +
    `**Moyen sur ${ratings.length} matchs** : **${avg}** · ${tier}\n` +
    `**Dernier match** : ${last}\n` +
    `**Best** : ${max} | **Worst** : ${min}\n\n` +
    `Voir tous tes matchs en detail : https://fragvalue.com/dashboard.html`,
  );
}

// ============================================================================
// Handler principal
// ============================================================================

export default async function handler(req, res) {
  // Lecture raw body
  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    return res.status(400).json({ error: 'invalid body' });
  }

  // Verification signature Ed25519 (REQUIS par Discord, fail-closed)
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  if (!publicKey) {
    console.error('[discord-interactions] DISCORD_PUBLIC_KEY not configured');
    return res.status(500).json({ error: 'config missing' });
  }

  if (!verifySignature(rawBody, signature, timestamp, publicKey)) {
    return res.status(401).json({ error: 'invalid request signature' });
  }

  let interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: 'invalid json' });
  }

  // Type 1 = PING : Discord verifie que notre endpoint marche
  if (interaction.type === InteractionType.PING) {
    return res.status(200).json({ type: InteractionResponseType.PONG });
  }

  // Type 2 = slash command
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const cmd = interaction.data?.name;
    try {
      let response;
      switch (cmd) {
        case 'help':         response = await handleHelp(); break;
        case 'upload':       response = await handleUpload(); break;
        case 'demo-review':  response = await handleDemoReview(); break;
        case 'myplan':       response = await handleMyPlan(interaction); break;
        case 'fvrating':     response = await handleFvRating(interaction); break;
        default:
          response = ephemeralResponse(`Commande inconnue : \`/${cmd}\`. Tape \`/help\` pour la liste.`);
      }
      return res.status(200).json(response);
    } catch (err) {
      console.error(`[discord-interactions] command /${cmd} failed:`, err);
      return res.status(200).json(ephemeralResponse(
        `Erreur interne. Reessaye dans quelques secondes ou contacte le support si ca persiste.`,
      ));
    }
  }

  // Autres types non geres pour l'instant (modals, components, autocomplete)
  return res.status(200).json({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'Type d\'interaction non gere.', flags: MessageFlags.EPHEMERAL } });
}
