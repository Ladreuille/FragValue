-- migrations/2026-05-05-stripe-webhook-events.sql
--
-- Table d'idempotency pour les webhooks Stripe.
-- Stripe peut retry le meme event en cas de timeout reseau cote consumer.
-- Sans dedup explicite, certaines actions (envoi email, ajout credits, etc.)
-- pourraient etre executees 2 fois. Les UPSERT par user_id sont naturellement
-- idempotents, mais les side-effects ne le sont pas tous.
--
-- Cette table sert de garde au debut du handler webhook : INSERT en premier,
-- on continue uniquement si l'insert reussit (donc on est le premier a voir
-- cet event_id). Si duplicate key (23505), on skip et renvoie 200 a Stripe.
--
-- Retention : on peut garder 90 jours pour debug, puis purger via un cron
-- separe si la table grossit. Stripe ne retry pas au-dela de 3 jours, donc
-- 7 jours suffirait techniquement.

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  api_version  TEXT,
  livemode     BOOLEAN,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received
  ON public.stripe_webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type
  ON public.stripe_webhook_events (event_type, received_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny all client reads" ON public.stripe_webhook_events;
CREATE POLICY "deny all client reads" ON public.stripe_webhook_events FOR ALL USING (false);

COMMENT ON TABLE public.stripe_webhook_events IS
  'Idempotency log des webhooks Stripe. INSERT en premier dans le handler, skip si duplicate.';
