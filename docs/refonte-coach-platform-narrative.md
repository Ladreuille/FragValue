# Refonte Coach Platform — Narrative + Structure

**Status** : Phase 0 draft v1, 2026-06-08
**Owner** : Quentin
**Branche** : `preview/coach-platform-refonte`
**Validation gate** : ce doc doit etre valide avant Phase 1 (refonte HTML)

## Pourquoi cette refonte

FACEIT vient de ship en native (avril-juin 2026) :
- FACEIT Rating + Round Swing
- Match Insights : 2D map + utility tracking + per-round breakdown
- Duels matrix
- Acquisition Mobalytics (mars 2025) → roadmap 2026 inclut "AI Coach", "Team Analytics", "Watchlist", "Lineups"

Le pitch "stats avancees CS2" de FragValue est mort. Le repositionnement coach-first est vital, pas optionnel.

L'analyse competitive ([refonte-coach-platform-benchmark](./b2b-coaching-platform-mvp-spec.md)) confirme :
- 3 concepts produits indispensables et defensifs vs FACEIT identifies
- Strategy : 1 produit unifie "Coach OS" avec 3 capabilities (VOD Coordinator, Practice OS, Anti-Strat Strat Time)
- Sequence : Vague 1 VOD Coordinator MVP, Vague 2 integration Practice, Vague 3 premium Anti-Strat

## Discipline soustractive : ce qui meurt

Sur la home actuelle, suppression sans pitie :

| Element | Pourquoi mort |
|---------|---------------|
| Ticker top "STATS ROUND PAR ROUND · ROSTER · COACH IA · LINEUP LIBRARY · 17 features" | Saturation. Lando dit 1 chose, pas 17. |
| Carte stats droite hero (FV/KAST/ADR/Opening) | Competit avec le H1. Focus impossible avec 4 chiffres. |
| Subtitle dense 4-5 lignes "Tes stats CS2 te donnent ton ADR et ton KAST..." | Trop de texte hero. 1 phrase max. |
| CTA secondaire "Voir les fonctionnalites →" | Single CTA discipline. |
| Section AUTO / 11 / 5 min sous le hero | Stats prematurees, pas la place dans le hero. |
| Tag "Auto-sync FACEIT · LIVE depuis mai 2026" | Sans valeur pour un coach. |
| Toute mention "Lineup library Pro" | FACEIT va le shipper, on ne le vend pas. |
| Tout le pitch "FV Rating exclusif" | Mort apres FACEIT Rating ship. Repositionner en "couche tactique au-dessus". |
| Section autosync FACEIT (3 colonnes) | Trop technique pour le pitch coach. |
| Cookie banner full-width 80px+ | A reduire en barre fine 40px. |
| Chat widget bulle vert bas-droite | A masquer pendant les 2 premiers viewports. |

Resultat : la home actuelle passe de ~24 000 px de hauteur a ~12 000 px. Moitie. **C'est ca la discipline soustractive.**

## Ce qui survit et se garde

| Element | Statut |
|---------|--------|
| Marque FragValue + palette #b8ff57 + Anton + Space Mono | Inchange |
| Tactical radar canvas hero | Conserve, amplifie en taille |
| Cursor reveal section (commit `4a93907`) | Conserve, re-textualise coach-first |
| Brand marquee footer (commit `11f76b9`) | Conserve, agrandi de 102px a 200px |
| `<em>` shimmer animation | Conserve sur les accents lime |
| CTA glow lime | Conserve |
| Toutes les pages secondaires (cgv, mentions, privacy, blog, sitemap) | Inchangees |

## Ce qui s'ajoute (le premium feel)

| Pattern | Source d'inspiration | Phase |
|---------|---------------------|-------|
| Widget sticky bottom-left "Prochaine session Vendredi 21h" | Lando "Next Race Barcelona GP" | 3 |
| Lenis smooth scroll | Tous sites Awwwards 2026 | 3 |
| Sticky nav avec bg opacity change au scroll | Standard premium | 3 |
| Massive Anton headlines `clamp(80, 12vw, 220)` | Lando, Linear, Vercel | 1 |
| Whitespace x3 (padding sections 200px+) | Lando, Apple | 1 |
| Hero translate-up + product UI rising | Lando 10% scroll moment | 3 |
| Cascade staggered sur capability cards | Lando helmet grid | 3 |
| Hover state mask reveal sur cards | Lando helmet hover | 3 |
| Pinned scroll sections sur les 3 Capabilities | Lando partner grid | 3 |
| Product UI demos animees (Coach IA conv, VOD scrub, heatmap build) | Hudl product demos | 4 |
| Section transitions Remotion stingers (lime flash 3s) | Lando section breaks | 6 |

## Narrative complete — 10 sections

Une discipline cle : **1 section = 1 message**. Pas de mix.

### Section 1 — Hero

**Headline** (Anton 220px clamp) :
```
COACH OS.
```

**Subheadline** (Anton 56px lime accent) :
```
POUR CS2.
```

**Tagline** (Space Mono 16px gris) :
```
Debrief tactique. Planning. Anti-strat. Une plateforme.
```

**Single CTA** (lime button) :
```
Configurer mon equipe  →
```

**Sticky widget bas-gauche** (anchored throughout scroll) :
```
SESSION VENDREDI 21H
4 / 5 joueurs prets
```

**Background** : tactical radar amplifie, opacity 0.12 (au lieu de 0.2)

**Rien d'autre.** Pas de nav visible (apparait au scroll), pas de stats, pas de sub paragraph.

### Section 2 — Problem (cursor reveal evolved)

Reutilise le cursor reveal existant mais re-textualise :

**Layer 1 (visible defaut)** :
```
TU VOIS TON ROSTER COMME CA.

K/D 1.10 · KAST 65% · ADR 78
```

**Layer 2 (revele sous curseur)** :
```
FRAGVALUE LE VOIT COMME CA.

FV 0.42 · Entry T 22% · Trade 0%
3 morts T-side mid Cache <15s
```

Identique structurellement au commit `4a93907`, juste les chiffres et le wording adaptes pour parler a un coach (pas a un solo player).

### Section 3 — Capability 1 : VOD Coordinator

**Headline** (Anton 140px) :
```
DEBRIEF EN 30 MIN,
PAS 4 HEURES.
```

**Subtitle** (Space Mono 18px) :
```
Selectionne les rounds critiques. Assigne par joueur.
Discord async. Agenda auto-genere.
```

**Product UI demo** (animation a droite, section pinned 300vh) :
- 2D map de demo qui scrub
- Annotations qui apparaissent en lime ("Round 7 · Qwhentin over-peek mid · 12s")
- Cards joueurs qui recoivent les assignments
- Discord notif qui pop "Tu as 3 rounds a watch d'ici Vendredi"
- Counter en bas "30 minutes" / "4 heures" qui se calcule

### Section 4 — Capability 2 : Practice OS

**Headline** (Anton 140px) :
```
PLANIFIE LA SEMAINE
EN 10 MIN.
```

**Subtitle** :
```
Drills, praccs, accountability Discord.
Coach IA propose, tu valides.
```

**Product UI demo** :
- Weekly grid lundi → dimanche
- Slots pracc qui se remplissent automatiquement
- Drills assignments qui glissent dans des cells
- Players names qui apparaissent avec status (ready/late/missing)

### Section 5 — Capability 3 : Anti-Strat Strat Time

**Headline** (Anton 140px) :
```
PREPARE SAMEDI
AVANT TOUS LES AUTRES.
```

**Subtitle** :
```
Demos adversaires importes automatiquement.
Patterns par map. War room collaborative.
```

**Product UI demo** :
- Input "Team adverse : Macuu"
- Spinner "Fetching 7 demos..."
- Rapport qui se construit : default execute Mirage A, common timing, weak players
- Team co-edition annotations

### Section 6 — Coach IA

**Headline** (Anton 140px) :
```
L'IA QUI A LU
10 000 DEMOS PRO.
```

**Subtitle** :
```
Pas un chatbot. Un copilote tactique.
Vises directement le pourquoi.
```

**Product UI demo** :
- Conversation Coach IA qui s'ecrit lettre par lettre
- Question : "Pourquoi mon roster perd Mirage T-side ?"
- Reponse anime avec citations de rounds + suggestions actionables

### Section 7 — Pricing

**Headline** (Anton 140px) :
```
POUR TOUTES LES TAILLES
D'EQUIPE.
```

**4 tiers cards** :

| Tier | Prix | Pour qui | Inclus |
|------|------|----------|--------|
| **Solo legacy** | 9 EUR/mois | Players solo deja inscrits | Acces solo, grandfathered (non promu) |
| **Team Starter** | 49 EUR/mois | Coach amateur 5 joueurs | VOD Coordinator, dashboard roster |
| **Team Pro** | 149 EUR/mois | Academie semi-pro | + Practice OS, + Coach IA roster, + Discord deep |
| **Team Elite** | 249 EUR/mois | Esport org | + Anti-Strat Strat Time, + multi-roster, + priority parsing |
| **Enterprise** | Custom | Karmine, Vitality, Heroic-tier | Tout + SSO + support dedie + integration custom |

Hover state mask reveal sur chaque card.

### Section 8 — Social proof (placeholder pour design partners)

**Headline** (Anton 96px) :
```
DEJA UTILISE PAR
DES COACHES QUI GAGNENT.
```

Pendant la beta : placeholder neutre "Annonce des design partners apres validation". Apres premiers clients : 3-5 testimonials avec photo + nom + structure.

### Section 9 — Final CTA

**Headline** (Anton 140px) :
```
DEMARRE GRATUITEMENT
30 JOURS.
```

**Sub** :
```
Pas de carte. Pas d'engagement. Setup en 5 minutes.
```

**CTA** :
```
Configurer mon equipe  →
```

### Section 10 — Brand marquee + Footer

**Brand marquee 200px** (vs 102px actuel) :
```
FRAGVALUE · COACH OS FOR CS2 · FRAGVALUE · STATS REDEFINED · FRAGVALUE ·
```

**Footer minimal** : logo + nav links + social + copy.

## Hierarchie visuelle (typography scale)

Discipline : 4 font sizes uniquement.

| Token | Size | Usage |
|-------|------|-------|
| `--display-xl` | `clamp(120px, 16vw, 280px)` | Hero only |
| `--display-l` | `clamp(80px, 12vw, 200px)` | Brand marquee, hero accent |
| `--display-m` | `clamp(56px, 9vw, 140px)` | Section H1 |
| `--display-s` | `clamp(32px, 5vw, 64px)` | Sub-headlines, pricing tier names |
| `--body-l` | `18px` | Subtitles, primary copy |
| `--body-m` | `16px` | Standard body |
| `--mono-tag` | `11px` | Tags, labels, monospace |

## Spacing scale

Discipline : 6 valeurs uniquement.

| Token | Size | Usage |
|-------|------|-------|
| `--space-xs` | `8px` | Inline gaps |
| `--space-sm` | `24px` | Card padding, gaps small |
| `--space-md` | `64px` | Sections internal |
| `--space-lg` | `160px` | Padding section vertical |
| `--space-xl` | `240px` | Padding hero / final CTA |
| `--space-xxl` | `320px` | Whitespace cinematique entre capabilities |

## Color tokens (inchanges)

```
--bg-deep      : #000
--bg-base      : #050505
--bg-elevated  : #0a0a0a
--border       : #1c1e1e
--border2      : #252727
--text         : #fff
--text2        : #7a8080
--text3        : #8a9090
--accent       : #b8ff57 (lime)
--accent2      : #7ddd1a (lime dark hover)
--glow-lime    : rgba(184,255,87,0.35)
```

## URL structure post-refonte

| URL | Etat |
|-----|------|
| `/` | Refondu coach-first |
| `/pricing.html` | Refondu 4 tiers B2B + Solo legacy mention |
| `/coach-dashboard.html` | NOUVEAU (V1 launch) |
| `/vod-coordinator/[demoId]` | NOUVEAU (V1 launch) |
| `/onboarding-coach.html` | NOUVEAU |
| `/developers.html` | Inchange |
| `/blog.html` + articles | Inchanges |
| `/account.html` | Inchange majoritairement + ajout roster management |
| `/demo.html` | Conservation + lien "Tu es coach ? Vois plutot →" en haut |
| `/solo` | NOUVEAU : page legacy pour les 17 users B2C existants |

## Roadmap phases 0-6

| Phase | Sem | Deliverables | Validation gate |
|-------|-----|--------------|-----------------|
| **0** | Sem 1 | Ce doc | Tu valides ou modifies. Si modif > 30% du doc, on re-discute. |
| **1** | Sem 2 | HTML refondu (squelette propre, pas de motion) | Visuellement on lit la story en 30s sans CSS |
| **2** | Sem 3 | Design system tokens + responsive scale | Tout le site rentre dans 4 font sizes, 6 spacing values, 3 fond colors |
| **3** | Sem 4 | GSAP + Lenis + sticky widget + hero pin | Scroll buttery, anchors qui breathent |
| **4** | Sem 5-6 | Product UI demos animees (5 demos) | Chaque capability section a sa demo qui montre la value prop |
| **5** | Sem 7 | Polish responsive + accessibilite (reduced-motion, mobile) | Lighthouse 95+ perf, 100 a11y |
| **6** | Sem 8 | Remotion stingers + A/B test 1 sem | Decision finale go-live ou rollback |

## Metriques de succes A/B test (sem 8)

| Metric | Avant (current) | Cible new site |
|--------|-----------------|-----------------|
| Time on page mediane | ~45s | 120s+ |
| Scroll depth 75% | ~25% | 60%+ |
| Coach IA conv start rate | 4% | 12%+ |
| Signup rate (coach persona) | 0.5% | 2-3% |
| Subjective premium feel (interviews) | 5/10 | 8.5/10+ |

Si on n'atteint pas au moins 3/5 metriques : rollback to current + post-mortem + iterate.

## Risques + mitigation

| Risque | Mitigation |
|--------|-----------|
| GSAP scrub pin bugs Safari/iOS | Test systematique avant chaque commit |
| Perf weight excessive | Cible <300kb initial, lazy-load Remotion videos |
| 8 sem trop ambitieux solo | Coupes possibles : Phase 6 (Remotion stingers) optionnelle, Phase 4 demo count reductible |
| Pitch coach-first ne resonne pas | Phase 0 a valider par 3 interviews coaches avant Phase 1 |
| SEO break | Redirects propres, URL preserves, schema.org maintenu |

## Validation Phase 0

Tu lis ce doc. Tu m'envoie :
- **(A) OK go Phase 1** : on enchaine sans modif
- **(B) Modifications mineures** : tu listes 3-5 changements, je redige v2, on revalide
- **(C) Pitch a revisiter** : la narrative coach-first ne te convient pas, on rediscute strategiquement avant de redessiner
