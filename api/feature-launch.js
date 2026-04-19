// api/feature-launch.js
// Admin-only : envoie un email de lancement a tous les users waitlistes
// sur une feature donnee, et marque notified_at = now().
//
// POST /api/feature-launch
//   body: { feature: '<slug>' }
//   -> { sent, skipped, total }
//
// Anons sans email sont skip silencieusement. Les users deja notifies aussi.

const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const ADMIN_EMAILS = ['qdreuillet@gmail.com'];
const ALLOWED_SLUGS = new Set([
  'lineup-library',
  'pro-demos',
  'pro-benchmarks',
  'prep-veto',
  'anti-strat',
]);

// Metadata par feature (titre, tagline, URL) pour personnaliser l'email
const FEATURE_META = {
  'lineup-library': {
    title: 'Lineup Library',
    tagline: 'Smokes, flashs et molos des pros CS2, filtrables par map et site. Apprends les setups des meilleures équipes.',
    url: 'https://fragvalue.com/lineup-library.html',
  },
  'pro-demos': {
    title: 'Pro Demos Viewer',
    tagline: 'Les matchs des pros (Major, Blast, ESL) en 2D replay, analysables round par round.',
    url: 'https://fragvalue.com/pro-demos.html',
  },
  'pro-benchmarks': {
    title: 'Pro Benchmarks',
    tagline: 'Compare ton jeu aux 20 meilleurs joueurs HLTV sur 18 métriques, map par map et par rôle.',
    url: 'https://fragvalue.com/pro-benchmarks.html',
  },
  'prep-veto': {
    title: 'Prep Veto',
    tagline: 'Séquence optimale de bans, picks et decider pour ton prochain match BO1/BO3/BO5, calculée sur la data.',
    url: 'https://fragvalue.com/prep-veto.html',
  },
  'anti-strat': {
    title: 'Anti-Strat Tool',
    tagline: 'Détecte les patterns répétés d\'une équipe adverse sur N matchs et obtiens des counters actionnables.',
    url: 'https://fragvalue.com/anti-strat.html',
  },
};

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getAdminUser(authHeader) {
  if (!authHeader) return null;
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await sb().auth.getUser(token);
  const u = data?.user;
  if (!u?.email || !ADMIN_EMAILS.includes(u.email)) return null;
  return u;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await getAdminUser(req.headers.authorization);
  if (!admin) return res.status(403).json({ error: 'Admin only' });

  const body = await readBody(req);
  const feature = body.feature || '';
  if (!ALLOWED_SLUGS.has(feature)) return res.status(400).json({ error: 'Feature slug inconnu' });

  const meta = FEATURE_META[feature];
  if (!meta) return res.status(500).json({ error: 'Meta manquante pour ' + feature });

  const s = sb();

  // 1. Liste tous les user_id inscrits non-notifies pour cette feature
  const { data: rows, error: selErr } = await s
    .from('feature_interests')
    .select('id, user_id')
    .eq('feature_slug', feature)
    .is('notified_at', null)
    .not('user_id', 'is', null);

  if (selErr) {
    console.error('feature-launch select error', selErr);
    return res.status(500).json({ error: 'Impossible de lister les interests' });
  }

  const userIds = (rows || []).map(r => r.user_id);
  if (!userIds.length) {
    return res.status(200).json({ sent: 0, skipped: 0, total: 0, message: 'Aucun user a notifier' });
  }

  // 2. Resolve profiles + emails en batch (2 queries au lieu de N+1)
  const nickById = {};
  const emailById = {};
  const { data: profiles } = await s
    .from('profiles')
    .select('id, faceit_nickname')
    .in('id', userIds);
  (profiles || []).forEach(p => { nickById[p.id] = p.faceit_nickname; });
  try {
    const { data: listData } = await s.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const wanted = new Set(userIds);
    (listData?.users || []).forEach(u => {
      if (wanted.has(u.id) && u.email) emailById[u.id] = u.email;
    });
  } catch (e) { console.warn('feature-launch listUsers failed', e.message); }

  // 3. Import email lib (dynamique pour eviter crash au boot si RESEND missing)
  const { sendEmail, emailFeatureLaunch } = await import('./_lib/email.js');

  let sent = 0, skipped = 0, rateLimited = 0, pendingResend = 0;
  const notifiedIds = [];

  // 4. Boucle envoi sequentielle rate-limitee (~8 rq/s, marge Resend free tier)
  const THROTTLE_MS = 120;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const email = emailById[r.user_id];
    if (!email) { skipped++; continue; }
    try {
      const tmpl = emailFeatureLaunch({
        feature_slug: feature,
        feature_title: meta.title,
        feature_tagline: meta.tagline,
        feature_url: meta.url,
        user_nickname: nickById[r.user_id] || null,
      });
      const result = await sendEmail({ to: email, subject: tmpl.subject, html: tmpl.html, text: tmpl.text });
      if (result?.ok) { sent++; notifiedIds.push(r.id); }
      else if (result?.skipped) { pendingResend++; } // RESEND pas configure : on NE marque PAS (permet retry plus tard)
      else if (/rate|429/i.test(result?.error || '')) { rateLimited++; console.warn('Resend rate-limit hit for', email); }
      else { skipped++; console.warn('feature-launch error:', email, result?.error); }
    } catch (e) {
      console.warn('feature-launch send error for', r.user_id, e.message);
      skipped++;
    }
    if (i < rows.length - 1) await new Promise(r => setTimeout(r, THROTTLE_MS));
  }

  // 5. Mark notified (seulement ceux a qui l'email est parti ou a ete skip par no-RESEND)
  if (notifiedIds.length) {
    await s
      .from('feature_interests')
      .update({ notified_at: new Date().toISOString() })
      .in('id', notifiedIds);
  }

  return res.status(200).json({
    sent,
    skipped,
    rateLimited,
    pendingResend,
    total: rows.length,
    resendConfigured: !!process.env.RESEND_API_KEY,
  });
};
