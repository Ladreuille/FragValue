# FragValue — Architecture produit

Source of truth pour la structure du site, les tiers d'abonnement et la roadmap. À consulter avant d'ajouter une page, un feature ou un gate d'abonnement.

Dernière mise à jour : 2026-04-18

---

## 1. Vue d'ensemble

FragValue est une plateforme d'analyse de démos CS2 pour joueurs FACEIT, équipes et coaches. Trois plans d'abonnement (Free / Pro / Elite) gradient la valeur du product : découverte → progression individuelle → outils tactiques d'équipe et références pros HLTV.

**Stack** :
- Frontend : HTML/CSS/JS vanilla, déployé sur Vercel (branche `main` auto-deploy)
- Backend auth/DB : Supabase (auth, postgres, edge functions)
- Parser démos : Node.js + @laihoe/demoparser2, hébergé sur Railway
- Paiements : Stripe (checkout + webhook subscription sync)
- DNS : fragvalue.com

**Repos** :
- `Ladreuille/FragValue` (frontend) — `/Users/quentin/Documents/Fragvalue/GitHub/GitHub/FragValue`
- Parser (non git-tracked localement) — `/Users/quentin/Documents/Fragvalue/GitHub/fragvalue-demo-parser`

---

## 2. Les 4 espaces du site

La navigation principale regroupe les pages en 4 sections logiques. Un dropdown par section dans la navbar.

### MON JEU
Espace perso du joueur : son histoire, ses matchs, son coaching.

| Page | URL | Description |
|---|---|---|
| Aperçu (Dashboard) | `/dashboard.html` | FV Rating trend, KPIs, chart, stats par map, meilleur match |
| Mes matchs | `/matches.html` | Historique paginé, filtres map/date |
| Analyse démo | `/demo.html` → `/analysis.html` → `/heatmap-results.html` | Flow upload + analyse |
| 2D Replay | `/replay.html` | Visualisation interactive de la démo |
| Match Report | `/match-report.html` **(à créer)** | Bilan round-by-round type coach |
| Scout | `/scout.html` **(teaser live, unlock 1000 users)** | Leaderboards multi-critères des meilleurs joueurs |
| Comparer | `/compare.html` | Comparaison 2-5 joueurs FACEIT |
| Coach IA | Intégré dans Analysis / Match Report | Narratif LLM |

#### Scout (feature stratégique en mode teaser)

Pre-launch (total users < 1000) : page teaser avec compteur live + preview blurred des 10 leaderboards + opt-in CTA.

Post-launch (unlocked = true) : 10 classements multi-critères :
- **Global talent** (FV Score composite)
- **Best Entry / AWP / Clutch / Support** (par rôle)
- **Best IGL** (prédit via consistency + KAST + K/R faible)
- **Rising Stars** (plus grosse hausse FV Rating sur 30j)
- **Most Consistent** (variance FV Rating la plus faible)
- **Rookie Gems** (<50 matchs avec FV >1.10)
- **Free Agents** (sans roster actif, opt-in aux offres)

Tier gating post-launch :
- Free : sa propre position + top 10 de chaque leaderboard
- Pro : leaderboards complets (top 100), export CSV
- Elite : filtres recruteurs avancés (rôle / région / niveau / free agent), metadata complete, pages profil privées

Endpoints :
- `GET /api/scout-rankings?type=global&limit=50` — leaderboard paginé
- `GET /api/scout-waitlist-status` — compteur + progress threshold

Tables Supabase :
- `player_rankings` (snapshot actuel par type)
- `ranking_history` (pour détecter rising stars)
- `profiles` enrichi avec `scout_opt_in`, `scout_role_primary/secondary`, `scout_region`, `scout_open_to_offers`, `scout_bio`

Opt-in géré depuis `account.html` → Paramètres → Profil Scout.

### PROGRESSER
Ressources pédagogiques pour monter en niveau.

| Page | URL | Description |
|---|---|---|
| Roadmap | `/levels.html` | Progression par niveaux |
| Stats guide | `/stats-guide.html` | Documentation des KPIs |
| Lineup library | `/lineup-library.html` **(à créer)** | Smokes/molos pros filtrables |
| Tutoriels KPI | `/tutorials.html` **(à créer, optionnel)** | "Comment améliorer ton entry rate" |

### PROS
Référence pros pour inspiration et benchmarks.

| Page | URL | Description |
|---|---|---|
| Pro demos | `/pro-demos.html` **(à créer)** | Listing matchs HLTV filtrables, ouverture dans 2D viewer |
| Pro benchmarks | `/pro-benchmarks.html` **(à créer)** | "Ton jeu vs top 20 HLTV" |
| Meta trends | `/meta-trends.html` **(à créer, optionnel)** | Map pick rates, util meta |

### ÉQUIPE (Elite only)
Outils tactiques pour équipes compétitives et coaches.

| Page | URL | Description |
|---|---|---|
| Team dashboard | `/team.html` **(à créer)** | Stats agrégées équipe, gestion membres |
| Prep veto | `/prep-veto.html` **(à créer)** | Ban/pick maps vs opponent |
| Anti-strat | `/anti-strat.html` **(à créer)** | Patterns opponent sur N derniers matchs |
| Rapport hebdo | Email + `/team-report.html` **(à créer)** | Rapport équipe auto |

### Pages hors-section (footer ou dropdown compte)

| Page | URL | Description |
|---|---|---|
| Tarifs | `/pricing.html` | Les 3 plans |
| Mon compte | `/account.html` | Settings, billing, team mgmt |
| Connexion | `/login.html` | Auth Supabase |
| Onboarding | `/onboarding.html` | Wizard post-signup |
| Partage public | `/share.html` | Liens publics d'analyses |
| FACEIT callback | `/faceit-callback.html` | OAuth handshake |
| Extension auth | `/extension-auth.html` | Auth pour l'extension Chrome |

---

## 3. Matrice features × tiers

**Règle de gate** : côté front, chaque feature gated appelle `getUserPlan()` depuis `common.js`. Côté backend, l'edge function `check-subscription` valide le tier depuis la DB. Jamais de gate uniquement front.

| Feature | Free | Pro 9€ | Elite 29€ |
|---|:-:|:-:|:-:|
| **CORE** | | | |
| Analyses démos | 3/mois | ∞ | ∞ |
| Scouts joueurs | 3/jour | ∞ | ∞ |
| Heatmaps kills/deaths | ✓ | ✓ | ✓ |
| Stats basiques (K/D, ADR, HS%) | ✓ | ✓ | ✓ |
| FV Rating | ✓ | ✓ | ✓ |
| Historique matchs | 5 | ∞ | ∞ |
| **ANALYSE AVANCÉE** | | | |
| 2D Replay interactif | ✗ | ✓ | ✓ |
| Heatmaps grenades | ✗ | ✓ | ✓ |
| KPIs avancés (entry, trade, flash, util dmg) | ✗ | ✓ | ✓ |
| Match Report round-by-round | ✗ | ✓ | ✓ |
| FV Score /100 breakdown | ✗ | ✓ | ✓ |
| Comparaison multi-joueurs | ✗ | 5 | ∞ |
| Export PDF | ✗ | ✓ | ✓ |
| Extension FACEIT sync | ✗ | ✓ | ✓ |
| Map control + pre-aim analysis | ✗ | ✓ | ✓ |
| **COACH IA** | | | |
| Diagnostic IA | 1/mois | ∞ | ∞ |
| Coach IA narratif LLM avancé | ✗ | ✗ | ✓ |
| **RÉFÉRENCE PROS** | | | |
| Pro demos viewer (HLTV) | ✗ | ✓ | ✓ |
| Lineup library lecture | ✓ | ✓ | ✓ |
| Lineup library filtrage avancé + favoris | ✗ | ✓ | ✓ + partage équipe |
| Pro benchmarks (vs top 20 HLTV) | ✗ | ✗ | ✓ |
| Pro strats DB (setups clustered) | ✗ | ✗ | ✓ |
| Anti-strat tool | ✗ | ✗ | ✓ |
| **ÉQUIPE** | | | |
| Team dashboard | ✗ | ✗ | ✓ (5 joueurs) |
| Prep veto | ✗ | ✗ | ✓ |
| Rapport équipe hebdo | ✗ | ✗ | ✓ |
| Coaching 1h/mois | ✗ | ✗ | ✓ |
| **OPS** | | | |
| API access | ✗ | ✗ | ✓ |
| Support | Community | <24h | <4h |

---

## 4. Parcours utilisateur par tier

### Free user (acquisition)
1. Arrive sur `index.html` via SEO ou partage
2. Clique "Analyser ma 1ère démo" → `login.html` (social login Supabase)
3. Flow : `onboarding.html` → `demo.html` (upload ou URL FACEIT)
4. Résultats : `heatmap-results.html` avec stats basiques + 1er teasers gated
5. Après 3ème démo du mois : paywall doux "Passe Pro pour continuer"
6. Accès libre à Pro demos listing + Lineup library (lecture) pour créer de l'habitude

### Pro user (rétention)
1. Landing → `dashboard.html` avec rating trend
2. Nouvelle démo → Match Report auto + Coach IA (1 diag par match inclus)
3. Feature discovery : Pro demos viewer (regarder Vitality/NAVI en 2D)
4. Clique un lineup → affiche la throw position exacte + video tuto (phase 2)
5. Upsell Elite : "Compare-toi aux top 20 HLTV → +29€/mois"

### Elite user (team captain / coach)
1. Landing → `team.html` dashboard équipe
2. Avant match : `anti-strat.html` + `prep-veto.html` sur l'opponent
3. Pendant match : chaque joueur utilise Pro features
4. Après match : rapport équipe auto
5. Référence : Pro strats DB pour adapter setups

---

## 5. Roadmap de build

### Q2 (2 mois) — Consolider Pro

- [ ] **KPIs Tier 1** dans `heatmap-results.html` : entry success rate, trade rate, flash assists, util damage, HS contextuel
- [ ] **Match Report page** (`match-report.html`) : bilan round-by-round avec pivots
- [ ] **Pro demos viewer MVP** (`pro-demos.html`) : 50 matchs curés manuellement (IEM Katowice 2026, BLAST Finals, PGL Cluj 2025)
- [ ] **Lineup library MVP** (`lineup-library.html`) : filtrage map/site, vue grid, copy-to-position feature
- [ ] **Pipeline HLTV MVP** : scraper manuel → parse → stocke dans Supabase `pro_matches`
- [ ] **Navbar 4 sections** : déployée sur toutes les pages
- [ ] **pricing.html** : matrice mise à jour (done via artefact ici)

### Q3 (2 mois) — Lancer Elite

- [ ] **Scraper HLTV automatique** (cron quotidien)
- [ ] **Clustering setups** (Python worker dédié pour K-means/DBSCAN)
- [ ] **Map control + pre-aim** dans Match Report
- [ ] **Team dashboard** (`team.html`) + gestion membres multi-utilisateurs
- [ ] **Prep veto** (`prep-veto.html`)
- [ ] **Ouverture du tier Elite** (retirer "BIENTÔT" sur pricing.html)

### Q4 (2 mois) — Scaler l'intelligence

- [ ] **Coach IA narratif LLM** : Claude API avec prompts structurés
- [ ] **Anti-strat tool** (`anti-strat.html`) : pattern detection sur 5-10 derniers matchs opponent
- [ ] **Rapports équipe hebdo** (cron + email)
- [ ] **API access** Elite (OpenAPI spec + rate limiting Supabase)
- [ ] **Affinement clustering** avec 500+ matchs pros en DB

---

## 6. Modèle DB (Supabase)

Tables existantes (à confirmer) :
- `auth.users` (Supabase auth)
- `profiles` (user settings)
- `subscriptions` (Stripe sync)
- `user_matches` (matchs analysés par users)
- `analysis_results` (JSON des démos parsées)

Tables à ajouter pour les nouvelles features :

```sql
-- PRO DEMOS DB
create table pro_matches (
  id uuid primary key default gen_random_uuid(),
  hltv_match_id text unique,
  team_a text, team_b text, score text,
  map text, tournament text, tier text,
  played_at timestamptz,
  demo_url text,
  parsed_data jsonb,
  created_at timestamptz default now()
);

create table pro_rounds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references pro_matches on delete cascade,
  round_num int,
  winner_side text check (winner_side in ('CT', 'T')),
  duration_ticks int,
  bomb_planted boolean,
  plant_x float, plant_y float,
  events jsonb
);

create table pro_utility (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references pro_matches on delete cascade,
  round_num int,
  thrower text,
  thrower_team text,
  type text check (type in ('smoke', 'flash', 'he', 'molotov', 'incgren', 'decoy')),
  throw_x float, throw_y float,
  deton_x float, deton_y float,
  tick int
);

create table pro_setups (
  id uuid primary key default gen_random_uuid(),
  map text, site text, side text,
  cluster_id text,
  player_positions jsonb,
  win_rate float,
  sample_size int,
  last_computed_at timestamptz
);

-- TEAM FEATURES
create table teams (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users,
  name text,
  created_at timestamptz default now()
);

create table team_members (
  team_id uuid references teams on delete cascade,
  user_id uuid references auth.users,
  role text check (role in ('owner', 'player', 'coach', 'analyst')),
  added_at timestamptz default now(),
  primary key (team_id, user_id)
);

-- USER FAVORITES
create table user_lineup_favorites (
  user_id uuid references auth.users,
  lineup_id text,
  created_at timestamptz default now(),
  primary key (user_id, lineup_id)
);
```

RLS policies : standard (les utilisateurs voient leurs propres données, Pro demos DB lisible par tous les authentifiés sauf `pro_setups.cluster_id` gated Elite).

---

## 7. Conventions UI

- **Nav principale** : 4 dropdowns (MON JEU / PROGRESSER / PROS / ÉQUIPE) + bouton compte à droite
- **Accent color** : `#b8ff57` (jaune-vert), toujours accent pour les CTA principaux
- **Typographie** : Anton (display) + Space Mono (body/UI)
- **Icônes** : aucune emoji dans les strings, toujours SVG inline ou `icons/*.svg`
- **Pas de tirets** dans les textes UI (règle design existante)
- **Gates visuelles** : feature gated → badge "PRO" (accent jaune) ou "ELITE" (dégradé gold) + tooltip upsell au survol
- **Langue par défaut** : FR, i18n repoussé à plus tard

---

## 8. Règles de plan gating

Côté JS :
```js
const plan = await getUserPlan(); // retourne 'free' | 'pro' | 'elite'
if (plan === 'free') {
  showPaywall('pro');
  return;
}
```

Côté edge function :
```js
// Toujours valider côté serveur avant de servir des données gatées
const { plan } = await getUserPlanServerSide(userId);
if (plan !== 'elite') {
  return new Response('Forbidden', { status: 403 });
}
```

**Jamais** de gate uniquement CSS (`display:none`) — l'utilisateur peut inspecter le DOM et bypass.

---

## 9. Fichiers à consulter

- `pricing.html` — source de vérité sur ce qui est vendu et à quel prix
- `docs/wireframes.md` — wireframes ASCII des nouvelles pages
- `common.js` — logique partagée (auth, plan gating, renderNav)
- `common.css` — styles partagés
- `supabase-migration.sql` — schema DB actuel
