# B2B Coaching Platform — MVP Spec

**Status** : Draft v1, 2026-06-08
**Owner** : Quentin
**Target launch** : 6 semaines (mi-juillet 2026)

## TL;DR

Lever le produit FragValue (analyse de demos + coach IA) en mode multi-coach pour vendre a des structures CS2 (academies, equipes semi-pro, hubs FACEIT). Le coach humain branche FragValue sur ses N eleves, voit leurs FV Rating + heatmaps + diagnostics IA dans un dashboard unifie, peut commenter / assigner des objectifs / suivre la progression hebdo.

Cible : 5-15 clients structures dans les 6 premiers mois, ARR ~30-90k EUR.

## Pourquoi maintenant

**Pull signals 2026** :

- L'autre Claude qui a teste MCP v0.1 a explicitement formule la demande "coaching staff Vitality" — confirme qu'un agent IA aligne avec un coach humain est le format attendu
- Le marche academie CS2 est en boom (PariMatch academy, Karmine Academy, hub FACEIT amateur) sans outil analytics natif
- Tu as deja l'infra de parsing + heatmap + coach IA + MCP server — le 80% du produit est build
- Saturation B2C de FragValue (~187 demos, ~17 users) suggere que le ROI marginal d'un nouveau user B2C decroit ; un client B2B vaut 50-100 users B2C

**Window risk** : 6-12 mois avant qu'un concurrent (Leetify, Esportal coach) ne se positionne sur ce segment

## Personas

### P1 — Head Coach Academie (decision-maker)

- 25-40 ans, ex-semi-pro CS:GO
- Coach 8-20 eleves entre 18-22 ans, 4-6 sessions/sem
- Budget : 200-500 EUR/mois en outils (Discord Nitro, Aimlab, Hltv premium)
- Pain : passe 5h+/sem a regarder des demos manuellement, copy-paste les stats sur Notion, oublie de tracker la progression

### P2 — Player Manager / Owner Esport Org (signature)

- 30-50 ans, business background
- Gere un roster CS2 et veut justifier l'investissement coach par des KPIs
- Pain : pas de visibilite ROI sur le coaching, signe les factures FragValue parce que le coach demande

### P3 — Joueur Eleve (utilisateur final)

- 16-22 ans, FACEIT 8-10, ambition de passer pro
- Pain : pas de feedback structure entre les sessions live coach
- N'est PAS decision-maker mais doit etre actif (uploader/lier ses matchs) sinon le produit echoue

## Scope MVP (6 semaines)

### Must-have (v1.0)

| Feature | Effort | Reuse |
|---------|--------|-------|
| **Multi-user roster** : coach voit ses N eleves dans un dashboard unique | 5j | Tables rosters + roster_players existent deja |
| **FV Rating timeline par eleve** : graphe 7j/30j/90j | 2j | API /player-history + chart |
| **Heatmap consolidee** : top 3 maps de l'equipe avec aggregate | 3j | Heatmap generator existant |
| **Coach IA scoped au roster** : "Identifie les 3 plus gros points faibles de mon roster cette semaine" | 4j | coach-conversational.js existant + new system prompt |
| **Assignments objectifs** : coach assigne "Travaille spray AK sur Mirage" a un eleve, deadline | 3j | New : table assignments |
| **Notifications Discord** au coach quand un eleve upload une nouvelle demo | 1j | discord-interactions existant |
| **Roster invitation flow** : coach invite par email/Discord, eleve accept | 2j | roster_invitations existant |
| **Billing B2B** : Stripe subscription "par seat" (5 EUR/eleve/mois min 5 seats) | 3j | Stripe deja branche |

**Total** : ~23j de dev = 5 semaines actives + 1 sem buffer/QA = 6 sem

### Nice-to-have (v1.1, post-launch)

- Comparatif eleve vs pro (utiliser pro_demos data deja en place)
- Replay annotations partage coach-eleve (fv_annotations existe deja)
- Export PDF rapport hebdo (le coach l'envoie au Player Manager)
- Match pracc tracking (coach et adversaires)

### Out-of-scope (v2+)

- VOD review collaboratif live
- Tournament bracket integration
- Pay-per-match (one-off coaching client)

## Architecture technique

### Reuse existant (80% du produit deja build)

```
[Existant a reutiliser]
  - profiles, demos, matches, heatmaps : data layer
  - /api/parse-from-storage-stream : parser pipeline
  - /api/coach-conversational : Coach IA
  - rosters / roster_players / roster_invitations : multi-user
  - Stripe billing, RGPD, Discord notifications

[Nouveau a build]
  - /coach-dashboard.html (B2B-specific UI)
  - /api/assignments.js (CRUD goals)
  - Table : assignments (roster_id, player_id, goal_text, deadline, status)
  - Table : coach_seats (roster_id, monthly_quota, current_count)
  - Stripe Product : "B2B Coaching Platform" 5 EUR/seat/mois
  - Coach IA system prompt scoped roster (multi-player synthese)
```

### Nouvelles tables (3)

```sql
CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid REFERENCES rosters(id) ON DELETE CASCADE,
  assigned_to_user_id uuid REFERENCES auth.users(id),
  assigned_by_user_id uuid REFERENCES auth.users(id),
  title text NOT NULL,
  description text,
  category text CHECK (category IN ('aim', 'utility', 'positioning', 'communication', 'mental', 'other')),
  deadline timestamptz,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'expired')),
  evidence_demo_ids uuid[] DEFAULT '{}',
  created_at timestamptz DEFAULT NOW(),
  completed_at timestamptz
);

CREATE TABLE roster_b2b_subscriptions (
  roster_id uuid PRIMARY KEY REFERENCES rosters(id),
  stripe_subscription_id text UNIQUE,
  seat_count int NOT NULL DEFAULT 5,
  monthly_price_cents int NOT NULL DEFAULT 2500, -- 25 EUR base = 5 seats * 5 EUR
  status text DEFAULT 'active' CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE coach_weekly_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid REFERENCES rosters(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  ai_summary text, -- genere par coach-conversational scoped roster
  generated_at timestamptz DEFAULT NOW(),
  UNIQUE (roster_id, week_start)
);
```

### Coach IA prompt scoped roster

Variante de `coach-conversational.js` avec contexte multi-player. System prompt enrichi :

```
Tu coaches un roster CS2 de N joueurs. Voici leurs stats semaine derniere :

[NICKNAME 1] FACEIT lvl 9
  - 8 demos, FV Rating 1.12 (tendance +0.08)
  - 65% sur Inferno, 0.94 sur Anubis
  - 3 entries perdues sur 8 sur Cache

[NICKNAME 2] FACEIT lvl 10
  - 12 demos, FV Rating 1.34 (tendance -0.05)
  - 45% sur Nuke (faible vol mais bas rating)

Q du coach : "Identifie les 3 plus gros points faibles du roster cette semaine."

A : <synthese cross-player avec priorisation actionable>
```

Reutilise tout le pipeline coach-conversational existant + system prompt different + data layer multi-player.

## Pricing

| Tier | Prix | Pour qui | Inclus |
|------|------|----------|--------|
| **Solo** (existant) | 12,99 EUR/mois | Joueur individuel | 1 seat, illimite demos perso |
| **Roster Starter** | 25 EUR/mois | Coach amateur, 5 eleves | 5 seats, 1 coach, basic dashboard |
| **Roster Pro** | 75 EUR/mois | Academy / semi-pro | 10 seats, 2 coaches, Coach IA roster, assignments, Discord |
| **Roster Elite** | 200 EUR/mois | Esport org structure | Illimite seats, 5 coaches, weekly reports, priority parsing |
| **Enterprise** | custom | Karmine, Vitality, Heroic | Multi-roster, SSO, support dedie, integration custom |

**Hypothese revenu 6 mois** : 8 clients moyens (2 Starter + 4 Pro + 2 Elite) = 50 + 300 + 400 = 750 EUR MRR = ~9000 EUR ARR. Cible realiste vu ton reseau actuel.

**Hypothese revenu 12 mois** : 15-20 clients, 80% Pro/Elite, ~2000 EUR MRR = 24000 EUR ARR.

## Go-to-market

### Phase 1 (semaines 7-8) : Soft launch beta

- Outreach perso : 10 coaches que tu connais deja sur Discord/Twitter
- Onboarding free 1 mois en echange de feedback structure
- Objectif : 3-5 design partners actifs

### Phase 2 (semaines 9-12) : Public launch

- Landing page `/b2b` avec hero "Coach un roster CS2 comme un staff pro"
- Demo video 2 min (reutilise Remotion stack que tu as deja)
- Outreach LinkedIn 50 Player Managers academy / hub owners
- Sponsoring 1-2 tournois amateurs / hub FACEIT (300-500 EUR)
- Goal : 5 clients payants

### Phase 3 (mois 4-6) : Scale

- Partenariat avec 1-2 organisations enterprise (Karmine Academy, Wave Esports, etc.)
- Programme affiliate coach-to-coach (15% recurring)
- Article blog technique "Comment on a build FragValue B2B coaching platform" (recruite des coaches + dev community)

## Risques + mitigation

| Risque | Probabilite | Mitigation |
|--------|-------------|------------|
| Les coaches achetent pas, c'est un nice-to-have | Mid | Beta gratuite + onboarding tres scriptee. Si <3 conversions sur 10 design partners, pivot vers Solo Pro (FragValue B2C focus) |
| Concurrents (Leetify Coach mode) | Mid | Build vite (6 sem), avantage : Coach IA + heatmaps superieurs. Defensive moat : MCP server (ecosysteme agent) |
| Charge serveur (parser pour 50+ eleves simultanes) | Low | Le parser Railway scale horizontal (autoscale config sur Railway). Cap : ~30 parsings concurrents avant degradation. Si depasse, queue avec Discord notif. |
| RGPD multi-user : data eleve visible par le coach | Mid | RLS Supabase via roster_id : eleve consent explicite a l'invitation. Doc dedie /rgpd-coaching.html. |
| FACEIT change l'API (deja arrive) | High | On a deja la double infra : webhook (real-time) + polling (fallback). Resilient. |

## KPIs de succes

**A 6 semaines (launch)** :
- 3 design partners actifs (utilisent le dashboard >2 fois/sem)
- 1 conversion paye

**A 3 mois** :
- 8 clients payants
- MRR 500 EUR
- Churn <10%/mois

**A 6 mois** :
- 15-20 clients payants
- MRR 1500-2500 EUR
- NPS coach >40
- Au moins 1 cas testimonial filme

## Decision points

Avant de demarrer le dev (semaine 7) :

1. **Validation problemquence** : interview 5 coaches academie avant de coder. Si moins de 4/5 disent "je paierais 50-100 EUR/mois pour ca", on pivote.
2. **Build vs reuse decisions** : confirmer que le multi-roster est faisable sur ta infra actuelle (probable oui via roster_id partout)
3. **Coach IA scoping** : decider si on cap les Q/min du coach (rate limit budget Claude API)

## Roadmap post-MVP

- **v1.1** (mois 3) : VOD pracc tracker, integration Demos.gg / Bo3.gg pour matchs praccs non-FACEIT
- **v1.2** (mois 4) : Replay annotations collaboratives coach + eleve (fv_annotations.is_collaborative)
- **v1.3** (mois 5) : Pre-match brief generator IA ("on joue contre X academy demain, voici leurs patterns")
- **v2.0** (mois 6-9) : Multi-org enterprise tier (Karmine, Vitality), SSO, custom branding white-label

## Prochaines actions concretes

1. **Cette semaine** : interview 5 coaches (DM Twitter + Discord, 30 min/each). Liste cible :
   - [a remplir avec les noms du reseau Quentin]
2. **Semaine prochaine** : valider scope MVP via Notion vote design partners, ajuster
3. **Semaine 3** : kickoff dev avec ce spec doc comme reference unique
4. **Semaine 7** : soft launch beta 5 partners
5. **Semaine 9** : public launch + landing /b2b

---

**Inspiration / refs** :
- Sportlyzer (B2B coaching SaaS football)
- HudL (NFL/college sports analytics multi-team)
- TacticView (CS:GO coaching tool 2018, disparu — opportunity)
- Strafe Esports (analytics esport pro)
