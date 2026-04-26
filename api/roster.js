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

// NB : pas d'import statique de ./_lib/email.js pour eviter un crash Vercel
// au startup si le module a un probleme de resolution. Import dynamique
// uniquement quand necessaire (dans sendEmailSafe).

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const MAX_ROSTER_SIZE = 7; // 5 titulaires + 2 subs max
const VALID_ROLES = ['entry','awp','support','lurker','igl','rifler','coach'];
const SITE = 'https://fragvalue.com';

// Helper : insert notification in-app (non-bloquant si echoue)
async function insertNotification(supabase, { user_id, title, body, link }) {
  if (!user_id) return;
  try {
    await supabase.from('notifications').insert({
      user_id, title, body, link,
      read: false,
    });
  } catch (e) { console.warn('notification insert failed:', e.message); }
}

// Helper : envoie email via dynamic import (non-bloquant, fallback silencieux)
async function sendEmailSafe(template, toEmail, payload) {
  if (!toEmail) return;
  try {
    const lib = await import('./_lib/email.js');
    const tplFn = lib[template];
    if (!tplFn) return;
    const { subject, html, text } = tplFn(payload);
    await lib.sendEmail({ to: toEmail, subject, html, text });
  } catch (e) { console.warn(`email ${template} failed:`, e.message); }
}

// Detecte les erreurs de colonne manquante (Postgres direct ou PostgREST cache)
function isMissingColumnError(err) {
  const msg = ((err && err.message) || '').toLowerCase();
  return /column/.test(msg) && (
    /does not exist/.test(msg) ||
    /schema cache/.test(msg) ||
    /not found/.test(msg) ||
    /could not find/.test(msg)
  );
}

// Extrait le nom de colonne manquante depuis l'erreur (pour retry cible)
function missingColumnName(err) {
  const msg = (err && err.message) || '';
  // Format PostgREST : "Could not find the 'X' column of 'Y'"
  const m1 = msg.match(/the '([^']+)' column/i);
  if (m1) return m1[1];
  // Format Postgres : column "X" does not exist
  const m2 = msg.match(/column "([^"]+)"/i);
  if (m2) return m2[1];
  return null;
}

// Insert tolerant : si colonne manquante, on retire ce champ et on retry
// (jusqu'a 8 fois) au lieu de tomber direct sur les required. Permet de
// sauver les champs etendus disponibles en DB meme si quelques-uns manquent.
async function tolerantInsert(supabase, table, fields, requiredKeys) {
  let attempt = { ...fields };
  for (let i = 0; i < 8; i++) {
    const { data, error } = await supabase.from(table).insert(attempt).select().single();
    if (!error) return { data, error: null };
    if (!isMissingColumnError(error)) return { data: null, error };
    const missing = missingColumnName(error);
    if (missing && missing in attempt) {
      console.warn(`[${table}] colonne '${missing}' manquante, retry sans. Run the SQL migration.`);
      delete attempt[missing];
      continue;
    }
    // Si on ne peut pas identifier la colonne, fallback : garde seulement les required
    console.warn(`[${table}] fallback vers champs required uniquement`);
    const minimal = {};
    requiredKeys.forEach(k => { if (fields[k] !== undefined) minimal[k] = fields[k]; });
    const retry = await supabase.from(table).insert(minimal).select().single();
    return { data: retry.data, error: retry.error };
  }
  return { data: null, error: { message: 'Trop de tentatives de retry' } };
}

async function tolerantUpdate(supabase, table, id, fields) {
  let attempt = { ...fields };
  for (let i = 0; i < 8; i++) {
    const { error } = await supabase.from(table).update(attempt).eq('id', id);
    if (!error) return { error: null };
    if (!isMissingColumnError(error)) return { error };
    const missing = missingColumnName(error);
    if (missing && missing in attempt) {
      delete attempt[missing];
      if (Object.keys(attempt).length === 0) return { error: null };
      continue;
    }
    console.warn(`[${table}] extended fields ignored (migration not run)`);
    return { error: null };
  }
  return { error: null };
}

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
// Actions qui creent / modifient une equipe (require Team).
// Les autres actions (respond, leave, remove_player, cancel_invite) restent
// accessibles aux Free pour qu'un user Free puisse rejoindre une equipe Team.
const TEAM_OWNER_ACTIONS = new Set(['create', 'update', 'invite', 'delete', 'link_faceit']);

async function handlePost(req, res, supabase, user) {
  const body = req.body || {};
  const action = body.action;

  if (TEAM_OWNER_ACTIONS.has(action)) {
    const { getUserPlan } = await import('./_lib/subscription.js');
    const { plan } = await getUserPlan(req.headers.authorization);
    if (plan !== 'elite') {
      return res.status(403).json({
        error: 'Abonnement Elite requis pour cette action',
        action,
        plan,
        upgrade_url: '/pricing.html',
      });
    }
  }

  if (action === 'create') {
    const { team_name, description, region, tag } = body;
    if (!team_name || team_name.trim().length < 2) return res.status(400).json({ error: 'team_name requis (min 2 caracteres)' });
    // Un user = un roster owned (pour l'instant)
    const { data: existing } = await supabase.from('rosters').select('id').eq('user_id', user.id).maybeSingle();
    if (existing) return res.status(400).json({ error: 'Tu as deja un roster. Supprime-le avant d\'en creer un nouveau.' });

    const rosterFields = {
      user_id: user.id,
      team_name: team_name.trim(),
      description: description || null,
      region: region || null,
      tag: tag ? tag.trim().toUpperCase().slice(0, 6) : null,
    };
    const { data: roster, error } = await tolerantInsert(supabase, 'rosters', rosterFields, ['user_id','team_name']);
    if (error) return res.status(500).json({ error: 'Creation echouee : ' + error.message });

    // Owner devient captain. Tolerant aux colonnes manquantes.
    const nickname = (await getProfileNickname(supabase, user.id)) || 'Owner';
    await tolerantInsert(supabase, 'roster_players', {
      roster_id: roster.id,
      user_id: user.id,
      faceit_nickname: nickname,
      team_role: 'captain',
      is_captain: true,
      invited_by: user.id,
    }, ['roster_id','faceit_nickname']);

    return res.status(200).json({ ok: true, roster });
  }

  if (action === 'update') {
    const { roster_id, fields } = body;
    if (!roster_id || !fields) return res.status(400).json({ error: 'roster_id et fields requis' });
    const { data: roster } = await supabase.from('rosters').select('user_id').eq('id', roster_id).maybeSingle();
    if (!roster || roster.user_id !== user.id) return res.status(403).json({ error: 'Seul l\'owner peut modifier' });
    const allowed = ['team_name','description','region','tag','visibility','looking_for_players','looking_for_roles','logo_url','faceit_team_id','faceit_team_url','esea_division','esea_season'];
    const clean = {};
    Object.keys(fields).forEach(k => { if (allowed.includes(k)) clean[k] = fields[k]; });
    const { error } = await tolerantUpdate(supabase, 'rosters', roster_id, clean);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  // ── link_faceit : associe une fiche FACEIT team a un roster ──────────
  // Body : { roster_id, faceit_team_url } OU { roster_id, faceit_team_id }
  // Resout via FACEIT API : team_id, name, members, ESEA championship si
  // detecte dans les matchs recents. Sauve en DB (tolerant aux colonnes
  // manquantes : faceit_team_id, faceit_team_url, esea_division, esea_season).
  if (action === 'link_faceit') {
    const { roster_id } = body;
    let faceitTeamId = body.faceit_team_id || null;
    const faceitUrl = body.faceit_team_url || null;
    if (!roster_id) return res.status(400).json({ error: 'roster_id requis' });

    // Verifie ownership
    const { data: roster } = await supabase.from('rosters').select('id, user_id, team_name').eq('id', roster_id).maybeSingle();
    if (!roster || roster.user_id !== user.id) return res.status(403).json({ error: 'Seul l\'owner peut lier' });

    // Parse URL si pas d'id direct
    if (!faceitTeamId && faceitUrl) {
      const m = String(faceitUrl).match(/faceit\.com\/[a-z]{2}\/teams\/([a-z0-9-]+)/i);
      if (m) faceitTeamId = m[1];
    }
    if (!faceitTeamId) return res.status(400).json({ error: 'URL FACEIT team invalide. Format : faceit.com/<lang>/teams/<id>' });

    const apiKey = process.env.FACEIT_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'FACEIT API non configuree' });

    try {
      const headers = { Authorization: `Bearer ${apiKey}` };
      const BASE = 'https://open.faceit.com/data/v4';
      // 1. Detail equipe
      const tRes = await fetch(`${BASE}/teams/${faceitTeamId}`, { headers });
      if (!tRes.ok) return res.status(404).json({ error: 'Equipe FACEIT introuvable. Verifie l\'URL.' });
      const team = await tRes.json();

      // 2. Detection ESEA via matchs recents (best-effort, swallow errors)
      let eseaDivision = null;
      let eseaSeason = null;
      try {
        const mRes = await fetch(`${BASE}/teams/${faceitTeamId}/matches?game=cs2&limit=20`, { headers });
        if (mRes.ok) {
          const md = await mRes.json();
          const items = md.items || [];
          // Chercher 'ESEA' dans les noms de competitions
          for (const it of items) {
            const compName = (it.competition_name || '').toString();
            if (/ESEA/i.test(compName)) {
              // ex: "ESEA Season 50 Open Division Europe" -> Open
              const divM = compName.match(/(Open|Intermediate|Main|Advanced|Premier|Challenger)/i);
              const seaM = compName.match(/Season\s*(\d+)/i);
              if (divM) eseaDivision = divM[1];
              if (seaM)  eseaSeason   = 'S' + seaM[1];
              break;
            }
          }
        }
      } catch (_) {}

      // 3. Sauve en DB (tolerant aux colonnes manquantes)
      const { error: updErr } = await tolerantUpdate(supabase, 'rosters', roster_id, {
        faceit_team_id: faceitTeamId,
        faceit_team_url: faceitUrl || `https://www.faceit.com/en/teams/${faceitTeamId}`,
        esea_division: eseaDivision,
        esea_season: eseaSeason,
      });
      if (updErr) return res.status(500).json({ error: 'Sauvegarde echouee : ' + updErr.message });

      return res.status(200).json({
        ok: true,
        team: {
          id: faceitTeamId,
          name: team.name || team.nickname || null,
          avatar: team.avatar || null,
          members: (team.members || []).map(m => m.nickname).filter(Boolean).slice(0, 10),
        },
        esea: { division: eseaDivision, season: eseaSeason },
      });
    } catch (e) {
      console.error('[roster] link_faceit failed:', e.message);
      return res.status(500).json({ error: 'Erreur lors du linking FACEIT' });
    }
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

    const { data: invitation, error } = await tolerantInsert(supabase, 'roster_invitations', {
      roster_id, inviter_id: user.id,
      invitee_user_id, invitee_nickname: nickname,
      proposed_role: proposed_role || null,
      message: message || null,
    }, ['roster_id', 'invitee_nickname']);
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (/relation.*does not exist|not found/.test(msg)) {
        return res.status(503).json({ error: 'Table roster_invitations pas encore creee. Joue la migration SQL Scout+Roster.' });
      }
      return res.status(500).json({ error: error.message });
    }

    // ── Notifications : in-app (si on connait le user) + email ───────────
    const inviterNickname = await getProfileNickname(supabase, user.id) || 'Un joueur';
    if (invitee_user_id) {
      await insertNotification(supabase, {
        user_id: invitee_user_id,
        title: `Invitation d'équipe : ${roster.team_name}`,
        body: `${inviterNickname} t'invite${proposed_role ? ` en tant que ${proposed_role}` : ''} dans son équipe.`,
        link: '/dashboard.html#roster',
      });
      const { data: inviteeAuth } = await supabase.auth.admin.getUserById(invitee_user_id);
      sendEmailSafe('emailRosterInvite', inviteeAuth?.user?.email, {
        team_name: roster.team_name,
        tag: null,
        inviter_nickname: inviterNickname,
        proposed_role,
        message,
        accept_url: `${SITE}/dashboard.html#roster`,
      });
    }
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
      const inviteeNick = profile || inv.invitee_nickname || 'Un joueur';
      const { data: rosterMeta } = await supabase.from('rosters').select('team_name').eq('id', inv.roster_id).maybeSingle();
      await insertNotification(supabase, {
        user_id: inv.inviter_id,
        title: `${inviteeNick} a décliné ton invitation`,
        body: `Pour l'équipe "${rosterMeta?.team_name || ''}".`,
        link: '/dashboard.html#roster',
      });
      const { data: inviterAuth } = await supabase.auth.admin.getUserById(inv.inviter_id);
      sendEmailSafe('emailInviteDeclined', inviterAuth?.user?.email, {
        team_name: rosterMeta?.team_name || '',
        invitee_nickname: inviteeNick,
        team_url: `${SITE}/dashboard.html#roster`,
      });
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
    const inviteeNick = profile || inv.invitee_nickname || 'Un joueur';
    const { data: rosterMeta } = await supabase.from('rosters').select('team_name').eq('id', inv.roster_id).maybeSingle();
    await insertNotification(supabase, {
      user_id: inv.inviter_id,
      title: `${inviteeNick} a rejoint ton équipe`,
      body: `${rosterMeta?.team_name || 'Ton équipe'} compte un nouveau membre.`,
      link: '/dashboard.html#roster',
    });
    const { data: inviterAuth } = await supabase.auth.admin.getUserById(inv.inviter_id);
    sendEmailSafe('emailInviteAccepted', inviterAuth?.user?.email, {
      team_name: rosterMeta?.team_name || '',
      invitee_nickname: inviteeNick,
      team_url: `${SITE}/dashboard.html#roster`,
    });
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
