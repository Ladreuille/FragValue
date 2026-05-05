-- migrations/2026-05-05-refund-requests.sql
--
-- Audit log des demandes de remboursement self-service.
--
-- Strategie business : la garantie 14j de FragValue est COMMERCIALE (pas
-- legale au sens strict, puisque le user a signe la renonciation L221-28-13
-- au moment de la souscription via le modal pricing.html). Mais on continue
-- a rembourser dans cette fenetre pour soutenir la promesse marketing
-- "satisfait ou rembourse 14j".
--
-- Conditions d'eligibilite :
-- - Le user a un stripe_customer_id
-- - Son dernier charge Stripe < 14 jours
-- - Pas deja de refund_request en status 'completed' pour ce charge
--
-- Effets du refund :
-- - stripe.refunds.create({ charge })  : refund total du dernier charge
-- - stripe.subscriptions.update : cancel immediat (l'utilisateur a recupere son
--   argent, donc il n'a plus droit au service)
-- - Le webhook customer.subscription.deleted synchro le profile en free
--
-- RLS : un user peut lire ses propres refund_requests, jamais modifier.

CREATE TABLE IF NOT EXISTS public.refund_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id   TEXT,
  stripe_charge_id     TEXT NOT NULL,
  stripe_refund_id     TEXT,
  stripe_subscription_id TEXT,
  amount_refunded_cents INTEGER NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'eur',
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | completed | failed
  error_message   TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  ip_hash         TEXT,
  user_agent      TEXT
);

CREATE INDEX IF NOT EXISTS idx_refund_requests_user
  ON public.refund_requests (user_id, requested_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_charge_completed
  ON public.refund_requests (stripe_charge_id)
  WHERE status = 'completed';

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user reads own refund requests" ON public.refund_requests;
CREATE POLICY "user reads own refund requests" ON public.refund_requests
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "service role writes" ON public.refund_requests;
CREATE POLICY "service role writes" ON public.refund_requests
  FOR ALL USING (false);

COMMENT ON TABLE public.refund_requests IS
  'Self-service refund 14j (garantie commerciale). Cf. /api/refund-request.';
