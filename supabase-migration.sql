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
