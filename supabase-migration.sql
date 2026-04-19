-- FragValue Supabase Migration
-- Execute dans le SQL Editor de Supabase Dashboard (https://supabase.com/dashboard)
-- Ordre strict : executer chaque bloc un par un

-- 1. Contrainte UNIQUE sur subscriptions
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
-- Si elle existe deja, ignore l'erreur et continue

-- 2. Table shared_demos
CREATE TABLE IF NOT EXISTS shared_demos (
  id TEXT PRIMARY KEY,
  demo_id UUID,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE shared_demos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON shared_demos FOR SELECT USING (true);
CREATE POLICY "Owner insert" ON shared_demos FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 3. Colonnes FACEIT sur profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faceit_nickname TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faceit_avatar TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faceit_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faceit_elo INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS faceit_level INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- 4. Contrainte UNIQUE sur profiles
ALTER TABLE profiles ADD CONSTRAINT profiles_pkey_check UNIQUE (id);
-- Si elle existe deja, ignore l'erreur et continue

-- 5. Abonnement Team pour le compte admin
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'qdreuillet@gmail.com';
  IF v_user_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM subscriptions WHERE user_id = v_user_id) THEN
      UPDATE subscriptions SET plan = 'team', status = 'active', updated_at = now() WHERE user_id = v_user_id;
    ELSE
      INSERT INTO subscriptions (user_id, plan, status, updated_at) VALUES (v_user_id, 'team', 'active', now());
    END IF;
  END IF;
END $$;

-- 6. Verification
SELECT s.plan, s.status, u.email
FROM subscriptions s
JOIN auth.users u ON u.id = s.user_id
WHERE u.email = 'qdreuillet@gmail.com';
-- Doit retourner : team | active | qdreuillet@gmail.com


-- ═══════════════════════════════════════════════════════════════════════════
-- SCOUT FEATURE (leaderboards + recrutement)
-- Execute apres avoir verifie que les tables precedentes existent.
-- ═══════════════════════════════════════════════════════════════════════════

-- Extensions profiles pour Scout + recrutement
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scout_opt_in BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scout_role_primary TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scout_role_secondary TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scout_bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scout_open_to_offers BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS scout_region TEXT;
-- Donnees biographiques pour classifications auto (Rookie = <22 ans, etc.)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birth_year INT;       -- annee de naissance
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS years_playing_cs INT; -- experience CS (annees)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country_code TEXT;    -- ISO 3166-1 alpha-2
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_prefs JSONB;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'fr';

-- Rankings table : snapshot du leaderboard a un instant T
CREATE TABLE IF NOT EXISTS player_rankings (
  player_id        TEXT NOT NULL,
  nickname         TEXT NOT NULL,
  ranking_type     TEXT NOT NULL, -- 'global', 'entry', 'awp', 'clutch', 'support', 'igl', 'rising', 'consistent', 'rookie', 'freeagent'
  rank             INT NOT NULL,
  score            NUMERIC NOT NULL,
  metadata         JSONB,         -- detail des stats utilisees pour calcul
  computed_at      TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (player_id, ranking_type)
);
CREATE INDEX IF NOT EXISTS idx_player_rankings_type_rank ON player_rankings (ranking_type, rank);
CREATE INDEX IF NOT EXISTS idx_player_rankings_nickname ON player_rankings (lower(nickname));
ALTER TABLE player_rankings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rankings public read" ON player_rankings FOR SELECT USING (true);

-- Ranking history pour detecter les "rising stars" (evolution du score)
CREATE TABLE IF NOT EXISTS ranking_history (
  player_id       TEXT NOT NULL,
  ranking_type    TEXT NOT NULL,
  rank            INT,
  score           NUMERIC,
  snapshot_date   DATE NOT NULL,
  PRIMARY KEY (player_id, ranking_type, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_ranking_history_date ON ranking_history (snapshot_date DESC);

-- Waitlist progress : RPC SECURITY DEFINER (remplace l'ancienne view qui
-- declenchait le lint Supabase auth_users_exposed). Le caller voit uniquement
-- les compteurs aggreges, jamais les rows auth.users.
CREATE OR REPLACE FUNCTION public.scout_waitlist_progress()
RETURNS TABLE (
  total_users bigint,
  opted_in_users bigint,
  threshold int,
  unlocked boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM auth.users) AS total_users,
    (SELECT COUNT(*) FROM public.profiles WHERE scout_opt_in = true) AS opted_in_users,
    1000 AS threshold,
    ((SELECT COUNT(*) FROM auth.users) >= 1000) AS unlocked;
$$;

REVOKE ALL ON FUNCTION public.scout_waitlist_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scout_waitlist_progress() TO anon, authenticated;

-- Pour launcher : quand unlocked devient true, le frontend bascule en mode live


-- ═══════════════════════════════════════════════════════════════════════════
-- ROSTER SYSTEM (equipes, invitations, parametres)
-- ═══════════════════════════════════════════════════════════════════════════

-- Extension table rosters : metadata de l'equipe
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'team'; -- 'private' (owner seul) | 'team' (membres) | 'public' (SEO)
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS looking_for_players BOOLEAN DEFAULT false;
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS looking_for_roles TEXT[]; -- ['entry','awp'] si recrutement cible
ALTER TABLE rosters ADD COLUMN IF NOT EXISTS tag TEXT; -- ex: 'FVT' (team tag style pro)

-- Extension roster_players : role team-specific + invitation metadata
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS team_role TEXT; -- role dans l'equipe (captain, igl, entry, etc)
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS is_captain BOOLEAN DEFAULT false;
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS is_sub BOOLEAN DEFAULT false; -- remplacant ou titulaire
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id);
ALTER TABLE roster_players ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id); -- link au compte FragValue si match

-- Table invitations : workflow invite -> accept/decline
CREATE TABLE IF NOT EXISTS roster_invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id       UUID REFERENCES rosters(id) ON DELETE CASCADE,
  inviter_id      UUID REFERENCES auth.users(id),
  invitee_user_id UUID REFERENCES auth.users(id),     -- si on connait le user FragValue
  invitee_nickname TEXT,                                -- FACEIT nickname (pour matching)
  invitee_email   TEXT,                                 -- alternative : email direct
  proposed_role   TEXT,                                 -- role suggere ('entry', 'awp', etc)
  message         TEXT,                                 -- message optionnel de l'inviteur
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  token           TEXT UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''), -- token URL-safe pour lien direct
  created_at      TIMESTAMPTZ DEFAULT now(),
  responded_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days')
);
CREATE INDEX IF NOT EXISTS idx_roster_invitations_invitee_user ON roster_invitations (invitee_user_id, status);
CREATE INDEX IF NOT EXISTS idx_roster_invitations_nickname ON roster_invitations (lower(invitee_nickname), status);
CREATE INDEX IF NOT EXISTS idx_roster_invitations_roster ON roster_invitations (roster_id, status);

ALTER TABLE roster_invitations ENABLE ROW LEVEL SECURITY;
-- L'inviteur voit ses invitations emises, l'invite voit ses invitations recues
CREATE POLICY "Inviter read own invitations" ON roster_invitations FOR SELECT
  USING (auth.uid() = inviter_id OR auth.uid() = invitee_user_id);
-- Lookup par token (pour flow accept via lien direct)
CREATE POLICY "Public token lookup" ON roster_invitations FOR SELECT USING (true);
-- Seul l'inviteur peut creer (le backend verifie)
CREATE POLICY "Inviter can insert" ON roster_invitations FOR INSERT WITH CHECK (auth.uid() = inviter_id);
-- L'invite peut update son status (accept/decline)
CREATE POLICY "Invitee can respond" ON roster_invitations FOR UPDATE
  USING (auth.uid() = invitee_user_id)
  WITH CHECK (auth.uid() = invitee_user_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- FEATURE WAITLIST (interets sur les teasers Bientôt/Pro/Elite)
-- 5 pages teasers : lineup-library, pro-demos, pro-benchmarks, prep-veto,
-- anti-strat. On stocke qui a exprime un interet, pour :
--   1. Afficher un compteur live par feature
--   2. Notifier au lancement
--   3. Prioriser les features selon la demande
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS feature_interests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_slug   TEXT NOT NULL,           -- 'lineup-library' | 'pro-demos' | etc.
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  anon_id        TEXT,                    -- hash(ip + user_agent) pour anon dedup
  source         TEXT DEFAULT 'teaser',   -- 'teaser' | 'homepage' | 'email'
  created_at     TIMESTAMPTZ DEFAULT now(),
  notified_at    TIMESTAMPTZ              -- timestamp d'envoi mail de lancement
);

-- Un user (ou anon_id) ne peut s'inscrire qu'une fois par feature
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_interests_user_unique
  ON feature_interests (feature_slug, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_interests_anon_unique
  ON feature_interests (feature_slug, anon_id)
  WHERE user_id IS NULL AND anon_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_feature_interests_feature ON feature_interests (feature_slug);

ALTER TABLE feature_interests ENABLE ROW LEVEL SECURITY;
-- L'utilisateur voit uniquement ses propres entrees (pour afficher "tu es deja inscrit")
CREATE POLICY "User reads own interests" ON feature_interests FOR SELECT
  USING (auth.uid() = user_id);
-- Insert via backend uniquement (on veut controler la dedup ip + headers)
-- Pas de policy INSERT grand public : API endpoint utilise la service_key

-- Aggregation publique via RPC SECURITY DEFINER (remplace l'ancienne view qui
-- declenchait le lint Supabase security_definer_view + contournait le RLS de
-- feature_interests). La fonction expose uniquement les compteurs agreges,
-- jamais les rows individuelles (user_id, anon_id restent prives).
CREATE OR REPLACE FUNCTION public.feature_interest_counts(slug text DEFAULT NULL)
RETURNS TABLE (
  feature_slug text,
  total bigint,
  users bigint,
  anons bigint
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT fi.feature_slug,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE fi.user_id IS NOT NULL) AS users,
    COUNT(*) FILTER (WHERE fi.user_id IS NULL) AS anons
  FROM public.feature_interests fi
  WHERE slug IS NULL OR fi.feature_slug = slug
  GROUP BY fi.feature_slug
  ORDER BY total DESC;
$$;

REVOKE ALL ON FUNCTION public.feature_interest_counts(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.feature_interest_counts(text) TO anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- PRO DEMOS VIEWER (Phase 1 : metadata + scorecards HLTV)
-- Applique via MCP Supabase. Schema seulement, le seed (matchs 2025-2026)
-- est gere separement via scripts/seed-pro-matches.sql ou MCP direct.
-- Phase 2 (a venir) : table pro_round_positions pour 2D replay tick-by-tick.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pro_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  short_name   TEXT,
  tier         TEXT DEFAULT 'S',
  prize_pool   INT,
  start_date   DATE,
  end_date     DATE,
  hltv_event_id INT UNIQUE,
  logo_url     TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pro_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID REFERENCES pro_events(id) ON DELETE CASCADE,
  stage           TEXT,
  format          TEXT DEFAULT 'BO3',
  team_a          TEXT NOT NULL,
  team_b          TEXT NOT NULL,
  team_a_logo     TEXT,
  team_b_logo     TEXT,
  team_a_score    INT DEFAULT 0,
  team_b_score    INT DEFAULT 0,
  winner          TEXT,
  best_player     TEXT,
  best_rating     NUMERIC(4,2),
  match_date      TIMESTAMPTZ NOT NULL,
  hltv_match_id   BIGINT UNIQUE,
  demo_available  BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pro_matches_date ON pro_matches (match_date DESC);
CREATE INDEX IF NOT EXISTS idx_pro_matches_event ON pro_matches (event_id);
CREATE INDEX IF NOT EXISTS idx_pro_matches_teams ON pro_matches (team_a, team_b);

CREATE TABLE IF NOT EXISTS pro_match_maps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID REFERENCES pro_matches(id) ON DELETE CASCADE,
  map_order       INT NOT NULL,
  map_name        TEXT NOT NULL,
  team_a_score    INT NOT NULL,
  team_b_score    INT NOT NULL,
  team_a_ct_rounds INT,
  team_a_t_rounds  INT,
  picked_by       TEXT,
  duration_min    INT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pro_match_maps_match ON pro_match_maps (match_id, map_order);

CREATE TABLE IF NOT EXISTS pro_match_players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_map_id    UUID REFERENCES pro_match_maps(id) ON DELETE CASCADE,
  nickname        TEXT NOT NULL,
  team            TEXT NOT NULL,
  country         TEXT,
  kills           INT DEFAULT 0,
  deaths          INT DEFAULT 0,
  assists         INT DEFAULT 0,
  adr             NUMERIC(5,1),
  kast_pct        NUMERIC(4,1),
  hltv_rating     NUMERIC(4,2),
  first_kills     INT DEFAULT 0,
  first_deaths    INT DEFAULT 0,
  clutches        INT DEFAULT 0,
  multi_kills     INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pro_match_players_map ON pro_match_players (match_map_id);
CREATE INDEX IF NOT EXISTS idx_pro_match_players_nickname ON pro_match_players (lower(nickname));

ALTER TABLE pro_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pro_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE pro_match_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE pro_match_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pro_events public read" ON pro_events;
CREATE POLICY "pro_events public read" ON pro_events FOR SELECT USING (true);
DROP POLICY IF EXISTS "pro_matches public read" ON pro_matches;
CREATE POLICY "pro_matches public read" ON pro_matches FOR SELECT USING (true);
DROP POLICY IF EXISTS "pro_match_maps public read" ON pro_match_maps;
CREATE POLICY "pro_match_maps public read" ON pro_match_maps FOR SELECT USING (true);
DROP POLICY IF EXISTS "pro_match_players public read" ON pro_match_players;
CREATE POLICY "pro_match_players public read" ON pro_match_players FOR SELECT USING (true);
