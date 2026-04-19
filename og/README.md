# OG Images FragValue

Chaque page principale a sa propre image Open Graph (1200×630 PNG). Les fichiers
sont référencés dans les `<meta property="og:image">` du HTML.

## Naming convention

`/og/<slug>.png` où `<slug>` = basename du fichier HTML (sans `.html`).

| Page                | Fichier                   |
| ------------------- | ------------------------- |
| index.html          | `/og/home.png`            |
| stats-guide.html    | `/og/stats-guide.png`     |
| lineup-library.html | `/og/lineup-library.png`  |
| pro-demos.html      | `/og/pro-demos.png`       |
| pro-benchmarks.html | `/og/pro-benchmarks.png`  |
| prep-veto.html      | `/og/prep-veto.png`       |
| anti-strat.html     | `/og/anti-strat.png`      |

## Régénérer

Les images sont générées par `scripts/og.mjs` (satori → SVG → PNG via resvg).

```bash
npm run og              # télécharge les fonts + génère les 7 images
npm run og:build        # rebuild sans re-télécharger les fonts
node scripts/og.mjs home   # une seule image
```

Pour éditer les titres, sous-titres, tags ou stats bas, modifier l'objet
`PAGES` dans `scripts/og.mjs` puis relancer.

## Spec visuelle commune

- 1200 × 630 px
- Fond : `#080909` avec léger grain + gradient radial accent en haut-gauche
- Logo "Frag**Value**" (Anton 72px, accent `#b8ff57` sur "Value") en haut-gauche
- Titre Anton 96px centré, tutoyant le visiteur quand c'est possible
- Sous-titre Space Mono 20px en dessous, 2 lignes max
- Tag coloré en haut-droit selon le tier :
  - Pro → pill vert `#b8ff57` / fond `rgba(184,255,87,.15)`
  - Elite → pill or `#f5c842` / fond `rgba(245,200,66,.15)`
- Fine bande accent en bas (2px) avec 3 stats chiffrées en Mono 16px

## Contenu par page

### home.png
- Titre : "LE PREMIER COACH IA POUR CS2"
- Sous-titre : "Analyse tes 20 derniers matchs FACEIT. Diagnostic chiffré."
- Tag : Nouveau
- Stats bas : "1 diagnostic IA" · "2D Replay" · "134 métriques"

### stats-guide.png
- Titre : "GUIDE DES STATS CS2"
- Sous-titre : "16 métriques expliquées avec seuils pro et méthode de calcul."
- Stats bas : "16 KPIs" · "FV Rating" · "Thresholds FACEIT"

### lineup-library.png
- Titre : "LES SMOKES DES PROS"
- Sous-titre : "1 842 lineups filtrables par map, site et type."
- Tag : Bientôt
- Stats bas : "7 maps" · "524 matchs" · "98% success"

### pro-demos.png
- Titre : "LES MATCHS PROS EN 2D"
- Sous-titre : "Major, Blast, ESL Pro League en 2D replay."
- Tag : Pro
- Stats bas : "524 matchs HLTV" · "32 équipes" · "14 tournois"

### pro-benchmarks.png
- Titre : "TON JEU VS LE TOP 20 HLTV"
- Sous-titre : "Écart chiffré sur 18 métriques. Map par map, par rôle."
- Tag : Elite
- Stats bas : "20 pros" · "18 métriques" · "90 jours"

### prep-veto.png
- Titre : "GAGNE LE VETO AVANT LA PARTIE"
- Sous-titre : "Séquence optimale de bans calculée sur la data."
- Tag : Elite
- Stats bas : "7 maps" · "CT vs T" · "BO3 supporté"

### anti-strat.png
- Titre : "DÉMONTE LEURS SETUPS"
- Sous-titre : "Patterns adverses détectés sur 20 matchs. Counters inclus."
- Tag : Elite
- Stats bas : "8 patterns" · "7 maps" · "30 jours"

## Génération

3 options :

1. **Figma → Export PNG** : template unique, duplicate × 7, change le titre.
2. **Script Node + satori (OG image as JSX)** : meilleure pour l'auto-update.
3. **Canva** : rapide mais manuel.

Une fois les PNGs créés, les déposer dans `/og/` et les HTMLs les chargeront
automatiquement (pas de modif HTML à faire).
