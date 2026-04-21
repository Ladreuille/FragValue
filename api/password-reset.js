// api/password-reset.js
// POST { email } : genere un lien de reset via Supabase admin API puis
// envoie un email custom FragValue (au lieu du template Supabase par defaut).
//
// Le lien genere expire apres 1h (config Supabase) et redirige vers
// /account.html?type=recovery ou l'user peut taper son nouveau mdp.
//
// Anti-enumeration : on repond toujours 200 "email envoye si le compte existe"
// pour eviter de reveler quels emails sont inscrits.
//
// Rate limit : 3 demandes / email / heure (via table password_reset_logs).

import { createClient } from '@supabase/supabase-js';
import { sendEmail } from './_lib/email.js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;
const HOURLY_LIMIT = 3;

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function tooManyRequests(email) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    const { count } = await sb()
      .from('password_reset_logs')
      .select('*', { count: 'exact', head: true })
      .eq('email', email.toLowerCase())
      .gte('created_at', oneHourAgo);
    return (count || 0) >= HOURLY_LIMIT;
  } catch {
    return false; // fail-open : si la table n'existe pas, on laisse passer
  }
}

async function logRequest(email) {
  try {
    await sb().from('password_reset_logs').insert({ email: email.toLowerCase() });
  } catch (e) {
    console.warn('[password-reset] log failed:', e.message);
  }
}

function buildEmailHtml(resetUrl, email) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Reinitialisation de ton mot de passe FragValue</title>
</head>
<body style="margin:0;padding:0;background:#080909;color:#e8eaea;font-family:'Space Mono',monospace,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080909;padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0f1010;border:1px solid #1c1e1e;border-radius:12px;overflow:hidden">
          <tr>
            <td style="padding:32px 32px 0">
              <div style="font-family:'Anton','Arial Black',sans-serif;font-size:28px;color:#b8ff57;letter-spacing:2px">FRAGVALUE</div>
              <div style="display:inline-block;background:#1c1e1e;color:#b8ff57;padding:5px 11px;border-radius:4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;margin-top:10px">Securite du compte</div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 12px">
              <h1 style="font-family:'Anton','Arial Black',sans-serif;font-size:24px;color:#e8eaea;letter-spacing:.5px;margin:16px 0 12px">Reinitialise ton mot de passe</h1>
              <p style="font-size:13px;color:#a8b0b0;margin:0 0 8px">Bonjour,</p>
              <p style="font-size:13px;color:#a8b0b0;margin:0 0 16px">Tu as demande la reinitialisation du mot de passe associe a <strong style="color:#e8eaea">${email}</strong>. Clique sur le bouton ci-dessous pour definir un nouveau mot de passe.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px" align="center">
              <a href="${resetUrl}" style="display:inline-block;background:#b8ff57;color:#000000 !important;padding:14px 28px;border-radius:6px;font-family:'Space Mono',monospace,sans-serif;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:.06em;text-transform:uppercase">Definir un nouveau mot de passe</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px">
              <div style="background:#131414;border-left:3px solid #b8ff57;padding:14px 18px;border-radius:0 6px 6px 0;font-size:12px;color:#a8b0b0;line-height:1.6">
                <strong style="color:#e8eaea;display:block;margin-bottom:4px">A noter</strong>
                Ce lien expire dans 1 heure. Si tu n'es pas a l'origine de cette demande, ignore cet email : ton mot de passe actuel reste actif.
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #1c1e1e;background:#0a0c0c">
              <p style="font-size:11px;color:#7a8080;margin:0 0 6px">Si le bouton ne marche pas, copie-colle ce lien dans ton navigateur :</p>
              <p style="font-size:10px;color:#8a9090;word-break:break-all;font-family:monospace;margin:0"><a href="${resetUrl}" style="color:#8a9090;text-decoration:underline">${resetUrl}</a></p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #1c1e1e;background:#0a0c0c">
              <p style="font-size:10px;color:#7a8080;margin:0 0 4px">Email envoye par FragValue. Tu recois ce message suite a une demande de reinitialisation.</p>
              <p style="font-size:10px;color:#7a8080;margin:0">Besoin d'aide ? <a href="mailto:contact@fragvalue.com" style="color:#b8ff57;text-decoration:none">contact@fragvalue.com</a> &middot; <a href="https://fragvalue.com" style="color:#b8ff57;text-decoration:none">fragvalue.com</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText(resetUrl, email) {
  return `FragValue - Reinitialise ton mot de passe

Bonjour,

Tu as demande la reinitialisation du mot de passe associe a ${email}.

Definir un nouveau mot de passe :
${resetUrl}

Ce lien expire dans 1 heure. Si tu n'es pas a l'origine de cette demande, ignore cet email.

Besoin d'aide ? contact@fragvalue.com
fragvalue.com`;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN_RE.test(origin) || origin.startsWith('http://localhost')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  // Rate limit : 3 / heure / email
  if (await tooManyRequests(email)) {
    // On renvoie 200 meme en cas de rate-limit pour anti-enumeration,
    // mais on log pour suivi.
    console.warn('[password-reset] rate limit hit for', email);
    return res.status(200).json({
      ok: true,
      message: 'Si ce compte existe, un email a ete envoye.',
    });
  }

  try {
    // Genere le lien via Supabase admin API (pas de mail envoye par Supabase)
    const { data, error } = await sb().auth.admin.generateLink({
      type: 'recovery',
      email,
      options: {
        redirectTo: 'https://fragvalue.com/account.html',
      },
    });

    // Si l'email n'existe pas, generateLink peut renvoyer null/error.
    // Anti-enumeration : on renvoie 200 comme si tout s'etait bien passe.
    if (error || !data?.properties?.action_link) {
      console.warn('[password-reset] no link generated for', email, error?.message);
      // On loggue quand meme pour le rate-limit
      await logRequest(email);
      return res.status(200).json({
        ok: true,
        message: 'Si ce compte existe, un email a ete envoye.',
      });
    }

    const resetUrl = data.properties.action_link;
    const html = buildEmailHtml(resetUrl, email);
    const text = buildEmailText(resetUrl, email);

    const result = await sendEmail({
      to: email,
      subject: 'FragValue - Reinitialise ton mot de passe',
      html,
      text,
    });

    if (result.error) {
      console.error('[password-reset] sendEmail error:', result.error);
      // On renvoie quand meme 200 pour anti-enumeration
    }

    await logRequest(email);

    return res.status(200).json({
      ok: true,
      message: 'Si ce compte existe, un email a ete envoye.',
    });
  } catch (e) {
    console.error('[password-reset]', e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
