-- email_broadcast_log avait RLS active mais sans policy explicite (deny-all
-- par defaut Postgres, mais explicit > implicit pour audit). On aligne sur
-- le pattern des autres tables *_log server-only.

DROP POLICY IF EXISTS "email_broadcast_log_deny_clients" ON public.email_broadcast_log;
CREATE POLICY "email_broadcast_log_deny_clients" ON public.email_broadcast_log
  FOR ALL USING (false);

COMMENT ON TABLE public.email_broadcast_log IS
  'Log des broadcasts email transactionnels. Ecriture/lecture via service_role uniquement.';
