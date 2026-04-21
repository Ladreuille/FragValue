// api/email-inbound.js — FragValue
// Webhook Resend Inbound : recoit les emails envoyes a contact@fragvalue.com
// (et autres adresses du domaine), les transforme en tickets user_feedback.
//
// Securite : valide la signature HMAC Svix utilisee par Resend webhooks.
// https://resend.com/docs/dashboard/webhooks/introduction
//
// Config env :
//   RESEND_WEBHOOK_SECRET  : secret du webhook Resend (format whsec_...)
//   SUPABASE_URL / SUPABASE_SERVICE_KEY
//   FEEDBACK_FORWARD_EMAIL : adresse qui recoit la notif (defaut: qdreuillet@gmail.com)

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const ADMIN_EMAIL = process.env.FEEDBACK_FORWARD_EMAIL || 'qdreuillet@gmail.com';

// Vercel ne parse pas le body : on a besoin du raw body pour HMAC.
export const config = { api: { bodyParser: false } };

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Verifie la signature Svix (format Resend webhooks).
// Header `svix-signature` contient "v1,<base64sig>" (possibly multiple).
// Signed payload : `${id}.${timestamp}.${body}` HMAC-SHA256 avec secret (base64 decode).
function verifySignature(rawBody, headers) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[email-inbound] RESEND_WEBHOOK_SECRET manquant — signature non verifiee (DEV mode)');
    return true;
  }
  const svixId = headers['svix-id'];
  const svixTs = headers['svix-timestamp'];
  const svixSig = headers['svix-signature'];
  if (!svixId || !svixTs || !svixSig) return false;

  // Anti-replay : rejet si timestamp > 5 min
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(svixTs, 10)) > 300) return false;

  const signedPayload = `${svixId}.${svixTs}.${rawBody}`;
  const cleanSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let expected;
  try {
    expected = crypto
      .createHmac('sha256', Buffer.from(cleanSecret, 'base64'))
      .update(signedPayload)
      .digest('base64');
  } catch (e) {
    console.warn('[email-inbound] HMAC compute error:', e.message);
    return false;
  }

  const sigs = svixSig.split(' ').map(s => s.replace(/^v1,/, ''));
  return sigs.some(s => {
    try {
      const a = Buffer.from(s);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch { return false; }
  });
}

function guessType(subject, text) {
  const s = ((subject || '') + ' ' + (text || '')).toLowerCase();
  if (/bug|erreur|probl[eè]me|crash|404|500/.test(s)) return 'bug';
  if (/merci|super|g[eé]nial|excellent|amazing|love|thank/.test(s)) return 'positive';
  if (/plainte|nul|mauvais|remboursement|d[eé]cevant|bad|refund/.test(s)) return 'negative';
  return 'idea';
}

async function findUserByEmail(email) {
  if (!email) return null;
  try {
    const { data } = await sb().auth.admin.listUsers({ perPage: 1000 });
    const match = (data?.users || []).find(u => (u.email || '').toLowerCase() === email.toLowerCase());
    return match?.id || null;
  } catch {
    return null;
  }
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return res.status(503).json({ error: 'Service indisponible' });
  }

  const rawBuf = await buffer(req);
  const rawBody = rawBuf.toString('utf8');

  if (!verifySignature(rawBody, req.headers)) {
    console.warn('[email-inbound] Signature invalide');
    return res.status(401).json({ error: 'Signature invalide' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    return res.status(400).json({ error: 'Body JSON invalide' });
  }

  // Events non-inbound (delivered, bounced) : ACK 200 sans traiter
  const evtType = payload.type || payload.event || '';
  if (!/inbound|received|email\.received/i.test(evtType)) {
    return res.status(200).json({ ok: true, skipped: true, type: evtType });
  }

  // Le webhook Resend Inbound ne contient que les metadonnees (pas le body).
  // On recupere le contenu complet via GET /emails/:email_id avec la RESEND_API_KEY.
  const data = payload.data || payload.email || payload;
  const fromRaw = data.from || data.sender || null;
  const fromEmail = typeof fromRaw === 'string' ? fromRaw : (fromRaw?.email || data.from_email || null);
  const fromName = typeof fromRaw === 'object' ? fromRaw?.name : null;
  const toList = data.to || data.recipients || [];
  const toEmail = (Array.isArray(toList) && toList.length)
    ? (typeof toList[0] === 'string' ? toList[0] : (toList[0]?.email || null))
    : (typeof toList === 'string' ? toList : null);
  const subject = String(data.subject || '').slice(0, 300);
  const emailId = data.email_id || data.id || null;
  const messageId = data.message_id || data.messageId || data['message-id'] || null;

  if (!fromEmail) {
    return res.status(400).json({ error: 'No sender email' });
  }

  // Fetch le contenu complet du mail via l'API Resend
  let text = '';
  let html = null;
  let inReplyTo = null;
  let references = null;
  if (emailId && process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/emails/receiving/' + emailId, {
        headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
      });
      if (r.ok) {
        const full = await r.json();
        text = String(full.text || '').trim();
        html = full.html || null;
        // Headers peut etre un objet {In-Reply-To, References} ou un tableau
        const h = full.headers || {};
        const getHdr = (k) => {
          if (Array.isArray(h)) {
            const found = h.find(x => String(x.name || '').toLowerCase() === k);
            return found?.value || null;
          }
          return h[k] || h[k.replace(/\b\w/g, c => c.toUpperCase())] || null;
        };
        inReplyTo = getHdr('in-reply-to');
        references = getHdr('references');
      } else {
        console.warn('[email-inbound] fetch email failed:', r.status, await r.text().catch(() => ''));
      }
    } catch (e) {
      console.warn('[email-inbound] fetch email error:', e.message);
    }
  }

  if (!text && !html) {
    // Fallback : accepte le ticket sans body (placeholder) pour ne pas perdre de l'info
    text = '(contenu du mail non disponible - recuperation API Resend echouee)';
  }

  // Threading : si reply a un ticket existant, on append au lieu de creer
  let parentFeedback = null;
  if (inReplyTo) {
    const { data: existing } = await sb()
      .from('user_feedback')
      .select('id, ticket_number, message, admin_response')
      .eq('inbound_message_id', String(inReplyTo).replace(/[<>]/g, ''))
      .maybeSingle();
    if (existing) parentFeedback = existing;
  }
  // Fallback : subject contient "FB-XXXX" ou "FB XXXX"
  if (!parentFeedback) {
    const m = subject.match(/FB[-\s]?(\d+)/i);
    if (m) {
      const num = parseInt(m[1], 10);
      const { data: existing } = await sb()
        .from('user_feedback')
        .select('id, ticket_number, message, admin_response')
        .eq('ticket_number', num)
        .maybeSingle();
      if (existing) parentFeedback = existing;
    }
  }

  if (parentFeedback) {
    // Append comme follow-up, marque comme "new" pour que l'admin voie l'activite
    const divider = '\n\n--- ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' (reply ' + fromEmail + ') ---\n';
    const updates = {
      status: 'new',
      inbound_message_id: (messageId || '').replace(/[<>]/g, '') || null,
      message: (parentFeedback.message || '') + divider + text,
    };
    await sb().from('user_feedback').update(updates).eq('id', parentFeedback.id);
    return res.status(200).json({
      ok: true,
      action: 'appended',
      ticket_number: parentFeedback.ticket_number,
    });
  }

  // Nouveau ticket
  const userId = await findUserByEmail(fromEmail);
  const userTier = userId ? await resolveUserTier(userId) : null;
  const cleanMessageId = (messageId || '').replace(/[<>]/g, '') || null;

  const row = {
    user_id: userId,
    anon_email: userId ? null : fromEmail,
    from_email: fromEmail,
    type: guessType(subject, text),
    subject,
    message: text.slice(0, 10000),
    message_html: html ? String(html).slice(0, 50000) : null,
    user_tier: userTier,
    status: 'new',
    source: 'email',
    inbound_message_id: cleanMessageId,
    thread_references: references,
    page_url: toEmail ? 'mailto:' + toEmail : null,
    user_agent: 'email-inbound',
  };

  const { data: inserted, error } = await sb()
    .from('user_feedback')
    .insert(row)
    .select('id, ticket_number')
    .single();

  if (error) {
    console.error('[email-inbound] insert error', error);
    return res.status(500).json({ error: 'DB insert failed' });
  }

  // Forward notif admin (best effort, ne bloque pas l'ACK)
  try {
    await Promise.race([
      notifyAdminOfEmail({
        ticketNumber: inserted.ticket_number,
        from: fromEmail,
        fromName,
        subject,
        text,
        userTier,
      }),
      new Promise(resolve => setTimeout(resolve, 4000)),
    ]);
  } catch (e) {
    console.warn('[email-inbound] notif admin failed:', e.message);
  }

  return res.status(200).json({
    ok: true,
    action: 'created',
    ticket_number: inserted.ticket_number,
  });
}

async function notifyAdminOfEmail({ ticketNumber, from, fromName, subject, text, userTier }) {
  const lib = await import('./_lib/email.js');
  const ticketCode = 'FB-' + String(ticketNumber).padStart(4, '0');
  const preview = (text || '').slice(0, 500) + (text.length > 500 ? '...' : '');
  const senderLabel = fromName ? (fromName + ' <' + from + '>') : from;
  const tierLine = userTier ? '\nTier : ' + userTier.toUpperCase() : '';
  const escapedPreview = String(preview).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedSubject = String(subject || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedSender = String(senderLabel).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const html = `
    <div style="font-family:'Space Mono',monospace,sans-serif;background:#080909;color:#e8eaea;padding:32px 24px;line-height:1.6">
      <div style="background:#0f1010;border:1px solid #1c1e1e;border-radius:12px;padding:24px 28px;max-width:560px;margin:0 auto">
        <div style="font-family:'Anton',sans-serif;font-size:32px;color:#b8ff57;letter-spacing:2px;margin-bottom:4px">FRAGVALUE</div>
        <div style="background:#1c1e1e;display:inline-block;padding:6px 12px;border-radius:4px;font-size:12px;color:#b8ff57;margin-bottom:20px">Email entrant &middot; ${ticketCode}</div>
        <p style="color:#7a8080;font-size:12px;margin:0 0 4px">De : <span style="color:#e8eaea">${escapedSender}</span>${tierLine}</p>
        <p style="color:#7a8080;font-size:12px;margin:0 0 12px">Sujet : <span style="color:#e8eaea;font-weight:700">${escapedSubject || '(sans sujet)'}</span></p>
        <div style="background:#0a0c0c;border-left:3px solid #b8ff57;padding:14px 16px;border-radius:6px;margin:16px 0;white-space:pre-wrap;font-size:13px">${escapedPreview}</div>
        <a href="https://fragvalue.com/admin/feedback.html#${ticketCode}" style="display:inline-block;background:#b8ff57;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;letter-spacing:.04em;text-transform:uppercase;margin-top:8px">Ouvrir le ticket &rarr;</a>
      </div>
    </div>`;

  return lib.sendEmail({
    to: ADMIN_EMAIL,
    subject: `[${ticketCode}] ${subject || 'Email entrant'} - de ${from}`,
    html,
    text: `${ticketCode} · Email entrant\n\nDe: ${senderLabel}${tierLine}\nSujet: ${subject}\n\n${preview}\n\n→ https://fragvalue.com/admin/feedback.html#${ticketCode}`,
    reply_to: from,
  });
}
