#!/usr/bin/env node
// scripts/discord-populate-content.js
// Populate les messages welcome / rules / pinned templates dans les channels
// du serveur Discord FragValue.
//
// Usage :
//   DISCORD_BOT_TOKEN=xxx DISCORD_GUILD_ID=xxx node scripts/discord-populate-content.js
//
// Idempotent : skip un channel si le bot a deja pinne au moins 1 message
// (signe que le populate a deja tourne). Pour re-populate from scratch,
// unpin manuellement les messages bot avant de relancer.
//
// Modes :
//   - DRY_RUN=1  -> log seulement
//   - VERBOSE=1  -> log les skips
//   - FORCE=1    -> repopulate meme si deja fait (ATTENTION : ne supprime
//                   pas l'existant, ajoute des doublons. Utiliser avec
//                   precaution apres avoir clean manuellement.)

const DISCORD_API = 'https://discord.com/api/v10';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID  = process.env.DISCORD_GUILD_ID;
if (!BOT_TOKEN) { console.error('Missing DISCORD_BOT_TOKEN'); process.exit(1); }
if (!GUILD_ID)  { console.error('Missing DISCORD_GUILD_ID'); process.exit(1); }

const DRY_RUN = process.env.DRY_RUN === '1';
const VERBOSE = process.env.VERBOSE === '1';
const FORCE   = process.env.FORCE === '1';

// ============================================================================
// MAPPING channel name -> messages a poster (et a pin)
// ============================================================================
// Format de chaque entry :
//   { channel: 'name', messages: [ { content, pin: bool, embed: {...}? } ] }
// Les messages sont postes dans l'ordre. Le 1er pinne devient le pinned du channel.
//
// Convention : on utilise du markdown Discord (gras **x**, italic *x*, code `x`,
// blockquote >, liste -, mention #channel via <#ID> mais on ne connait pas les
// IDs, on tape juste le nom textuel #channel-name).

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
- **Releases** & nouvelles features (FV Rating updates, Pro Demos, integrations)
- **Maintenance** & incidents (rare mais on previent)
- **Events** community (demo reviews, tournois FragValue Cup)
- **Promo codes** & deals exclusifs

Active les notifications de ce canal (clic droit -> Notifications) pour rien rater.

> 🔇 Canal en mode **read-only**. Pour les questions -> #help-support. Pour les feedback -> #feature-requests.`,
      },
    ],
  },

  {
    channel: 'rules',
    messages: [
      {
        pin: true,
        content: `# 📜 Regles FragValue Community

## 1. Respect zero-tolerance
- ❌ Pas de toxic gaming culture (rage tilt, insults, baiting)
- ❌ Pas de racisme / sexisme / homophobie / harcelement
- ❌ Pas de drama personnel inter-equipes

## 2. Pas de cheats / exploits
- ❌ Aucune discussion de cheats, hacks, comptes boosted
- 🔍 Tu vois ca -> @ moderation

## 3. Pas de pub
- ❌ Promo serveurs / services concurrents (sans permission ecrite)
- ❌ Crypto / NFT / scams
- ✅ Tes propres clips / streams = OK dans #highlights (1x/semaine max)

## 4. Langues
- 🇫🇷 + 🇬🇧 acceptes (la commu est franco a 70%, anglo 30%)
- Evite les autres langues pour rester comprehensible

## 5. Bug reports / Feature requests
- Channel dedie -> #bug-reports / #feature-requests
- Decris bien le contexte. "Ca marche pas" sans details ne sera pas traite.

## 6. Self-promo / spam
- Tes streams / clips OK 1x/semaine max dans #highlights
- Pas de DM commercial aux autres membres

---

### Sanctions
\`warn\` -> \`mute 1h\` -> \`kick\` -> \`ban\` (graduel sauf zero-tolerance items)

🚨 **Zero-tolerance items = ban immediat sans warning.**

---

> En postant dans ce serveur, tu acceptes ces regles.
> Pour signaler un comportement -> #reports`,
      },
    ],
  },

  {
    channel: 'changelog',
    messages: [
      {
        pin: true,
        content: `# 🚀 Changelog FragValue

Les releases & nouvelles features de **fragvalue.com** seront annoncees ici.

## 🔗 Liens rapides
- 🌐 Site : https://fragvalue.com
- 💎 Plans : https://fragvalue.com/pricing.html
- 📖 Comment ca marche : https://fragvalue.com/how-it-works.html
- 🐛 Bug ? -> #bug-reports
- 💡 Feature request ? -> #feature-requests

## 🆕 Recemment shippe
- ✅ **Discord integration** : link ton compte sur /account.html, role Pro/Elite auto sync
- ✅ **Email lifecycle** : welcome + dunning + demo analysis ready emails
- ✅ **Mobile UX** : iOS zoom prevention, touch targets 44px, responsive grids
- ✅ **Resiliation 3 clics** native (conformite loi juin 2023)

## 🔜 En cours
- 🟡 **FACEIT Downloads API** : analyse auto des matchs FACEIT lies (en attente scope cote FACEIT)
- 🟡 **Pro Demos viewer** : decryptage round-by-round des matchs Major / Blast / ESL
- 🟡 **Coach IA Conversational** : ameliorations system prompt, citations cliquables`,
      },
    ],
  },

  {
    channel: 'roadmap',
    messages: [
      {
        pin: true,
        content: `# 🗺️ Roadmap FragValue

Ou on en est sur le produit, par priorite.

## 🟢 Done
- Diagnostic IA sur 20 derniers matchs FACEIT
- FV Rating + heatmaps + 2D replay
- Coach IA conversational (5 msg/jour Pro, 30/jour Elite)
- Pro Benchmarks (top 20 HLTV vs toi)
- Discord integration (role auto Pro/Elite)
- Stripe LIVE + dunning + cancellation 3 clics

## 🟡 In progress
- **FACEIT Downloads API** auto-import (en attente cote FACEIT, ETA ~1-2 semaines)
- **Pro Demos viewer** scorecards round-by-round (Q3 2026)
- **Weekly Coach IA report** email automatique

## 🔵 Next quarter
- **Tournois FragValue Cup** mensuels (5v5, prizes Pro/Elite gratuit)
- **Equipe coaching** Elite (sessions live mensuelles)
- **Bot Discord slash commands** : \`/myrating\`, \`/lastmatch\`, \`/leaderboard\`

## 💡 Tu veux voter pour un truc ?
-> #feature-requests, drop ton idee, on vote avec :+1: / :-1:.`,
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

L'endroit ou on discute librement de CS2, FACEIT, et de tout le reste.

## 🎯 Presente-toi en 4 lignes :
\`\`\`
🎮 Pseudo FACEIT :
🏆 Level / ELO :
🌍 Region :
🎯 Sur quoi tu galeres :
\`\`\`

Exemple : *"Pseudo Qwhentin, Lvl 8 EU, je galere en CT-side Mirage et mon KAST chute en deuxieme mi-temps."*

## 📌 Quelques tips
- 🔥 Tes clips / aces -> #highlights
- 🎯 Compare ton FV Rating avec la commu -> #share-your-rating
- 🤝 Cherches des coequipiers ? -> #team-finding
- 🎓 Galeres sur une map ? -> #map-strats
- 📊 Insight Coach IA interessant ? -> #coach-ia-tips

## 🎬 Demo review collective
Chaque **dimanche 19h CET**, on decortique ensemble une demo pro dans #demo-reviews (voice channel + screen share). Active la notif #announcements pour rien rater.

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

## 📋 Format suggere
\`\`\`
🎯 Type : ace / clutch 1vX / frag / retake
🗺️ Map :
🎬 Clip :  (lien ou attachment)
📝 Contexte : 1-2 phrases (round eco ? force buy ? clutch decisif ?)
\`\`\`

## ✅ Bonnes pratiques
- 🎬 Format **video courte** (< 30s ideal) : Medal, Outplayed, ou Twitch clip
- 📷 Screenshots OK aussi (scoreboard final apres 1v5 etc.)
- ❌ Pas de spam : 1-2 clips / semaine max par membre
- ❌ Pas de clips de cheat / racistes / shittalk

## 🏆 Best clip de la semaine
Tous les vendredis, on selectionne le **best clip** de la semaine. Le gagnant recoit un shoutout dans #announcements. Ca commence cette semaine.`,
      },
    ],
  },

  {
    channel: 'team-finding',
    messages: [
      {
        pin: true,
        content: `# 🤝 Team finding — trouve tes coequipiers

Cherches des partenaires fixes pour FACEIT / ESEA / 5v5 ?

## 📋 Format obligatoire pour poster
\`\`\`
🌍 Region :              (EU / NA / SA / OCE / SEA)
🏆 Level / ELO :         (Lvl 7 / 1900 ELO par ex.)
🕐 Disponibilites :      (soirees semaine ? weekend ?)
🎯 Role prefere :        (entry / awp / igl / support / lurker)
🎤 Voice :               (mic obligatoire ? langues parlees)
🎮 Game mode :           (FACEIT 5v5, premade, ESEA, etc.)
💬 Discord pour DM :     (ton handle)
\`\`\`

## ✅ Tips pour trouver vite
- 🎯 Sois clair sur ton **objectif** : grind ELO ? avoir du fun ? tournoi ESEA ?
- 🌟 Mentionne tes **stats clés** (FV Rating, KAST, win rate map principale)
- 🤝 Reagis aux posts des autres avec :raised_hand: si interessant
- 💬 Continue les discussions en DM apres premier match contact

## ⚠️ Important
- 1 post / 7 jours maximum (sinon spam)
- Mets a jour ton post au lieu d'en faire un nouveau
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

Une question sur l'app, l'analyse de demo, ou ton compte ? On repond ici.

## 📋 Format pour bien etre aide
\`\`\`
🎮 Plan :       (Free / Pro / Elite)
🌐 Page :       (URL ou tu as le probleme)
🐛 Probleme :   (1-2 phrases claires)
📷 Capture :    (screenshot du probleme + console browser si erreur JS)
🔄 Steps :      (ce que tu as essaye)
\`\`\`

## ⚡ FAQ rapide (a verifier avant de poster)
**1. Mon analyse demo plante**
-> Verifie que c'est un .dem FACEIT (pas .dem.gz, pas .dem.zst). Si ca plante toujours, drop l'erreur exacte ici.

**2. Coach IA dit "limite atteinte"**
-> Free = 1 diagnostic / mois. Pro = 5 msg / jour. Elite = 30 / jour.
Reset minuit UTC. Achete des credits packs sur /account.html si besoin.

**3. Pas de demo trouvee**
-> FACEIT garde les demos ~2-4 semaines. Si ton match est plus vieux, c'est purge.

**4. Mon role Discord ne match pas mon plan**
-> Va sur /account.html -> "Lier mon Discord" (ou "Delier" + relier). Sync auto en 5-10s.

## 📞 Probleme urgent ?
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

Ton idee pour ameliorer FragValue ? Drop la ici, on vote, on shippe.

## 📋 Format suggere
\`\`\`
🎯 Idee :         (titre court, 1 ligne)
📝 Context :      (pourquoi tu en as besoin, ton pain point actuel)
✅ Solution :     (ce que tu imagines comme feature)
🎮 Plan :         (Free / Pro / Elite — pour comprendre l'audience)
\`\`\`

## 🗳️ Voting
- Reagis :+1: si tu veux la feature
- Reagis :-1: si pas d'accord
- Les top votes sont review chaque semaine et integres dans la roadmap

## 🚦 Status track
Apres review on tag les threads :
- 🟢 \`accepted\` -> dans la prochaine release
- 🟡 \`considering\` -> en exploration
- 🔵 \`planned\` -> dans la roadmap mais pas immediat
- ⚫ \`rejected\` -> avec une explication

## ✅ Bonnes idees recentes (deja shippees grace a vous)
- Discord integration role auto Pro/Elite
- Resiliation 3 clics native
- Email "demo analysis ready" avec preview FV Rating
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

Quelque chose plante ? Decris le bug ici pour qu'on puisse fix vite.

## 📋 Template a copier-coller
\`\`\`
🌐 URL :              (ex: https://fragvalue.com/heatmap-results.html?id=...)
🖥️ Browser :          (Chrome 130 / Safari 18 / Firefox 132)
📱 Device :           (Desktop / Mobile iOS / Mobile Android)
🎮 Plan :             (Free / Pro / Elite)
🔄 Steps to reproduce :
  1. ...
  2. ...
  3. ...
✅ Expected :         (ce qui devrait se passer)
❌ Got :              (ce qui se passe vraiment)
📷 Screenshot :       (capture du probleme + console DevTools si JS error)
🆔 Match ID :         (si lie a une demo specifique)
\`\`\`

## 🚦 Priorite
- 🔴 \`critical\` : impact paiement, perte de donnees, securite -> fix < 24h
- 🟠 \`high\` : feature majeure cassee -> fix < 7 jours
- 🟡 \`medium\` : bug visuel ou edge case -> fix dans la prochaine release
- 🟢 \`low\` : cosmetic -> backlog

## 🔒 Bug securite ?
**Pas dans ce channel** -> mail direct **security@fragvalue.com** (pas encore publie ? mail contact@ avec le mot "security" en sujet).

> Plus ton report est detaille, plus vite on fix.`,
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

## 🏅 Echelle FV Rating
| FV Rating | Niveau equivalent | Traduction |
|-----------|-------------------|------------|
| 0.70-0.85 | Lvl 3-5           | Tu stagnes ou regresses |
| 0.85-0.95 | Lvl 5-7           | Tu tiens ta place |
| 0.95-1.05 | Lvl 7-9           | Tu fais ton job |
| 1.05-1.15 | Lvl 9-10          | Tu carry regulierement |
| 1.15-1.25 | Lvl 10 top        | Top 5% de ton level |
| 1.25+     | Semi-pro / pro    | Niveau competitif serieux |

## 🎯 Idees de challenges entre membres
- "Qui ameliore son KAST de +5% cette semaine ?"
- "Best FV Rating sur Mirage en 5 matchs consecutifs"
- "Top 1 monthly leaderboard de la commu"

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

Ton Diagnostic IA t'a sorti un truc interessant ? Balance ici, on apprend tous ensemble.

## 📋 Format ideal
\`\`\`
🎯 Insight :      (cite l'IA en quote)
📊 Contexte :     (ton FV Rating, level, map, periode)
✅ Action :       (ce que tu vas faire pour corriger)
📈 Impact :       (apres 1-2 semaines, edit le post pour partager le resultat)
\`\`\`

## 💡 Exemples de bons posts
**Exemple 1 — Opening duels**
> "Coach IA m'a dit : 'Tu perds 60% de tes opening duels en CT-side Mirage. Joue passif les 2 premiers rounds, observe les setups T avant de peek.'"
>
> Apres 1 semaine : opening WR CT Mirage est passe de 38% a 51%. Game changer.

**Exemple 2 — KAST**
> "Insight: 'Tu as 4-5 rounds fantomes par match (0 kill / 0 assist / mort tot). Reduis ton agressivite en T side anti-eco.'"
>
> A faire : check sur prochains matchs.

## ⚠️ Ce qu'on ne fait pas ici
- ❌ Pas de "Coach IA dit que je suis nul, comment progresser ?"  -> #help-support
- ❌ Pas de capture brute du diagnostic sans commentaire -> partage l'insight + ton plan
- ❌ Pas de critique du Coach IA -> #feature-requests si tu trouves un cas ou il se trompe`,
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
🔫 Type :             (smoke / molotov / flash / he / tactique strat / lineup specifique)
📍 Position :         (ou se mettre)
🎬 Demo / clip :      (lien ou screenshot)
📝 Description :      (1-2 phrases : effet attendu)
\`\`\`

## 🏷️ Tags suggeres dans le titre
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
   (ex: passer mon KAST moyen de 65% a 70% sur 10 matchs FACEIT)
✅ 3 actions concretes pour y arriver :
   1.
   2.
   3.
🔍 Comment je mesure :  (le KPI exact a tracker)
📊 FV Rating actuel :
\`\`\`

## 📋 Template dimanche (recap)
\`\`\`
🎯 Objectif visee :
✅ Atteint :          (oui/non/partiel)
📊 Resultat :         (chiffres)
💡 Apprentissages :   (1-2 phrases)
🎯 Objectif semaine prochaine :
\`\`\`

## 🏆 Reward de la commu
Top 3 progress de la semaine selon le coach IA -> mention dans #announcements + 1 mois Elite gratuit pour le 1er.

## 💪 Pourquoi c'est utile
**Strava effect** : les gens qui annoncent publiquement leurs objectifs les atteignent ~2-3x plus souvent. Pas de pression, juste de la visibilite.`,
      },
    ],
  },

  {
    channel: 'demo-reviews',
    messages: [
      {
        pin: true,
        content: `# 📺 Demo reviews — collective Sunday 19h CET

Chaque dimanche, on decortique ensemble une demo pro (Major, Blast, ESL Pro League).

## 📅 Schedule
- 🕐 **Dimanche 19h CET**
- 🎤 Voice channel #voice-lobby
- 🖥️ Screen share via Discord stream
- ⏱️ Duree : ~45-60 min

## 🎬 Programme type
1. **5 min** : intro + presentation du match (teams, importance, score)
2. **15 min** : decortique du **CT-side d'une team** (utility, retakes, anti-strats)
3. **15 min** : decortique du **T-side de l'autre team** (executes, picks, mid-round calls)
4. **10 min** : insights cles + transferable a notre niveau (FACEIT Lvl 5-10)
5. **10 min** : Q&A live

## 📋 Pour participer
- Rejoins le #voice-lobby a 19h pile
- Prepare un notepad pour noter les insights
- Pose tes questions en chat #demo-reviews ou direct au mic

## 🎯 Demos prochaines
**Dimanche prochain (a annoncer dans #announcements le vendredi)**

## 💡 Tu veux suggerer une demo a decortiquer ?
Drop le **lien HLTV** + raison dans ce channel. Top votes = on fait celle-la.`,
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

Le match pro **a regarder aujourd'hui**, choisi par la commu et la mod.

## 🎯 Critere de selection
- Match d'un tournoi tier 1 (Major, BLAST, ESL Pro League, IEM)
- BO3+ ou BO5
- Equipes top 20 HLTV
- Storyline interessante (clutch series, comeback, debut nouveau roster)

## 📋 Format du post quotidien
\`\`\`
🏆 Tournoi :
⚔️  Match :              (ex: Vitality vs FaZe BO3)
🕐 Heure :               (CET, lien GMT pour les autres regions)
📺 Stream :              (https://twitch.tv/... ou https://hltv.org/...)
📝 Storyline :           (1-2 phrases sur l'enjeu)
🎯 Pourquoi c'est interessant :
\`\`\`

## 💬 Discussion live
Pendant le match, balance tes reactions ici. Apres :
- 🔥 Best round du match
- 🎯 MVP de chaque team
- 📊 Stats qui surprennent

## 🗳️ Tu veux suggerer un match ?
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

Calendar des tournois pros et discussions par event.

## 📅 Tournois majeurs 2026 (a jour)
- **PGL Cluj-Napoca Major** — Fevrier 2026 ✅ termine
- **BLAST Spring Final** — Avril 2026 ✅ termine
- **IEM Cologne** — Aout 2026 (a confirmer)
- **ESL Pro League S22** — Sept-Oct 2026
- **PGL Bucarest Major** — Decembre 2026

## 📋 Format thread par event
Pour chaque tournoi majeur, on cree un **thread dedie** avec :
- Bracket + standings
- Predictions community
- Daily highlights
- Best plays compilation

## 🎯 Predictions challenge
Pour les Majors, on lance un **prediction challenge** :
- Predit le top 4
- Predit le MVP
- Predit le best K/D

Top 3 predictions = 3 mois Elite gratuit.

## 📺 Ressources
- 📊 HLTV : https://hltv.org/events
- 📅 Liquipedia calendar : https://liquipedia.net/counterstrike/Main_Page
- 🎬 Replays YouTube : chaines officielles BLAST, ESL, PGL`,
      },
    ],
  },

  {
    channel: 'pro-replays-discussion',
    messages: [
      {
        pin: true,
        content: `# 🎬 Pro replays discussion

Discute les rounds des pros : pourquoi ce setup ? cette decision ? cette utilisation d'utility ?

## 📋 Format pour poster
\`\`\`
🏆 Match :                (ex: Vitality vs G2, IEM Katowice 2026)
🗺️ Map :
🔢 Round :                (numero ou timestamp dans le VOD)
🎬 Lien VOD :             (timestamp direct si possible : ?t=12345s)
🎯 Sujet de discussion :  (1-2 phrases : qu'est-ce qui t'intrigue ?)
📝 Ton analyse :          (ce que tu en penses)
\`\`\`

## 🎯 Bons sujets de discussion
- **Decision IGL** : pourquoi cette strat / call dans cette situation ?
- **Utility coordination** : execute multi-utility, double smoke, etc.
- **Clutch breakdown** : comment le pro a gere ce 1v3 ?
- **Anti-strat detection** : quand le CT a senti la strat venir
- **Eco round genius** : 4-1 sur eco, comment ?

## 📚 Comment apprendre vraiment
1. Pause le VOD a la fin du round
2. Note ta prediction de ce qui va se passer
3. Watch le round
4. Analyse ce que tu avais bon / faux
5. Cherche les patterns sur 10-20 rounds

## 🎓 Le coach IA peut analyser tes propres demos avec la meme rigueur. Drop ta demo sur fragvalue.com -> diagnostic detaille.`,
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

Bienvenue dans le **lounge Elite**, reserve aux abonnes Elite. 🟪

## 🎯 Ce qui se passe ici
- 💬 Discussions privees entre Elite members
- 🎓 Coaching collectif mensuel (sessions 1h voice)
- 🎬 Demo reviews **avancees** (1v1 calls + tactical breakdown profond)
- 📊 Acces beta aux features avant tout le monde
- 🤝 Networking Elite : se trouver pour 5v5 entre membres serieux

## 📅 Events Elite recurrents
- 🎓 **Coaching collectif** : 1er samedi du mois, 18h CET
- 🎬 **Tactical demo review** : 3eme dimanche du mois, 19h CET
- 📊 **Beta features preview** : announcement quand dispo

## 🔒 Confidentialite
Ce qui se dit ici reste ici. Pas de screenshots / leaks vers les channels publics. Sanction = revocation Elite + ban serveur.

## 🎯 Acces aux autres channels Elite
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

Duree : ~1h. Coach invite (ESEA / ECL / AS coach pro francophone).

## 🎯 Format de la session
1. **10 min** : tour de table — chaque participant partage son **pain point #1** de la semaine
2. **30 min** : focus sur 2-3 sujets recurrents (mid-round calls, anti-eco, post-plant)
3. **15 min** : Q&A directe avec le coach
4. **5 min** : objectifs hebdo a poster dans #progression

## 📋 Comment participer
- Rejoins simplement le voice channel a 18h
- Prepare 1 question precise sur ton jeu
- Mic optionnel mais conseille
- Camera off acceptee

## 🎓 Coachs deja invites
*Section a remplir une fois on a 2-3 sessions a notre actif*

## 💡 Tu veux suggerer un coach ?
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

Prepare tes matchs serieux (FACEIT lvl 10+, ESEA league, tournois) avec la commu.

## 🎯 Use cases
- 📊 **Anti-strat** : tu vas affronter une team, on cherche leurs patterns
- 🗺️ **Prep veto** : ban-pick optimal selon votre roster vs leur roster
- 🎬 **Demo review express** : analyse rapide des 3 dernieres demos de l'opposant
- 💬 **War room** : discussion live pendant que tu warm avant le match

## 📋 Format de demande
\`\`\`
⚔️  Vs team :              (URL FACEIT team / HLTV / nom)
📅 Match prevu :           (date + heure)
🎯 Stake :                 (quel niveau / qualif / ranked)
🌐 URL FragValue prep :    (https://fragvalue.com/prep-veto.html?... avec votre roster)
🆘 Aide voulue :           (anti-strat / prep veto / demo review)
\`\`\`

## 🤝 Comment aider un autre membre
- Reagis avec :raised_hand: si tu peux scout
- Drop ton analyse en thread sous le post
- Si le membre est en match dans <30 min, prio absolu

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

Channel reserve aux abonnes Pro et Elite.

## 🎯 Ce qui se passe ici
- 💬 Discussions Pro-tier (entre membres serieux qui investissent dans leur progression)
- 🎬 Partage de demos perso pour review entre membres
- 📊 Compare ton FV Rating mensuel avec les autres Pro
- 🤝 Trouve des partenaires de meme niveau (Lvl 8+ FACEIT typically)

## 🎯 Differences avec #general (public)
- Conversation plus tech / focused
- Spam / off-topic = 0 tolerance
- Niveau moyen plus haut (les membres Free ne sont pas la)
- Beta features previews (avant Elite)

## 💎 Tu veux passer Elite ?
Acces aux channels Elite + sessions coaching mensuelles + tactical demo reviews + beta features.

29€/mois, sans engagement, annulable en 1 clic. -> https://fragvalue.com/pricing.html`,
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
        content: `# 🛠️ Moderation log

Log automatique des actions de moderation (warn / mute / kick / ban) + events serveur.

⚠️ **Channel reserve aux moderateurs.** Read-only pour les autres.

## 📋 Ce qui est logge
- Sanctions appliquees (warn, mute, kick, ban) avec raison
- Joins / leaves serveur
- Channel creations / deletions
- Role changes (debug)
- Bot errors / warnings

> Configure via bot MEE6 / Carl-bot ou via webhook custom.`,
      },
    ],
  },

  {
    channel: 'reports',
    messages: [
      {
        pin: true,
        content: `# 🚨 Reports — signaler un comportement

Tu vois quelque chose qui viole les regles ? Signale-le ici, on traite.

## 📋 Format pour reporter
\`\`\`
👤 User concerne :          (mention + ID si possible : right-click profil > Copier ID)
📍 Channel concerne :       (ex: #general)
🐛 Comportement :           (1-2 phrases)
📷 Screenshot / message ID : (right-click message > Copy ID)
🚨 Severity :               (mineur / majeur / zero-tolerance)
\`\`\`

## ⚠️ Categories de violations
- 🟢 **Mineur** : spam, off-topic, langue non FR/EN -> warn / mute court
- 🟠 **Majeur** : agressivite, doxxing menace, pub repetee -> mute long / kick
- 🔴 **Zero-tolerance** : racisme / sexisme / harcelement / cheats / threats -> ban immediat

## 🔒 Confidentialite
Les reports sont **prives** (visible uniquement par les moderateurs). Le user signale n'est jamais notifie de qui a report.

## 🚫 Anti-abus
Spam de reports / faux reports = warn d'abord, puis sanction (le report est un outil serieux).

> Pour une urgence absolue (menaces, doxxing en cours) : DM direct @Founder.`,
      },
    ],
  },
];

// ============================================================================
// API helpers
// ============================================================================

async function api(path, options = {}) {
  const url = `${DISCORD_API}${path}`;
  const headers = {
    'Authorization': `Bot ${BOT_TOKEN}`,
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord API ${options.method || 'GET'} ${path} failed: ${res.status} ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listChannels() {
  return await api(`/guilds/${GUILD_ID}/channels`);
}

async function getPinnedMessages(channelId) {
  return await api(`/channels/${channelId}/pins`);
}

async function postMessage(channelId, content) {
  if (DRY_RUN) {
    console.log(`    [DRY] Would post to ${channelId}: ${content.split('\n')[0].slice(0, 60)}...`);
    return { id: 'dry-run-' + Date.now() };
  }
  return await api(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

async function pinMessage(channelId, messageId) {
  if (DRY_RUN) {
    console.log(`    [DRY] Would pin message ${messageId}`);
    return;
  }
  return await api(`/channels/${channelId}/pins/${messageId}`, {
    method: 'PUT',
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n${DRY_RUN ? '🔍 [DRY RUN] ' : '🚀 '}Populate Discord content (guild ${GUILD_ID})\n`);

  let channels;
  try {
    channels = await listChannels();
  } catch (err) {
    console.error('❌ Failed to list channels:', err.message);
    process.exit(1);
  }

  // Index par nom (pour lookup rapide)
  const channelsByName = new Map();
  for (const ch of channels) {
    if (ch.type === 0) channelsByName.set(ch.name, ch); // text channels uniquement
  }

  let stats = { posted: 0, pinned: 0, skippedAlreadyPinned: 0, channelNotFound: 0 };

  for (const entry of CONTENT) {
    const ch = channelsByName.get(entry.channel);
    if (!ch) {
      console.log(`⚠️  Channel #${entry.channel} not found (run discord-setup.js first?)`);
      stats.channelNotFound++;
      continue;
    }

    // Idempotence : si le channel a deja des messages pinnes du bot, on skip
    // (sauf si FORCE=1).
    if (!FORCE) {
      try {
        const pins = await getPinnedMessages(ch.id);
        if (pins && pins.length > 0) {
          if (VERBOSE) console.log(`📌 #${entry.channel}: skip (already has ${pins.length} pinned message${pins.length > 1 ? 's' : ''})`);
          stats.skippedAlreadyPinned++;
          continue;
        }
      } catch (err) {
        console.warn(`  ⚠️  Could not check pins for #${entry.channel}: ${err.message}`);
      }
    }

    console.log(`📝 #${entry.channel} (${entry.messages.length} message${entry.messages.length > 1 ? 's' : ''} to post)`);

    for (const msg of entry.messages) {
      try {
        const posted = await postMessage(ch.id, msg.content);
        stats.posted++;
        if (msg.pin && posted?.id && !DRY_RUN) {
          // Le pin doit etre fait apres le post (sinon le messageId n'existe pas)
          await new Promise(r => setTimeout(r, 250)); // rate limit
          await pinMessage(ch.id, posted.id);
          stats.pinned++;
          console.log(`    📌 pinned`);
        }
        await new Promise(r => setTimeout(r, 500)); // rate limit safety
      } catch (err) {
        console.error(`    ❌ Failed: ${err.message}`);
      }
    }
  }

  console.log(`\n✅ Done. Posted ${stats.posted} messages, pinned ${stats.pinned}.`);
  if (stats.skippedAlreadyPinned > 0) console.log(`   Skipped ${stats.skippedAlreadyPinned} channels (already populated).`);
  if (stats.channelNotFound > 0) console.log(`   ⚠️  ${stats.channelNotFound} channels not found — run scripts/discord-setup.js first?`);
  console.log('');
  if (DRY_RUN) console.log('(DRY RUN — no changes applied. Re-run without DRY_RUN=1 to apply.)\n');
}

main().catch(err => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
