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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Supabase non configure' });
  }

  try {
    if (req.method === 'POST') return handleCreate(req, res);
    if (req.method === 'GET') return handleList(req, res);
    if (req.method === 'PATCH') return handleUpdate(req, res);
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
  };

  const { data, error } = await sb()
    .from('user_feedback')
    .insert(row)
    .select('id, type, created_at')
    .single();

  if (error) {
    console.error('[feedback] insert error', error);
    return res.status(500).json({ error: 'Impossible d\'enregistrer le feedback' });
  }

  // Notif email admin (non-bloquant si echoue, on ne veut pas casser le UX)
  notifyAdminAsync({
    feedbackId: data.id,
    type,
    message,
    user_email: user?.email || anonEmail,
    user_tier: userTier,
    page_url: row.page_url,
  });

  return res.status(201).json({
    id: data.id,
    ok: true,
    message: 'Feedback enregistre. Merci !',
  });
}

// Async fire-and-forget : on ne await pas pour que le user ait sa reponse vite
function notifyAdminAsync({ feedbackId, type, message, user_email, user_tier, page_url }) {
  (async () => {
    try {
      const lib = await import('./_lib/email.js');
      if (!lib.emailFeedbackReceived) return;
      const tpl = lib.emailFeedbackReceived({
        feedbackId,
        type,
        message,
        user_email,
        user_tier,
        page_url,
      });
      await lib.sendEmail({
        to: ADMIN_EMAILS[0],
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    } catch (e) {
      console.warn('[feedback] notif admin failed:', e.message);
    }
  })();
}

// ── GET : list feedbacks (admin only) ────────────────────────────────────
async function handleList(req, res) {
  if (!(await isAdmin(req.headers.authorization))) {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { status, type, limit } = req.query || {};
  let q = sb()
    .from('user_feedback')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit) || 100, 500));

  if (status && VALID_STATUSES.has(status)) q = q.eq('status', status);
  if (type && VALID_TYPES.has(type)) q = q.eq('type', type);

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

  // Stats agregees
  const stats = {
    total: feedbacks.length,
    by_type: {},
    by_status: {},
    new_count: 0,
  };
  for (const f of feedbacks) {
    stats.by_type[f.type] = (stats.by_type[f.type] || 0) + 1;
    stats.by_status[f.status] = (stats.by_status[f.status] || 0) + 1;
    if (f.status === 'new') stats.new_count++;
  }

  res.setHeader('Cache-Control', 'private, no-cache');
  return res.status(200).json({ feedbacks: enriched, stats });
}

// ── PATCH : update status / response (admin only) ────────────────────────
async function handleUpdate(req, res) {
  if (!(await isAdmin(req.headers.authorization))) {
    return res.status(403).json({ error: 'Admin only' });
  }

  const body = req.body || {};
  const id = body.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return res.status(400).json({ error: 'id invalide (uuid attendu)' });
  }

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
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'Rien a mettre a jour' });
  }

  const { data: existing } = await sb()
    .from('user_feedback')
    .select('id, type, message, user_id, anon_email, admin_response')
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
      notifyUserResponseAsync({
        recipientEmail,
        feedbackType: existing.type,
        userMessage: existing.message,
        adminResponse: newResponse,
      });
    }
  }

  return res.status(200).json({ feedback: data });
}

function notifyUserResponseAsync({ recipientEmail, feedbackType, userMessage, adminResponse }) {
  (async () => {
    try {
      const lib = await import('./_lib/email.js');
      if (!lib.emailFeedbackResponse) return;
      const tpl = lib.emailFeedbackResponse({
        feedbackType,
        userMessage,
        adminResponse,
      });
      await lib.sendEmail({
        to: recipientEmail,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      });
    } catch (e) {
      console.warn('[feedback] notif user response failed:', e.message);
    }
  })();
}
