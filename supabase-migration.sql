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
