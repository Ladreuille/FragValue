// api/email-welcome.js - FragValue
// Envoie le mail de bienvenue post-signup. Idempotent : si le mail a deja
// ete envoye pour cet user (profiles.welcome_email_sent_at != null), on
// retourne 200 sans renvoyer (evite les doublons en cas de retry client).
//
// Auth : JWT Supabase obligatoire (Authorization: Bearer ...).
// Trigger : appele par login.html juste apres signup ou apres premiere
// confirmation email reussie.

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Auth requise' });

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    // Idempotence : check si deja envoye
    const { data: profile } = await sb
      .from('profiles')
      .select('welcome_email_sent_at, faceit_nickname')
      .eq('id', user.id)
      .maybeSingle();

    if (profile?.welcome_email_sent_at) {
      return res.status(200).json({ ok: true, alreadySent: true });
    }

    if (!user.email) {
      return res.status(400).json({ error: 'User sans email (provider OAuth ?)' });
    }

    // Send via Resend wrapper
    const { sendEmail } = await import('./_lib/email.js');
    const templates = require('./_lib/email-templates.js');
    const tpl = templates.welcome({
      nickname: profile?.faceit_nickname || (user.email.split('@')[0]),
    });

    const result = await sendEmail({ to: user.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    if (result.error) {
      console.error('[email-welcome] sendEmail error:', result.error);
      return res.status(500).json({ error: 'Email send failed' });
    }

    // Mark as sent (best-effort, on n'echoue pas si la colonne manque)
    try {
      await sb.from('profiles').update({ welcome_email_sent_at: new Date().toISOString() }).eq('id', user.id);
    } catch (_) {}

    return res.status(200).json({ ok: true, sent: true, skipped: result.skipped || false });
  } catch (err) {
    console.error('[email-welcome] error:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
