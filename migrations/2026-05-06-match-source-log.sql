-- match_source_log : analytics interne pour distinguer la source d'analyse
-- (manual upload, faceit_url, faceit_webhook_auto, etc.). Sert au debug et
-- au tracking funnel. Pas de PII sensible. Server-only.
--
-- Cette table etait referencee dans le code (api/parse-from-faceit-url.js +
-- api/cron/faceit-process-events.js) mais n'avait jamais ete creee. Les
-- inserts echouaient silencieusement (try/catch swallow).

CREATE TABLE IF NOT EXISTS public.match_source_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  match_id    TEXT,
  source      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_source_log_user
  ON public.match_source_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_source_log_source
  ON public.match_source_log (source, created_at DESC);

ALTER TABLE public.match_source_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "match_source_log_deny_clients" ON public.match_source_log;
CREATE POLICY "match_source_log_deny_clients" ON public.match_source_log
  FOR ALL USING (false);

COMMENT ON TABLE public.match_source_log IS
  'Analytics interne : source d''analyse de chaque match. Server-only.';
