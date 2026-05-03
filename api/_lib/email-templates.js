// api/_lib/email-templates.js
// Templates HTML pour les emails transactionnels FragValue.
// Toujours fournir un fallback texte (rendu plain text).
// Style inline only (pas de CSS class) pour compatibilite Gmail/Outlook.
// Couleurs : --accent #b8ff57 (vert neon FV), --bg #0f1010, --text #e8eaea.

const BASE_URL = 'https://fragvalue.com';
const FONT_STACK = "'Helvetica Neue', Helvetica, Arial, sans-serif";

// Helper : entoure le contenu d'un wrapper email branded FragValue.
function wrap(title, contentHtml) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#080909;font-family:${FONT_STACK};color:#e8eaea;line-height:1.55">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#080909;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0" style="max-width:540px;background:#0f1010;border:1px solid #1c1e1e;border-radius:14px;overflow:hidden">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #1c1e1e">
          <a href="${BASE_URL}" style="text-decoration:none;color:#e8eaea;font-family:${FONT_STACK};font-size:20px;font-weight:900;letter-spacing:.04em">Frag<span style="color:#b8ff57">Value</span></a>
        </td></tr>
        <tr><td style="padding:32px">
          ${contentHtml}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #1c1e1e;font-size:11px;color:#7a8080;line-height:1.6">
          FragValue &middot; Analyse CS2 IA pour joueurs FACEIT<br>
          <a href="${BASE_URL}" style="color:#b8ff57;text-decoration:none">fragvalue.com</a> &middot;
          <a href="${BASE_URL}/account.html#settings" style="color:#b8ff57;text-decoration:none">Mes préférences</a> &middot;
          <a href="mailto:contact@fragvalue.com" style="color:#b8ff57;text-decoration:none">Support</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// === WELCOME (post signup) ===============================================
// Declenche apres confirmation email reussie. Pousse vers la 1re analyse.
function welcome({ nickname }) {
  const name = nickname || 'joueur';
  const subject = 'Bienvenue sur FragValue, ' + name + ' · prêt pour ton 1er diagnostic ?';
  const html = wrap(subject, `
    <h1 style="font-family:${FONT_STACK};font-size:24px;line-height:1.2;color:#e8eaea;margin:0 0 16px;font-weight:800">Bienvenue ${name}.</h1>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 18px">Ton compte FragValue est actif. Voici ce que tu peux faire dès maintenant :</p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px">
      <tr><td style="padding:14px 16px;background:#080909;border:1px solid #1c1e1e;border-radius:10px;border-left:3px solid #b8ff57">
        <div style="font-size:13px;color:#b8ff57;font-weight:700;letter-spacing:.04em;margin-bottom:4px">1. ANALYSE TA 1RE DEMO</div>
        <div style="font-size:12px;color:#a8b0b0;line-height:1.55">Glisse ton fichier .dem FACEIT, reçois ton FV Rating, heatmaps et plan d'action en moins de 2 minutes. <strong style="color:#e8eaea">1 analyse gratuite par mois</strong> sur le plan Free.</div>
      </td></tr>
      <tr><td style="height:8px"></td></tr>
      <tr><td style="padding:14px 16px;background:#080909;border:1px solid #1c1e1e;border-radius:10px;border-left:3px solid #b8ff57">
        <div style="font-size:13px;color:#b8ff57;font-weight:700;letter-spacing:.04em;margin-bottom:4px">2. CONNECTE TON FACEIT</div>
        <div style="font-size:12px;color:#a8b0b0;line-height:1.55">Pour débloquer le diagnostic IA personnalisé et la roadmap 7 jours basée sur tes 20 derniers matchs.</div>
      </td></tr>
      <tr><td style="height:8px"></td></tr>
      <tr><td style="padding:14px 16px;background:#080909;border:1px solid #1c1e1e;border-radius:10px;border-left:3px solid #b8ff57">
        <div style="font-size:13px;color:#b8ff57;font-weight:700;letter-spacing:.04em;margin-bottom:4px">3. PASSE PRO POUR LES OUTILS COMPLETS</div>
        <div style="font-size:12px;color:#a8b0b0;line-height:1.55">2D Replay frame par frame, KPIs avancés, Diagnostic IA illimité + Chat Coach IA 5 msg/jour, Match Report tactique. <strong style="color:#e8eaea">Sans engagement</strong>, annulation en 1 clic.</div>
      </td></tr>
    </table>

    <p style="text-align:center;margin:24px 0 8px">
      <a href="${BASE_URL}/demo.html?welcome=1" style="display:inline-block;background:#b8ff57;color:#000;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:800;font-size:14px;letter-spacing:.04em;font-family:${FONT_STACK}">Analyser ma 1re demo &rsaquo;</a>
    </p>

    <p style="font-size:11px;color:#7a8080;margin:18px 0 0;line-height:1.5">Une question ? Réponds simplement à ce mail, c'est moi qui lis :)</p>
  `);
  const text = `Bienvenue ${name},

Ton compte FragValue est actif. Voici ce que tu peux faire :

1. ANALYSE TA 1RE DEMO
   Glisse ton fichier .dem FACEIT et reçois ton FV Rating + heatmaps + plan d'action.
   1 analyse gratuite par mois sur le plan Free.

2. CONNECTE TON FACEIT
   Pour le diagnostic IA personnalisé basé sur tes 20 derniers matchs.

3. PASSE PRO (sans engagement)
   2D Replay complet, KPIs avancés, Diagnostic IA illimité + Chat Coach 5/jour, Match Report.
   Dès 9€/mois, annulation en 1 clic.

Lance ta 1re analyse : ${BASE_URL}/demo.html?welcome=1

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
  const subject = `Bienvenue dans ${planLabel} · ton accès premium est actif`;
  const html = wrap(subject, `
    <h1 style="font-family:${FONT_STACK};font-size:24px;line-height:1.2;color:#e8eaea;margin:0 0 16px;font-weight:800">Bienvenue dans <span style="color:#b8ff57">${planLabel}</span>, ${name}.</h1>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 20px">Ton paiement est confirmé et ton accès premium est actif dès maintenant.</p>

    <div style="padding:18px 20px;background:linear-gradient(135deg,rgba(184,255,87,.1),rgba(184,255,87,.02));border:1px solid rgba(184,255,87,.35);border-radius:10px;margin-bottom:20px">
      <div style="font-size:11px;color:#b8ff57;font-weight:700;letter-spacing:.1em;margin-bottom:6px">DÉBLOQUÉ MAINTENANT</div>
      <ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#e8eaea;line-height:1.8">
        <li>Analyses de demos illimitées</li>
        <li>2D Replay frame par frame</li>
        <li>KPIs avancés : entry, trade, flash eff, util damage</li>
        <li>Diagnostic IA refresh par match avec roadmap 7 jours + Chat Coach 5 msg/jour (Pro) ou 30/jour (Elite)</li>
        <li>Match Report round par round</li>
        ${plan?.startsWith('elite') ? '<li><strong>Elite uniquement</strong> : team dashboard, anti-strat, prep veto, pro benchmarks</li>' : ''}
      </ul>
    </div>

    ${renewDate ? `<p style="font-size:12px;color:#7a8080;margin:0 0 24px">Renouvellement automatique le <strong style="color:#e8eaea">${renewDate}</strong>. Tu peux annuler en 1 clic depuis ton espace.</p>` : ''}

    <p style="text-align:center;margin:24px 0 8px">
      <a href="${BASE_URL}/demo.html" style="display:inline-block;background:#b8ff57;color:#000;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:800;font-size:14px;letter-spacing:.04em;font-family:${FONT_STACK}">Lancer une analyse Pro &rsaquo;</a>
    </p>

    <!-- BLOCKER LEGAL P0 EMAIL (cf. ultrareview Trust/Legal + Email lifecycle) :
         Mention obligatoire du droit de retractation (Code conso art. L221-13 +
         L221-28-13). Sans cet email comme support durable, le user a 14j pour
         exiger remboursement integral. Bloc visuellement dedie + CGV link. -->
    <div style="margin-top:28px;padding:14px 16px;background:rgba(255,255,255,.02);border:1px solid #1c1e1e;border-radius:8px;font-size:11px;color:#7a8080;line-height:1.6">
      <strong style="color:#a8b0b0;display:block;margin-bottom:6px">Information legale</strong>
      Conformément à l'art. L221-28-13° du Code de la consommation, en demandant l'exécution immédiate du service à la souscription, vous avez renoncé à votre droit de rétractation de 14 jours pour la partie déjà consommée. Vous gardez la possibilité d'annuler votre abonnement à tout moment depuis votre <a href="${BASE_URL}/account.html" style="color:#b8ff57;text-decoration:none">espace compte</a> sans frais ni justification (effet à la fin de la période payée).
      ${isYearly ? `<br><br>Pour les abonnements annuels : conformément à l'art. L215-1 du Code de la consommation, nous vous notifierons par email entre 1 et 3 mois avant chaque échéance afin que vous puissiez choisir de ne pas reconduire.` : ''}
      <br><br>CGV : <a href="${BASE_URL}/cgv.html" style="color:#b8ff57;text-decoration:none">${BASE_URL.replace('https://','')}/cgv.html</a>
    </div>

    <p style="font-size:11px;color:#7a8080;margin:18px 0 0;line-height:1.5">Besoin d'aide ? Réponds à ce mail, on te répond sous 24h.</p>
  `);
  const text = `Bienvenue dans ${planLabel}, ${name}.

Ton paiement est confirmé. Tu débloques :

- Analyses de demos illimitées
- 2D Replay frame par frame
- KPIs avancés (entry, trade, flash eff, util dmg)
- Diagnostic IA refresh par match + Chat Coach 5 msg/jour (Pro) ou 30/jour (Elite)
- Match Report round par round
${plan?.startsWith('elite') ? '- Elite : team dashboard, anti-strat, prep veto, pro benchmarks\n' : ''}
${renewDate ? `Renouvellement le ${renewDate}. Annulation en 1 clic depuis ton espace.\n\n` : ''}Lance ta prochaine analyse : ${BASE_URL}/demo.html

INFORMATION LÉGALE :
Art. L221-28-13° Code de la consommation : en demandant l'execution immédiate du service à la souscription, vous avez renoncé à votre droit de retractation de 14j pour la partie déjà consommée. Annulation possible à tout moment depuis ${BASE_URL}/account.html sans frais (effet fin de periode payee).
${isYearly ? `Art. L215-1 : pour les abonnements annuels, vous serez notifié par email entre 1 et 3 mois avant chaque échéance.\n` : ''}CGV : ${BASE_URL}/cgv.html

L'équipe FragValue`;
  return { subject, html, text };
}

// === TRIAL EXPIRING J-3 ==================================================
function trialExpiringJ3({ nickname, planLabel, trialEndIso }) {
  const name = nickname || 'joueur';
  const endDate = trialEndIso
    ? new Date(trialEndIso).toLocaleDateString('fr-FR', { day:'numeric', month:'long' })
    : 'dans 3 jours';
  const subject = `Plus que 3 jours d'essai ${planLabel} · prolonge ou annule en 1 clic`;
  const html = wrap(subject, `
    <h1 style="font-family:${FONT_STACK};font-size:24px;line-height:1.2;color:#e8eaea;margin:0 0 16px;font-weight:800">${name}, ton essai ${planLabel} expire le <span style="color:#b8ff57">${endDate}</span>.</h1>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 20px">Si tu veux continuer à utiliser les features premium (analyses illimitées, 2D Replay, Coach IA), aucune action n'est nécessaire : ton abonnement se renouvelle automatiquement le ${endDate}.</p>

    <div style="padding:14px 16px;background:#080909;border:1px solid #1c1e1e;border-radius:8px;margin-bottom:18px">
      <div style="font-size:12px;color:#a8b0b0;line-height:1.65">
        <strong style="color:#e8eaea">Tu hésites ?</strong> Tu peux <strong style="color:#b8ff57">annuler en 1 clic</strong> depuis ton espace avant le ${endDate}, sans aucun prélèvement. Et tu gardes l'accès premium jusqu'à la fin de l'essai.
      </div>
    </div>

    <p style="text-align:center;margin:18px 0">
      <a href="${BASE_URL}/account.html" style="display:inline-block;background:#b8ff57;color:#000;padding:13px 26px;border-radius:8px;text-decoration:none;font-weight:800;font-size:13px;letter-spacing:.04em;margin:0 4px;font-family:${FONT_STACK}">Gérer mon abonnement</a>
    </p>

    <p style="font-size:11px;color:#7a8080;margin:18px 0 0;line-height:1.5">Astuce : passe au plan annuel pour 2 mois offerts (Pro 79€/an, Elite 290€/an).</p>
  `);
  const text = `${name}, ton essai ${planLabel} expire le ${endDate}.

Si tu continues : aucune action nécessaire, le renouvellement est automatique.

Si tu veux annuler : 1 clic depuis ${BASE_URL}/account.html avant le ${endDate}, aucun prélèvement, tu gardes l'accès jusqu'à la fin.

Astuce : passe au plan annuel pour 2 mois offerts (Pro 79€/an, Elite 290€/an).

L'équipe FragValue`;
  return { subject, html, text };
}

// === COACH CREDITS PURCHASED ============================================
// Envoye apres un achat reussi de pack de credits Coach IA via Stripe Checkout.
// Confirme la transaction + indique le nouveau solde + date d'expiration.
function coachCreditsPurchased({ nickname, packLabel, creditsAdded, balanceAfter, expiresAtIso, amountEur }) {
  const name = nickname || 'joueur';
  const expiresDate = expiresAtIso
    ? new Date(expiresAtIso).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : null;
  const amountStr = (typeof amountEur === 'number')
    ? `${amountEur.toFixed(2).replace('.', ',')} EUR`
    : '';
  const subject = `+${creditsAdded} credits Coach IA actives - merci ${name}`;

  const html = wrap(subject, `
    <h1 style="font-family:${FONT_STACK};font-size:24px;line-height:1.2;color:#e8eaea;margin:0 0 16px;font-weight:800">
      <span style="color:#b8ff57">+${creditsAdded} credits</span> actives.
    </h1>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 20px">Merci ${name}, ton paiement de ${amountStr} est confirme. Tes credits sont disponibles immediatement sur le Coach IA Conversational.</p>

    <div style="padding:18px 20px;background:linear-gradient(135deg,rgba(184,255,87,.1),rgba(184,255,87,.02));border:1px solid rgba(184,255,87,.35);border-radius:10px;margin-bottom:20px">
      <div style="font-size:11px;color:#b8ff57;font-weight:700;letter-spacing:.1em;margin-bottom:8px">RECAPITULATIF</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#e8eaea">
        <tr><td style="padding:4px 0;color:#a8b0b0">Pack achete</td><td style="text-align:right;font-weight:700">${packLabel}</td></tr>
        <tr><td style="padding:4px 0;color:#a8b0b0">Credits ajoutes</td><td style="text-align:right;font-weight:700;color:#b8ff57">+${creditsAdded}</td></tr>
        <tr><td style="padding:4px 0;color:#a8b0b0">Nouveau solde</td><td style="text-align:right;font-weight:800">${balanceAfter} credits</td></tr>
        ${expiresDate ? `<tr><td style="padding:4px 0;color:#a8b0b0">Validite jusqu'au</td><td style="text-align:right">${expiresDate}</td></tr>` : ''}
      </table>
    </div>

    <p style="font-size:13px;color:#a8b0b0;margin:0 0 20px;line-height:1.6">
      <strong style="color:#e8eaea">Comment ca marche ?</strong> 1 credit = 1 message au-dela de ta limite quotidienne (Pro 5/jour, Elite 30/jour). Les credits se debitent automatiquement quand tu depasses ton quota.
    </p>

    <p style="text-align:center;margin:24px 0 8px">
      <a href="${BASE_URL}/demo.html" style="display:inline-block;background:#b8ff57;color:#000;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:800;font-size:14px;letter-spacing:.04em;font-family:${FONT_STACK}">Lancer une analyse + chatter &rsaquo;</a>
    </p>

    <p style="font-size:11px;color:#7a8080;margin:18px 0 0;line-height:1.5">
      Ta facture est dans <a href="${BASE_URL}/account.html" style="color:#b8ff57;text-decoration:none">ton espace</a>. Question ? Reponds a ce mail.
    </p>
  `);

  const text = `+${creditsAdded} credits Coach IA actives. Merci ${name}.

Pack achete    : ${packLabel}
Credits ajoutes : +${creditsAdded}
Nouveau solde  : ${balanceAfter} credits
${expiresDate ? `Validite       : jusqu'au ${expiresDate}` : ''}

Montant : ${amountStr}

1 credit = 1 message au-dela de ta limite quotidienne (Pro 5/jour, Elite 30/jour).

Lance une analyse et chatte avec le Coach : ${BASE_URL}/demo.html
Ta facture est dans ton espace : ${BASE_URL}/account.html

L'equipe FragValue`;

  return { subject, html, text };
}

// === CANCELLATION CONFIRMATION + WIN-BACK PATH ===========================
// Cf. ultrareview Email lifecycle P0 #3. Trigger : webhook customer.subscription.updated
// quand cancel_at_period_end=true. Couvre 2 objectifs :
// 1. Confirmation legale (preuve de la resiliation, art. L215-1)
// 2. Win-back path : 1 question de friction unique + offre -50% pour eviter churn
function cancellationConfirmation({ nickname, planLabel, periodEndIso }) {
  const name = nickname || 'joueur';
  const endDate = periodEndIso
    ? new Date(periodEndIso).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' })
    : 'la fin de la periode courante';
  const subject = `Resiliation confirmee · ton acces ${planLabel} reste actif jusqu'au ${endDate}`;
  const html = wrap(subject, `
    <h1 style="font-family:${FONT_STACK};font-size:24px;line-height:1.2;color:#e8eaea;margin:0 0 16px;font-weight:800">Resiliation confirmee, ${name}.</h1>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 16px">Ton abonnement <strong style="color:#e8eaea">${planLabel}</strong> a ete resilie. Aucun frais supplementaire ne sera preleve.</p>

    <div style="padding:16px 18px;background:rgba(184,255,87,.06);border:1px solid rgba(184,255,87,.25);border-radius:8px;margin-bottom:24px">
      <div style="font-size:11px;color:#b8ff57;font-weight:700;letter-spacing:.1em;margin-bottom:6px">CE QUI SE PASSE MAINTENANT</div>
      <ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#e8eaea;line-height:1.8">
        <li>Ton acces ${planLabel} reste <strong>actif jusqu'au ${endDate}</strong></li>
        <li>Apres cette date, tu repasseras automatiquement en plan Free</li>
        <li>Ton historique (analyses, FV Rating, Coach IA insights) reste accessible</li>
        <li>Tu peux te reabonner a tout moment</li>
      </ul>
    </div>

    <p style="font-size:14px;color:#e8eaea;margin:0 0 12px;font-weight:700">Une question rapide pour qu'on s'ameliore :</p>
    <p style="font-size:13px;color:#a8b0b0;margin:0 0 16px">Qu'est-ce qui n'a pas marche ? Reponds simplement a ce mail avec un mot, on lit toutes les reponses.</p>

    <!-- Win-back offer : -50% sur la prochaine periode pendant 14j -->
    <div style="margin-top:24px;padding:18px 20px;background:linear-gradient(135deg,rgba(245,200,66,.08),rgba(245,200,66,.02));border:1px solid rgba(245,200,66,.3);border-radius:8px;text-align:center">
      <div style="font-size:11px;color:#f5c842;font-weight:700;letter-spacing:.1em;margin-bottom:6px">SI TU CHANGES D'AVIS</div>
      <p style="font-size:13px;color:#e8eaea;margin:0 0 12px;line-height:1.5">Reactive ton abonnement avec <strong style="color:#f5c842">-50% sur les 3 prochains mois</strong> avant le ${endDate}.</p>
      <a href="${BASE_URL}/pricing.html?winback=1" style="display:inline-block;background:#f5c842;color:#000;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:700;font-size:12px;letter-spacing:.04em;font-family:${FONT_STACK}">Reactiver avec -50%</a>
    </div>

    <p style="font-size:11px;color:#7a8080;margin:24px 0 0;line-height:1.5">Conformement a l'art. L215-1 du Code de la consommation, votre resiliation prendra effet le ${endDate}. Aucune penalite applicable.</p>
  `);
  const text = `Resiliation confirmee, ${name}.

Ton abonnement ${planLabel} a ete resilie. Aucun frais supplementaire.

Ce qui se passe :
- Acces ${planLabel} actif jusqu'au ${endDate}
- Apres : tu repasseras en plan Free
- Historique conserve (analyses, FV Rating, Coach IA)
- Reabonnement possible a tout moment

QU'EST-CE QUI N'A PAS MARCHE ?
Reponds simplement a ce mail. On lit toutes les reponses.

OFFRE DE RETOUR -50% (valable jusqu'au ${endDate}) :
${BASE_URL}/pricing.html?winback=1

Conformement a l'art. L215-1 Code de la consommation, ta resiliation prend
effet le ${endDate}. Aucune penalite.

L'equipe FragValue`;
  return { subject, html, text };
}

// === YEARLY RENEWAL NOTICE (L215-1 OBLIGATOIRE) ==========================
// Cf. ultrareview Email lifecycle P0 #1 + Trust/Legal HIGH #8. L'art. L215-1-1
// du Code conso impose pour les abonnements annuels d'informer le user entre
// 1 et 3 mois avant chaque renouvellement, via un cron quotidien.
// Sanction : 15 000 EUR par contrat non-notifie. Ne JAMAIS skipper.
function yearlyRenewalNotice({ nickname, planLabel, renewDate, daysLeft, amount }) {
  const name = nickname || 'joueur';
  const subject = daysLeft <= 7
    ? `Plus que ${daysLeft}j pour annuler avant le renouvellement annuel`
    : `[Action possible] Ton abonnement ${planLabel} se renouvelle le ${renewDate}`;
  const urgency = daysLeft <= 7
    ? `<strong style="color:#f5c842">Plus que ${daysLeft} jours</strong> pour decider`
    : `Tu as encore <strong style="color:#a8b0b0">${daysLeft} jours</strong> pour decider`;
  const html = wrap(subject, `
    <h1 style="font-family:${FONT_STACK};font-size:22px;line-height:1.3;color:#e8eaea;margin:0 0 16px;font-weight:800">Renouvellement ${planLabel} le <span style="color:#b8ff57">${renewDate}</span></h1>
    <p style="font-size:14px;color:#a8b0b0;margin:0 0 16px">${urgency}. Conformement a la loi (art. L215-1 Code de la consommation), nous t'informons de la possibilite de ne pas reconduire ton abonnement.</p>

    <div style="padding:16px 18px;background:rgba(255,255,255,.02);border:1px solid #1c1e1e;border-radius:8px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#a8b0b0;line-height:2">
        <span>Plan</span><strong style="color:#e8eaea">${planLabel}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#a8b0b0;line-height:2">
        <span>Montant qui sera preleve</span><strong style="color:#b8ff57">${amount}</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:#a8b0b0;line-height:2">
        <span>Date du prelevement</span><strong style="color:#e8eaea">${renewDate}</strong>
      </div>
    </div>

    <p style="font-size:13px;color:#e8eaea;margin:0 0 16px"><strong>2 options :</strong></p>
    <p style="text-align:center;margin:16px 0">
      <a href="${BASE_URL}/account.html" style="display:inline-block;background:#b8ff57;color:#000;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.04em;font-family:${FONT_STACK};margin-right:8px">Garder ${planLabel}</a>
      <a href="${BASE_URL}/account.html#cancel" style="display:inline-block;background:transparent;color:#a8b0b0;padding:11px 22px;border-radius:6px;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:.04em;font-family:${FONT_STACK};border:1px solid #1c1e1e">Annuler en 1 clic</a>
    </p>

    <p style="font-size:11px;color:#7a8080;margin:24px 0 0;line-height:1.5">Si tu ne fais rien, ton abonnement sera reconduit pour 1 an le ${renewDate}. L'annulation reste possible a tout moment depuis ton espace, sans frais (effet fin de periode payee).</p>
  `);
  const text = `Renouvellement ${planLabel} le ${renewDate}

${urgency.replace(/<[^>]+>/g, '')}.

Conformement a la loi (art. L215-1 Code conso), nous t'informons que ton
abonnement ${planLabel} sera reconduit pour 1 an le ${renewDate} pour ${amount}.

2 options :
1. Garder ${planLabel} : aucune action requise.
2. Annuler en 1 clic depuis ton espace :
   ${BASE_URL}/account.html#cancel

L'annulation reste possible a tout moment, sans frais (effet fin de periode).

L'equipe FragValue`;
  return { subject, html, text };
}

module.exports = { welcome, checkoutSuccess, trialExpiringJ3, coachCreditsPurchased, cancellationConfirmation, yearlyRenewalNotice };
