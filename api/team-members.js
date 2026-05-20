// api/team-members.js · FragValue
//
// CRUD pour la gestion des sieges Elite (1 admin + 4 invites = 5 joueurs).
//
// GET    /api/team-members              -> liste tes invitations (en tant qu'admin)
// POST   /api/team-members              -> invite un nouveau membre par email
//                                            { email, faceit_nickname? }
// DELETE /api/team-members?id=X         -> revoke une invitation
// POST   /api/team-members?accept=TOKEN -> accepte une invitation (l'invite click sur le lien)
//
// Auth : JWT Supabase requis pour toutes les operations sauf accept (qui se
// fait via invite_token signe par le serveur).
// Plan check : l'admin doit etre sur plan elite OU team OU lifetime_pro
// (lifetime_pro = Pro mais on autorise quand meme la fonction team pour les
// founders comme valeur ajoutee). On voit a la fin si on garde ou pas
// (option A = elite-only stricte; option B = elite+lifetime_pro inclus).

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const TEAM_MAX_INVITES = 4;

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getAuthedUser(req, sb) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const { data: { user } } = await sb.auth.getUser(token);
  return user || null;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── POST ?accept=TOKEN : route publique (l'invite n'est pas encore log)
  if (req.method === 'POST' && req.query.accept) {
    return acceptInvite(req, res, sb);
  }

  // ── Tout le reste : auth requise + admin doit etre sur plan Elite
  const user = await getAuthedUser(req, sb);
  if (!user) return res.status(401).json({ error: 'Auth requise' });

  // Plan check : seuls elite/team peuvent inviter (lifetime_pro = Pro perso,
  // pas access team). On verifie via la table subscriptions.
  const { data: sub } = await sb.from('subscriptions')
    .select('plan, status').eq('user_id', user.id).maybeSingle();
  const isEligibleAdmin =
    sub?.status === 'active' &&
    ['elite', 'team', 'elite_monthly', 'elite_yearly', 'team_monthly', 'team_yearly'].includes((sub?.plan || '').toLowerCase());

  if (req.method === 'GET') {
    return listInvites(req, res, sb, user, isEligibleAdmin);
  }
  if (req.method === 'POST') {
    if (!isEligibleAdmin) return res.status(403).json({ error: 'Plan Elite requis pour inviter des coequipiers' });
    return inviteMember(req, res, sb, user);
  }
  if (req.method === 'DELETE') {
    if (!isEligibleAdmin) return res.status(403).json({ error: 'Plan Elite requis' });
    return revokeInvite(req, res, sb, user);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function listInvites(req, res, sb, user, isEligibleAdmin) {
  // 1. Mes invitations en tant qu'admin
  const { data: asAdmin } = await sb.from('team_members')
    .select('id, email_invited, faceit_nickname, status, invited_at, accepted_at, member_user_id')
    .eq('admin_user_id', user.id)
    .in('status', ['pending', 'accepted'])
    .order('invited_at', { ascending: true });

  // 2. Les teams ou je suis member (au cas ou je suis invite par quelqu'un d'autre)
  const { data: asMember } = await sb.from('team_members')
    .select('id, admin_user_id, status, accepted_at')
    .eq('member_user_id', user.id)
    .eq('status', 'accepted')
    .maybeSingle();

  // Enrich asAdmin avec FV Rating des members acceptes (best-effort)
  const memberIds = (asAdmin || []).map(r => r.member_user_id).filter(Boolean);
  const fvByUser = new Map();
  if (memberIds.length > 0) {
    const monthAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
    const { data: dems } = await sb.from('demos')
      .select('user_id, fv_rating')
      .in('user_id', memberIds)
      .not('fv_rating', 'is', null)
      .gte('analysed_at', monthAgo);
    if (dems) {
      const acc = new Map();
      for (const d of dems) {
        const arr = acc.get(d.user_id) || [];
        arr.push(parseFloat(d.fv_rating));
        acc.set(d.user_id, arr);
      }
      for (const [uid, arr] of acc) {
        const avg = arr.reduce((s, r) => s + r, 0) / arr.length;
        fvByUser.set(uid, Number(avg.toFixed(2)));
      }
    }
  }

  const members = (asAdmin || []).map(row => ({
    ...row,
    fv_rating_avg_30d: row.member_user_id ? fvByUser.get(row.member_user_id) || null : null,
  }));

  return res.status(200).json({
    is_eligible_admin: !!isEligibleAdmin,
    total_seats: 5,         // 1 admin + 4 invites
    used_seats: 1 + (members.filter(m => m.status === 'accepted').length),
    members,
    is_member_of_other_team: !!asMember,
  });
}

async function inviteMember(req, res, sb, user) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = (body?.email || '').toLowerCase().trim();
  const faceitNickname = (body?.faceit_nickname || '').trim() || null;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }
  if (email === (user.email || '').toLowerCase()) {
    return res.status(400).json({ error: 'Tu ne peux pas t\'inviter toi-meme' });
  }

  // Check cap manuel (le trigger DB le refait, mais on retourne un message clair)
  const { count: activeCount } = await sb.from('team_members')
    .select('id', { count: 'exact', head: true })
    .eq('admin_user_id', user.id)
    .in('status', ['pending', 'accepted']);
  if ((activeCount || 0) >= TEAM_MAX_INVITES) {
    return res.status(409).json({ error: `Maximum ${TEAM_MAX_INVITES} invites en cours (5 places total incluant toi)` });
  }

  // Genere un invite_token cryptographique pour le lien d'acceptation.
  const inviteToken = crypto.randomBytes(24).toString('base64url');

  const { data, error } = await sb.from('team_members').insert({
    admin_user_id: user.id,
    email_invited: email,
    faceit_nickname: faceitNickname,
    invite_token: inviteToken,
    status: 'pending',
  }).select('id, email_invited, invite_token, invited_at').single();

  if (error) {
    if (error.message?.includes('unique')) {
      return res.status(409).json({ error: 'Tu as deja invite ce mail (en attente ou accepte)' });
    }
    console.error('[team-members] insert error:', error);
    return res.status(500).json({ error: 'Erreur DB : ' + error.message });
  }

  // TODO : envoyer un email de invitation via Resend avec un lien
  //        https://fragvalue.com/team-invite.html?token=XXX
  //        Pour MVP, l'admin partage manuellement le lien depuis l'UI.
  // (Voir email-templates.js, ajouter teamInvite si on automatise plus tard)

  const acceptUrl = (req.headers.origin || 'https://fragvalue.com') + '/team-invite.html?token=' + inviteToken;

  return res.status(200).json({
    ok: true,
    id: data.id,
    email: data.email_invited,
    invited_at: data.invited_at,
    accept_url: acceptUrl,
  });
}

async function revokeInvite(req, res, sb, user) {
  const id = parseInt(req.query.id, 10);
  if (!id) return res.status(400).json({ error: 'Parametre id manquant' });

  const { error } = await sb.from('team_members')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('admin_user_id', user.id)
    .in('status', ['pending', 'accepted']);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

async function acceptInvite(req, res, sb) {
  // L'invite doit etre log dans son propre compte pour accepter
  const user = await getAuthedUser(req, sb);
  if (!user) return res.status(401).json({ error: 'Connecte-toi pour accepter l\'invitation' });

  const token = req.query.accept;
  if (!token || token.length < 16) return res.status(400).json({ error: 'Token invalide' });

  const { data: invite } = await sb.from('team_members')
    .select('id, admin_user_id, email_invited, status')
    .eq('invite_token', token)
    .maybeSingle();

  if (!invite) return res.status(404).json({ error: 'Invitation introuvable ou expiree' });
  if (invite.status !== 'pending') return res.status(409).json({ error: 'Invitation deja ' + invite.status });
  if (invite.admin_user_id === user.id) return res.status(400).json({ error: 'Tu ne peux pas accepter ta propre invitation' });

  // Optionnel : verifier que l'email du user matche email_invited
  // (pour eviter qu'un user accepte une invitation envoyee a quelqu'un d'autre).
  if ((user.email || '').toLowerCase() !== invite.email_invited.toLowerCase()) {
    return res.status(403).json({ error: `Cette invitation est pour ${invite.email_invited}. Connecte-toi avec ce mail.` });
  }

  const { error: updErr } = await sb.from('team_members')
    .update({
      member_user_id: user.id,
      status: 'accepted',
      accepted_at: new Date().toISOString(),
      invite_token: null,  // invalide le token apres acceptation
    })
    .eq('id', invite.id);

  if (updErr) return res.status(500).json({ error: updErr.message });

  return res.status(200).json({ ok: true, team_admin_id: invite.admin_user_id });
}
