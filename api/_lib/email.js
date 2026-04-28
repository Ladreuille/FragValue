// api/_lib/email.js // FragValue
// Wrapper pour envoyer des emails transactionnels via Resend.
// Si RESEND_API_KEY n'est pas configuree, l'envoi est no-op (log warn).
// Le reste du systeme fonctionne normalement sans email.

// Adresse expediteur : doit correspondre au domaine verifie dans Resend.
// Par convention on utilise un sous-domaine dedie (send.fragvalue.com) pour
// isoler la reputation des emails transactionnels du domaine principal.
// Override possible via EMAIL_FROM env var.
const FROM_DEFAULT = process.env.EMAIL_FROM || 'FragValue <notifications@send.fragvalue.com>';

// Adresse par defaut pour les reponses. Les users qui repondent a une notif
// (feedback, factures, waitlist, etc.) atterrissent ici. Cette boite DOIT
// avoir des MX records configures (ImprovMX forward ou Resend Inbound).
// Si tu utilises seulement Resend outbound, laisse vide pour ne pas ajouter
// de reply_to (les replies rebondiront mais c'est pas un drame initial).
const REPLY_TO_DEFAULT = process.env.EMAIL_REPLY_TO || 'contact@fragvalue.com';

// Resolve reply_to : undefined → default contact@ ; null → pas de reply_to ;
// string/array → valeur fournie. Retourne un objet prêt à être spread dans
// le body JSON (ex: { reply_to: ['contact@...'] } ou {} si null explicite).
function resolveReplyTo(reply_to) {
  if (reply_to === null) return {};
  const val = reply_to || REPLY_TO_DEFAULT;
  if (!val) return {};
  return { reply_to: Array.isArray(val) ? val : [val] };
}

// Envoi email via Resend API (fetch direct, pas de SDK).
// https://resend.com/docs/api-reference/emails/send-email
// Options supplementaires pour threading / reply-to :
//   reply_to      : adresse a laquelle les reponses doivent aller
//                   (undefined = default contact@ ; null = aucun reply-to)
//   in_reply_to   : Message-ID du mail parent (string avec < >)
//   references    : chaine espace-separee de Message-ID (pour Gmail threading)
export async function sendEmail({ to, subject, html, text, from, reply_to, in_reply_to, references }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY manquant - email ignore :', subject, '->', to);
    return { skipped: true };
  }
  if (!to || !subject || (!html && !text)) {
    console.warn('[email] champs manquants', { to, subject });
    return { error: 'missing fields' };
  }
  // Headers de threading RFC 5322 : Gmail / Outlook les utilisent pour
  // regrouper les reponses dans le meme thread.
  const headers = {};
  if (in_reply_to) headers['In-Reply-To'] = in_reply_to;
  if (references)  headers['References']  = references;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || FROM_DEFAULT,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
        // reply_to explicite prime ; sinon on applique le default pour que
        // les replies atterrissent dans la bonne boite. Passer reply_to: null
        // explicitement supprime le default (ex : pour des mails systeme).
        ...(resolveReplyTo(reply_to)),
        ...(Object.keys(headers).length ? { headers } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      // Log verbeux pour diagnostic Vercel (les logs tronquent apres 40 chars)
      console.warn('[email] resend error status=' + res.status + ' name=' + (data.name || 'unknown') + ' message=' + (data.message || ''));
      return {
        error: data.message || 'send failed',
        status: res.status,
        name: data.name,
      };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    console.warn('[email] exception', e.message);
    return { error: e.message };
  }
}

// ── Templates HTML simples (inline CSS pour max compat email clients) ────
const baseStyle = `
  font-family: 'Space Mono', monospace, system-ui, sans-serif;
  color: #e8eaea;
  background: #080909;
  padding: 32px 24px;
  line-height: 1.6;
`;
const cardStyle = `
  background: #0f1010;
  border: 1px solid #1c1e1e;
  border-radius: 12px;
  padding: 24px 28px;
  max-width: 560px;
  margin: 0 auto;
`;
const btnStyle = `
  display: inline-block;
  background: #b8ff57;
  color: #000;
  padding: 12px 24px;
  border-radius: 6px;
  text-decoration: none;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: 12px;
  margin-top: 16px;
`;
const logoStyle = `
  font-family: 'Anton', sans-serif, system-ui;
  font-size: 28px;
  color: #e8eaea;
  letter-spacing: 0.04em;
  margin-bottom: 20px;
  text-align: center;
`;

function wrapEmail(content) {
  return `
    <div style="${baseStyle}">
      <div style="${cardStyle}">
        <div style="${logoStyle}">Frag<span style="color:#b8ff57">Value</span></div>
        ${content}
        <hr style="border:none;border-top:1px solid #1c1e1e;margin:28px 0 16px">
        <div style="font-size:11px;color:#4a5050;text-align:center">
          <a href="https://fragvalue.com/account.html#settings" style="color:#7a8080;text-decoration:none">Gérer mes préférences</a>
          · <a href="https://fragvalue.com" style="color:#7a8080;text-decoration:none">fragvalue.com</a>
        </div>
      </div>
    </div>
  `;
}

export function emailRosterInvite({ team_name, tag, inviter_nickname, proposed_role, message, accept_url }) {
  const roleLine = proposed_role ? `<p style="margin:8px 0;color:#7a8080">Rôle proposé : <strong style="color:#b8ff57">${proposed_role}</strong></p>` : '';
  const msgBlock = message ? `<div style="margin:16px 0;padding:12px 16px;background:#131414;border-left:2px solid #b8ff57;border-radius:0 6px 6px 0;font-size:13px;color:#a8b0b0">"${escapeHtml(message)}"</div>` : '';
  return {
    subject: `${inviter_nickname} t'invite dans "${team_name}"`,
    html: wrapEmail(`
      <h2 style="margin:0 0 12px;color:#e8eaea;font-size:20px;letter-spacing:-.3px">Nouvelle invitation d'équipe</h2>
      <p style="margin:0 0 12px;color:#a8b0b0;font-size:14px">
        <strong style="color:#e8eaea">${escapeHtml(inviter_nickname)}</strong>
        t'invite à rejoindre
        <strong style="color:#b8ff57">${escapeHtml(team_name)}${tag ? ` [${escapeHtml(tag)}]` : ''}</strong>
        sur FragValue.
      </p>
      ${roleLine}
      ${msgBlock}
      <p style="margin:20px 0 0;color:#7a8080;font-size:12px">Clique ci-dessous pour accepter ou décliner :</p>
      <a href="${accept_url}" style="${btnStyle}">Voir l'invitation →</a>
    `),
    text: `${inviter_nickname} t'invite à rejoindre "${team_name}" sur FragValue. ${proposed_role ? 'Rôle proposé : ' + proposed_role + '. ' : ''}${message ? 'Message : "' + message + '". ' : ''}Réponds sur : ${accept_url}`,
  };
}

export function emailInviteAccepted({ team_name, invitee_nickname, team_url }) {
  return {
    subject: `${invitee_nickname} a rejoint ${team_name}`,
    html: wrapEmail(`
      <h2 style="margin:0 0 12px;color:#e8eaea;font-size:20px;letter-spacing:-.3px">Invitation acceptée</h2>
      <p style="margin:0 0 12px;color:#a8b0b0;font-size:14px">
        <strong style="color:#b8ff57">${escapeHtml(invitee_nickname)}</strong>
        a rejoint ton équipe
        <strong style="color:#e8eaea">${escapeHtml(team_name)}</strong>. Ton roster est maintenant à jour.
      </p>
      <a href="${team_url}" style="${btnStyle}">Voir mon équipe →</a>
    `),
    text: `${invitee_nickname} a rejoint ${team_name}. Voir : ${team_url}`,
  };
}

// Feature launch : email envoye aux users waitlistes quand une feature passe live
export function emailFeatureLaunch({ feature_slug, feature_title, feature_tagline, feature_url, user_nickname }) {
  const hi = user_nickname ? `Yo <strong style="color:#b8ff57">${escapeHtml(user_nickname)}</strong>,` : 'Yo,';
  return {
    subject: `${feature_title} est live sur FragValue`,
    html: wrapEmail(`
      <div style="display:inline-block;background:rgba(184,255,87,.1);color:#b8ff57;border:1px solid rgba(184,255,87,.3);padding:3px 10px;border-radius:40px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:14px">Feature lancée</div>
      <h2 style="margin:0 0 12px;color:#e8eaea;font-size:22px;letter-spacing:-.3px">${escapeHtml(feature_title)}</h2>
      <p style="margin:0 0 16px;color:#a8b0b0;font-size:14px;line-height:1.6">${hi} La feature sur laquelle tu avais activé ton intérêt est maintenant disponible.</p>
      <p style="margin:0 0 20px;color:#a8b0b0;font-size:14px;line-height:1.6">${escapeHtml(feature_tagline)}</p>
      <a href="${feature_url}" style="${btnStyle}">Ouvrir ${escapeHtml(feature_title)} →</a>
      <p style="margin:28px 0 0;color:#4a5050;font-size:11px;line-height:1.5">Tu reçois ce message parce que tu as activé les notifications pour <strong style="color:#7a8080">${feature_slug}</strong>. Tu peux <a href="https://fragvalue.com/account.html#settings" style="color:#7a8080">gérer tes préférences</a> depuis ton espace.</p>
    `),
    text: `${feature_title} est live sur FragValue. ${feature_tagline} Ouvre : ${feature_url}`,
  };
}

export function emailInviteDeclined({ team_name, invitee_nickname, team_url }) {
  return {
    subject: `${invitee_nickname} a décliné ton invitation`,
    html: wrapEmail(`
      <h2 style="margin:0 0 12px;color:#e8eaea;font-size:20px;letter-spacing:-.3px">Invitation déclinée</h2>
      <p style="margin:0 0 12px;color:#a8b0b0;font-size:14px">
        <strong style="color:#e8eaea">${escapeHtml(invitee_nickname)}</strong>
        n'a pas souhaité rejoindre
        <strong>${escapeHtml(team_name)}</strong> pour le moment.
      </p>
      <a href="${team_url}" style="${btnStyle}">Inviter un autre joueur →</a>
    `),
    text: `${invitee_nickname} a décliné ton invitation pour ${team_name}.`,
  };
}

// ── Feedback : notif admin a chaque nouveau retour utilisateur ───────────
const FEEDBACK_TYPE_LABELS = {
  positive: { label: 'Positif', color: '#b8ff57', emoji: '+' },
  negative: { label: 'Négatif', color: '#ff4444', emoji: '-' },
  idea:     { label: 'Idée',    color: '#f5c842', emoji: '!' },
  bug:      { label: 'Bug',     color: '#ff8a3d', emoji: 'x' },
};

export function emailFeedbackReceived({ feedbackId, ticketNumber, type, message, user_email, user_tier, page_url }) {
  const meta = FEEDBACK_TYPE_LABELS[type] || { label: type, color: '#7a8080', emoji: '?' };
  const ticket = ticketNumber ? `FB-${String(ticketNumber).padStart(4, '0')}` : '';
  const tierBadge = user_tier ? `<span style="display:inline-block;font-size:10px;background:#1c1e1e;color:#b8ff57;padding:2px 8px;border-radius:40px;letter-spacing:.05em;margin-left:6px;text-transform:uppercase">${escapeHtml(user_tier)}</span>` : '';
  const emailLine = user_email ? `<p style="margin:4px 0;color:#7a8080;font-size:12px">De : <strong style="color:#e8eaea">${escapeHtml(user_email)}</strong>${tierBadge}</p>` : `<p style="margin:4px 0;color:#7a8080;font-size:12px">De : <em>anonyme</em></p>`;
  const pageLine = page_url ? `<p style="margin:4px 0;color:#7a8080;font-size:12px">Page : <a href="${escapeHtml(page_url)}" style="color:#b8ff57;text-decoration:none">${escapeHtml(page_url)}</a></p>` : '';
  const ticketLine = ticket ? `<p style="margin:4px 0;color:#7a8080;font-size:12px">Ticket : <strong style="color:#b8ff57;font-family:monospace">${ticket}</strong></p>` : '';
  return {
    subject: `[${ticket || 'Feedback'} ${meta.label}] ${message.slice(0, 60)}${message.length > 60 ? '...' : ''}`,
    html: wrapEmail(`
      <h2 style="margin:0 0 12px;color:#e8eaea;font-size:20px;letter-spacing:-.3px">Nouveau ticket ${ticket}</h2>
      <div style="display:inline-block;padding:4px 12px;background:${meta.color}1a;border:1px solid ${meta.color}40;color:${meta.color};border-radius:40px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:12px">${meta.label}</div>
      ${ticketLine}
      ${emailLine}
      ${pageLine}
      <div style="margin:16px 0;padding:14px 16px;background:#131414;border-left:2px solid ${meta.color};border-radius:0 6px 6px 0;font-size:13px;color:#e8eaea;white-space:pre-wrap">${escapeHtml(message)}</div>
      <a href="https://fragvalue.com/admin/feedback.html#${feedbackId}" style="${btnStyle}">Répondre →</a>
    `),
    text: `[${ticket} ${meta.label}] ${message}\n\nDe : ${user_email || 'anonyme'}${user_tier ? ' (' + user_tier + ')' : ''}\nPage : ${page_url || '-'}\n\nRépondre : https://fragvalue.com/admin/feedback.html#${feedbackId}`,
  };
}

// ── Feedback : reponse de l'admin envoyee a l'utilisateur ────────────────
export function emailFeedbackResponse({ feedbackType, ticketNumber, userMessage, adminResponse }) {
  const meta = FEEDBACK_TYPE_LABELS[feedbackType] || { label: feedbackType, color: '#7a8080' };
  const ticket = ticketNumber ? `FB-${String(ticketNumber).padStart(4, '0')}` : '';
  return {
    subject: ticket ? `[${ticket}] Réponse à ton feedback FragValue` : `Réponse à ton feedback FragValue`,
    html: wrapEmail(`
      <h2 style="margin:0 0 12px;color:#e8eaea;font-size:20px;letter-spacing:-.3px">Merci pour ton retour</h2>
      <p style="margin:0 0 16px;color:#a8b0b0;font-size:14px">On a pris le temps de regarder ton feedback et voici notre réponse :</p>

      <p style="margin:16px 0 6px;color:#7a8080;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700">Ton message</p>
      <div style="margin:0 0 16px;padding:12px 14px;background:#131414;border-left:2px solid ${meta.color};border-radius:0 6px 6px 0;font-size:13px;color:#a8b0b0;white-space:pre-wrap">${escapeHtml(userMessage)}</div>

      <p style="margin:16px 0 6px;color:#7a8080;font-size:11px;text-transform:uppercase;letter-spacing:.08em;font-weight:700">Notre réponse</p>
      <div style="margin:0 0 16px;padding:12px 14px;background:#131414;border-left:2px solid #b8ff57;border-radius:0 6px 6px 0;font-size:13px;color:#e8eaea;white-space:pre-wrap">${escapeHtml(adminResponse)}</div>

      <p style="margin:20px 0 0;color:#7a8080;font-size:12px">Tu peux nous renvoyer un feedback à tout moment depuis le bouton en bas à droite du site.</p>
      <a href="https://fragvalue.com" style="${btnStyle}">Retour sur FragValue →</a>
    `),
    text: `Merci pour ton feedback. Tu nous as écrit : "${userMessage}"\n\nNotre réponse : ${adminResponse}\n\nfragvalue.com`,
  };
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
