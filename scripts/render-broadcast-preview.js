#!/usr/bin/env node
// scripts/render-broadcast-preview.js
// Genere une preview HTML du template discord_launch (rendu identique
// a ce qui sera envoye en prod). Ecrit dans /tmp et print le path.

const fs = require('fs');
const path = require('path');

// Copie 1:1 de la logique de api/email-broadcast.js pour preview offline.
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function withUtm(url, campaign) {
  if (!url || typeof url !== 'string') return url;
  if (!url.includes('fragvalue.com')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}utm_source=email&utm_medium=broadcast&utm_campaign=${encodeURIComponent(campaign || 'broadcast')}`;
}

function wrapHtml(subject, innerHtml, baseUrl, unsubUrl, campaign) {
  const unsub = unsubUrl || `${baseUrl}/unsubscribed.html`;
  const homeUtm = withUtm(baseUrl, campaign);
  const cgvUtm  = withUtm(`${baseUrl}/cgv.html`, campaign);
  const privUtm = withUtm(`${baseUrl}/privacy.html`, campaign);
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#080909;font-family:'Space Mono',monospace,system-ui,Arial">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080909">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#0f1010;border:1px solid #1c1e1e;border-radius:12px;overflow:hidden">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #1c1e1e">
        <a href="${homeUtm}" style="text-decoration:none;color:#e8eaea;font-family:Anton,sans-serif;font-size:22px;letter-spacing:.04em">Frag<span style="color:#b8ff57">Value</span></a>
      </td></tr>
      <tr><td style="padding:32px 28px;color:#e8eaea">${innerHtml}</td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #1c1e1e;background:rgba(255,255,255,.02)">
        <p style="margin:0;font-size:11px;color:#7a8080;line-height:1.6">FragValue · 969 rue de la Forêt de Disse, 01170 Gex, France · SIREN 104 054 788<br>
        <a href="${homeUtm}" style="color:#7a8080">${baseUrl}</a> &middot; <a href="${cgvUtm}" style="color:#7a8080">CGV</a> &middot; <a href="${privUtm}" style="color:#7a8080">Privacy</a> &middot; <a href="${unsub}" style="color:#7a8080">Se désinscrire</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function buildDiscordLaunch(data, recipientEmail) {
  const baseUrl = 'https://fragvalue.com';
  const subject = data?.subject || `On vient de lancer le Discord FragValue, viens taper la discu`;
  const ctaUrl = data?.discordInvite || 'https://discord.gg/fragvalue';
  const html = wrapHtml(subject, `
    <h1 style="font-family:Anton,sans-serif;font-size:28px;line-height:1.15;color:#e8eaea;margin:0 0 18px;font-weight:800">On vient de lancer notre <span style="color:#b8ff57">Discord community</span></h1>

    <p style="font-size:14px;color:#a8b0b0;margin:0 0 20px;line-height:1.6">Un endroit où la communauté FragValue échange autour du jeu, des stats, et de la progression sur FACEIT.</p>

    <div style="padding:18px 20px;background:rgba(184,255,87,.04);border:1px solid rgba(184,255,87,.2);border-radius:10px;margin-bottom:20px">
      <div style="font-size:11px;color:#b8ff57;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px">Au programme</div>
      <ul style="margin:0;padding-left:20px;font-size:13px;color:#a8b0b0;line-height:1.8">
        <li>Comparer ton <strong style="color:#e8eaea">FV Rating</strong> avec les autres joueurs FACEIT</li>
        <li>Partager tes insights Coach IA et profiter de ceux des autres</li>
        <li>Trouver des coéquipiers FACEIT à ton niveau pour grind ensemble</li>
        <li>Demo reviews collectives de matchs pro tous les dimanches 19h CET</li>
        <li>Channels dédiés par map et par stratégie pour échanger des setups</li>
      </ul>
    </div>

    <p style="font-size:13px;color:#a8b0b0;margin:0 0 18px;line-height:1.7">Le serveur est petit pour l'instant. Si tu rejoins maintenant, un rôle <strong style="color:#f5c842">Early</strong> permanent s'affiche sur ton profil Discord, visible uniquement par les premiers arrivés.</p>

    <p style="text-align:center;margin:28px 0">
      <a href="${ctaUrl}" style="display:inline-block;background:#5865F2;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:800;font-size:14px;letter-spacing:.04em;font-family:'Space Mono',monospace">Rejoindre le Discord &rsaquo;</a>
    </p>

    <p style="font-size:12px;color:#7a8080;margin:18px 0 0;line-height:1.6">À tout de suite,<br><strong style="color:#a8b0b0">FragValue</strong></p>

    <p style="font-size:11px;color:#7a8080;margin:14px 0 0;line-height:1.6">PS : si tu es Pro ou Elite, tu auras automatiquement accès aux channels privés (Elite Lounge, Team Coaching, Pre-match Prep), avec sync des rôles auto via <a href="${withUtm(baseUrl + '/account.html', 'discord_launch')}" style="color:#b8ff57;text-decoration:underline">/account.html</a> sur fragvalue.com.</p>
  `, baseUrl, undefined, 'discord_launch');
  return { subject, html };
}

const sampleEmail = process.argv[2] || 'qdreuillet@gmail.com';
const { subject, html } = buildDiscordLaunch({}, sampleEmail);

const outPath = '/tmp/fragvalue-broadcast-preview.html';
fs.writeFileSync(outPath, html);

console.log(`✅ Preview generated\n`);
console.log(`Subject : ${subject}`);
console.log(`To      : ${sampleEmail} (sample)`);
console.log(`File    : ${outPath}`);
console.log(`\nOpen in browser : open ${outPath}`);
