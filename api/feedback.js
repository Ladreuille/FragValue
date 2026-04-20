// api/feedback.js — FragValue
// Endpoint unifie pour le systeme de feedback :
//   POST   { type, message, page_url?, anon_email? }    public (auth optionnelle)
//   GET    ?status=&type=&limit=                         admin only
//   PATCH  { id, status?, admin_response? }              admin only
//
// L'admin recoit un email Resend a chaque nouveau feedback.
// Si l'user fournit un email, il recoit la reponse de l'admin par email.

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const ADMIN_EMAILS = ['qdreuillet@gmail.com'];
const VALID_TYPES = new Set(['positive', 'negative', 'idea', 'bug']);
const VALID_STATUSES = new Set(['new', 'read', 'responded', 'closed']);
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 30;

// Normalise un tag : lowercase + kebab-case + strip caracteres exotiques.
// Accepte uniquement [a-z0-9-]. Tag invalide ou trop long → null.
function normalizeTag(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!t || t.length > MAX_TAG_LENGTH) return null;
  return t;
}

// Filtre + dedup + cap : retourne un array TEXT[] propre pour Postgres
function normalizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set();
  const out = [];
  for (const t of rawTags) {
    const n = normalizeTag(t);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
      if (out.length >= MAX_TAGS) break;
    }
  }
  return out;
}

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function resolveUser(authHeader) {
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data } = await sb().auth.getUser(token);
    return data?.user || null;
  } catch {
    return null;
  }
}

async function isAdmin(authHeader) {
  const user = await resolveUser(authHeader);
  return !!(user?.email && ADMIN_EMAILS.includes(user.email));
}

async function resolveUserTier(userId) {
  if (!userId) return null;
  try {
    const { data } = await sb()
      .from('subscriptions')
      .select('plan, status')
      .eq('user_id', userId)
      .single();
    if (!data || !['active', 'trialing'].includes(data.status)) return 'free';
    const p = String(data.plan || '').toLowerCase();
    if (p.includes('team')) return 'team';
    if (p.includes('pro')) return 'pro';
    return 'free';
  } catch {
    return null;
  }
}

// Hash IP (premiers 32 chars suffisent, pas besoin de crypto-grade)
function hashIp(req) {
  const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  if (!ip) return null;
  let h = 0;
  for (let i = 0; i < ip.length; i++) h = ((h << 5) - h + ip.charCodeAt(i)) | 0;
  return 'ip_' + Math.abs(h).toString(36);
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  try {
    if (req.method === 'POST') return handleCreate(req, res);
    if (req.method === 'GET') return handleList(req, res);
    if (req.method === 'PATCH') return handleUpdate(req, res);
    if (req.method === 'DELETE') return handleDelete(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('feedback error', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};

// ── POST : create feedback (public, auth optional) ───────────────────────
async function handleCreate(req, res) {
  const body = req.body || {};
  const type = String(body.type || '').toLowerCase();
  const message = String(body.message || '').trim();

  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: 'Type invalide. Attendu : positive | negative | idea | bug' });
  }
  if (!message || message.length < 3) {
    return res.status(400).json({ error: 'Message trop court (min 3 caracteres)' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: 'Message trop long (max 2000 caracteres)' });
  }

  const user = await resolveUser(req.headers.authorization);
  const userTier = user ? await resolveUserTier(user.id) : null;
  const ipHash = hashIp(req);

  // Validation email anon (optionnel mais on check le format si fourni)
  let anonEmail = null;
  if (!user && body.anon_email) {
    const e = String(body.anon_email).trim().toLowerCase();
    if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200) anonEmail = e;
  }

  // Tags : meme logique que pour PATCH. L'user lambda peut envoyer des tags
  // (ex: depuis un widget custom plus tard), mais on les normalise + capw.
  const tags = normalizeTags(body.tags);

  const row = {
    user_id: user?.id || null,
    anon_email: anonEmail,
    type,
    message,
    page_url: String(body.page_url || '').slice(0, 500) || null,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
    viewport: String(body.viewport || '').slice(0, 30) || null,
    user_tier: userTier,
    ip_hash: ipHash,
    status: 'new',
    tags,
  };

  const { data, error } = await sb()
    .from('user_feedback')
    .insert(row)
    .select('id, ticket_number, type, created_at')
    .single();

  if (error) {
    console.error('[feedback] insert error', error);
    return res.status(500).json({ error: 'Impossible d\'enregistrer le feedback' });
  }

  // Notif email admin : await pour garantir l'envoi (Vercel serverless tue
  // les promises fire-and-forget des que le handler retourne). +200-500ms
  // mais on est sur que le mail part. timeout safety au cas ou Resend lag.
  await Promise.race([
    notifyAdmin({
      feedbackId: data.id,
      ticketNumber: data.ticket_number,
      type,
      message,
      user_email: user?.email || anonEmail,
      user_tier: userTier,
      page_url: row.page_url,
    }),
    new Promise(resolve => setTimeout(resolve, 4000)),
  ]).catch(e => console.warn('[feedback] notif admin failed:', e.message));

  return res.status(201).json({
    id: data.id,
    ticket_number: data.ticket_number,
    ok: true,
    message: 'Feedback enregistre. Merci !',
  });
}

async function notifyAdmin({ feedbackId, ticketNumber, type, message, user_email, user_tier, page_url }) {
  const lib = await import('./_lib/email.js');
  if (!lib.emailFeedbackReceived) return;
  const tpl = lib.emailFeedbackReceived({
    feedbackId,
    ticketNumber,
    type,
    message,
    user_email,
    user_tier,
    page_url,
  });
  return lib.sendEmail({
    to: ADMIN_EMAILS[0],
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  });
}

// ── GET : list feedbacks
//   ?mine=1                  → user authentifie : ses propres feedbacks
//   (sans param ou autre)    → admin only : tous les feedbacks
//   ?status= ?type= ?tag=    → filtres (admin et user)
// ─────────────────────────────────────────────────────────────────────────
async function handleList(req, res) {
  const { status, type, tag, limit, mine } = req.query || {};

  // Mode "mine" : user authentifie liste ses propres feedbacks
  if (mine === '1' || mine === 'true') {
    const user = await resolveUser(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'Authentification requise' });

    let q = sb()
      .from('user_feedback')
      .select('id, ticket_number, type, message, page_url, status, admin_response, responded_at, created_at, tags')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(limit) || 50, 200));

    if (status && VALID_STATUSES.has(status)) q = q.eq('status', status);
    if (type && VALID_TYPES.has(type)) q = q.eq('type', type);

    const { data: feedbacks, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const unread = (feedbacks || []).filter(f => f.admin_response && (!f.responded_at || true)).length;
    const withResponse = (feedbacks || []).filter(f => f.admin_response).length;

    res.setHeader('Cache-Control', 'private, no-cache');
    return res.status(200).json({
      feedbacks: feedbacks || [],
      stats: {
        total: (feedbacks || []).length,
        with_response: withResponse,
        unread_responses: unread,
      },
    });
  }

  // Mode admin : tous les feedbacks
  if (!(await isAdmin(req.headers.authorization))) {
    return res.status(403).json({ error: 'Admin only' });
  }

  let q = sb()
    .from('user_feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit) || 100, 500));

  if (status && VALID_STATUSES.has(status)) q = q.eq('status', status);
  if (type && VALID_TYPES.has(type)) q = q.eq('type', type);
  if (tag) {
    const normalizedTag = normalizeTag(tag);
    if (normalizedTag) q = q.contains('tags', [normalizedTag]);
  }

  const { data: feedbacks, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Resoudre les emails des users authentifies (auth.users non-readable via RLS)
  const userIds = [...new Set(feedbacks.filter(f => f.user_id).map(f => f.user_id))];
  let usersById = {};
  if (userIds.length) {
    try {
      const { data: list } = await sb().auth.admin.listUsers({ perPage: 1000 });
      for (const u of (list?.users || [])) {
        if (userIds.includes(u.id)) usersById[u.id] = u.email;
      }
    } catch (e) { console.warn('[feedback] listUsers failed:', e.message); }
  }

  const enriched = feedbacks.map(f => ({
    ...f,
    user_email: f.user_id ? (usersById[f.user_id] || null) : f.anon_email,
  }));

  // Stats agregees (sur l'ensemble, pas filtre, pour les cards top de la page admin)
  const { data: all } = await sb().from('user_feedback').select('type, status, tags');
  const stats = {
    total: (all || []).length,
    by_type: {},
    by_status: {},
    by_tag: {},
    new_count: 0,
  };
  for (const f of (all || [])) {
    stats.by_type[f.type] = (stats.by_type[f.type] || 0) + 1;
    stats.by_status[f.status] = (stats.by_status[f.status] || 0) + 1;
    if (f.status === 'new') stats.new_count++;
    for (const t of (f.tags || [])) {
      stats.by_tag[t] = (stats.by_tag[t] || 0) + 1;
    }
  }

  res.setHeader('Cache-Control', 'private, no-cache');
  return res.status(200).json({ feedbacks: enriched, stats });
}

// ── PATCH : update status / response / tags
//   Admin : full power (status, admin_response, tags)
//   User loggé : peut fermer (status='closed') son propre feedback uniquement
// ─────────────────────────────────────────────────────────────────────────
async function handleUpdate(req, res) {
  const body = req.body || {};
  const id = body.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'id invalide (uuid attendu)' });
  }

  const adminFlag = await isAdmin(req.headers.authorization);

  // Mode user : seul status='closed' autorise sur son propre feedback
  if (!adminFlag) {
    const user = await resolveUser(req.headers.authorization);
    if (!user) return res.status(401).json({ error: 'Authentification requise' });
    if (body.status !== 'closed') {
      return res.status(403).json({ error: 'Action reservee : seul "fermer" est autorise pour les users' });
    }
    const { data: own } = await sb()
      .from('user_feedback')
      .select('id, user_id, status')
      .eq('id', id)
      .single();
    if (!own || own.user_id !== user.id) {
      return res.status(403).json({ error: 'Tu ne peux fermer que tes propres feedbacks' });
    }
    const { data, error } = await sb()
      .from('user_feedback')
      .update({ status: 'closed' })
      .eq('id', id)
      .select('id, status')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ feedback: data });
  }

  // Mode admin : full
  const updates = {};
  if (body.status !== undefined) {
    if (!VALID_STATUSES.has(body.status)) return res.status(400).json({ error: 'status invalide' });
    updates.status = body.status;
  }
  if (body.admin_response !== undefined) {
    const r = String(body.admin_response).trim();
    if (r.length > 2000) return res.status(400).json({ error: 'reponse trop longue (max 2000)' });
    updates.admin_response = r || null;
    if (r) {
      updates.responded_at = new Date().toISOString();
      if (!updates.status) updates.status = 'responded';
    }
  }
  if (body.tags !== undefined) {
    updates.tags = normalizeTags(body.tags);
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Rien a mettre a jour' });
  }

  const { data: existing } = await sb()
    .from('user_feedback')
    .select('id, ticket_number, type, message, user_id, anon_email, admin_response, source, subject, from_email, inbound_message_id, thread_references')
    .eq('id', id)
    .single();
  if (!existing) return res.status(404).json({ error: 'Feedback introuvable' });

  const { data, error } = await sb()
    .from('user_feedback')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Si admin a ajoute une reponse ET on a un email pour notifier, envoyer
  const newResponse = updates.admin_response;
  const hadResponseBefore = !!existing.admin_response;
  if (newResponse && !hadResponseBefore) {
    let recipientEmail = existing.anon_email;
    if (!recipientEmail && existing.user_id) {
      try {
        const { data: u } = await sb().auth.admin.getUserById(existing.user_id);
        recipientEmail = u?.user?.email || null;
      } catch {}
    }
    if (recipientEmail) {
      // Pour les tickets source=email, on utilise les headers RFC 5322 pour
      // que la reponse atterrisse dans le MEME thread Gmail que le mail
      // original. Pour les tickets widget, headers ignores (pas de thread
      // pre-existant).
      const threadOpts = existing.source === 'email' ? {
        threadSubject: existing.subject ? ('Re: ' + existing.subject.replace(/^(Re:|Fwd:)\s*/i, '')) : null,
        inReplyTo: existing.inbound_message_id ? '<' + existing.inbound_message_id + '>' : null,
        references: (existing.thread_references ? existing.thread_references + ' ' : '') +
                    (existing.inbound_message_id ? '<' + existing.inbound_message_id + '>' : ''),
      } : {};

      // Await + timeout safety pour garantir l'envoi (Vercel serverless tue
      // les promises fire-and-forget des que le handler retourne).
      await Promise.race([
        notifyUserResponse({
          recipientEmail,
          feedbackType: existing.type,
          ticketNumber: existing.ticket_number,
          userMessage: existing.message,
          adminResponse: newResponse,
          ...threadOpts,
        }),
        new Promise(resolve => setTimeout(resolve, 4000)),
      ]).catch(e => console.warn('[feedback] notif user response failed:', e.message));
    }
  }

  return res.status(200).json({ feedback: data });
}

async function notifyUserResponse({ recipientEmail, feedbackType, ticketNumber, userMessage, adminResponse, threadSubject, inReplyTo, references }) {
  const lib = await import('./_lib/email.js');
  if (!lib.emailFeedbackResponse) return;
  const tpl = lib.emailFeedbackResponse({
    feedbackType,
    ticketNumber,
    userMessage,
    adminResponse,
  });
  // Si on a un thread (ticket source=email), on override le sujet pour
  // conserver le "Re: xxx" du thread Gmail original et on ajoute les
  // headers In-Reply-To + References.
  return lib.sendEmail({
    to: recipientEmail,
    subject: threadSubject || tpl.subject,
    html: tpl.html,
    text: tpl.text,
    in_reply_to: inReplyTo,
    references,
  });
}

// ── DELETE : suppression dure d'un feedback
//   Admin : peut supprimer n'importe quel feedback
//   User loggé : peut supprimer son propre feedback (effet RGPD)
//   id passe en query string ou body : ?id=xxx ou { id: xxx }
// ─────────────────────────────────────────────────────────────────────────
async function handleDelete(req, res) {
  const id = req.query?.id || req.body?.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'id invalide (uuid attendu)' });
  }

  const adminFlag = await isAdmin(req.headers.authorization);

  if (adminFlag) {
    const { error } = await sb().from('user_feedback').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, deleted: id, by: 'admin' });
  }

  // User mode : verifie que c'est bien son feedback
  const user = await resolveUser(req.headers.authorization);
  if (!user) return res.status(401).json({ error: 'Authentification requise' });

  const { data: own } = await sb()
    .from('user_feedback')
    .select('id, user_id')
    .eq('id', id)
    .single();
  if (!own) return res.status(404).json({ error: 'Feedback introuvable' });
  if (own.user_id !== user.id) {
    return res.status(403).json({ error: 'Tu ne peux supprimer que tes propres feedbacks' });
  }

  const { error } = await sb().from('user_feedback').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, deleted: id, by: 'user' });
}
