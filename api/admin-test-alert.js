// api/admin-test-alert.js
// Endpoint admin one-shot pour tester que les alertes Discord ops fonctionnent.
// Auth = Supabase JWT + ADMIN_EMAILS (meme que les autres endpoints admin).
//
// Usage : POST sans body. Retourne :
//   { ok: true, configured: true, sent: true } si tout marche
//   { ok: true, configured: false } si DISCORD_WEBHOOK_ALERTS pas set
//   { ok: false, error: "..." } si l'envoi a foire (URL invalide, etc.)
//
// Le user doit voir une notification arriver dans son channel Discord ops.

import { createClient } from '@supabase/supabase-js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

// Lit FRAGVALUE_ADMIN_EMAILS (canonique) puis ADMIN_EMAILS (legacy).
function getAdminEmails() {
  const raw = process.env.FRAGVALUE_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '';
  const fromEnv = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const FALLBACK = ['qdreuillet@gmail.com', 'valuefrag@gmail.com'];
  return Array.from(new Set([...fromEnv, ...FALLBACK]));
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth required' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    const adminEmails = getAdminEmails();
    if (!adminEmails.includes((user.email || '').toLowerCase())) {
      return res.status(403).json({ error: 'Forbidden, admin only' });
    }

    const { sendAlert, isEnabled } = require('./_lib/alert.js');

    if (!isEnabled()) {
      return res.status(200).json({
        ok: true,
        configured: false,
        message: 'DISCORD_WEBHOOK_ALERTS env var not set in Vercel. Ajoute la dans Settings > Environment Variables.',
      });
    }

    const result = await sendAlert({
      severity: 'info',
      title: 'Test alert depuis admin dashboard',
      source: 'admin-test-alert',
      details: {
        triggered_by: user.email,
        timestamp: new Date().toISOString(),
        message: 'Si tu vois ce message dans ton channel Discord, le webhook ops marche.',
      },
    });

    return res.status(200).json({
      ok: true,
      configured: true,
      sent: !!result?.ok,
      result,
    });
  } catch (err) {
    console.error('[admin-test-alert] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
