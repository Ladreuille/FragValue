// api/roster.js // FragValue
// API unifiee pour gerer les rosters (equipes) :
//  - POST   { action: 'create', team_name, description?, region?, tag? }
//  - POST   { action: 'update', roster_id, fields: {...} }
//  - POST   { action: 'invite', roster_id, nickname, proposed_role?, message? }
//  - POST   { action: 'respond', invitation_id, response: 'accept'|'decline' }
//  - POST   { action: 'remove_player', roster_id, player_id }
//  - POST   { action: 'leave', roster_id }
//  - POST   { action: 'delete', roster_id }
//  - POST   { action: 'cancel_invite', invitation_id }
//  - GET    ?view=my_roster           -> mon equipe + membres + invitations
//  - GET    ?view=my_invitations      -> invitations recues en attente

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const MAX_ROSTER_SIZE = 7; // 5 titulaires + 2 subs max
const VALID_ROLES = ['entry','awp','support','lurker','igl','rifler','coach'];

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Non authentifie' });

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: 'Session invalide' });

    if (req.method === 'GET') return handleGet(req, res, supabase, user);
    return handlePost(req, res, supabase, user);
  } catch (err) {
    console.error('roster error:', err.message);
    return res.status(500).json({ error: 'Erreur serveur : ' + err.message });
  }
}

// ── GET ────────────────────────────────────────────────────────────────────
async function handleGet(req, res, supabase, user) {
  const view = req.query.view;

  if (view === 'my_roster') {
    // Roster possede par l'user (owner) OU dont il est membre
    const { data: ownedRoster } = await supabase
      .from('rosters').select('*').eq('user_id', user.id).maybeSingle();
    let roster = ownedRoster;
    if (!roster) {
      // Chercher dans les memberships
      const { data: membership } = await supabase
        .from('roster_players').select('roster_id').eq('user_id', user.id).maybeSingle();
      if (membership) {
        const { data: r } = await supabase
          .from('rosters').select('*').eq('id', membership.roster_id).maybeSingle();
        roster = r;
      }
    }
    if (!roster) return res.status(200).json({ roster: null });

    const { data: players } = await supabase
      .from('roster_players').select('*').eq('roster_id', roster.id);
    const { data: invitations } = await supabase
      .from('roster_invitations').select('*').eq('roster_id', roster.id).eq('status', 'pending');

    return res.status(200).json({
      roster,
      players: players || [],
      invitations: invitations || [],
      is_owner: roster.user_id === user.id,
    });
  }

  if (view === 'my_invitations') {
    const { data: profile } = await supabase
      .from('profiles').select('faceit_nickname').eq('id', user.id).maybeSingle();
    const nickname = profile?.faceit_nickname || null;

    // Invitations via user_id direct ou via nickname FACEIT
    let query = supabase.from('roster_invitations').select('*, rosters(team_name, tag, region)').eq('status', 'pending');
    query = nickname
      ? query.or(`invitee_user_id.eq.${user.id},invitee_nickname.ilike.${nickname}`)
      : query.eq('invitee_user_id', user.id);
    const { data: invitations } = await query;
    return res.status(200).json({ invitations: invitations || [] });
  }

  return res.status(400).json({ error: 'view inconnue' });
}

// ── POST ───────────────────────────────────────────────────────────────────
async function handlePost(req, res, supabase, user) {
  const body = req.body || {};
  const action = body.action;

  if (action === 'create') {
    const { team_name, description, region, tag } = body;
    if (!team_name || team_name.trim().length < 2) return res.status(400).json({ error: 'team_name requis (min 2 caracteres)' });
    // Un user = un roster owned (pour l'instant)
    const { data: existing } = await supabase.from('rosters').select('id').eq('user_id', user.id).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Tu as deja un roster. Supprime-le avant d\'en creer un nouveau.' });
    const { data: roster, error } = await supabase.from('rosters').insert({
      user_id: user.id,
      team_name: team_name.trim(),
      description: description || null,
      region: region || null,
      tag: tag ? tag.trim().toUpperCase().slice(0, 6) : null,
    }).select().single();
    if (error) throw error;
    // Owner devient automatiquement membre (captain)
    await supabase.from('roster_players').insert({
      roster_id: roster.id,
      user_id: user.id,
      faceit_nickname: (await getProfileNickname(supabase, user.id)) || 'Owner',
      team_role: 'captain',
      is_captain: true,
      invited_by: user.id,
    });
    return res.status(200).json({ ok: true, roster });
  }

  if (action === 'update') {
    const { roster_id, fields } = body;
    if (!roster_id || !fields) return res.status(400).json({ error: 'roster_id et fields requis' });
    // Verifie ownership
    const { data: roster } = await supabase.from('rosters').select('user_id').eq('id', roster_id).maybeSingle();
    if (!roster || roster.user_id !== user.id) return res.status(403).json({ error: 'Seul l\'owner peut modifier' });
    const allowed = ['team_name','description','region','tag','visibility','looking_for_players','looking_for_roles','logo_url'];
    const clean = {};
    Object.keys(fields).forEach(k => { if (allowed.includes(k)) clean[k] = fields[k]; });
    const { error } = await supabase.from('rosters').update(clean).eq('id', roster_id);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  }

  if (action === 'invite') {
    const { roster_id, nickname, proposed_role, message } = body;
    if (!roster_id || !nickname) return res.status(400).json({ error: 'roster_id et nickname requis' });
    if (proposed_role && !VALID_ROLES.includes(proposed_role)) return res.status(400).json({ error: 'role invalide' });

    const { data: roster } = await supabase.from('rosters').select('user_id, team_name').eq('id', roster_id).maybeSingle();
    if (!roster || roster.user_id !== user.id) return res.status(403).json({ error: 'Seul l\'owner peut inviter' });

    // Check taille max
    const { count: currentCount } = await supabase
      .from('roster_players').select('*', { count: 'exact', head: true }).eq('roster_id', roster_id);
    if ((currentCount || 0) >= MAX_ROSTER_SIZE) return res.status(400).json({ error: `Roster plein (max ${MAX_ROSTER_SIZE} joueurs)` });

    // Chercher si le FACEIT nickname correspond a un user FragValue
    let invitee_user_id = null;
    const { data: matchingProfile } = await supabase
      .from('profiles').select('id').ilike('faceit_nickname', nickname).maybeSingle();
    if (matchingProfile) invitee_user_id = matchingProfile.id;

    // Check doublon (meme invitee + meme roster + pending)
    const { data: dup } = await supabase
      .from('roster_invitations').select('id').eq('roster_id', roster_id)
      .ilike('invitee_nickname', nickname).eq('status', 'pending').maybeSingle();
    if (dup) return res.status(400).json({ error: 'Invitation deja envoyee a ce joueur' });

    const { data: invitation, error } = await supabase.from('roster_invitations').insert({
      roster_id, inviter_id: user.id,
      invitee_user_id, invitee_nickname: nickname,
      proposed_role: proposed_role || null,
      message: message || null,
    }).select().single();
    if (error) throw error;
    return res.status(200).json({ ok: true, invitation });
  }

  if (action === 'respond') {
    const { invitation_id, response } = body;
    if (!invitation_id || !['accept','decline'].includes(response)) {
      return res.status(400).json({ error: 'invitation_id et response (accept|decline) requis' });
    }
    const { data: inv } = await supabase
      .from('roster_invitations').select('*').eq('id', invitation_id).maybeSingle();
    if (!inv) return res.status(404).json({ error: 'Invitation introuvable' });

    // Verifie destinataire : soit invitee_user_id, soit nickname match
    const profile = await getProfileNickname(supabase, user.id);
    const isRecipient = inv.invitee_user_id === user.id
      || (inv.invitee_nickname && profile && inv.invitee_nickname.toLowerCase() === profile.toLowerCase());
    if (!isRecipient) return res.status(403).json({ error: 'Tu n\'es pas le destinataire' });
    if (inv.status !== 'pending') return res.status(400).json({ error: 'Invitation deja traitee' });

    if (response === 'decline') {
      await supabase.from('roster_invitations').update({ status: 'declined', responded_at: new Date().toISOString() }).eq('id', invitation_id);
      return res.status(200).json({ ok: true });
    }

    // Accept : check si deja dans un roster (peut pas cumuler)
    const { data: existingMembership } = await supabase
      .from('roster_players').select('roster_id').eq('user_id', user.id).maybeSingle();
    if (existingMembership) return res.status(400).json({ error: 'Tu es deja dans un roster. Quitte-le avant d\'accepter.' });

    // Check taille max
    const { count: currentCount } = await supabase
      .from('roster_players').select('*', { count: 'exact', head: true }).eq('roster_id', inv.roster_id);
    if ((currentCount || 0) >= MAX_ROSTER_SIZE) {
      await supabase.from('roster_invitations').update({ status: 'expired' }).eq('id', invitation_id);
      return res.status(400).json({ error: 'Roster plein entre temps' });
    }

    await supabase.from('roster_players').insert({
      roster_id: inv.roster_id,
      user_id: user.id,
      faceit_nickname: profile || inv.invitee_nickname,
      team_role: inv.proposed_role || null,
      invited_by: inv.inviter_id,
    });
    await supabase.from('roster_invitations').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', invitation_id);
    return res.status(200).json({ ok: true, roster_id: inv.roster_id });
  }

  if (action === 'remove_player') {
    const { roster_id, player_id } = body;
    if (!roster_id || !player_id) return res.status(400).json({ error: 'roster_id et player_id requis' });
    const { data: roster } = await supabase.from('rosters').select('user_id').eq('id', roster_id).maybeSingle();
    if (!roster || roster.user_id !== user.id) return res.status(403).json({ error: 'Seul l\'owner peut retirer' });
    // Ne pas retirer l'owner lui-meme
    const { data: pl } = await supabase.from('roster_players').select('user_id').eq('id', player_id).maybeSingle();
    if (pl && pl.user_id === user.id) return res.status(400).json({ error: 'L\'owner ne peut pas se retirer. Supprime le roster.' });
    await supabase.from('roster_players').delete().eq('id', player_id).eq('roster_id', roster_id);
    return res.status(200).json({ ok: true });
  }

  if (action === 'leave') {
    const { roster_id } = body;
    if (!roster_id) return res.status(400).json({ error: 'roster_id requis' });
    const { data: roster } = await supabase.from('rosters').select('user_id').eq('id', roster_id).maybeSingle();
    if (roster && roster.user_id === user.id) return res.status(400).json({ error: 'L\'owner doit supprimer le roster, pas le quitter' });
    await supabase.from('roster_players').delete().eq('roster_id', roster_id).eq('user_id', user.id);
    return res.status(200).json({ ok: true });
  }

  if (action === 'delete') {
    const { roster_id } = body;
    if (!roster_id) return res.status(400).json({ error: 'roster_id requis' });
    const { data: roster } = await supabase.from('rosters').select('user_id').eq('id', roster_id).maybeSingle();
    if (!roster || roster.user_id !== user.id) return res.status(403).json({ error: 'Seul l\'owner peut supprimer' });
    // Cascade manuelle (players, invitations)
    await supabase.from('roster_players').delete().eq('roster_id', roster_id);
    await supabase.from('roster_invitations').delete().eq('roster_id', roster_id);
    await supabase.from('rosters').delete().eq('id', roster_id);
    return res.status(200).json({ ok: true });
  }

  if (action === 'cancel_invite') {
    const { invitation_id } = body;
    if (!invitation_id) return res.status(400).json({ error: 'invitation_id requis' });
    const { data: inv } = await supabase
      .from('roster_invitations').select('inviter_id').eq('id', invitation_id).maybeSingle();
    if (!inv || inv.inviter_id !== user.id) return res.status(403).json({ error: 'Seul l\'inviteur peut annuler' });
    await supabase.from('roster_invitations').update({ status: 'cancelled' }).eq('id', invitation_id);
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'action inconnue' });
}

async function getProfileNickname(supabase, userId) {
  const { data } = await supabase.from('profiles').select('faceit_nickname').eq('id', userId).maybeSingle();
  return data?.faceit_nickname || null;
}
