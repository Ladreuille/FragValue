-- subscription_events : audit log legal DGCCRF.
--
-- Loi Beroud-Lemoyne (L215-1-1 Code conso) : preuve que l'utilisateur a pu
-- resilier en 3 clics, sans redirection. La DGCCRF peut demander cette preuve
-- en cas de plainte consommateur. Sanction max : 15 000 EUR par contrat.
--
-- Retention recommandee : 5 ans (delai de prescription civile).
-- Server-only (deny-all clients) : ces logs ne doivent pas etre lus ni
-- modifies depuis le frontend.
--
-- Cette table etait referencee dans api/stripe-cancel-subscription.js mais
-- n'avait jamais ete creee. Les inserts echouaient silencieusement, donc
-- aucune preuve d'audit n'etait conservee. Risque legal en cas de controle
-- DGCCRF. Maintenant les events 'cancel_requested', 'refund_requested' etc.
-- seront persistes.

CREATE TABLE IF NOT EXISTS public.subscription_events (
  id                     BIGSERIAL PRIMARY KEY,
  user_id                UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type             TEXT NOT NULL,
  plan                   TEXT,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  ip                     TEXT,
  user_agent             TEXT,
  metadata               JSONB,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_user
  ON public.subscription_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_type
  ON public.subscription_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscription_events_stripe_customer
  ON public.subscription_events (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscription_events_deny_clients" ON public.subscription_events;
CREATE POLICY "subscription_events_deny_clients" ON public.subscription_events
  FOR ALL USING (false);

COMMENT ON TABLE public.subscription_events IS
  'Audit log legal DGCCRF (L215-1-1) : preuve resiliation conforme. Retention 5 ans. Server-only.';
