# Marketing assets FragValue

Index des contenus marketing et des calendriers Twitter / X.

---

## Deux formats de contenu Twitter

### 1. Calendrier baseline (1 tweet/jour, format court)

`/scripts/twitter-content-calendar-7j.md` : 7 tweets pré-rédigés courts pour
maintenir un rythme post-launch sans avoir à réfléchir chaque jour. Format
simple : 1 thème par jour (insight stat, behind-the-scenes, case study,
comparatif, community, technical, milestone). À programmer en batch via
Twitter natif ou Buffer.

Quand l'utiliser : phase post-launch où il faut maintenir une présence sans
nouvelles annonces majeures. Rythme "drip" pour growth organique.

### 2. Annonces riches (one-shot, multiple variantes)

`marketing/twitter-YYYY-MM-DD-*.md` : posts événementiels avec annonce
majeure. Chaque fichier contient :
- Variante PRINCIPALE recommandée
- Variante COURTE pour impact rapide
- Variante centric (focus angle particulier)
- Thread version (4-5 tweets long-form)
- Recommandations format (heure, hashtags, mentions, image)
- Asset suggestions (screenshot, video, image fixe)
- Metrics post-publication a tracker
- Re-pack pour autres reseaux (LinkedIn, TikTok, Discord, email)

Quand l'utiliser : sortie d'une feature majeure, milestone produit, gain
mesurable a communiquer (LCP, conversions, etc.).

---

## Contenus existants

### Annonces deja redigees (marketing/)

| Date | Slug | Theme | Status |
|---|---|---|---|
| 2026-05-02 | cache-chatbot | Cache map + Coach IA Conversational launch | Publie |
| 2026-05-08 | refund-14j | Garantie commerciale 14 jours self-service | A publier vendredi |
| 2026-05-12 | blog-en-launch | 6 articles blog traduits en anglais | A publier lundi |
| 2026-05-15 | perf-lcp | Gains Core Web Vitals (chart.js + Supabase defer) | A publier jeudi |

### Calendriers (scripts/)

| Fichier | Usage |
|---|---|
| `scripts/twitter-content-calendar-7j.md` | 7 tweets baseline post-launch |
| `scripts/discord-seed-content.md` | 10 posts seed Discord par channel |

### Assets visuels (marketing/twitter-assets/)

| Fichier | Format | Usage |
|---|---|---|
| `twitter-cache-coach-1600x900.png` | 16:9 | Twitter timeline preview |
| `twitter-square-1080x1080.png` | 1:1 | Instagram, LinkedIn carousel |
| `twitter-vertical-1080x1920.png` | 9:16 | TikTok, IG Reels, Stories |

---

## Strategie cumulative (mai-juin 2026)

Phase 1 : trust-building et expansion (mai)
- 2026-05-08 : refund 14j (trust signal pour preparer audience plus large)
- 2026-05-12 : blog EN launch (capture audience internationale)
- 2026-05-15 : perf gains (credibilite tech, attire devs/early adopters)

Phase 2 : amplification (juin, en attendant la cle FACEIT downloads_api)
- Continuer le rythme du calendrier 7j entre les annonces
- Preparer une serie "build in public" sur le solo dev
- Drafter les posts qui annoncent la beta FACEIT API quand la cle arrive

Phase 3 : campagne FACEIT integration (T+0 cle dispo)
- Sortie majeure : annonce auto-import demos via webhook FACEIT
- Threads techniques (cf. format "annonce riche")
- Re-pack LinkedIn, TikTok, Discord
- Cible : amplification organique max via la news produit

---

## Conventions style (rappel)

- Pas d'em-dash ni en-dash (--)
- Accents francais corrects en chat et contenu user-facing
- Pas d'emoji UI dans le produit (mais OK ponctuellement dans les tweets si
  ca passe le test "ca ressemble pas trop a de l'IA")
- URL fragvalue.com en clair, pas de short link (X penalise)
- Aucun hashtag (X penalise depuis 2024)
- Mentions ciblees : @PlayFACEIT, @CounterStrike pour amplification
  potentielle, jamais en spam

## Outils

- Twitter natif : icone calendrier dans la box de tweet pour scheduling
- Buffer / Hootsuite / TweetDeck : si besoin batcher 10+ posts
- Twitter Analytics : suivi imp / profile visits / replies par tweet
- GA4 : conversions via UTM `?utm_source=x&utm_campaign=<slug>`
