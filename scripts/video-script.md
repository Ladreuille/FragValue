# Script vidéo de présentation FragValue

**Cible** : page d'accueil + landing pricing + posts réseaux sociaux (TikTok, X, Discord, YouTube short)
**Durée** : 75-90 secondes
**Format** : 16:9 (1920×1080) pour YouTube/X, ratio 9:16 disponible avec recadrage
**Style visuel** : sombre, vert accent (#b8ff57), Anton + Space Mono (cohérent avec la charte)
**Ton de voix** : direct, technique, second degré assumé. Comme un pote level 10 qui te debrief un match.

---

## Pipeline de production

```
1. Lance le recorder Playwright       → produit les .webm bruts par feature
   $ node scripts/record-demo.js

2. Enregistre la voix-off              → micro USB ou iPhone (mémo vocal)
   Lis le texte de chaque section ci-dessous, enregistre en .wav 48kHz

3. Monte dans CapCut / iMovie          → drop les .webm + voix + musique
   Suis le timing ci-dessous (chaque section = 1 clip)

4. Exporte en MP4 1080p H.264          → upload prod fragvalue.com et réseaux
```

---

## Storyboard scène par scène

### 01 · INTRO (0:00 – 0:05)
- **À l'écran** : `clips/01-intro.webm` — homepage qui charge, headline visible, scroll léger
- **Voix-off** :
  > « Tu joues 5 heures par jour. Tu fais le même match en boucle. Les mêmes erreurs. Sans le savoir. »
- **Texte overlay** : `Tu stagnes ?` → fade out
- **SFX** : whoosh à 0:03 + bass drop à 0:05

### 02 · UPLOAD (0:05 – 0:14)
- **À l'écran** : `clips/02-demo-upload.webm` — page demo.html, slider des 8 maps qui défile, dropzone qui s'illumine au hover
- **Voix-off** :
  > « FragValue analyse ta demo en moins de 30 secondes. Glisse ton fichier, ou link FACEIT, c'est tout. »
- **Texte overlay** : `8 maps · MR12 · CS2 ready` (avec dot animé qui pulse)
- **B-roll suggestion** : zoom progressif sur le slider quand Cache passe (la nouvelle map)

### 03 · FV RATING (0:14 – 0:24)
- **À l'écran** : `clips/03-fv-rating.webm` — stats-guide.html, scroll sur la formule FVR, comparaison Leetify
- **Voix-off** :
  > « FV Rating, c'est notre mesure de l'impact réel. Pas juste les frags. Le KAST, l'ouverture, le clutch, l'utilité. Comme HLTV Rating 2.0, mais transparent : la formule est publique. »
- **Texte overlay** : `Impact réel · pas juste les frags`
- **Élément à mettre en valeur** : le tableau qui décompose les composantes du FVR

### 04 · 2D REPLAY (0:24 – 0:34)
- **À l'écran** : `clips/04-replay-2d.webm` — section how-it-works.html, capture d'un round Mirage A site
- **Voix-off** :
  > « Replay 2D round par round. Vois exactement où tu étais, qui tu as trade, qui t'a tué. Tape un round, t'as la situation gelée à la frame près. »
- **Texte overlay** : `Round-by-round · tick precision`
- **B-roll suggestion** : zoom sur les positions joueurs avec les flèches de mouvement

### 05 · AI COACH CONVERSATIONAL (0:34 – 0:50) ⭐ KILLER FEATURE
- **À l'écran** : `clips/05-coach-ia.webm` — pricing.html avec carte Elite, puis demo du chat (à mocker manuellement si besoin)
- **Voix-off** :
  > « Et le coach IA. Pose-lui n'importe quelle question sur ton match. "Pourquoi j'ai perdu round 12 ?" Il te répond avec le contexte exact, et un lien cliquable qui ouvre le replay au bon moment. Lexique scène pro, raisonnement SBI, streaming temps réel. Réservé Elite. »
- **Texte overlay** : `Pose une question · clique le round · revis le moment` + badge `KILLER FEATURE` qui flash
- **Important** : c'est ta feature différenciatrice, soigne ce segment. Si possible, enregistre un vrai chat live (15s) et insère ce clip à la place du `.webm` Playwright

### 06 · HEATMAPS (0:50 – 0:58)
- **À l'écran** : `clips/06-heatmaps.webm` — lineup-library, smoke setups visualisés
- **Voix-off** :
  > « Heatmaps tactiques. Vois où meurent tes mates, où tu campes trop, où sont les angles que tu loupes. »
- **Texte overlay** : `Heatmaps · positions · lineups`

### 07 · PRO BENCHMARKS (0:58 – 1:06)
- **À l'écran** : `clips/07-pro-benchmarks.webm` — pro-benchmarks.html avec ZywOo, donk, NiKo
- **Voix-off** :
  > « Compare-toi à un pro qui a ton style. ZywOo si t'es AWPer, donk si t'es agressif, sh1ro si t'es passif. Les datas viennent de HLTV, pas inventées. »
- **Texte overlay** : `Pro twin · ZywOo / donk / NiKo · 60 pros indexés`

### 08 · PREP VETO BO3 (1:06 – 1:14)
- **À l'écran** : `clips/08-prep-veto.webm` — prep-veto.html, sélection 2 teams, recommandations
- **Voix-off** :
  > « Tu joues un BO3 ce soir ? Entre les 2 rosters FACEIT, FragValue te dit quoi ban, quoi pick, quel side, et te calcule la win probability. »
- **Texte overlay** : `BO1 · BO3 · BO5 · ban-pick optimal`

### 09 · OUTRO + CTA (1:14 – 1:25)
- **À l'écran** : `clips/09-outro.webm` — homepage, scroll vers le bouton "Analyser une demo"
- **Voix-off** :
  > « 1 analyse gratuite par mois pour tester. Pro à 5 euros, Elite à 10. Pas d'abonnement piège, pas de pub. Juste les stats qu'il te faut pour passer level 10. »
- **Texte overlay final** : `fragvalue.com · Made in France · Level 10 ready`
- **SFX** : whoosh final + logo qui s'agrandit

---

## Script narration brut (à enregistrer en une prise)

> Tu joues 5 heures par jour. Tu fais le même match en boucle. Les mêmes erreurs. Sans le savoir.
>
> FragValue analyse ta demo en moins de 30 secondes. Glisse ton fichier, ou link FACEIT, c'est tout.
>
> FV Rating, c'est notre mesure de l'impact réel. Pas juste les frags. Le KAST, l'ouverture, le clutch, l'utilité. Comme HLTV Rating 2.0, mais transparent : la formule est publique.
>
> Replay 2D round par round. Vois exactement où tu étais, qui tu as trade, qui t'a tué. Tape un round, t'as la situation gelée à la frame près.
>
> Et le coach IA. Pose-lui n'importe quelle question sur ton match. « Pourquoi j'ai perdu round 12 ? » Il te répond avec le contexte exact, et un lien cliquable qui ouvre le replay au bon moment. Lexique scène pro, raisonnement SBI, streaming temps réel. Réservé Elite.
>
> Heatmaps tactiques. Vois où meurent tes mates, où tu campes trop, où sont les angles que tu loupes.
>
> Compare-toi à un pro qui a ton style. ZywOo si t'es AWPer, donk si t'es agressif, sh1ro si t'es passif. Les datas viennent de HLTV, pas inventées.
>
> Tu joues un BO3 ce soir ? Entre les 2 rosters FACEIT, FragValue te dit quoi ban, quoi pick, quel side, et te calcule la win probability.
>
> Une analyse gratuite par mois pour tester. Pro à 5 euros, Elite à 10. Pas d'abonnement piège, pas de pub. Juste les stats qu'il te faut pour passer level 10.

---

## Musique de fond

Cherche sur Epidemic Sound / Artlist (libre de droits) :
- Genre : `lo-fi techno`, `synthwave dark`, `cyberpunk minimal`, `gaming ambient`
- BPM : 90-110
- Mood : `focus`, `tense`, `confident`
- Réf : "Pulse" de Ben Khan, "Night Drive" de TOKYO LOSTBOY, ou n'importe quoi de la playlist YouTube `cyberpunk lofi 1 hour`

Évite : tout ce qui a une voix qui chante (interfère avec ta voix-off)

---

## Variantes à tirer

Une fois le master 90s tourné, fais des coupes plus courtes :

- **Short TikTok / Reels (9:16, 30s)** : Intro + Coach IA + Outro
- **X post (16:9, 45s)** : Intro + FV Rating + Coach IA + CTA
- **Discord embed (15s)** : Coach IA seul (le plus différenciateur)
- **Banner GIF homepage (5s, sans son)** : Coach IA en streaming text avec citations cliquables

---

## Éléments visuels à incruster en post

- Logo FragValue en watermark coin bas-droit (toujours visible, opacité 60%)
- Curseur Playwright auto-injecté (fait dans `record-demo.js`)
- Flèches d'annotation pour pointer les éléments clés (dans CapCut, c'est `Stickers > Arrow`)
- Sound design : whooshes Epidemic Sound `transition tech`, dings sur chaque feature qui apparaît
- Sous-titres FR brûlés : 70%+ des vues sociales sont muets

---

## Checklist pré-publication

- [ ] Vérifier que tous les clips Playwright sont OK (8 .webm)
- [ ] Voix-off enregistrée propre (pas de bruit de fond)
- [ ] Sous-titres burned in (FR + EN si bilingue)
- [ ] Watermark logo coin bas-droit
- [ ] CTA final visible 3+ secondes
- [ ] Export final : MP4, H.264, 1080p, ~10 Mbps, AAC 256kbps
- [ ] Test lecture sur mobile (volume bas)
- [ ] Variante 9:16 (recadrage central) prête
- [ ] Description / hashtags réseaux sociaux préparés
