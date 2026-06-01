// api/_lib/email-templates.js
// Templates HTML pour les emails transactionnels FragValue.
// Style : cinematic dark, inspiré pub North Face / Apple keynote.
// Inline styles ONLY (no class) pour compat Gmail/Outlook 2016/Apple Mail.
// Layout : tables seulement (pas de flexbox/grid), fonts fallback system.
// Palette FV : accent #b8ff57, success #5dff8c, bg #080909/#0f1010, border #1c1e1e/#2a2c2a.

const BASE_URL = 'https://fragvalue.com';
const FONT_STACK = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO_STACK = "'SF Mono', Menlo, Consolas, monospace";

// Helper : wrapper cinematic. Header avec gradient subtle, footer designed.
function wrap(title, contentHtml) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark only">
<meta name="supported-color-schemes" content="dark only">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#080909;font-family:${FONT_STACK};color:#e8eaea;line-height:1.55;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080909;padding:40px 16px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#0f1010;border:1px solid #1c1e1e;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.45)">

        <tr><td style="padding:28px 36px 24px;background-image:linear-gradient(180deg,rgba(184,255,87,.04) 0%,rgba(184,255,87,0) 100%);border-bottom:1px solid #1c1e1e">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td align="left">
                <a href="${BASE_URL}" style="text-decoration:none;color:#e8eaea;font-family:${FONT_STACK};font-size:22px;font-weight:900;letter-spacing:.06em;text-transform:uppercase">FRAG<span style="color:#b8ff57">VALUE</span></a>
              </td>
              <td align="right" style="font-family:${MONO_STACK};font-size:10px;color:#7a8080;letter-spacing:.18em;text-transform:uppercase">CS2 INTEL // IA</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:36px 36px 32px">
          ${contentHtml}
        </td></tr>

        <tr><td style="height:1px;background-image:linear-gradient(90deg,transparent 0%,#2a2c2a 50%,transparent 100%);font-size:0;line-height:0">&nbsp;</td></tr>

        <tr><td style="padding:24px 36px 28px;background:#0c0d0d">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-family:${FONT_STACK};font-size:11px;color:#a8b0b0;letter-spacing:.04em;line-height:1.7" align="left">
                <div style="font-weight:800;color:#e8eaea;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">FragValue</div>
                <div style="color:#7a8080">CS2 Intelligence pour joueurs FACEIT</div>
              </td>
              <td style="font-family:${FONT_STACK};font-size:11px;line-height:1.7" align="right">
                <a href="${BASE_URL}" style="color:#b8ff57;text-decoration:none;font-weight:700">fragvalue.com</a><br>
                <a href="${BASE_URL}/account.html#settings" style="color:#7a8080;text-decoration:none">Preferences</a> &middot;
                <a href="mailto:contact@fragvalue.com" style="color:#7a8080;text-decoration:none">Support</a>
              </td>
            </tr>
          </table>
        </td></tr>

      </table>

      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin-top:16px">
        <tr><td align="center" style="font-family:${MONO_STACK};font-size:10px;color:#4a5050;letter-spacing:.18em;text-transform:uppercase;padding:8px 0">
          FRAGVALUE &middot; 01170 GEX, FRANCE &middot; SIREN 104 054 788
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}

// Helper : eyebrow label (petite indication au-dessus du H1)
function eyebrow(text, color) {
  return `<div style="font-family:${MONO_STACK};font-size:11px;color:${color || '#b8ff57'};letter-spacing:.22em;text-transform:uppercase;font-weight:700;margin-bottom:14px">${text}</div>`;
}

// Helper : accent line (ligne neon qui sépare deux sections)
function accentLine() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0"><tr><td style="height:1px;background-image:linear-gradient(90deg,#b8ff57 0%,transparent 100%);font-size:0;line-height:0">&nbsp;</td></tr></table>`;
}

// === WELCOME (post signup) ===============================================
// Déclenché après confirmation email réussie. Pousse vers la 1re analyse.
function welcome({ nickname }) {
  const name = nickname || 'joueur';
  const subject = 'Ton 1er FV Rating CS2 t\'attend, ' + name;
  const html = wrap(subject, `
    ${eyebrow('// WELCOME // ACCESS GRANTED')}
    <h1 style="font-family:${FONT_STACK};font-size:40px;line-height:1;color:#e8eaea;margin:0 0 20px;font-weight:900;letter-spacing:-.02em">Bienvenue<br><span style="color:#b8ff57;text-shadow:0 0 24px rgba(184,255,87,.35)">${name}.</span></h1>
    <p style="font-size:15px;color:#a8b0b0;margin:0 0 32px;line-height:1.6;max-width:480px">Ton compte FragValue est actif. 3 étapes pour débloquer ta première analyse cinematic, et voir le jeu autrement.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">

      <tr><td style="padding:20px 22px;background-image:linear-gradient(135deg,#0c0d0d 0%,#101212 100%);border:1px solid #1c1e1e;border-left:3px solid #b8ff57;border-radius:10px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="44" valign="top" style="font-family:${MONO_STACK};font-size:22px;color:#b8ff57;font-weight:900;letter-spacing:-.02em;padding-right:14px">01</td>
            <td>
              <div style="font-family:${FONT_STACK};font-size:14px;color:#e8eaea;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Lie ton compte FACEIT</div>
              <div style="font-size:13px;color:#a8b0b0;line-height:1.6">1 clic depuis ton espace. Import des 5 derniers matchs, et <strong style="color:#b8ff57">auto-sync</strong> (Pro/Elite) qui analyse chaque match dès qu'il se termine.</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="height:10px"></td></tr>

      <tr><td style="padding:20px 22px;background-image:linear-gradient(135deg,#0c0d0d 0%,#101212 100%);border:1px solid #1c1e1e;border-left:3px solid #b8ff57;border-radius:10px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="44" valign="top" style="font-family:${MONO_STACK};font-size:22px;color:#b8ff57;font-weight:900;letter-spacing:-.02em;padding-right:14px">02</td>
            <td>
              <div style="font-family:${FONT_STACK};font-size:14px;color:#e8eaea;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Lance ta 1re analyse</div>
              <div style="font-size:13px;color:#a8b0b0;line-height:1.6">FV Rating, heatmaps, diagnostic Coach IA en moins de 2 minutes. Drag-drop ton .dem ou colle une URL FACEIT. <strong style="color:#e8eaea">5 analyses/mois</strong> en Free.</div>
            </td>
          </tr>
        </table>
      </td></tr>

      <tr><td style="height:10px"></td></tr>

      <tr><td style="padding:20px 22px;background-image:linear-gradient(135deg,#0c0d0d 0%,#101212 100%);border:1px solid #1c1e1e;border-left:3px solid #b8ff57;border-radius:10px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="44" valign="top" style="font-family:${MONO_STACK};font-size:22px;color:#b8ff57;font-weight:900;letter-spacing:-.02em;padding-right:14px">03</td>
            <td>
              <div style="font-family:${FONT_STACK};font-size:14px;color:#e8eaea;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px">Essaie Pro gratuitement 7 jours</div>
              <div style="font-size:13px;color:#a8b0b0;line-height:1.6">Auto-sync FACEIT, 2D Replay, Coach IA 20 msg/jour, KPIs avancés. <strong style="color:#b8ff57">7 jours gratuits</strong> puis 9 EUR/mois (0,30 EUR/jour). Annulation 1 clic avant la fin du trial, rien débité.</div>
            </td>
          </tr>
        </table>
      </td></tr>

    </table>

    ${accentLine()}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px">
      <tr><td style="padding:24px 26px;background-image:linear-gradient(135deg,rgba(184,255,87,.14) 0%,rgba(184,255,87,.03) 60%,rgba(184,255,87,0) 100%);border:1px solid rgba(184,255,87,.4);border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#b8ff57;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:8px">// FOUNDERS DEAL // 50 PLACES</div>
        <div style="font-family:${FONT_STACK};font-size:24px;color:#e8eaea;font-weight:900;line-height:1.15;margin-bottom:8px;letter-spacing:-.01em">Pro à VIE pour <span style="color:#b8ff57;text-shadow:0 0 20px rgba(184,255,87,.4)">99 EUR</span></div>
        <div style="font-size:13px;color:#a8b0b0;line-height:1.6;margin-bottom:14px">Tu deviens fondateur FragValue, accès Pro à vie, channel Discord <span style="color:#b8ff57;font-family:${MONO_STACK}">#founders</span> exclusif. 50 places, on n'en remettra pas.</div>
        <a href="${BASE_URL}/pricing.html#ltd" style="display:inline-block;color:#b8ff57;text-decoration:none;font-weight:800;font-size:13px;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid rgba(184,255,87,.4);padding-bottom:2px">Voir l'offre &rsaquo;</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center" style="padding:8px 0">
        <a href="${BASE_URL}/onboarding.html" style="display:inline-block;background:#b8ff57;color:#000;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:900;font-size:14px;letter-spacing:.12em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 30px rgba(184,255,87,.35),0 8px 20px rgba(0,0,0,.4)">Configurer mon compte &rsaquo;</a>
      </td></tr>
    </table>

    <p style="font-size:12px;color:#7a8080;margin:28px 0 0;line-height:1.6;text-align:center">Une question ? Réponds simplement à ce mail, c'est moi qui lis.</p>
  `);
  const text = `Bienvenue ${name}.

Ton compte FragValue est actif. 3 étapes pour avoir ta 1ère analyse :

01. LIE TON COMPTE FACEIT
    1 clic depuis ton espace. Import 5 derniers matchs + (Pro/Elite)
    auto-sync analyse chaque match automatiquement.

02. LANCE TA 1RE ANALYSE
    FV Rating, heatmaps, diagnostic Coach IA en 2 min.
    Drag-drop .dem ou colle une URL FACEIT. 5 analyses/mois en Free.

03. ESSAIE PRO GRATUITEMENT 7 JOURS
    Auto-sync, 2D Replay, Coach IA 20 msg/jour, KPIs avancés.
    7 jours gratuits puis 9 EUR/mois. Annulation avant fin trial = rien débité.

FOUNDERS DEAL : Pro à VIE 99 EUR (50 places seulement)
${BASE_URL}/pricing.html#ltd

Configurer mon compte : ${BASE_URL}/onboarding.html

Une question ? Réponds à ce mail.

L'équipe FragValue
${BASE_URL}`;
  return { subject, html, text };
}

// === CHECKOUT SUCCESS (post Stripe payment) ==============================
function checkoutSuccess({ nickname, plan, periodEndIso }) {
  const name = nickname || 'joueur';
  const planLabel = plan === 'elite_yearly' || plan === 'elite_monthly' ? 'Elite'
                  : plan === 'pro_yearly' || plan === 'pro_monthly' ? 'Pro'
                  : 'Premium';
  const isYearly = plan?.endsWith('_yearly');
  const renewDate = periodEndIso
    ? new Date(periodEndIso).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : null;
  const subject = `Bienvenue dans ${planLabel}, ton accès premium est actif`;
  const html = wrap(subject, `
    ${eyebrow(`// PAYMENT CONFIRMED // ${planLabel.toUpperCase()} ACTIVE`)}
    <h1 style="font-family:${FONT_STACK};font-size:38px;line-height:1.05;color:#e8eaea;margin:0 0 18px;font-weight:900;letter-spacing:-.02em">Bienvenue dans<br><span style="color:#b8ff57;text-shadow:0 0 24px rgba(184,255,87,.4)">${planLabel}</span>, ${name}.</h1>
    <p style="font-size:15px;color:#a8b0b0;margin:0 0 32px;line-height:1.6">Paiement confirmé. Tout est actif dès maintenant. Voici ce que tu viens de débloquer.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
      <tr><td style="padding:22px 24px;background-image:linear-gradient(135deg,rgba(184,255,87,.12) 0%,rgba(184,255,87,.02) 100%);border:1px solid rgba(184,255,87,.38);border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#b8ff57;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:14px">// UNLOCKED NOW</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT_STACK};font-size:14px;color:#e8eaea;line-height:1.7">
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:8px">Analyses de demos <strong>illimitées</strong></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:8px">2D Replay <strong>frame par frame</strong></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:8px">KPIs avancés, entry, trade, flash eff, util damage</td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:8px">Diagnostic IA refresh par match avec roadmap 7 jours, Chat Coach <strong>${plan?.startsWith('elite') ? '50' : '20'} msg/jour</strong></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:${plan?.startsWith('elite') ? '8' : '0'}px">Match Report round par round</td></tr>
          ${plan?.startsWith('elite') ? `<tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td><strong style="color:#b8ff57">Elite only,</strong> team dashboard, anti-strat, prep veto, pro benchmarks</td></tr>` : ''}
        </table>
      </td></tr>
    </table>

    ${renewDate ? `<p style="font-size:12px;color:#7a8080;margin:0 0 28px;text-align:center;font-family:${MONO_STACK};letter-spacing:.08em">RENOUVELLEMENT AUTO LE <span style="color:#e8eaea;font-weight:700">${renewDate.toUpperCase()}</span> &middot; ANNULATION 1 CLIC DEPUIS TON ESPACE</p>` : ''}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px">
      <tr><td align="center">
        <a href="${BASE_URL}/demo.html" style="display:inline-block;background:#b8ff57;color:#000;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:900;font-size:14px;letter-spacing:.12em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 30px rgba(184,255,87,.35),0 8px 20px rgba(0,0,0,.4)">Lancer une analyse ${planLabel} &rsaquo;</a>
      </td></tr>
    </table>

    ${accentLine()}

    <!-- BLOCKER LEGAL P0 EMAIL : Mention obligatoire du droit de rétractation
         (Code conso art. L221-13 + L221-28-13). Sans cet email comme support
         durable, le user a 14j pour exiger remboursement intégral. -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px">
      <tr><td style="padding:18px 20px;background:#0a0b0b;border:1px solid #1c1e1e;border-radius:10px;font-size:11px;color:#7a8080;line-height:1.7">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#a8b0b0;letter-spacing:.2em;text-transform:uppercase;font-weight:700;margin-bottom:8px">Information légale</div>
        Conformément à l'art. L221-28-13 du Code de la consommation, en demandant l'exécution immédiate du service à la souscription, vous avez renoncé à votre droit de rétractation de 14 jours pour la partie déjà consommée. Vous gardez la possibilité d'annuler votre abonnement à tout moment depuis votre <a href="${BASE_URL}/account.html" style="color:#b8ff57;text-decoration:none">espace compte</a> sans frais ni justification (effet à la fin de la période payée).
        ${isYearly ? `<br><br>Abonnements annuels, art. L215-1 du Code de la consommation, nous vous notifierons par email entre 1 et 3 mois avant chaque échéance afin que vous puissiez choisir de ne pas reconduire.` : ''}
        <br><br>CGV : <a href="${BASE_URL}/cgv.html" style="color:#b8ff57;text-decoration:none">${BASE_URL.replace('https://','')}/cgv.html</a>
      </td></tr>
    </table>

    <p style="font-size:11px;color:#7a8080;margin:18px 0 0;line-height:1.5;text-align:center">Besoin d'aide ? Réponds à ce mail, réponse sous 24h.</p>
  `);
  const text = `Bienvenue dans ${planLabel}, ${name}.

Paiement confirmé. Tu débloques :

> Analyses de demos illimitées
> 2D Replay frame par frame
> KPIs avancés (entry, trade, flash eff, util dmg)
> Diagnostic IA refresh par match, Chat Coach ${plan?.startsWith('elite') ? '50' : '20'} msg/jour
> Match Report round par round
${plan?.startsWith('elite') ? '> Elite only : team dashboard, anti-strat, prep veto, pro benchmarks\n' : ''}
${renewDate ? `RENOUVELLEMENT AUTO LE ${renewDate}. Annulation 1 clic depuis ton espace.\n\n` : ''}Lance ta prochaine analyse : ${BASE_URL}/demo.html

INFORMATION LEGALE
Art. L221-28-13 Code de la consommation : en demandant l'exécution immédiate du service à la souscription, vous avez renoncé à votre droit de rétractation de 14j pour la partie déjà consommée. Annulation possible à tout moment depuis ${BASE_URL}/account.html sans frais (effet fin de période payée).
${isYearly ? `Art. L215-1 : abonnements annuels, vous serez notifié par email entre 1 et 3 mois avant chaque échéance.\n` : ''}CGV : ${BASE_URL}/cgv.html

L'équipe FragValue`;
  return { subject, html, text };
}

// === TRIAL EXPIRING J-3 ==================================================
function trialExpiringJ3({ nickname, planLabel, trialEndIso }) {
  const name = nickname || 'joueur';
  const endDate = trialEndIso
    ? new Date(trialEndIso).toLocaleDateString('fr-FR', { day:'numeric', month:'long' })
    : 'dans 3 jours';
  const subject = `Plus que 3 jours d'essai ${planLabel}, prolonge ou annule en 1 clic`;
  const html = wrap(subject, `
    ${eyebrow('// TRIAL // 3 DAYS LEFT', '#f5c842')}
    <h1 style="font-family:${FONT_STACK};font-size:36px;line-height:1.05;color:#e8eaea;margin:0 0 18px;font-weight:900;letter-spacing:-.02em">3 jours restants<br><span style="color:#b8ff57;text-shadow:0 0 20px rgba(184,255,87,.35)">${name}.</span></h1>
    <p style="font-size:15px;color:#a8b0b0;margin:0 0 28px;line-height:1.6">Ton essai ${planLabel} expire le <strong style="color:#e8eaea">${endDate}</strong>. Voici tes options.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
      <tr>
        <td width="50%" valign="top" style="padding-right:8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:22px 22px;background-image:linear-gradient(135deg,rgba(184,255,87,.12) 0%,rgba(184,255,87,.02) 100%);border:1px solid rgba(184,255,87,.4);border-radius:12px;height:165px;vertical-align:top">
              <div style="font-family:${MONO_STACK};font-size:10px;color:#b8ff57;letter-spacing:.22em;text-transform:uppercase;font-weight:700;margin-bottom:10px">Option A &middot; Continuer</div>
              <div style="font-family:${FONT_STACK};font-size:20px;color:#e8eaea;font-weight:900;line-height:1.15;margin-bottom:8px;letter-spacing:-.01em">Aucune action</div>
              <div style="font-size:12px;color:#a8b0b0;line-height:1.55">Tu gardes auto-sync, 2D Replay, Coach IA. Renouvellement le ${endDate}.</div>
            </td></tr>
          </table>
        </td>
        <td width="50%" valign="top" style="padding-left:8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:22px 22px;background:#0c0d0d;border:1px solid #2a2c2a;border-radius:12px;height:165px;vertical-align:top">
              <div style="font-family:${MONO_STACK};font-size:10px;color:#a8b0b0;letter-spacing:.22em;text-transform:uppercase;font-weight:700;margin-bottom:10px">Option B &middot; Annuler</div>
              <div style="font-family:${FONT_STACK};font-size:20px;color:#e8eaea;font-weight:900;line-height:1.15;margin-bottom:8px;letter-spacing:-.01em">1 clic, 0 frais</div>
              <div style="font-size:12px;color:#a8b0b0;line-height:1.55">Annule avant le ${endDate}, aucun prélèvement. Accès premium jusqu'à la fin.</div>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px">
      <tr><td align="center">
        <a href="${BASE_URL}/account.html" style="display:inline-block;background:#b8ff57;color:#000;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:900;font-size:14px;letter-spacing:.12em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 30px rgba(184,255,87,.35),0 8px 20px rgba(0,0,0,.4)">Gérer mon abonnement &rsaquo;</a>
      </td></tr>
    </table>

    ${accentLine()}

    <p style="font-size:12px;color:#7a8080;margin:0;line-height:1.6;text-align:center"><strong style="color:#a8b0b0">Tip.</strong> Passe au plan annuel pour 2 mois offerts, Pro 90 EUR/an, Elite 250 EUR/an.</p>
  `);
  const text = `3 jours restants, ${name}.

Ton essai ${planLabel} expire le ${endDate}.

OPTION A. Continuer
Aucune action. Renouvellement auto le ${endDate}. Tu gardes auto-sync, 2D Replay, Coach IA.

OPTION B. Annuler
1 clic depuis ${BASE_URL}/account.html avant le ${endDate}. Aucun prélèvement. Accès premium jusqu'à la fin.

Tip : passe au plan annuel pour 2 mois offerts (Pro 90 EUR/an, Elite 250 EUR/an).

L'équipe FragValue`;
  return { subject, html, text };
}

// === COACH CREDITS PURCHASED ============================================
// Envoyé après un achat réussi de pack de crédits Coach IA via Stripe Checkout.
function coachCreditsPurchased({ nickname, packLabel, creditsAdded, balanceAfter, expiresAtIso, amountEur }) {
  const name = nickname || 'joueur';
  const expiresDate = expiresAtIso
    ? new Date(expiresAtIso).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : null;
  const amountStr = (typeof amountEur === 'number')
    ? `${amountEur.toFixed(2).replace('.', ',')} EUR`
    : '';
  const subject = `+${creditsAdded} crédits Coach IA activés, merci ${name}`;

  const html = wrap(subject, `
    ${eyebrow('// COACH CREDITS // ACTIVATED')}
    <h1 style="font-family:${FONT_STACK};font-size:60px;line-height:.95;color:#b8ff57;margin:0 0 12px;font-weight:900;letter-spacing:-.03em;text-shadow:0 0 32px rgba(184,255,87,.5)">+${creditsAdded}</h1>
    <p style="font-family:${FONT_STACK};font-size:18px;color:#e8eaea;margin:0 0 8px;font-weight:700;letter-spacing:-.01em">crédits Coach IA activés.</p>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 32px;line-height:1.6">Merci ${name}, paiement de <strong style="color:#e8eaea">${amountStr}</strong> confirmé. Tes crédits sont disponibles immédiatement sur le Coach IA Conversational.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td style="padding:24px 26px;background-image:linear-gradient(135deg,rgba(184,255,87,.1) 0%,rgba(184,255,87,.02) 100%);border:1px solid rgba(184,255,87,.35);border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#b8ff57;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:14px">// TRANSACTION</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;line-height:2;font-family:${FONT_STACK}">
          <tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px">Pack</td>
            <td align="right" style="color:#e8eaea;font-weight:700">${packLabel}</td>
          </tr>
          <tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px">Crédits ajoutés</td>
            <td align="right" style="color:#b8ff57;font-weight:900;font-family:${MONO_STACK}">+${creditsAdded}</td>
          </tr>
          <tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px;border-top:1px solid #2a2c2a;padding-top:8px">Nouveau solde</td>
            <td align="right" style="color:#e8eaea;font-weight:900;font-size:20px;font-family:${MONO_STACK};border-top:1px solid #2a2c2a;padding-top:8px">${balanceAfter}</td>
          </tr>
          ${expiresDate ? `<tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px">Validité</td>
            <td align="right" style="color:#a8b0b0;font-family:${MONO_STACK};font-size:12px">jusqu'au ${expiresDate}</td>
          </tr>` : ''}
        </table>
      </td></tr>
    </table>

    <p style="font-size:13px;color:#a8b0b0;margin:0 0 28px;line-height:1.7;padding:16px 18px;background:#0a0b0b;border:1px solid #1c1e1e;border-radius:10px">
      <strong style="color:#e8eaea;font-family:${MONO_STACK};font-size:11px;letter-spacing:.16em;text-transform:uppercase;display:block;margin-bottom:6px">Comment ça marche</strong>
      1 crédit = 1 message au-delà de ta limite quotidienne (Pro 5/jour, Elite 30/jour). Les crédits se débitent automatiquement quand tu dépasses ton quota.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">
        <a href="${BASE_URL}/demo.html" style="display:inline-block;background:#b8ff57;color:#000;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:900;font-size:14px;letter-spacing:.12em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 30px rgba(184,255,87,.35),0 8px 20px rgba(0,0,0,.4)">Lancer une analyse &rsaquo;</a>
      </td></tr>
    </table>

    <p style="font-size:11px;color:#7a8080;margin:24px 0 0;line-height:1.5;text-align:center">
      Ta facture est dans <a href="${BASE_URL}/account.html" style="color:#b8ff57;text-decoration:none">ton espace</a>. Une question ? Réponds à ce mail.
    </p>
  `);

  const text = `+${creditsAdded} crédits Coach IA activés. Merci ${name}.

TRANSACTION
Pack            : ${packLabel}
Crédits ajoutés : +${creditsAdded}
Nouveau solde   : ${balanceAfter} crédits
${expiresDate ? `Validité        : jusqu'au ${expiresDate}` : ''}

Montant : ${amountStr}

1 crédit = 1 message au-delà de ta limite quotidienne (Pro 5/jour, Elite 30/jour).

Lance une analyse et chatte avec le Coach : ${BASE_URL}/demo.html
Ta facture est dans ton espace : ${BASE_URL}/account.html

L'équipe FragValue`;

  return { subject, html, text };
}

// === CANCELLATION CONFIRMATION + WIN-BACK PATH ===========================
function cancellationConfirmation({ nickname, planLabel, periodEndIso }) {
  const name = nickname || 'joueur';
  const endDate = periodEndIso
    ? new Date(periodEndIso).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : 'la fin de la période courante';
  const subject = `Résiliation confirmée, ton accès ${planLabel} reste actif jusqu'au ${endDate}`;
  const html = wrap(subject, `
    ${eyebrow('// SUBSCRIPTION // CANCELLED')}
    <h1 style="font-family:${FONT_STACK};font-size:36px;line-height:1.05;color:#e8eaea;margin:0 0 16px;font-weight:900;letter-spacing:-.02em">Résiliation<br><span style="color:#b8ff57;text-shadow:0 0 20px rgba(184,255,87,.35)">confirmée, ${name}.</span></h1>
    <p style="font-size:15px;color:#a8b0b0;margin:0 0 32px;line-height:1.6">Ton abonnement <strong style="color:#e8eaea">${planLabel}</strong> a été résilié. Aucun frais supplémentaire ne sera prélevé.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td style="padding:22px 24px;background-image:linear-gradient(135deg,rgba(184,255,87,.1) 0%,rgba(184,255,87,.02) 100%);border:1px solid rgba(184,255,87,.32);border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#b8ff57;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:14px">// CE QUI SE PASSE MAINTENANT</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT_STACK};font-size:13.5px;color:#e8eaea;line-height:1.7">
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:8px">Accès <strong>${planLabel} actif jusqu'au ${endDate}</strong></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:8px">Après cette date, retour automatique en plan Free</td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:8px">Historique conservé, analyses, FV Rating, Coach IA insights</td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td>Réabonnement possible à tout moment</td></tr>
        </table>
      </td></tr>
    </table>

    ${accentLine()}

    <p style="font-family:${FONT_STACK};font-size:17px;color:#e8eaea;margin:0 0 10px;font-weight:800;letter-spacing:-.01em">Une question rapide.</p>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 28px;line-height:1.6">Qu'est-ce qui n'a pas marché ? Réponds simplement à ce mail avec un mot. On lit toutes les réponses, et ça nous aide à faire mieux.</p>

    <!-- Win-back offer : -50% sur la prochaine période pendant 14j -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px">
      <tr><td style="padding:24px 26px;background-image:linear-gradient(135deg,rgba(245,200,66,.12) 0%,rgba(245,200,66,.02) 100%);border:1px solid rgba(245,200,66,.35);border-radius:12px;text-align:center">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#f5c842;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:8px">// WIN-BACK OFFER</div>
        <div style="font-family:${FONT_STACK};font-size:22px;color:#e8eaea;font-weight:900;line-height:1.15;margin-bottom:8px;letter-spacing:-.01em">Réactive avec <span style="color:#f5c842;text-shadow:0 0 18px rgba(245,200,66,.4)">-50%</span></div>
        <p style="font-size:13px;color:#a8b0b0;margin:0 0 16px;line-height:1.5">Sur les 3 prochains mois, avant le ${endDate}.</p>
        <a href="${BASE_URL}/pricing.html?winback=1" style="display:inline-block;background:#f5c842;color:#000;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:900;font-size:13px;letter-spacing:.12em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 26px rgba(245,200,66,.35),0 6px 16px rgba(0,0,0,.4)">Réactiver -50% &rsaquo;</a>
      </td></tr>
    </table>

    <p style="font-size:11px;color:#7a8080;margin:24px 0 0;line-height:1.5;text-align:center">Conformément à l'art. L215-1 du Code de la consommation, votre résiliation prendra effet le ${endDate}. Aucune pénalité applicable.</p>
  `);
  const text = `Résiliation confirmée, ${name}.

Ton abonnement ${planLabel} a été résilié. Aucun frais supplémentaire.

CE QUI SE PASSE MAINTENANT
> Accès ${planLabel} actif jusqu'au ${endDate}
> Après : retour automatique en plan Free
> Historique conservé (analyses, FV Rating, Coach IA)
> Réabonnement possible à tout moment

QU'EST-CE QUI N'A PAS MARCHE ?
Réponds simplement à ce mail. On lit toutes les réponses.

WIN-BACK -50% (valable jusqu'au ${endDate})
${BASE_URL}/pricing.html?winback=1

Art. L215-1 Code de la consommation, votre résiliation prend effet le ${endDate}. Aucune pénalité.

L'équipe FragValue`;
  return { subject, html, text };
}

// === YEARLY RENEWAL NOTICE (L215-1 OBLIGATOIRE) ==========================
// L215-1-1 du Code conso impose pour les abonnements annuels d'informer le
// user entre 1 et 3 mois avant chaque renouvellement, via un cron quotidien.
// Sanction : 15 000 EUR par contrat non-notifié. Ne JAMAIS skipper.
function yearlyRenewalNotice({ nickname, planLabel, renewDate, daysLeft, amount }) {
  const name = nickname || 'joueur';
  const subject = daysLeft <= 7
    ? `Plus que ${daysLeft}j pour annuler avant le renouvellement annuel`
    : `[Action possible] Ton abonnement ${planLabel} se renouvelle le ${renewDate}`;
  const urgent = daysLeft <= 7;
  const urgencyColor = urgent ? '#f5c842' : '#b8ff57';
  const urgencyText = urgent
    ? `Plus que <strong style="color:#f5c842">${daysLeft} jours</strong> pour décider.`
    : `Tu as encore <strong style="color:#e8eaea">${daysLeft} jours</strong> pour décider.`;
  const html = wrap(subject, `
    ${eyebrow(`// L215-1 NOTICE // ${daysLeft}D LEFT`, urgencyColor)}
    <h1 style="font-family:${FONT_STACK};font-size:34px;line-height:1.05;color:#e8eaea;margin:0 0 16px;font-weight:900;letter-spacing:-.02em">Renouvellement<br><span style="color:${urgencyColor};text-shadow:0 0 20px ${urgent ? 'rgba(245,200,66,.4)' : 'rgba(184,255,87,.35)'}">${renewDate}.</span></h1>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 28px;line-height:1.6">${urgencyText} Conformément à la loi (art. L215-1 Code de la consommation), nous t'informons de la possibilité de ne pas reconduire ton abonnement.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td style="padding:24px 26px;background:#0a0b0b;border:1px solid #2a2c2a;border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#a8b0b0;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:14px">// CONTRAT</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;line-height:2;font-family:${FONT_STACK}">
          <tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px">Plan</td>
            <td align="right" style="color:#e8eaea;font-weight:800">${planLabel}</td>
          </tr>
          <tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px">Montant qui sera prélevé</td>
            <td align="right" style="color:#b8ff57;font-weight:900;font-family:${MONO_STACK};font-size:20px">${amount}</td>
          </tr>
          <tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px;border-top:1px solid #1c1e1e;padding-top:8px">Date du prélèvement</td>
            <td align="right" style="color:#e8eaea;font-weight:800;font-family:${MONO_STACK};border-top:1px solid #1c1e1e;padding-top:8px">${renewDate}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <p style="font-family:${MONO_STACK};font-size:11px;color:#a8b0b0;margin:0 0 18px;letter-spacing:.18em;text-transform:uppercase;text-align:center;font-weight:700">// 2 OPTIONS</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px">
      <tr>
        <td width="50%" align="center" style="padding-right:6px">
          <a href="${BASE_URL}/account.html" style="display:block;background:#b8ff57;color:#000;padding:15px 24px;border-radius:10px;text-decoration:none;font-weight:900;font-size:13px;letter-spacing:.1em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 26px rgba(184,255,87,.3),0 6px 16px rgba(0,0,0,.4)">Garder ${planLabel}</a>
        </td>
        <td width="50%" align="center" style="padding-left:6px">
          <a href="${BASE_URL}/account.html#cancel" style="display:block;background:transparent;color:#a8b0b0;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:800;font-size:13px;letter-spacing:.1em;text-transform:uppercase;font-family:${FONT_STACK};border:1px solid #2a2c2a">Annuler en 1 clic</a>
        </td>
      </tr>
    </table>

    ${accentLine()}

    <p style="font-size:11px;color:#7a8080;margin:0;line-height:1.6">Si tu ne fais rien, ton abonnement sera reconduit pour 1 an le ${renewDate}. L'annulation reste possible à tout moment depuis ton espace, sans frais (effet fin de période payée). Conformément à l'art. L215-1-1 du Code de la consommation.</p>
  `);
  const text = `Renouvellement ${planLabel} le ${renewDate}.

${urgencyText.replace(/<[^>]+>/g, '')}

Conformément à la loi (art. L215-1 Code conso), nous t'informons que ton
abonnement ${planLabel} sera reconduit pour 1 an le ${renewDate} pour ${amount}.

CONTRAT
Plan       : ${planLabel}
Montant    : ${amount}
Date prlvt : ${renewDate}

2 OPTIONS
1. Garder ${planLabel} : aucune action requise.
2. Annuler en 1 clic depuis ton espace :
   ${BASE_URL}/account.html#cancel

L'annulation reste possible à tout moment, sans frais (effet fin de période).

L'équipe FragValue`;
  return { subject, html, text };
}

// === DUNNING SERIE (invoice.payment_failed) ===============================
// 4 emails progressifs J+0/+3/+5/+7 pour récupérer les paiements échoués.
function paymentFailed({ nickname, planLabel, milestone, amount, periodEndIso, portalUrl }) {
  const name = nickname || 'joueur';
  const portal = portalUrl || `${BASE_URL}/account.html`;

  const variants = {
    'j0': {
      subject: `Problème avec ton paiement, 1 minute pour mettre à jour ta carte`,
      eyebrowText: '// PAYMENT // RETRY NEEDED',
      eyebrowColor: '#b8ff57',
      heroTitle: `Ton paiement<br><span style="color:#b8ff57;text-shadow:0 0 20px rgba(184,255,87,.35)">n'est pas passé.</span>`,
      heroSub: `Ta banque a refusé le prélèvement de <strong style="color:#e8eaea">${amount}</strong> pour ton abonnement ${planLabel}. Pas de panique, c'est souvent une carte expirée ou un plafond temporaire.`,
      tone: 'reassure',
      ctaLabel: 'Mettre à jour ma carte',
      ctaSub: '30 secondes',
      footer: `Ton accès ${planLabel} reste actif. On retentera automatiquement dans 3 jours, ou dès que tu mets à jour ta carte.`,
    },
    'j3': {
      subject: `Ton accès ${planLabel} reste actif, mais ta carte a été refusée`,
      eyebrowText: '// PAYMENT // 2ND ATTEMPT FAILED',
      eyebrowColor: '#b8ff57',
      heroTitle: `Rappel,<br><span style="color:#b8ff57;text-shadow:0 0 20px rgba(184,255,87,.35)">paiement en attente.</span>`,
      heroSub: `Le re-essai automatique a échoué. Ton abonnement ${planLabel} (${amount}) reste actif pour le moment, mais on a besoin que tu mettes à jour ta carte pour éviter une interruption.`,
      tone: 'reminder',
      ctaLabel: 'Résoudre maintenant',
      ctaSub: '30 secondes',
      footer: `Si tu changes de carte, le prélèvement reprendra automatiquement. On te recontactera une dernière fois avant de basculer en Free.`,
    },
    'j5': {
      subject: `Dernière tentative dans 48h, ton diagnostic IA et heatmaps à sauver`,
      eyebrowText: '// PAYMENT // 48H BEFORE DOWNGRADE',
      eyebrowColor: '#f5c842',
      heroTitle: `Plus que <span style="color:#f5c842;text-shadow:0 0 22px rgba(245,200,66,.5)">48h</span><br>avant la bascule Free.`,
      heroSub: `On a tenté 3 fois de prélever ${amount} sans succès. Si rien n'est fait dans 48h, ton accès ${planLabel} sera basculé en Free et tu perdras le Diagnostic IA refresh par match, le Chat Coach IA quotidien, le 2D Replay et les KPIs avancés.`,
      tone: 'urgent',
      ctaLabel: 'Résoudre maintenant',
      ctaSub: 'urgent',
      footer: `Ton historique (analyses, FV Rating, watchlist) sera conservé, mais tu ne pourras plus utiliser les features Pro. Tu pourras te réabonner plus tard.`,
    },
    'j7': {
      subject: `Ton abonnement passe en Free aujourd'hui, ton historique reste`,
      eyebrowText: '// PAYMENT // FINAL NOTICE',
      eyebrowColor: '#f5c842',
      heroTitle: `Bascule en <span style="color:#f5c842;text-shadow:0 0 22px rgba(245,200,66,.45)">Free</span><br>aujourd'hui.`,
      heroSub: `Après 4 tentatives infructueuses sur ${amount}, ton abonnement ${planLabel} a été suspendu. Tu repasses automatiquement en plan Free. <strong style="color:#b8ff57">Bonne nouvelle,</strong> ton historique complet (analyses, FV Rating, Coach IA insights) reste accessible.`,
      tone: 'final',
      ctaLabel: 'Réactiver mon abonnement',
      ctaSub: '',
      footer: `Tu peux te réabonner à tout moment depuis pricing.html. Aucune pénalité, aucun frais caché.`,
    },
  };

  const v = variants[milestone] || variants['j0'];
  const accentColor = v.tone === 'urgent' || v.tone === 'final' ? '#f5c842' : '#b8ff57';
  const accentRgba = v.tone === 'urgent' || v.tone === 'final' ? '245,200,66' : '184,255,87';

  const html = wrap(v.subject, `
    ${eyebrow(v.eyebrowText, v.eyebrowColor)}
    <h1 style="font-family:${FONT_STACK};font-size:38px;line-height:1.05;color:#e8eaea;margin:0 0 18px;font-weight:900;letter-spacing:-.02em">${v.heroTitle}</h1>
    <p style="font-size:15px;color:#a8b0b0;margin:0 0 28px;line-height:1.6">${v.heroSub}</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td style="padding:20px 22px;background:#0a0b0b;border:1px solid #1c1e1e;border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#a8b0b0;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:12px">// CAUSES LES PLUS FREQUENTES</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT_STACK};font-size:13px;color:#a8b0b0;line-height:1.7">
          <tr><td width="22" valign="top" style="color:#7a8080;font-family:${MONO_STACK};font-weight:700">01</td><td style="padding-bottom:6px">Carte expirée ou bientôt expirée</td></tr>
          <tr><td width="22" valign="top" style="color:#7a8080;font-family:${MONO_STACK};font-weight:700">02</td><td style="padding-bottom:6px">Plafond mensuel atteint (banque)</td></tr>
          <tr><td width="22" valign="top" style="color:#7a8080;font-family:${MONO_STACK};font-weight:700">03</td><td style="padding-bottom:6px">Carte signalée par la banque (anti-fraude trop sensible)</td></tr>
          <tr><td width="22" valign="top" style="color:#7a8080;font-family:${MONO_STACK};font-weight:700">04</td><td>Carte remplacée sans mise à jour</td></tr>
        </table>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px">
      <tr><td align="center">
        <a href="${portal}" style="display:inline-block;background:${accentColor};color:#000;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:900;font-size:14px;letter-spacing:.12em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 30px rgba(${accentRgba},.35),0 8px 20px rgba(0,0,0,.4)">${v.ctaLabel} &rsaquo;</a>
        ${v.ctaSub ? `<div style="font-family:${MONO_STACK};font-size:10px;color:${accentColor};letter-spacing:.2em;text-transform:uppercase;margin-top:10px;font-weight:700">${v.ctaSub}</div>` : ''}
      </td></tr>
    </table>

    ${accentLine()}

    <p style="font-size:12px;color:#7a8080;margin:0 0 12px;line-height:1.6">${v.footer}</p>
    <p style="font-size:11px;color:#7a8080;margin:0;line-height:1.5">Besoin d'aide ? Réponds à ce mail, on te répond sous 24h.</p>
  `);
  const text = `${v.heroTitle.replace(/<[^>]+>/g, '')}

${v.heroSub.replace(/<[^>]+>/g, '')}

CAUSES FREQUENTES
01. Carte expirée ou bientôt expirée
02. Plafond mensuel atteint (banque)
03. Carte signalée par la banque (anti-fraude)
04. Carte remplacée sans mise à jour

${v.ctaLabel} : ${portal}
${v.ctaSub ? `(${v.ctaSub})\n` : ''}
${v.footer}

Besoin d'aide ? Réponds à ce mail.

L'équipe FragValue`;
  return { subject: v.subject, html, text };
}

// === DEMO ANALYSIS READY (push email avec preview) ========================
// LE PLUS IMPORTANT. Hero massif FV Rating, KPI cards, diagnostic IA, CTAs.
function demoAnalysisReady({ nickname, demoId, map, fvRating, kast, adr, mainAxis }) {
  const name = nickname || 'joueur';
  const ratingNum = Number(fvRating) || 0;
  const ratingStr = ratingNum.toFixed(2);
  const ratingLabel = ratingNum >= 1.20 ? 'TU CARRY'
                    : ratingNum >= 1.05 ? 'AU-DESSUS DE LA MOYENNE'
                    : ratingNum >= 0.95 ? 'DANS LA MOYENNE'
                    : ratingNum >= 0.80 ? 'SOUS LA MOYENNE'
                    : 'MATCH DIFFICILE';
  const ratingColor = ratingNum >= 1.05 ? '#b8ff57' : ratingNum >= 0.95 ? '#e8eaea' : '#f5c842';
  const ratingGlow = ratingNum >= 1.05 ? 'rgba(184,255,87,.55)' : ratingNum >= 0.95 ? 'rgba(232,234,234,.3)' : 'rgba(245,200,66,.45)';
  const mapClean = (map || 'cs2').replace('de_', '').toUpperCase();

  // Fallback diagnostic IA si mainAxis n'est pas fourni
  const diagnostic = mainAxis || (
    ratingNum >= 1.20 ? 'Tu portes l\'équipe. Ton impact en clutch et en opening duels est supérieur à la moyenne du tier. Continue de prendre les duels que tu maîtrises, et regarde les rounds où tu pourrais ouvrir plutôt que trade pour passer un cran au-dessus.'
    : ratingNum >= 1.05 ? 'Match solide, au-dessus de la moyenne. Le Coach IA a détecté 2 patterns où tu peux gagner 0,1 FV Rating en mois, notamment sur ton positioning post-plant et ton timing d\'util sur les retake.'
    : ratingNum >= 0.95 ? 'Match dans la moyenne. Le Coach IA a identifié le moment clé où la game a basculé : c\'est là qu\'on focus pour ton plan d\'action 7 jours.'
    : 'Match difficile mais beaucoup d\'apprentissage. Le Coach IA a isolé les 3 patterns qui t\'ont coûté des rounds, et propose un plan concret pour les corriger sur tes 5 prochains matchs.'
  );

  const subject = `[FV ${ratingStr}] Ton match ${mapClean} est décortiqué, ${ratingLabel.toLowerCase()}`;
  const html = wrap(subject, `
    ${eyebrow(`// ANALYSE READY // ${mapClean}`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td align="center" style="padding:32px 20px 28px;background-image:linear-gradient(180deg,#0c0d0d 0%,#0a0b0b 100%);border:1px solid ${ratingNum >= 1.05 ? 'rgba(184,255,87,.32)' : '#2a2c2a'};border-radius:14px">
        <div style="font-family:${MONO_STACK};font-size:11px;color:#7a8080;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:10px">FV RATING</div>
        <div style="font-family:${FONT_STACK};font-size:84px;line-height:.9;color:${ratingColor};font-weight:900;letter-spacing:-.04em;text-shadow:0 0 40px ${ratingGlow},0 0 80px ${ratingGlow};margin-bottom:8px">${ratingStr}</div>
        <div style="font-family:${MONO_STACK};font-size:11px;color:${ratingColor};letter-spacing:.28em;text-transform:uppercase;font-weight:700">${ratingLabel}</div>
      </td></tr>
    </table>

    <p style="font-family:${MONO_STACK};font-size:11px;color:#a8b0b0;margin:0 0 14px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;text-align:center">// MATCH STATS</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:32px">
      <tr>
        <td width="33%" valign="top" style="padding-right:6px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="padding:22px 12px;background:#0a0b0b;border:1px solid #1c1e1e;border-radius:10px">
              <div style="font-family:${MONO_STACK};font-size:9px;color:#7a8080;letter-spacing:.2em;text-transform:uppercase;font-weight:700;margin-bottom:8px">FV RATING</div>
              <div style="font-family:${FONT_STACK};font-size:34px;line-height:1;color:${ratingColor};font-weight:900;letter-spacing:-.03em;text-shadow:0 0 16px ${ratingGlow}">${ratingStr}</div>
            </td></tr>
          </table>
        </td>
        <td width="33%" valign="top" style="padding:0 3px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="padding:22px 12px;background:#0a0b0b;border:1px solid #1c1e1e;border-radius:10px">
              <div style="font-family:${MONO_STACK};font-size:9px;color:#7a8080;letter-spacing:.2em;text-transform:uppercase;font-weight:700;margin-bottom:8px">KAST</div>
              <div style="font-family:${FONT_STACK};font-size:34px;line-height:1;color:#e8eaea;font-weight:900;letter-spacing:-.03em">${kast ? kast + '<span style="font-size:18px;color:#7a8080">%</span>' : '<span style="color:#4a5050">·</span>'}</div>
            </td></tr>
          </table>
        </td>
        <td width="33%" valign="top" style="padding-left:6px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td align="center" style="padding:22px 12px;background:#0a0b0b;border:1px solid #1c1e1e;border-radius:10px">
              <div style="font-family:${MONO_STACK};font-size:9px;color:#7a8080;letter-spacing:.2em;text-transform:uppercase;font-weight:700;margin-bottom:8px">ADR</div>
              <div style="font-family:${FONT_STACK};font-size:34px;line-height:1;color:#e8eaea;font-weight:900;letter-spacing:-.03em">${adr || '<span style="color:#4a5050">·</span>'}</div>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td style="padding:22px 24px;background-image:linear-gradient(135deg,rgba(184,255,87,.1) 0%,rgba(184,255,87,.02) 100%);border:1px solid rgba(184,255,87,.32);border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#b8ff57;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:12px">// DIAGNOSTIC COACH IA</div>
        <p style="font-family:${FONT_STACK};font-size:14.5px;color:#e8eaea;margin:0;line-height:1.65">${diagnostic}</p>
      </td></tr>
    </table>

    <p style="font-family:${MONO_STACK};font-size:11px;color:#a8b0b0;margin:0 0 14px;letter-spacing:.22em;text-transform:uppercase;font-weight:700">// CE QUI T'ATTEND DANS L'ANALYSE</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;font-family:${FONT_STACK};font-size:13.5px;color:#e8eaea;line-height:1.7">
      <tr><td width="28" valign="top" style="color:#b8ff57;font-weight:900;font-size:16px">&rsaquo;</td><td style="padding-bottom:8px"><strong>Heatmaps tactiques</strong>, où tu meurs, où tu kill, par side</td></tr>
      <tr><td width="28" valign="top" style="color:#b8ff57;font-weight:900;font-size:16px">&rsaquo;</td><td style="padding-bottom:8px"><strong>2D Replay frame par frame</strong>, re-joue tes rounds clutch</td></tr>
      <tr><td width="28" valign="top" style="color:#b8ff57;font-weight:900;font-size:16px">&rsaquo;</td><td><strong>Plan d'action 7 jours</strong>, les 3 axes concrets pour la semaine</td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px">
      <tr><td align="center">
        <a href="${BASE_URL}/heatmap-results.html?id=${demoId}" style="display:inline-block;background:#b8ff57;color:#000;padding:18px 40px;border-radius:10px;text-decoration:none;font-weight:900;font-size:15px;letter-spacing:.12em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 36px rgba(184,255,87,.4),0 10px 24px rgba(0,0,0,.5);text-shadow:0 1px 0 rgba(255,255,255,.2)">Voir l'analyse complète &rsaquo;</a>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px">
      <tr><td align="center">
        <a href="${BASE_URL}/account.html#coach-credits" style="display:inline-block;color:#a8b0b0;padding:10px 20px;text-decoration:none;font-weight:700;font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-family:${FONT_STACK};border-bottom:1px solid #2a2c2a">Acheter un pack crédits Coach IA &rsaquo;</a>
      </td></tr>
    </table>

    ${accentLine()}

    <p style="font-size:11px;color:#7a8080;margin:0;line-height:1.6;text-align:center">Analyse générée pour ${name} &middot; Match ID <span style="font-family:${MONO_STACK};color:#a8b0b0">${demoId}</span></p>
  `);
  const text = `Analyse terminée, ${name}.

================================
FV RATING : ${ratingStr}
${ratingLabel}
================================

Match : ${mapClean}
${kast ? `KAST  : ${kast}%` : ''}
${adr ? `ADR   : ${adr}` : ''}

DIAGNOSTIC COACH IA
${diagnostic}

CE QUI T'ATTEND
> Heatmaps tactiques (où tu meurs / kill, par side)
> 2D Replay frame par frame
> Plan d'action 7 jours (3 axes concrets)

Voir l'analyse complète :
${BASE_URL}/heatmap-results.html?id=${demoId}

Pack crédits Coach IA :
${BASE_URL}/account.html#coach-credits

Match ID : ${demoId}

L'équipe FragValue`;
  return { subject, html, text };
}

// === DAY 3 FOLLOW-UP FREE ================================================
// Free users actifs (>= 1 demo analysée) qui n'ont pas upgrade.
function day3FollowupFree({ nickname, demosCount, fvRating }) {
  const name = String(nickname || 'joueur').replace(/[<>"&]/g, '');
  const subject = `${name}, 3 jours sur FragValue, ce qui change avec Pro`;
  const fvLine = fvRating
    ? `Ton FV Rating moyen sur tes ${demosCount} analyse(s), <strong style="color:#b8ff57;text-shadow:0 0 12px rgba(184,255,87,.4)">${fvRating}</strong>. Pas mal pour un démarrage.`
    : `Tu as déjà lancé ${demosCount} analyse(s) de demo. Pas mal pour un démarrage.`;
  const html = wrap(subject, `
    ${eyebrow('// DAY 3 // YOU\'RE IN')}
    <h1 style="font-family:${FONT_STACK};font-size:38px;line-height:1.05;color:#e8eaea;margin:0 0 18px;font-weight:900;letter-spacing:-.02em">3 jours plus tard,<br><span style="color:#b8ff57;text-shadow:0 0 20px rgba(184,255,87,.35)">${name}.</span></h1>
    <p style="font-size:15px;color:#a8b0b0;margin:0 0 32px;line-height:1.6">${fvLine} Voici ce que tu vas pouvoir faire en plus en passant Pro.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td style="padding:24px 26px;background-image:linear-gradient(135deg,rgba(184,255,87,.1) 0%,rgba(184,255,87,.02) 100%);border:1px solid rgba(184,255,87,.32);border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#b8ff57;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:14px">// CE QUI CHANGE AVEC PRO</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT_STACK};font-size:14px;color:#e8eaea;line-height:1.7">
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:10px"><strong>Analyses illimitées</strong> <span style="color:#7a8080">/ plus de cap à 3/mois, refresh après chaque match FACEIT</span></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:10px"><strong>Coach IA chat 20 messages/jour</strong> <span style="color:#7a8080">/ pose des questions ciblées sur tes patterns</span></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:10px"><strong>2D Replay interactif</strong> <span style="color:#7a8080">/ re-joue tes rounds clutch frame par frame</span></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:10px"><strong>KPIs avancés</strong> <span style="color:#7a8080">/ KAST, opening duels WR, multi-kills, trade rate</span></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td><strong>Heatmaps tactiques</strong> <span style="color:#7a8080">/ où tu meurs, où tu kill, par map et side</span></td></tr>
        </table>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr>
        <td width="50%" valign="middle" style="padding:0 12px 0 0">
          <div style="font-family:${MONO_STACK};font-size:10px;color:#7a8080;letter-spacing:.2em;text-transform:uppercase;font-weight:700;margin-bottom:6px">PRO</div>
          <div style="font-family:${FONT_STACK};font-size:36px;color:#b8ff57;font-weight:900;line-height:1;letter-spacing:-.03em;text-shadow:0 0 18px rgba(184,255,87,.35)">9 EUR<span style="font-size:14px;color:#7a8080;font-weight:700">/mois</span></div>
        </td>
        <td width="50%" valign="middle" style="padding:0 0 0 12px;border-left:1px solid #2a2c2a">
          <div style="font-family:${MONO_STACK};font-size:10px;color:#7a8080;letter-spacing:.2em;text-transform:uppercase;font-weight:700;margin-bottom:6px">DAILY</div>
          <div style="font-family:${FONT_STACK};font-size:36px;color:#e8eaea;font-weight:900;line-height:1;letter-spacing:-.03em">0,30 EUR<span style="font-size:14px;color:#7a8080;font-weight:700">/jour</span></div>
        </td>
      </tr>
    </table>

    <p style="font-size:13px;color:#a8b0b0;margin:0 0 28px;line-height:1.65;text-align:center">Sans engagement, annulable en 1 clic. Pas satisfait dans les 14 premiers jours, on rembourse intégralement (art. L221-28-13).</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px">
      <tr><td align="center">
        <a href="${BASE_URL}/pricing.html?utm_source=email&utm_medium=lifecycle&utm_campaign=day3_followup" style="display:inline-block;background:#b8ff57;color:#000;padding:16px 36px;border-radius:10px;text-decoration:none;font-weight:900;font-size:14px;letter-spacing:.12em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 30px rgba(184,255,87,.35),0 8px 20px rgba(0,0,0,.4)">Voir les plans &rsaquo;</a>
      </td></tr>
    </table>

    ${accentLine()}

    <p style="font-size:12px;color:#7a8080;margin:0 0 8px;line-height:1.6;text-align:center">Tu préfères rester en Free ? Aucun problème.</p>
    <p style="font-size:12px;color:#7a8080;margin:0;line-height:1.6;text-align:center">Tu peux acheter des packs de crédits Coach IA à la demande sur <a href="${BASE_URL}/account.html?utm_source=email&utm_medium=lifecycle&utm_campaign=day3_followup" style="color:#b8ff57;text-decoration:none">ton espace</a>, sans abonnement.</p>
  `);
  const text = `3 jours plus tard, ${name}.

${fvRating ? `Ton FV Rating moyen sur tes ${demosCount} analyse(s) : ${fvRating}` : `Tu as déjà lancé ${demosCount} analyse(s) de demo`}. Pas mal pour un démarrage.

CE QUI CHANGE AVEC PRO
> Analyses illimitées (plus de cap à 3/mois, refresh après chaque match FACEIT)
> Coach IA chat 20 messages/jour pour des questions ciblées
> 2D Replay interactif frame par frame
> KPIs avancés (KAST, opening duels WR, multi-kills, trade rate)
> Heatmaps tactiques par map et par side

PRO     : 9 EUR/mois
DAILY   : 0,30 EUR/jour

Sans engagement, annulable en 1 clic. Satisfait ou remboursé 14 jours (art. L221-28-13).

Voir les plans :
${BASE_URL}/pricing.html?utm_source=email&utm_medium=lifecycle&utm_campaign=day3_followup

Tu préfères rester en Free ? Packs crédits Coach IA à la demande :
${BASE_URL}/account.html

Bonne progression,
L'équipe FragValue`;
  return { subject, html, text };
}

// === REFUND PROCESSED (self-service 14j) ================================
function refundProcessed({ email, amount_eur, currency, refund_id }) {
  const subject = 'Remboursement FragValue confirmé, ' + amount_eur + ' ' + currency;
  const html = wrap(subject, `
    ${eyebrow('// REFUND // PROCESSED')}
    <h1 style="font-family:${FONT_STACK};font-size:38px;line-height:1.05;color:#e8eaea;margin:0 0 16px;font-weight:900;letter-spacing:-.02em">Remboursement<br><span style="color:#b8ff57;text-shadow:0 0 20px rgba(184,255,87,.35)">confirmé.</span></h1>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 28px;line-height:1.6">Ton remboursement de <strong style="color:#e8eaea">${amount_eur} ${currency}</strong> a été déclenché côté Stripe. Le crédit apparaîtra sur ton moyen de paiement sous 5 à 10 jours ouvrés selon ta banque.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td style="padding:24px 26px;background:#0a0b0b;border:1px solid #2a2c2a;border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#a8b0b0;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:14px">// TRANSACTION</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;line-height:2;font-family:${FONT_STACK}">
          <tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px">Montant</td>
            <td align="right" style="color:#b8ff57;font-weight:900;font-family:${MONO_STACK};font-size:18px">${amount_eur} ${currency}</td>
          </tr>
          <tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px">Référence Stripe</td>
            <td align="right" style="color:#a8b0b0;font-family:${MONO_STACK};font-size:11px">${refund_id}</td>
          </tr>
          <tr>
            <td style="color:#7a8080;letter-spacing:.06em;text-transform:uppercase;font-size:11px;border-top:1px solid #1c1e1e;padding-top:8px">Statut accès premium</td>
            <td align="right" style="color:#ff6b6b;font-weight:800;font-family:${MONO_STACK};font-size:11px;letter-spacing:.06em;text-transform:uppercase;border-top:1px solid #1c1e1e;padding-top:8px">Annulé</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <p style="font-size:13px;color:#a8b0b0;margin:0 0 16px;line-height:1.7">Ton compte FragValue est repassé en plan Free. Tu gardes l'accès à ton historique d'analyses, mais les fonctionnalités Pro (Coach IA, 2D replay, KPIs avancés) sont désactivées.</p>

    <p style="font-size:13px;color:#a8b0b0;margin:0 0 28px;line-height:1.7">Si ce remboursement est une erreur ou si tu souhaites te réabonner, contacte-nous à <a href="mailto:contact@fragvalue.com" style="color:#b8ff57;text-decoration:none">contact@fragvalue.com</a>.</p>

    ${accentLine()}

    <p style="font-size:11px;color:#7a8080;margin:0;line-height:1.6">Conformément à notre garantie commerciale 14j. Cf. <a href="${BASE_URL}/cgv.html" style="color:#7a8080;text-decoration:underline">CGV art. 9</a>.</p>
  `);
  const text = `Remboursement FragValue confirmé.

TRANSACTION
Montant       : ${amount_eur} ${currency}
Référence     : ${refund_id}
Statut Pro    : Annulé

Le crédit apparaîtra sur ton moyen de paiement sous 5 à 10 jours ouvrés.

Ton accès Pro/Elite a été annulé immédiatement. Tu repasses en plan Free et tu gardes l'accès à ton historique.

Une question ? Réponds à ce mail ou écris à contact@fragvalue.com.

Conformément à notre garantie commerciale 14j. CGV : ${BASE_URL}/cgv.html`;
  return { subject, html, text };
}

// === LIFETIME DEAL PURCHASED (launch 50 places, 99 EUR one-time) =========
function lifetimeDealPurchased({ nickname, amountEur }) {
  const name = nickname || 'joueur';
  const subject = 'Tu fais partie des 50 fondateurs FragValue, Pro Lifetime actif';
  const html = wrap(subject, `
    ${eyebrow('// FOUNDERS CLUB // LIFETIME ACCESS')}
    <h1 style="font-family:${FONT_STACK};font-size:42px;line-height:1;color:#e8eaea;margin:0 0 16px;font-weight:900;letter-spacing:-.03em">Welcome to the<br><span style="color:#b8ff57;text-shadow:0 0 28px rgba(184,255,87,.5)">Founders Club.</span></h1>
    <p style="font-size:15px;color:#a8b0b0;margin:0 0 32px;line-height:1.6">Merci ${name}. Ton paiement de <strong style="color:#e8eaea">${amountEur} EUR</strong> est confirmé. Tu as maintenant l'accès <strong style="color:#b8ff57">Pro à vie</strong> sur FragValue. Plus jamais de carte, plus jamais d'abonnement.</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td style="padding:26px 28px;background-image:linear-gradient(135deg,rgba(184,255,87,.14) 0%,rgba(184,255,87,.02) 100%);border:1px solid rgba(184,255,87,.4);border-radius:14px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#b8ff57;letter-spacing:.26em;text-transform:uppercase;font-weight:700;margin-bottom:16px">// DEBLOQUE A VIE</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT_STACK};font-size:14.5px;color:#e8eaea;line-height:1.7">
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:10px">Auto-sync FACEIT <strong>illimité</strong></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:10px">Coach IA <strong>20 msg/jour</strong> à vie</td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:10px">Analyses illimitées + <strong>2D Replay frame par frame</strong></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td style="padding-bottom:10px">KPIs avancés + <strong>Pro benchmarks</strong></td></tr>
          <tr><td width="22" valign="top" style="color:#b8ff57;font-weight:900">&rsaquo;</td><td>Toutes les futures features Pro, <strong>gratuitement</strong></td></tr>
        </table>
      </td></tr>
    </table>

    ${accentLine()}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px">
      <tr><td style="padding:22px 24px;background:#0a0b0b;border:1px solid #2a2c2a;border-radius:12px">
        <div style="font-family:${MONO_STACK};font-size:10px;color:#a8b0b0;letter-spacing:.24em;text-transform:uppercase;font-weight:700;margin-bottom:10px">// EXCLUSIF FONDATEURS</div>
        <p style="font-family:${FONT_STACK};font-size:14px;color:#e8eaea;margin:0;line-height:1.65">Tu fais partie des <strong style="color:#b8ff57">50 fondateurs</strong> qui ont cru au projet avant le launch. Un channel Discord privé <span style="background:#1c1e1e;padding:3px 8px;border-radius:4px;color:#b8ff57;font-family:${MONO_STACK};font-size:12px">#founders</span> t'est réservé. On y partage les next features, on prend tes retours en premier, et on débrief les sessions ensemble.</p>
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">
        <a href="${BASE_URL}/dashboard.html" style="display:inline-block;background:#b8ff57;color:#000;padding:18px 40px;border-radius:10px;text-decoration:none;font-weight:900;font-size:15px;letter-spacing:.12em;text-transform:uppercase;font-family:${FONT_STACK};box-shadow:0 0 36px rgba(184,255,87,.4),0 10px 24px rgba(0,0,0,.5)">Accéder à mon espace Pro &rsaquo;</a>
      </td></tr>
    </table>

    <p style="font-size:11px;color:#7a8080;margin:24px 0 0;line-height:1.5;text-align:center">Une question ? Réponds directement à ce mail.</p>
  `);
  const text = `Welcome to the Founders Club, ${name}.

Ton paiement de ${amountEur} EUR est confirmé. Tu as l'accès Pro à vie sur FragValue.

DEBLOQUE A VIE
> Auto-sync FACEIT illimité
> Coach IA 20 msg/jour à vie
> Analyses illimitées + 2D Replay frame par frame
> KPIs avancés + Pro benchmarks
> Toutes les futures features Pro, gratuitement

EXCLUSIF FONDATEURS
Tu fais partie des 50 fondateurs. Channel Discord privé #founders réservé.
On y partage les next features, on prend tes retours en premier, on débrief les sessions ensemble.

Accéder à mon espace : ${BASE_URL}/dashboard.html

L'équipe FragValue
${BASE_URL}`;
  return { subject, html, text };
}

module.exports = { welcome, checkoutSuccess, trialExpiringJ3, coachCreditsPurchased, cancellationConfirmation, yearlyRenewalNotice, paymentFailed, demoAnalysisReady, day3FollowupFree, refundProcessed, lifetimeDealPurchased };
