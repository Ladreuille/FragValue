// api/planner-notify.js // FragValue
// Notifications Discord du Pracc Planner.
//
// POST { event_id, action: 'created'|'updated'|'deleted', snapshot? }
//  - created/updated : on recharge l'event en DB (source de verite)
//  - deleted : l'event n'existe plus, le client passe un snapshot
//    { event_type, starts_at, map?, opponent?, roster_id }
//
// Flow :
//  1. Auth Bearer (session Supabase du coach/capitaine)
//  2. Verifie que l'appelant est owner du roster OU capitaine
//  3. DM chaque joueur du roster qui a lie son compte Discord
//     (discord_links), embed + boutons Ready / Peut-etre / Pas dispo
//  4. Si rosters.discord_channel_id est renseigne : poste aussi dans le
//     channel d'equipe (le bot doit etre present sur ce serveur)
//
// Les clics de boutons sont geres par api/discord-interactions.js
// (custom_id = rsvp:<event_id>:<status>).

const DISCORD_API = 'https://discord.com/api/v10';
const SITE = 'https://fragvalue.com';

const TYPE_LABELS = {
  pracc: 'Pracc', match: 'Match', strat_time: 'Strat time',
  vod_review: 'VOD review', try_out: 'Try out', off: 'Off',
};

function fmtDate(iso) {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Europe/Paris',
    }).format(new Date(iso));
  } catch { return iso; }
}

function buildEmbed(evt, action) {
  const label = TYPE_LABELS[evt.event_type] || evt.event_type;
  const verb = action === 'created' ? 'Nouvelle session'
    : action === 'updated' ? 'Session modifiée'
    : 'Session annulée';
  const lines = [`**${fmtDate(evt.starts_at)}**`];
  if (evt.duration_min) lines.push(`Durée : ${evt.duration_min} min`);
  if (evt.map) lines.push(`Map : ${evt.map}`);
  if (evt.opponent) lines.push(`Adversaire : ${evt.opponent}`);
  if (evt.notes) lines.push(evt.notes);
  return {
    title: `${verb} : ${label}${evt.opponent ? ' ' + evt.opponent : ''}`,
    description: lines.join('\n'),
    color: action === 'deleted' ? 0x4a5050 : 0xb8ff57,
    footer: { text: 'FragValue Pracc Planner' },
    url: `${SITE}/pracc-planner.html`,
  };
}

function buildComponents(eventId) {
  return [{
    type: 1, // action row
    components: [
      { type: 2, style: 3, label: 'Ready',     custom_id: `rsvp:${eventId}:ready` },
      { type: 2, style: 2, label: 'Peut-être', custom_id: `rsvp:${eventId}:maybe` },
      { type: 2, style: 4, label: 'Pas dispo', custom_id: `rsvp:${eventId}:no` },
    ],
  }];
}

async function discordPost(path, payload) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`discord ${path} -> ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function dmUser(discordUserId, payload) {
  const channel = await discordPost('/users/@me/channels', { recipient_id: discordUserId });
  return discordPost(`/channels/${channel.id}/messages`, payload);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.DISCORD_BOT_TOKEN) return res.status(200).json({ ok: false, skipped: 'no bot token' });

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Auth requise' });
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) return res.status(401).json({ error: 'Session invalide' });

    const { event_id, action, snapshot } = req.body || {};
    if (!['created', 'updated', 'deleted'].includes(action)) {
      return res.status(400).json({ error: 'action invalide' });
    }

    // Event : DB pour created/updated, snapshot client pour deleted
    let evt = null;
    if (action === 'deleted') {
      evt = snapshot;
      if (!evt || !evt.roster_id || !evt.starts_at || !evt.event_type) {
        return res.status(400).json({ error: 'snapshot incomplet' });
      }
    } else {
      const { data } = await supabase.from('roster_events').select('*').eq('id', event_id).maybeSingle();
      evt = data;
      if (!evt) return res.status(404).json({ error: 'event introuvable' });
    }

    // Droits : owner du roster OU capitaine
    const { data: roster } = await supabase.from('rosters')
      .select('id,user_id,team_name,discord_channel_id').eq('id', evt.roster_id).maybeSingle();
    if (!roster) return res.status(404).json({ error: 'roster introuvable' });
    const { data: players } = await supabase.from('roster_players')
      .select('user_id,is_captain,faceit_nickname').eq('roster_id', roster.id);
    const isOwner = roster.user_id === user.id;
    const isCaptain = (players || []).some(p => p.user_id === user.id && p.is_captain);
    if (!isOwner && !isCaptain) return res.status(403).json({ error: 'Reserve au coach/capitaine' });

    const embed = buildEmbed(evt, action);
    // Pas de boutons RSVP sur les sessions off ni sur les annulations
    const withButtons = action !== 'deleted' && evt.event_type !== 'off';
    const payload = {
      embeds: [embed],
      ...(withButtons ? { components: buildComponents(evt.id || event_id) } : {}),
    };

    // Destinataires DM : membres lies a Discord (sans l'auteur de l'action)
    const memberIds = (players || []).map(p => p.user_id).filter(Boolean).filter(uid => uid !== user.id);
    let links = [];
    if (memberIds.length) {
      const { data } = await supabase.from('discord_links')
        .select('user_id,discord_id').in('user_id', memberIds);
      links = data || [];
    }

    const results = { dm_sent: 0, dm_failed: 0, channel: false };
    for (const link of links) {
      try { await dmUser(link.discord_id, payload); results.dm_sent++; }
      catch (e) { results.dm_failed++; console.warn('[planner-notify] DM failed:', e.message); }
    }

    // Channel d'equipe optionnel
    if (roster.discord_channel_id) {
      try {
        await discordPost(`/channels/${roster.discord_channel_id}/messages`, payload);
        results.channel = true;
      } catch (e) { console.warn('[planner-notify] channel post failed:', e.message); }
    }

    return res.status(200).json({ ok: true, ...results });
  } catch (err) {
    console.error('[planner-notify]', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
