// api/_lib/email.js // FragValue
// Wrapper pour envoyer des emails transactionnels via Resend.
// Si RESEND_API_KEY n'est pas configuree, l'envoi est no-op (log warn).
// Le reste du systeme fonctionne normalement sans email.

// Adresse expediteur : doit correspondre au domaine verifie dans Resend.
// Par convention on utilise un sous-domaine dedie (send.fragvalue.com) pour
// isoler la reputation des emails transactionnels du domaine principal.
// Override possible via EMAIL_FROM env var.
const FROM_DEFAULT = process.env.EMAIL_FROM || 'FragValue <notifications@send.fragvalue.com>';

// Envoi email via Resend API (fetch direct, pas de SDK).
// https://resend.com/docs/api-reference/emails/send-email
export async function sendEmail({ to, subject, html, text, from }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY manquant — email ignore :', subject, '->', to);
    return { skipped: true };
  }
  if (!to || !subject || (!html && !text)) {
    console.warn('[email] champs manquants', { to, subject });
    return { error: 'missing fields' };
  }
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
          <a href="https://fragvalue.com/account.html" style="color:#7a8080;text-decoration:none">Gérer mes préférences</a>
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
    text: `${inviter_nickname} t'invite a rejoindre "${team_name}" sur FragValue. ${proposed_role ? 'Role propose : ' + proposed_role + '. ' : ''}${message ? 'Message : "' + message + '". ' : ''}Reponds sur : ${accept_url}`,
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
      <p style="margin:28px 0 0;color:#4a5050;font-size:11px;line-height:1.5">Tu reçois ce message parce que tu as activé les notifications pour <strong style="color:#7a8080">${feature_slug}</strong>. Tu peux <a href="https://fragvalue.com/account.html" style="color:#7a8080">gérer tes préférences</a> depuis ton espace.</p>
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
    text: `${invitee_nickname} a decline ton invitation pour ${team_name}.`,
  };
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
