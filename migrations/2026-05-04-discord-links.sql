-- migrations/2026-05-04-discord-links.sql
-- Cree la table discord_links qui rattache un user FragValue a son compte
-- Discord (apres flow OAuth dans /api/discord-link-callback.js).
--
-- Utilisation :
--   - api/discord-link-callback.js : INSERT/UPSERT apres OAuth user
--   - api/stripe-webhook.js : SELECT pour sync auto les roles Pro/Elite
--   - account.html (front) : SELECT pour afficher status + DELETE pour unlink
--
-- A executer dans Supabase SQL Editor (https://supabase.com/dashboard) :
--   1. New query
--   2. Coller ce fichier
--   3. Run
--
-- Idempotent : safe a relancer si deja applique.

-- ============================================================================
-- 1. TABLE discord_links
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.discord_links (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL UNIQUE,
  discord_username TEXT,
  discord_avatar_url TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Commentaires de table (visibles dans Supabase Dashboard pour la doc)
COMMENT ON TABLE public.discord_links IS 'Liaison entre un user FragValue (auth.users.id) et son compte Discord. Utilise pour assignment auto des roles Pro/Elite.';
COMMENT ON COLUMN public.discord_links.user_id IS 'FK vers auth.users.id. Cascade delete si user supprime son compte.';
COMMENT ON COLUMN public.discord_links.discord_id IS 'Snowflake Discord (string car >2^53). UNIQUE pour empecher 2 users FragValue de lier le meme Discord.';
COMMENT ON COLUMN public.discord_links.discord_username IS 'Username Discord (global_name si dispo, sinon username legacy). Cache pour affichage UI.';
COMMENT ON COLUMN public.discord_links.discord_avatar_url IS 'URL avatar Discord (CDN). Refresh manuel si user change avatar.';

-- ============================================================================
-- 2. INDEXES (pour les queries SELECT frequentes)
-- ============================================================================
-- Lookup par discord_id (utilise dans webhook Discord events futurs)
CREATE INDEX IF NOT EXISTS idx_discord_links_discord_id ON public.discord_links(discord_id);
-- Lookup par linked_at pour analytics (cohorte de users qui ont link)
CREATE INDEX IF NOT EXISTS idx_discord_links_linked_at ON public.discord_links(linked_at DESC);

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- Activation : par defaut tout est BLOQUE pour les clients (anon/authenticated).
-- Le service_role (utilise par les API serverless) bypass RLS.
ALTER TABLE public.discord_links ENABLE ROW LEVEL SECURITY;

-- Policy 1 : un user peut lire SA propre ligne (utilise par account.html
-- pour afficher le status linked).
DROP POLICY IF EXISTS "discord_links_select_own" ON public.discord_links;
CREATE POLICY "discord_links_select_own"
  ON public.discord_links
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Policy 2 : un user peut DELETE sa propre ligne (utilise par account.html
-- pour unlink). L'INSERT/UPDATE est fait via service_role uniquement (cote
-- API discord-link-callback.js apres validation OAuth).
DROP POLICY IF EXISTS "discord_links_delete_own" ON public.discord_links;
CREATE POLICY "discord_links_delete_own"
  ON public.discord_links
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ============================================================================
-- 4. TRIGGER updated_at auto
-- ============================================================================
-- Maintient updated_at sync sur chaque UPDATE.
CREATE OR REPLACE FUNCTION public.discord_links_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_discord_links_updated_at ON public.discord_links;
CREATE TRIGGER trg_discord_links_updated_at
  BEFORE UPDATE ON public.discord_links
  FOR EACH ROW
  EXECUTE FUNCTION public.discord_links_set_updated_at();

-- ============================================================================
-- 5. VERIFICATION
-- ============================================================================
-- Apres execution, lance :
--   SELECT * FROM public.discord_links LIMIT 5;
-- Doit retourner 0 rows et la table doit etre visible dans Supabase Dashboard
-- > Table Editor > public.discord_links.
