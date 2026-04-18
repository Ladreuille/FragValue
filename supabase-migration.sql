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

-- Waitlist progress : vue pour exposer le compteur d'users sans dump
CREATE OR REPLACE VIEW scout_waitlist_progress AS
SELECT
  (SELECT COUNT(*) FROM auth.users) AS total_users,
  (SELECT COUNT(*) FROM profiles WHERE scout_opt_in = true) AS opted_in_users,
  1000 AS threshold,
  (SELECT COUNT(*) FROM auth.users) >= 1000 AS unlocked;

GRANT SELECT ON scout_waitlist_progress TO anon, authenticated;

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
