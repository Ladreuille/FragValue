// api/email-broadcast.js
// Endpoint admin pour envoyer un email broadcast a tous les users actifs
// FragValue (table profiles, status enabled).
//
// Auth : 2 facteurs cumulatifs (defense en profondeur) :
//   1. JWT Supabase valide (user logge)
//   2. L'email du user doit etre dans ADMIN_EMAILS (env var ou hardcoded)
//
// Body :
//   {
//     "subject": string,           // requis
//     "templateKey": string,       // 'discord_launch' (defaut) ou autre
//     "templateData": { ... },     // optionnel, vars du template
//     "audience": "all" | "free" | "pro" | "elite" | "linked_discord" |
//                 "active_30d" | "test",   // segmentation
//     "limit": number,             // optionnel, limite nb emails (test/safety)
//     "dryRun": boolean,           // si true : retourne juste le preview + count, n'envoie rien
//   }
//
// Idempotence :
//   - Logge dans email_broadcast_log (1 row par broadcast)
//   - Track sent_count, failed_count, sample_recipients
//   - Pas de double-envoi : un broadcast est unique par (subject + templateKey + day)
//
// Rate-limit interne :
//   - Resend autorise 10/sec sur free tier, 100/sec sur paid
//   - On bat a 5/sec safe (200ms entre chaque send)
//   - Pour 1000 users -> ~3.5 min, OK pour Vercel Functions (max 60s en hobby,
//     300s en pro). Note : si broadcast > 1000 users, decouper en batchs ou
//     deplacer vers un cron / Railway worker.

import { createClient } from '@supabase/supabase-js';
import { makeUnsubUrl } from './_lib/email-unsub.js';

const ALLOWED_ORIGIN_RE = /^https:\/\/(fragvalue\.com|www\.fragvalue\.com|frag-value(-[a-z0-9-]+)?\.vercel\.app)$/;

// Liste des emails admin autorises a trigger un broadcast.
// On lit depuis env var ADMIN_EMAILS (separateur virgule), avec fallback hardcoded
// pour eviter qu'un oubli env var bloque l'admin.
function getAdminEmails() {
  const fromEnv = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  // Fallback pour le owner. A modifier selon ton email.
  const FALLBACK = ['qdreuillet@gmail.com', 'valuefrag@gmail.com'];
  return Array.from(new Set([...fromEnv, ...FALLBACK]));
}

// Definit les templates dispos. Chaque template prend des templateData et
// retourne { subject, html, text }.
// `unsubUrl` est optionnel : si fourni, il remplace le lien Unsubscribe par
// defaut dans le footer (=> URL signee par user pour conformite RGPD).
function buildTemplate(key, data, recipientEmail, unsubUrl) {
  const baseUrl = process.env.PUBLIC_URL || 'https://fragvalue.com';
  const firstName = data?.firstName || (recipientEmail ? recipientEmail.split('@')[0] : 'joueur');

  if (key === 'discord_launch') {
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

      <p style="font-size:11px;color:#7a8080;margin:14px 0 0;line-height:1.6">PS : si tu es Pro ou Elite, tu auras automatiquement accès aux channels privés (Elite Lounge, Team Coaching, Pre-match Prep), avec sync des rôles auto via /account.html sur fragvalue.com.</p>
    `, baseUrl, unsubUrl);
    const text = `On vient de lancer notre Discord community.

Un endroit où la communauté FragValue échange autour du jeu, des stats, et de la progression sur FACEIT.

Au programme :
- Comparer ton FV Rating avec les autres joueurs FACEIT
- Partager tes insights Coach IA et profiter de ceux des autres
- Trouver des coéquipiers FACEIT à ton niveau pour grind ensemble
- Demo reviews collectives de matchs pro tous les dimanches 19h CET
- Channels dédiés par map et par stratégie pour échanger des setups

Le serveur est petit pour l'instant. Si tu rejoins maintenant, un rôle Early permanent s'affiche sur ton profil Discord, visible uniquement par les premiers arrivés.

Rejoins-nous : ${ctaUrl}

À tout de suite,
FragValue

PS : Pro/Elite → rôles auto sync sur Discord depuis ${baseUrl}/account.html
`;
    return { subject, html, text };
  }

  // Template generique fallback
  const subject = data?.subject || 'Update FragValue';
  const html = wrapHtml(subject, `
    <h1 style="font-family:Anton,sans-serif;font-size:24px;color:#e8eaea;margin:0 0 16px">${escapeHtml(subject)}</h1>
    <p style="font-size:14px;color:#a8b0b0;line-height:1.6">${escapeHtml(data?.body || '(corps vide)')}</p>
  `, baseUrl, unsubUrl);
  const text = `${subject}\n\n${data?.body || ''}\n\nFragValue · ${baseUrl}`;
  return { subject, html, text };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wrapHtml(subject, innerHtml, baseUrl, unsubUrl) {
  // unsubUrl = lien personnalise (signe par user via api/_lib/email-unsub.js).
  // Fallback (page generique) si non fourni - cas des previews ou template
  // generique sans destinataire identifie.
  const unsub = unsubUrl || `${baseUrl}/unsubscribed.html`;
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
        <a href="${baseUrl}" style="text-decoration:none;color:#e8eaea;font-family:Anton,sans-serif;font-size:22px;letter-spacing:.04em">Frag<span style="color:#b8ff57">Value</span></a>
      </td></tr>
      <tr><td style="padding:32px 28px;color:#e8eaea">${innerHtml}</td></tr>
      <tr><td style="padding:18px 28px;border-top:1px solid #1c1e1e;background:rgba(255,255,255,.02)">
        <p style="margin:0;font-size:11px;color:#7a8080;line-height:1.6">FragValue · 969 rue de la Forêt de Disse, 01170 Gex, France · SIREN 104 054 788<br>
        <a href="${baseUrl}" style="color:#7a8080">${baseUrl}</a> &middot; <a href="${baseUrl}/cgv.html" style="color:#7a8080">CGV</a> &middot; <a href="${baseUrl}/privacy.html" style="color:#7a8080">Privacy</a> &middot; <a href="${unsub}" style="color:#7a8080">Se désinscrire</a></p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Recupere la liste des recipients selon l'audience demandee.
// Note schema : la table profiles a `subscription_tier` (pas `plan`) et
// `created_at` (pas `updated_at`). On adapte les filtres en consequence.
async function fetchRecipients(supabase, audience, limit) {
  let query = supabase.from('profiles')
    .select('id, subscription_tier, faceit_nickname, created_at, signup_at')
    .eq('marketing_opt_out', false); // RGPD : exclude les desinscrits
  switch (audience) {
    case 'free':
      query = query.eq('subscription_tier', 'free');
      break;
    case 'pro':
      query = query.eq('subscription_tier', 'pro');
      break;
    case 'elite':
      query = query.eq('subscription_tier', 'elite');
      break;
    case 'active_30d':
      // Pas d'updated_at en DB : on fallback sur signup_at recent (proxy
      // pour "user nouveau") ou created_at. Pour vraie activite, il faudrait
      // joindre matches.last_synced_at ou demos.analysed_at - trop complexe ici.
      query = query.gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString());
      break;
    case 'linked_discord':
      // Subquery via JOIN aurait ete plus propre, mais on filter cote app
      // pour eviter une fonction RPC. On recupere tous les profiles + tous
      // les discord_links et on intersect en JS.
      break;
    case 'test':
      // Mode test : juste 3 user (admin)
      query = query.limit(3);
      break;
    case 'all':
    default:
      // Aucun filter
      break;
  }
  if (limit) query = query.limit(limit);
  const { data: profiles, error } = await query;
  if (error) throw new Error(`Profiles fetch failed: ${error.message}`);
  if (!profiles || profiles.length === 0) return [];

  let userIds = profiles.map(p => p.id);

  if (audience === 'linked_discord') {
    const { data: links } = await supabase.from('discord_links').select('user_id');
    const linkedSet = new Set((links || []).map(l => l.user_id));
    userIds = userIds.filter(id => linkedSet.has(id));
  }

  // Recupere les emails via auth.admin (besoin du service key)
  const recipients = [];
  for (const id of userIds) {
    try {
      const { data } = await supabase.auth.admin.getUserById(id);
      const email = data?.user?.email;
      if (email) {
        const profile = profiles.find(p => p.id === id);
        recipients.push({
          user_id: id,
          email,
          firstName: profile?.faceit_nickname || email.split('@')[0],
          plan: profile?.subscription_tier || 'free',
        });
      }
    } catch (_) { /* skip */ }
  }
  return recipients;
}

// Mode test cible : envoi a UN email precis (override audience).
// Cherche le user dans auth.users via listUsers (paginate par 1000).
// Necessaire pour le user_id qui sert au token unsubscribe signe.
// Note : marketing_opt_out NE filtre PAS ici - le sender admin a explicitement
// targete cet email pour test, donc on respecte l'intention.
async function fetchSingleRecipient(supabase, email) {
  // listUsers retourne max 1000 par page. Pour ~< 50k users on parcourt.
  let page = 1;
  while (page < 50) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users || data.users.length === 0) break;
    const user = data.users.find(u => (u.email || '').toLowerCase() === email);
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, subscription_tier, faceit_nickname')
        .eq('id', user.id)
        .maybeSingle();
      return [{
        user_id: user.id,
        email: user.email,
        firstName: profile?.faceit_nickname || user.email.split('@')[0],
        plan: profile?.subscription_tier || 'free',
      }];
    }
    if (data.users.length < 1000) break;
    page++;
  }
  return [];
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
  if (!authHeader) return res.status(401).json({ error: 'Authentification requise' });

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Token invalide' });

    // Auth admin : email doit etre dans la whitelist
    const adminEmails = getAdminEmails();
    if (!adminEmails.includes((user.email || '').toLowerCase())) {
      console.warn(`[email-broadcast] non-admin user ${user.email} tried to broadcast`);
      return res.status(403).json({ error: 'Forbidden · admin only' });
    }

    const body = req.body || {};
    const subject = body.subject;
    const templateKey = body.templateKey || 'discord_launch';
    const templateData = body.templateData || {};
    const audience = body.audience || 'all';
    const limit = body.limit ? Math.min(parseInt(body.limit), 5000) : null;
    const dryRun = !!body.dryRun;
    const singleEmail = (body.singleEmail || '').trim().toLowerCase();

    if (!subject || typeof subject !== 'string') {
      return res.status(400).json({ error: 'subject required' });
    }
    if (subject.length > 200) {
      return res.status(400).json({ error: 'subject too long (max 200 chars)' });
    }
    if (singleEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(singleEmail)) {
      return res.status(400).json({ error: 'singleEmail invalide' });
    }

    // Slug d'identification du broadcast (utilise pour idempotence + log).
    // Pour singleEmail, on suffixe l'email + timestamp ms pour rendre le slug
    // unique a chaque tentative (tu dois pouvoir relancer le test 10x dans la
    // journee sans collision sur la contrainte UNIQUE de email_broadcast_log).
    const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const subjectSlug = subject.slice(0, 60).replace(/[^a-zA-Z0-9]/g, '_');
    const broadcastSlug = singleEmail
      ? `${templateKey}_${dayKey}_${subjectSlug}_${singleEmail.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`
      : `${templateKey}_${dayKey}_${subjectSlug}`;

    // Anti-double-broadcast (1 broadcast unique par subject + templateKey + day).
    // On skip cette protection si singleEmail est defini : un test dirige peut
    // etre relance plusieurs fois dans la meme journee.
    if (!dryRun && !singleEmail) {
      const { data: existing } = await supabase
        .from('email_broadcast_log')
        .select('id, sent_count')
        .eq('slug', broadcastSlug)
        .maybeSingle();
      if (existing) {
        return res.status(409).json({
          error: 'Ce broadcast a deja ete envoye aujourd\'hui (idempotence par day + subject)',
          existing,
        });
      }
    }

    // Fetch recipients
    let recipients;
    if (singleEmail) {
      recipients = await fetchSingleRecipient(supabase, singleEmail);
      if (recipients.length === 0) {
        return res.status(404).json({
          error: `Aucun user FragValue trouve avec l'email ${singleEmail}`,
          hint: 'L\'email doit correspondre a un compte existant (auth.users)',
        });
      }
    } else {
      recipients = await fetchRecipients(supabase, audience, limit);
    }
    if (recipients.length === 0) {
      return res.status(200).json({
        ok: true,
        audience: singleEmail ? `singleEmail:${singleEmail}` : audience,
        sent: 0,
        message: 'No recipients matching audience',
      });
    }

    // Mode dry run : retourne juste le preview + count
    if (dryRun) {
      const sample = recipients.slice(0, 3);
      const preview = sample.length > 0 ? buildTemplate(templateKey, templateData, sample[0].email) : null;
      return res.status(200).json({
        ok: true,
        dryRun: true,
        audience,
        recipientsCount: recipients.length,
        sampleRecipients: sample.map(r => ({ email: r.email, firstName: r.firstName, plan: r.plan })),
        preview: preview ? { subject: preview.subject, htmlPreview: preview.html.slice(0, 500) + '...' } : null,
      });
    }

    // Insert log row (avant envoi pour idempotence stricte)
    const { data: logRow, error: logErr } = await supabase
      .from('email_broadcast_log')
      .insert({
        slug: broadcastSlug,
        subject,
        template_key: templateKey,
        audience,
        recipients_count: recipients.length,
        triggered_by: user.email,
        triggered_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (logErr) {
      console.error('[email-broadcast] log insert failed:', logErr);
      return res.status(500).json({ error: 'Log insert failed: ' + logErr.message });
    }

    // Envoi en serie avec rate-limit 5/sec
    const { sendEmail } = await import('./_lib/email.js');
    let sent = 0, failed = 0;
    const failedSamples = [];
    const startTime = Date.now();

    const baseUrl = process.env.PUBLIC_URL || 'https://fragvalue.com';
    for (const r of recipients) {
      try {
        // Lien unsubscribe personnalise par user (signe HMAC) : conformite RGPD/CAN-SPAM
        const unsubUrl = makeUnsubUrl(r.user_id, baseUrl);
        const t = buildTemplate(templateKey, { ...templateData, firstName: r.firstName }, r.email, unsubUrl);
        const result = await sendEmail({
          to: r.email,
          subject: t.subject,
          html: t.html,
          text: t.text,
          headers: {
            // RFC 2369 : permet aux clients mail (Gmail, Apple Mail) d'afficher
            // un bouton Unsubscribe natif dans l'UI = meilleur deliverability.
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
        if (result?.error) throw new Error(result.error);
        sent++;
      } catch (err) {
        failed++;
        if (failedSamples.length < 5) failedSamples.push({ email: r.email, error: err.message });
      }
      // Rate limit safety : 200ms entre chaque (= 5/sec)
      await new Promise(r => setTimeout(r, 200));

      // Update log toutes les 50 envois (progress).
      // Note : le query builder Supabase est thenable mais n'expose pas
      // .catch() directement, donc on wrap en try/catch.
      if ((sent + failed) % 50 === 0) {
        try {
          await supabase.from('email_broadcast_log')
            .update({ sent_count: sent, failed_count: failed })
            .eq('id', logRow.id);
        } catch (_) { /* progress log non-critique */ }
      }
    }

    // Final log update
    try {
      await supabase.from('email_broadcast_log')
        .update({
          sent_count: sent,
          failed_count: failed,
          completed_at: new Date().toISOString(),
          failed_samples: failedSamples,
        })
        .eq('id', logRow.id);
    } catch (logErr) {
      console.warn('[email-broadcast] final log update failed:', logErr?.message);
    }

    const tookMs = Date.now() - startTime;
    console.log(`[email-broadcast] ${broadcastSlug}: sent ${sent} / ${recipients.length} (${failed} failed) in ${tookMs}ms`);

    return res.status(200).json({
      ok: true,
      broadcastId: logRow.id,
      slug: broadcastSlug,
      audience,
      recipientsCount: recipients.length,
      sent,
      failed,
      failedSamples,
      tookMs,
    });
  } catch (err) {
    console.error('[email-broadcast] error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
}
