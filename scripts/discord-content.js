// scripts/discord-content.js
// Source unique du contenu des channels Discord FragValue.
// Importe par :
//   - discord-populate-content.js  (post + pin pour 1ere mise en place)
//   - discord-update-content.js    (PATCH du message bot existant si typo / accent)
//
// Convention markdown Discord : gras **x**, italic *x*, code `x`, blockquote >,
// liste -. Accents francais standards (é è ê à â ç î ï ô ù û).

const CONTENT = [
  // ════════════════════════════════════════════════════════════════════════
  // 📍 INFOS
  // ════════════════════════════════════════════════════════════════════════
  {
    channel: 'announcements',
    messages: [
      {
        pin: true,
        content: `# 📢 Bienvenue dans le canal annonces FragValue

Toutes les annonces officielles passent ici :
- **Releases** & nouvelles features (FV Rating updates, Pro Demos, intégrations)
- **Maintenance** & incidents (rare mais on prévient)
- **Events** community (demo reviews, tournois FragValue Cup)
- **Promo codes** & deals exclusifs

Active les notifications de ce canal (clic droit → Notifications) pour ne rien rater.

> 🔇 Canal en mode **read-only**. Pour les questions → #help-support. Pour les feedbacks → #feature-requests.`,
      },
    ],
  },

  {
    channel: 'rules',
    messages: [
      {
        pin: true,
        content: `# 📜 Règles FragValue Community

## 1. Respect zéro-tolérance
- ❌ Pas de toxic gaming culture (rage tilt, insults, baiting)
- ❌ Pas de racisme / sexisme / homophobie / harcèlement
- ❌ Pas de drama personnel inter-équipes

## 2. Pas de cheats / exploits
- ❌ Aucune discussion de cheats, hacks, comptes boosted
- 🔍 Tu vois ça → @ modération

## 3. Pas de pub
- ❌ Promo serveurs / services concurrents (sans permission écrite)
- ❌ Crypto / NFT / scams
- ✅ Tes propres clips / streams = OK dans #highlights (1×/semaine max)

## 4. Langues
- 🇫🇷 + 🇬🇧 acceptées (la commu est franco à 70%, anglo à 30%)
- Évite les autres langues pour rester compréhensible

## 5. Bug reports / Feature requests
- Channel dédié → #bug-reports / #feature-requests
- Décris bien le contexte. « Ça marche pas » sans détails ne sera pas traité.

## 6. Self-promo / spam
- Tes streams / clips OK 1×/semaine max dans #highlights
- Pas de DM commercial aux autres membres

---

### Sanctions
\`warn\` → \`mute 1h\` → \`kick\` → \`ban\` (graduel sauf zéro-tolérance items)

🚨 **Zéro-tolérance items = ban immédiat sans warning.**

---

> En postant dans ce serveur, tu acceptes ces règles.
> Pour signaler un comportement → #reports`,
      },
    ],
  },

  {
    channel: 'changelog',
    messages: [
      {
        pin: true,
        content: `# 🚀 Changelog FragValue

Les releases & nouvelles features de **fragvalue.com** seront annoncées ici.

## 🔗 Liens rapides
- 🌐 Site : https://fragvalue.com
- 💎 Plans : https://fragvalue.com/pricing.html
- 📖 Comment ça marche : https://fragvalue.com/how-it-works.html
- 🐛 Bug ? → #bug-reports
- 💡 Feature request ? → #feature-requests

## 🆕 Récemment shippé
- ✅ **Discord intégration** : link ton compte sur /account.html, rôle Pro/Elite auto-sync
- ✅ **Email lifecycle** : welcome + dunning + demo analysis ready emails
- ✅ **Mobile UX** : iOS zoom prevention, touch targets 44px, responsive grids
- ✅ **Résiliation 3 clics** native (conformité loi juin 2023)

## 🔜 En cours
- 🟡 **FACEIT Downloads API** : analyse auto des matchs FACEIT liés (en attente scope côté FACEIT)
- 🟡 **Pro Demos viewer** : décryptage round-by-round des matchs Major / BLAST / ESL
- 🟡 **Coach IA Conversational** : améliorations system prompt, citations cliquables`,
      },
    ],
  },

  {
    channel: 'roadmap',
    messages: [
      {
        pin: true,
        content: `# 🗺️ Roadmap FragValue

Où on en est sur le produit, par priorité.

## 🟢 Done
- Diagnostic IA sur 20 derniers matchs FACEIT
- FV Rating + heatmaps + 2D replay
- Coach IA conversational (5 msg/jour Pro, 30/jour Elite)
- Pro Benchmarks (top 20 HLTV vs toi)
- Discord intégration (rôle auto Pro/Elite)
- Stripe LIVE + dunning + cancellation 3 clics

## 🟡 In progress
- **FACEIT Downloads API** auto-import (en attente côté FACEIT, ETA ~1-2 semaines)
- **Pro Demos viewer** scorecards round-by-round (Q3 2026)
- **Weekly Coach IA report** email automatique

## 🔵 Next quarter
- **Tournois FragValue Cup** mensuels (5v5, prizes Pro/Elite gratuit)
- **Équipe coaching** Elite (sessions live mensuelles)
- **Bot Discord slash commands** : \`/myrating\`, \`/lastmatch\`, \`/leaderboard\`

## 💡 Tu veux voter pour un truc ?
→ #feature-requests, drop ton idée, on vote avec :+1: / :-1:.`,
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // 🎮 COMMUNITY
  // ════════════════════════════════════════════════════════════════════════
  {
    channel: 'general',
    messages: [
      {
        pin: true,
        content: `# 👋 Bienvenue dans le general FragValue

L'endroit où on discute librement de CS2, FACEIT, et de tout le reste.

## 🎯 Présente-toi en 4 lignes :
\`\`\`
🎮 Pseudo FACEIT :
🏆 Level / ELO :
🌍 Région :
🎯 Sur quoi tu galères :
\`\`\`

Exemple : *« Pseudo Qwhentin, Lvl 8 EU, je galère en CT-side Mirage et mon KAST chute en deuxième mi-temps. »*

## 📌 Quelques tips
- 🔥 Tes clips / aces → #highlights
- 🎯 Compare ton FV Rating avec la commu → #share-your-rating
- 🤝 Tu cherches des coéquipiers ? → #team-finding
- 🎓 Tu galères sur une map ? → #map-strats
- 📊 Insight Coach IA intéressant ? → #coach-ia-tips

## 🎬 Demo review collective
Chaque **dimanche 19h CET**, on décortique ensemble une demo pro dans #demo-reviews (voice channel + screen share). Active la notif #announcements pour ne rien rater.

> **Ton ELO ne change pas. Tes habitudes oui.** 🎯`,
      },
    ],
  },

  {
    channel: 'highlights',
    messages: [
      {
        pin: true,
        content: `# 🔥 Highlights — partage tes meilleurs moments

Ace, clutch 1v3+, frag stylé, retake impossible : balance ici.

## 📋 Format suggéré
\`\`\`
🎯 Type : ace / clutch 1vX / frag / retake
🗺️ Map :
🎬 Clip : (lien ou attachment)
📝 Contexte : 1-2 phrases (round eco ? force buy ? clutch décisif ?)
\`\`\`

## ✅ Bonnes pratiques
- 🎬 Format **vidéo courte** (< 30s idéal) : Medal, Outplayed, ou Twitch clip
- 📷 Screenshots OK aussi (scoreboard final après 1v5 etc.)
- ❌ Pas de spam : 1-2 clips / semaine max par membre
- ❌ Pas de clips de cheat / racistes / shittalk

## 🏆 Best clip de la semaine
Tous les vendredis, on sélectionne le **best clip** de la semaine. Le gagnant reçoit un shoutout dans #announcements. Ça commence cette semaine.`,
      },
    ],
  },

  {
    channel: 'team-finding',
    messages: [
      {
        pin: true,
        content: `# 🤝 Team finding — trouve tes coéquipiers

Tu cherches des partenaires fixes pour FACEIT / ESEA / 5v5 ?

## 📋 Format obligatoire pour poster
\`\`\`
🌍 Région :              (EU / NA / SA / OCE / SEA)
🏆 Level / ELO :         (Lvl 7 / 1900 ELO par ex.)
🕐 Disponibilités :      (soirées semaine ? weekend ?)
🎯 Rôle préféré :        (entry / awp / igl / support / lurker)
🎤 Voice :               (mic obligatoire ? langues parlées)
🎮 Game mode :           (FACEIT 5v5, premade, ESEA, etc.)
💬 Discord pour DM :     (ton handle)
\`\`\`

## ✅ Tips pour trouver vite
- 🎯 Sois clair sur ton **objectif** : grind ELO ? avoir du fun ? tournoi ESEA ?
- 🌟 Mentionne tes **stats clés** (FV Rating, KAST, win rate map principale)
- 🤝 Réagis aux posts des autres avec :raised_hand: si intéressant
- 💬 Continue les discussions en DM après le premier match contact

## ⚠️ Important
- 1 post / 7 jours maximum (sinon spam)
- Mets à jour ton post au lieu d'en faire un nouveau
- Pas de scout commercial / boost / smurf — ban direct`,
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // 📊 FRAGVALUE
  // ════════════════════════════════════════════════════════════════════════
  {
    channel: 'help-support',
    messages: [
      {
        pin: true,
        content: `# ❓ Help & support FragValue

Une question sur l'app, l'analyse de demo, ou ton compte ? On répond ici.

## 📋 Format pour bien être aidé
\`\`\`
🎮 Plan :       (Free / Pro / Elite)
🌐 Page :       (URL où tu as le problème)
🐛 Problème :   (1-2 phrases claires)
📷 Capture :    (screenshot du problème + console browser si erreur JS)
🔄 Steps :      (ce que tu as essayé)
\`\`\`

## ⚡ FAQ rapide (à vérifier avant de poster)
**1. Mon analyse demo plante**
→ Vérifie que c'est un .dem FACEIT (pas .dem.gz, pas .dem.zst). Si ça plante toujours, drop l'erreur exacte ici.

**2. Coach IA dit « limite atteinte »**
→ Free = 1 diagnostic / mois. Pro = 5 msg / jour. Elite = 30 / jour.
Reset minuit UTC. Achète des credits packs sur /account.html si besoin.

**3. Pas de demo trouvée**
→ FACEIT garde les demos ~2-4 semaines. Si ton match est plus vieux, c'est purgé.

**4. Mon rôle Discord ne match pas mon plan**
→ Va sur /account.html → « Lier mon Discord » (ou « Délier » + relier). Sync auto en 5-10s.

## 📞 Problème urgent ?
DM @Founder ou mail contact@fragvalue.com.`,
      },
    ],
  },

  {
    channel: 'feature-requests',
    messages: [
      {
        pin: true,
        content: `# 💡 Feature requests

Ton idée pour améliorer FragValue ? Drop-la ici, on vote, on shippe.

## 📋 Format suggéré
\`\`\`
🎯 Idée :         (titre court, 1 ligne)
📝 Contexte :     (pourquoi tu en as besoin, ton pain point actuel)
✅ Solution :     (ce que tu imagines comme feature)
🎮 Plan :         (Free / Pro / Elite — pour comprendre l'audience)
\`\`\`

## 🗳️ Voting
- Réagis :+1: si tu veux la feature
- Réagis :-1: si pas d'accord
- Les top votes sont review chaque semaine et intégrés dans la roadmap

## 🚦 Status track
Après review on tag les threads :
- 🟢 \`accepted\` → dans la prochaine release
- 🟡 \`considering\` → en exploration
- 🔵 \`planned\` → dans la roadmap mais pas immédiat
- ⚫ \`rejected\` → avec une explication

## ✅ Bonnes idées récentes (déjà shippées grâce à vous)
- Discord intégration rôle auto Pro/Elite
- Résiliation 3 clics native
- Email « demo analysis ready » avec preview FV Rating
- Mode mobile drag-drop fix iOS

Continue !`,
      },
    ],
  },

  {
    channel: 'bug-reports',
    messages: [
      {
        pin: true,
        content: `# 🐛 Bug reports

Quelque chose plante ? Décris le bug ici pour qu'on puisse fix vite.

## 📋 Template à copier-coller
\`\`\`
🌐 URL :              (ex: https://fragvalue.com/heatmap-results.html?id=...)
🖥️ Navigateur :       (Chrome 130 / Safari 18 / Firefox 132)
📱 Appareil :         (Desktop / Mobile iOS / Mobile Android)
🎮 Plan :             (Free / Pro / Elite)
🔄 Steps to reproduce :
  1. ...
  2. ...
  3. ...
✅ Attendu :          (ce qui devrait se passer)
❌ Obtenu :           (ce qui se passe vraiment)
📷 Screenshot :       (capture du problème + console DevTools si JS error)
🆔 Match ID :         (si lié à une demo spécifique)
\`\`\`

## 🚦 Priorité
- 🔴 \`critical\` : impact paiement, perte de données, sécurité → fix < 24h
- 🟠 \`high\` : feature majeure cassée → fix < 7 jours
- 🟡 \`medium\` : bug visuel ou edge case → fix dans la prochaine release
- 🟢 \`low\` : cosmetic → backlog

## 🔒 Bug sécurité ?
**Pas dans ce channel** → mail direct **security@fragvalue.com** (pas encore publié ? mail contact@ avec le mot « security » en sujet).

> Plus ton report est détaillé, plus vite on fix.`,
      },
    ],
  },

  {
    channel: 'share-your-rating',
    messages: [
      {
        pin: true,
        content: `# 📈 Share your FV Rating

Compare ton rating avec la commu, balance des challenges, motive-toi.

## 📋 Format pour poster
\`\`\`
🎮 Pseudo FACEIT :
🏆 Level :
📊 FV Rating moyen (20 derniers) :
🎯 Best stat :          (ex: KAST 78%)
📉 Worst stat :         (ex: opening duel WR 42%)
🗺️ Map principale :
🎬 Capture :            (screenshot dashboard)
\`\`\`

## 🏅 Échelle FV Rating
| FV Rating | Niveau équivalent | Traduction |
|-----------|-------------------|------------|
| 0.70-0.85 | Lvl 3-5           | Tu stagnes ou tu régresses |
| 0.85-0.95 | Lvl 5-7           | Tu tiens ta place |
| 0.95-1.05 | Lvl 7-9           | Tu fais ton job |
| 1.05-1.15 | Lvl 9-10          | Tu carry régulièrement |
| 1.15-1.25 | Lvl 10 top        | Top 5% de ton level |
| 1.25+     | Semi-pro / pro    | Niveau compétitif sérieux |

## 🎯 Idées de challenges entre membres
- « Qui améliore son KAST de +5% cette semaine ? »
- « Best FV Rating sur Mirage en 5 matchs consécutifs »
- « Top 1 monthly leaderboard de la commu »

> **Ton ELO ne change pas. Tes habitudes oui.**`,
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // 🎓 IMPROVEMENT
  // ════════════════════════════════════════════════════════════════════════
  {
    channel: 'coach-ia-tips',
    messages: [
      {
        pin: true,
        content: `# 🧠 Coach IA Tips

Ton Diagnostic IA t'a sorti un truc intéressant ? Balance ici, on apprend tous ensemble.

## 📋 Format idéal
\`\`\`
🎯 Insight :      (cite l'IA en quote)
📊 Contexte :     (ton FV Rating, level, map, période)
✅ Action :       (ce que tu vas faire pour corriger)
📈 Impact :       (après 1-2 semaines, édit le post pour partager le résultat)
\`\`\`

## 💡 Exemples de bons posts
**Exemple 1 — Opening duels**
> « Coach IA m'a dit : "Tu perds 60% de tes opening duels en CT-side Mirage. Joue passif les 2 premiers rounds, observe les setups T avant de peek." »
>
> Après 1 semaine : opening WR CT Mirage est passé de 38% à 51%. Game changer.

**Exemple 2 — KAST**
> « Insight : "Tu as 4-5 rounds fantômes par match (0 kill / 0 assist / mort tôt). Réduis ton agressivité en T-side anti-eco." »
>
> À faire : check sur prochains matchs.

## ⚠️ Ce qu'on ne fait pas ici
- ❌ Pas de « Coach IA dit que je suis nul, comment progresser ? » → #help-support
- ❌ Pas de capture brute du diagnostic sans commentaire → partage l'insight + ton plan
- ❌ Pas de critique du Coach IA → #feature-requests si tu trouves un cas où il se trompe`,
      },
    ],
  },

  {
    channel: 'map-strats',
    messages: [
      {
        pin: true,
        content: `# 🗺️ Map strats — lineups, smokes, tactiques

L'endroit pour partager les setups qui gagnent des rounds.

## 📋 Format quand tu postes
\`\`\`
🗺️ Map :              (mirage / inferno / nuke / dust2 / vertigo / ancient / anubis / overpass)
🎯 Side :             (CT / T)
🔫 Type :             (smoke / molotov / flash / he / tactique strat / lineup spécifique)
📍 Position :         (où se mettre)
🎬 Demo / clip :      (lien ou screenshot)
📝 Description :      (1-2 phrases : effet attendu)
\`\`\`

## 🏷️ Tags suggérés dans le titre
- \`[CT-side]\` ou \`[T-side]\`
- \`[Smoke]\` \`[Molo]\` \`[Flash]\` \`[HE]\`
- \`[Lineup]\` \`[Strat]\` \`[Setup]\`

## 📚 Resources externes utiles
- **CSGO Lineup Tool** : https://csgo-lineups.com
- **Liquipedia map pools** : https://liquipedia.net/counterstrike/Map_pool
- **Pro demos** : https://hltv.org/matches (les VOD majors sont sur YouTube)

## 🎓 Pour les novices
Lis d'abord le **Stats guide FragValue** : https://fragvalue.com/stats-guide.html`,
      },
    ],
  },

  {
    channel: 'progression',
    messages: [
      {
        pin: true,
        content: `# 🎯 Progression — objectifs hebdo & accountability

Pose tes objectifs publiquement, viens les valider ou non.

## 📋 Template lundi
\`\`\`
📅 Semaine du :       (ex: 5 mai)
🎯 Objectif principal :
   (ex: passer mon KAST moyen de 65% à 70% sur 10 matchs FACEIT)
✅ 3 actions concrètes pour y arriver :
   1.
   2.
   3.
🔍 Comment je mesure :  (le KPI exact à tracker)
📊 FV Rating actuel :
\`\`\`

## 📋 Template dimanche (récap)
\`\`\`
🎯 Objectif visé :
✅ Atteint :          (oui/non/partiel)
📊 Résultat :         (chiffres)
💡 Apprentissages :   (1-2 phrases)
🎯 Objectif semaine prochaine :
\`\`\`

## 🏆 Récompense de la commu
Top 3 progress de la semaine selon le Coach IA → mention dans #announcements + 1 mois Elite gratuit pour le 1er.

## 💪 Pourquoi c'est utile
**Strava effect** : les gens qui annoncent publiquement leurs objectifs les atteignent ~2-3× plus souvent. Pas de pression, juste de la visibilité.`,
      },
    ],
  },

  {
    channel: 'demo-reviews',
    messages: [
      {
        pin: true,
        content: `# 📺 Demo reviews — collective Sunday 19h CET

Chaque dimanche, on décortique ensemble une demo pro (Major, BLAST, ESL Pro League).

## 📅 Schedule
- 🕐 **Dimanche 19h CET**
- 🎤 Voice channel #voice-lobby
- 🖥️ Screen share via Discord stream
- ⏱️ Durée : ~45-60 min

## 🎬 Programme type
1. **5 min** : intro + présentation du match (teams, importance, score)
2. **15 min** : décortique du **CT-side d'une team** (utility, retakes, anti-strats)
3. **15 min** : décortique du **T-side de l'autre team** (executes, picks, mid-round calls)
4. **10 min** : insights clés + transférables à notre niveau (FACEIT Lvl 5-10)
5. **10 min** : Q&A live

## 📋 Pour participer
- Rejoins le #voice-lobby à 19h pile
- Prépare un notepad pour noter les insights
- Pose tes questions en chat #demo-reviews ou direct au mic

## 🎯 Demos prochaines
**Dimanche prochain (à annoncer dans #announcements le vendredi)**

## 💡 Tu veux suggérer une demo à décortiquer ?
Drop le **lien HLTV** + raison dans ce channel. Top votes = on fait celle-là.`,
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // 🏆 PRO SCENE
  // ════════════════════════════════════════════════════════════════════════
  {
    channel: 'match-of-the-day',
    messages: [
      {
        pin: true,
        content: `# 📅 Match of the day

Le match pro **à regarder aujourd'hui**, choisi par la commu et la mod.

## 🎯 Critère de sélection
- Match d'un tournoi tier 1 (Major, BLAST, ESL Pro League, IEM)
- BO3+ ou BO5
- Équipes top 20 HLTV
- Storyline intéressante (clutch series, comeback, début nouveau roster)

## 📋 Format du post quotidien
\`\`\`
🏆 Tournoi :
⚔️  Match :              (ex: Vitality vs FaZe BO3)
🕐 Heure :               (CET, lien GMT pour les autres régions)
📺 Stream :              (https://twitch.tv/... ou https://hltv.org/...)
📝 Storyline :           (1-2 phrases sur l'enjeu)
🎯 Pourquoi c'est intéressant :
\`\`\`

## 💬 Discussion live
Pendant le match, balance tes réactions ici. Après :
- 🔥 Best round du match
- 🎯 MVP de chaque team
- 📊 Stats qui surprennent

## 🗳️ Tu veux suggérer un match ?
Tag #match-of-the-day avec le lien HLTV.`,
      },
    ],
  },

  {
    channel: 'events',
    messages: [
      {
        pin: true,
        content: `# 🌍 Events — Major, BLAST, ESL Pro League, IEM

Calendrier des tournois pros et discussions par event.

## 📅 Tournois majeurs 2026 (à jour)
- **PGL Cluj-Napoca Major** — Février 2026 ✅ terminé
- **BLAST Spring Final** — Avril 2026 ✅ terminé
- **IEM Cologne** — Août 2026 (à confirmer)
- **ESL Pro League S22** — Sept-Oct 2026
- **PGL Bucarest Major** — Décembre 2026

## 📋 Format thread par event
Pour chaque tournoi majeur, on crée un **thread dédié** avec :
- Bracket + standings
- Prédictions community
- Daily highlights
- Best plays compilation

## 🎯 Predictions challenge
Pour les Majors, on lance un **prediction challenge** :
- Prédis le top 4
- Prédis le MVP
- Prédis le best K/D

Top 3 prédictions = 3 mois Elite gratuit.

## 📺 Ressources
- 📊 HLTV : https://hltv.org/events
- 📅 Liquipedia calendar : https://liquipedia.net/counterstrike/Main_Page
- 🎬 Replays YouTube : chaînes officielles BLAST, ESL, PGL`,
      },
    ],
  },

  {
    channel: 'pro-replays-discussion',
    messages: [
      {
        pin: true,
        content: `# 🎬 Pro replays discussion

Discute les rounds des pros : pourquoi ce setup ? cette décision ? cette utilisation d'utility ?

## 📋 Format pour poster
\`\`\`
🏆 Match :                (ex: Vitality vs G2, IEM Katowice 2026)
🗺️ Map :
🔢 Round :                (numéro ou timestamp dans le VOD)
🎬 Lien VOD :             (timestamp direct si possible : ?t=12345s)
🎯 Sujet de discussion :  (1-2 phrases : qu'est-ce qui t'intrigue ?)
📝 Ton analyse :          (ce que tu en penses)
\`\`\`

## 🎯 Bons sujets de discussion
- **Décision IGL** : pourquoi cette strat / call dans cette situation ?
- **Utility coordination** : execute multi-utility, double smoke, etc.
- **Clutch breakdown** : comment le pro a géré ce 1v3 ?
- **Anti-strat detection** : quand le CT a senti la strat venir
- **Éco round genius** : 4-1 sur eco, comment ?

## 📚 Comment apprendre vraiment
1. Pause le VOD à la fin du round
2. Note ta prédiction de ce qui va se passer
3. Watch le round
4. Analyse ce que tu avais bon / faux
5. Cherche les patterns sur 10-20 rounds

## 🎓 Le Coach IA peut analyser tes propres demos avec la même rigueur. Drop ta demo sur fragvalue.com → diagnostic détaillé.`,
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // 💼 PROS / ELITE (gated)
  // ════════════════════════════════════════════════════════════════════════
  {
    channel: 'elite-lounge',
    messages: [
      {
        pin: true,
        content: `# 💎 Elite lounge

Bienvenue dans le **lounge Elite**, réservé aux abonnés Elite. 🟪

## 🎯 Ce qui se passe ici
- 💬 Discussions privées entre Elite members
- 🎓 Coaching collectif mensuel (sessions 1h voice)
- 🎬 Demo reviews **avancées** (1v1 calls + tactical breakdown profond)
- 📊 Accès beta aux features avant tout le monde
- 🤝 Networking Elite : se trouver pour 5v5 entre membres sérieux

## 📅 Events Elite récurrents
- 🎓 **Coaching collectif** : 1er samedi du mois, 18h CET
- 🎬 **Tactical demo review** : 3e dimanche du mois, 19h CET
- 📊 **Beta features preview** : announcement quand dispo

## 🔒 Confidentialité
Ce qui se dit ici reste ici. Pas de screenshots / leaks vers les channels publics. Sanction = révocation Elite + ban serveur.

## 🎯 Accès aux autres channels Elite
- 📋 #team-coaching : sessions de coaching en groupe
- ⚔️ #pre-match-prep : prep tactique pour vos matchs (anti-strat, prep veto)`,
      },
    ],
  },

  {
    channel: 'team-coaching',
    messages: [
      {
        pin: true,
        content: `# 📋 Team coaching — Elite only

Sessions de coaching collectif pour les membres Elite.

## 📅 Schedule
**1er samedi du mois, 18h CET, voice channel #voice-lobby**

Durée : ~1h. Coach invité (ESEA / ECL / AS coach pro francophone).

## 🎯 Format de la session
1. **10 min** : tour de table — chaque participant partage son **pain point #1** de la semaine
2. **30 min** : focus sur 2-3 sujets récurrents (mid-round calls, anti-eco, post-plant)
3. **15 min** : Q&A directe avec le coach
4. **5 min** : objectifs hebdo à poster dans #progression

## 📋 Comment participer
- Rejoins simplement le voice channel à 18h
- Prépare 1 question précise sur ton jeu
- Mic optionnel mais conseillé
- Caméra off acceptée

## 🎓 Coachs déjà invités
*Section à remplir une fois qu'on a 2-3 sessions à notre actif*

## 💡 Tu veux suggérer un coach ?
DM @Founder. On cherche des coachs ESEA Open / Main / Advanced pour les futures sessions.`,
      },
    ],
  },

  {
    channel: 'pre-match-prep',
    messages: [
      {
        pin: true,
        content: `# ⚔️ Pre-match prep — Elite only

Prépare tes matchs sérieux (FACEIT lvl 10+, ESEA league, tournois) avec la commu.

## 🎯 Use cases
- 📊 **Anti-strat** : tu vas affronter une team, on cherche leurs patterns
- 🗺️ **Prep veto** : ban-pick optimal selon votre roster vs leur roster
- 🎬 **Demo review express** : analyse rapide des 3 dernières demos de l'opposant
- 💬 **War room** : discussion live pendant que tu warm avant le match

## 📋 Format de demande
\`\`\`
⚔️  Vs team :              (URL FACEIT team / HLTV / nom)
📅 Match prévu :           (date + heure)
🎯 Stake :                 (quel niveau / qualif / ranked)
🌐 URL FragValue prep :    (https://fragvalue.com/prep-veto.html?... avec votre roster)
🆘 Aide voulue :           (anti-strat / prep veto / demo review)
\`\`\`

## 🤝 Comment aider un autre membre
- Réagis avec :raised_hand: si tu peux scout
- Drop ton analyse en thread sous le post
- Si le membre est en match dans <30 min, prio absolue

## 🎯 Outil qu'on utilise
Toutes les analyses passent par **fragvalue.com/prep-veto.html** (Elite-only). Sortie = recommandations veto + KPIs vs benchmarks.`,
      },
    ],
  },

  {
    channel: 'pro-private',
    messages: [
      {
        pin: true,
        content: `# ⭐ Pro-private — Pro & Elite

Channel réservé aux abonnés Pro et Elite.

## 🎯 Ce qui se passe ici
- 💬 Discussions Pro-tier (entre membres sérieux qui investissent dans leur progression)
- 🎬 Partage de demos perso pour review entre membres
- 📊 Compare ton FV Rating mensuel avec les autres Pro
- 🤝 Trouve des partenaires de même niveau (Lvl 8+ FACEIT typically)

## 🎯 Différences avec #general (public)
- Conversation plus tech / focused
- Spam / off-topic = 0 tolérance
- Niveau moyen plus haut (les membres Free ne sont pas là)
- Beta features previews (avant Elite)

## 💎 Tu veux passer Elite ?
Accès aux channels Elite + sessions coaching mensuelles + tactical demo reviews + beta features.

29€/mois, sans engagement, annulable en 1 clic. → https://fragvalue.com/pricing.html`,
      },
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // 🛠️ MODERATION
  // ════════════════════════════════════════════════════════════════════════
  {
    channel: 'mod-log',
    messages: [
      {
        pin: true,
        content: `# 🛠️ Modération log

Log automatique des actions de modération (warn / mute / kick / ban) + events serveur.

⚠️ **Channel réservé aux modérateurs.** Read-only pour les autres.

## 📋 Ce qui est loggé
- Sanctions appliquées (warn, mute, kick, ban) avec raison
- Joins / leaves serveur
- Channel créations / suppressions
- Rôle changes (debug)
- Bot errors / warnings

> Configuré via bot MEE6 / Carl-bot ou via webhook custom.`,
      },
    ],
  },

  {
    channel: 'reports',
    messages: [
      {
        pin: true,
        content: `# 🚨 Reports — signaler un comportement

Tu vois quelque chose qui viole les règles ? Signale-le ici, on traite.

## 📋 Format pour reporter
\`\`\`
👤 User concerné :          (mention + ID si possible : right-click profil > Copier ID)
📍 Channel concerné :       (ex: #general)
🐛 Comportement :           (1-2 phrases)
📷 Screenshot / message ID : (right-click message > Copy ID)
🚨 Sévérité :               (mineur / majeur / zéro-tolérance)
\`\`\`

## ⚠️ Catégories de violations
- 🟢 **Mineur** : spam, off-topic, langue non FR/EN → warn / mute court
- 🟠 **Majeur** : agressivité, doxxing menace, pub répétée → mute long / kick
- 🔴 **Zéro-tolérance** : racisme / sexisme / harcèlement / cheats / threats → ban immédiat

## 🔒 Confidentialité
Les reports sont **privés** (visibles uniquement par les modérateurs). L'user signalé n'est jamais notifié de qui a report.

## 🚫 Anti-abus
Spam de reports / faux reports = warn d'abord, puis sanction (le report est un outil sérieux).

> Pour une urgence absolue (menaces, doxxing en cours) : DM direct @Founder.`,
      },
    ],
  },
];

module.exports = { CONTENT };
