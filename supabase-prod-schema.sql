-- ─────────────────────────────────────────────────────────────────────────
-- FragValue — Supabase prod schema (canonical source of truth)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Genere automatiquement le 2026-05-18 depuis la prod Supabase
-- (project ref xmyruycvvkmcwysfygcq) via le MCP Supabase + queries
-- information_schema / pg_catalog.
--
-- POURQUOI CE FICHIER :
-- L'ancien `supabase-migration.sql` couvrait ~10 tables alors que la prod
-- en a 47 (drift accumule depuis mars 2026). Ce fichier est la source de
-- verite a jour. Pour recreer un environnement local Supabase :
--
--   psql -h db.xxxx.supabase.co -U postgres -d postgres < supabase-prod-schema.sql
--
-- ou via la CLI :
--
--   supabase db reset && supabase db push --include-all
--
-- A REGENERER quand le schema prod change. TODO : automatiser via cron
-- weekly qui compare et commit le drift (script `scripts/regen-schema.js`
-- a creer).
--
-- Structure du fichier :
--   1. Extensions
--   2. Tables (CREATE TABLE IF NOT EXISTS)
--   3. Constraints (PK, FK, UNIQUE, CHECK)
--   4. Indexes (btree, gin, hnsw vector)
--   5. RLS enable
--   6. RLS policies
--   7. Notes (functions, triggers, views NON inclus - cf bas du fichier)
--
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Extensions ────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";  -- pgvector pour RAG embeddings (pro_demo_situations.embedding)

-- ── 2. Tables ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ai_roadmap_cache (user_id uuid NOT NULL, nickname text NOT NULL, faceit_level integer, faceit_elo integer, diagnosis jsonb NOT NULL, cached_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.analyses (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, faceit_nickname text, faceit_elo integer, fv_rating numeric(5,3), analysed_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.coach_conversations (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, demo_id uuid, demo_context jsonb, message_count integer NOT NULL DEFAULT 0, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.coach_credits (id bigint NOT NULL DEFAULT nextval('coach_credits_id_seq'::regclass), user_id uuid NOT NULL, balance integer NOT NULL DEFAULT 0, total_purchased integer NOT NULL DEFAULT 0, last_purchase_at timestamp with time zone, last_purchase_session text, last_purchase_pack text, last_purchase_amount integer, expires_at timestamp with time zone, created_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.coach_credits_log (id bigint NOT NULL DEFAULT nextval('coach_credits_log_id_seq'::regclass), user_id uuid NOT NULL, type text NOT NULL, delta integer NOT NULL, balance_after integer NOT NULL, message_id bigint, stripe_session text, metadata jsonb DEFAULT '{}'::jsonb, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.coach_messages (id bigint NOT NULL DEFAULT nextval('coach_messages_id_seq'::regclass), conversation_id uuid NOT NULL, role text NOT NULL, content text NOT NULL, refs jsonb DEFAULT '{}'::jsonb, tokens_in integer DEFAULT 0, tokens_out integer DEFAULT 0, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.coach_qa_logs (id bigint NOT NULL DEFAULT nextval('coach_qa_logs_id_seq'::regclass), user_id uuid NOT NULL, question text NOT NULL, response_tokens integer DEFAULT 0, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.demos (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, map text, rounds integer, total_kills integer, analysed_at timestamp with time zone DEFAULT now(), fv_rating double precision);
CREATE TABLE IF NOT EXISTS public.diagnostic_history (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, endpoint text NOT NULL, diagnosis jsonb NOT NULL, top_priorities text[], axis_scores jsonb, confidence_avg numeric(3,2), model text, thinking_budget_tokens integer, output_tokens integer, demo_id uuid, generated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.discord_links (user_id uuid NOT NULL, discord_id text NOT NULL, discord_username text, discord_avatar_url text, linked_at timestamp with time zone NOT NULL DEFAULT now(), updated_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.email_broadcast_log (id bigint NOT NULL DEFAULT nextval('email_broadcast_log_id_seq'::regclass), slug text NOT NULL, subject text NOT NULL, template_key text NOT NULL, audience text NOT NULL, recipients_count integer NOT NULL DEFAULT 0, sent_count integer NOT NULL DEFAULT 0, failed_count integer NOT NULL DEFAULT 0, failed_samples jsonb, triggered_by text NOT NULL, triggered_at timestamp with time zone NOT NULL DEFAULT now(), completed_at timestamp with time zone, metadata jsonb DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS public.email_inbound_debug (id bigint NOT NULL DEFAULT nextval('email_inbound_debug_id_seq'::regclass), created_at timestamp with time zone DEFAULT now(), headers jsonb, body_raw text, body_parsed jsonb, signature_ok boolean, result text, error_message text);
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_log (id bigint NOT NULL DEFAULT nextval('email_unsubscribe_log_id_seq'::regclass), user_id uuid, action text NOT NULL, ip text, user_agent text, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.error_logs (id bigint NOT NULL DEFAULT nextval('error_logs_id_seq'::regclass), created_at timestamp with time zone NOT NULL DEFAULT now(), source text NOT NULL, level text NOT NULL DEFAULT 'error'::text, message text NOT NULL, stack text, url text, user_agent text, user_id uuid, route text, extra jsonb, resolved boolean DEFAULT false, resolved_at timestamp with time zone, fingerprint text);
CREATE TABLE IF NOT EXISTS public.faceit_leaderboard_cache (region text NOT NULL, payload jsonb NOT NULL, cached_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.faceit_webhook_events (id bigint NOT NULL DEFAULT nextval('faceit_webhook_events_id_seq'::regclass), event_id text, event_type text NOT NULL, match_id text, payload jsonb NOT NULL, signature_valid boolean, processed_at timestamp with time zone, error_message text, retry_count integer NOT NULL DEFAULT 0, received_at timestamp with time zone NOT NULL DEFAULT now(), created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.feature_interests (id uuid NOT NULL DEFAULT gen_random_uuid(), feature_slug text NOT NULL, user_id uuid, anon_id text, source text DEFAULT 'teaser'::text, created_at timestamp with time zone DEFAULT now(), notified_at timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.fv_annotations (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, demo_id uuid NOT NULL, round_num integer NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb, is_public boolean NOT NULL DEFAULT false, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), share_id text);
CREATE TABLE IF NOT EXISTS public.match_players (id uuid NOT NULL DEFAULT gen_random_uuid(), match_id text, user_id uuid, faceit_player_id text, nickname text, team text, kills integer DEFAULT 0, deaths integer DEFAULT 0, assists integer DEFAULT 0, kast numeric DEFAULT 0, adr numeric DEFAULT 0, hs_pct numeric DEFAULT 0, fv_rating numeric DEFAULT 0, first_kills integer DEFAULT 0, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.match_source_log (id bigint NOT NULL DEFAULT nextval('match_source_log_id_seq'::regclass), user_id uuid, match_id text, source text NOT NULL, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.matches (id text NOT NULL, faceit_match_id text NOT NULL, user_id uuid, map text, score_ct integer DEFAULT 0, score_t integer DEFAULT 0, winner text, rounds integer DEFAULT 0, demo_url text, status text DEFAULT 'pending'::text, parsed_at timestamp with time zone, demo_data jsonb, created_at timestamp with time zone DEFAULT now(), error_message text);
CREATE TABLE IF NOT EXISTS public.notifications (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, type text NOT NULL, title text NOT NULL, message text, match_id text, read boolean DEFAULT false, created_at timestamp with time zone DEFAULT now(), action_url text, icon text, metadata jsonb);
CREATE TABLE IF NOT EXISTS public.password_reset_logs (id bigint NOT NULL DEFAULT nextval('password_reset_logs_id_seq'::regclass), email text NOT NULL, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.player_advanced_cache (player_id text NOT NULL, nickname text NOT NULL, advanced_stats jsonb NOT NULL DEFAULT '{}'::jsonb, cached_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pro_demo_events (id bigint NOT NULL DEFAULT nextval('pro_demo_events_id_seq'::regclass), pro_match_map_id uuid NOT NULL, round_num integer NOT NULL, tick integer NOT NULL, round_time_s numeric(6,2), event_type text NOT NULL, player_steamid text, player_name text, player_team text, pos_x numeric(7,1), pos_y numeric(7,1), pos_z numeric(7,1), target_pos_x numeric(7,1), target_pos_y numeric(7,1), target_pos_z numeric(7,1), weapon text, grenade_type text, victim_steamid text, victim_name text, metadata jsonb, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pro_demo_patterns (id uuid NOT NULL DEFAULT gen_random_uuid(), pattern_type text NOT NULL, map text NOT NULL, side text, signature_hash text NOT NULL, player_steamid text, player_name text, team_name text, sample_size integer NOT NULL, total_opportunities integer, confidence numeric(4,3) NOT NULL, pattern_data jsonb NOT NULL, description text, detected_at timestamp with time zone DEFAULT now(), last_seen timestamp with time zone DEFAULT now(), pro_demo_situation_id uuid, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pro_demo_situations (id uuid NOT NULL DEFAULT gen_random_uuid(), map text NOT NULL, side text, situation_type text, round_num integer, pro_name text, match_event text, match_date date, hltv_match_id bigint, description text NOT NULL, tactical_notes text NOT NULL, key_callouts text[], axes_demonstrated text[], replay_link text, embedding vector(1024), notable_rating integer, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pro_demos (id uuid NOT NULL DEFAULT gen_random_uuid(), pro_match_map_id uuid NOT NULL, hltv_demo_url text, storage_path text, storage_bucket text DEFAULT 'pro-demos'::text, status text NOT NULL DEFAULT 'pending'::text, bytes_size bigint, parser_version text, tick_rate integer DEFAULT 64, download_started_at timestamp with time zone, download_completed_at timestamp with time zone, parse_started_at timestamp with time zone, parse_completed_at timestamp with time zone, event_count integer, error_message text, retry_count integer DEFAULT 0, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pro_events (id uuid NOT NULL DEFAULT gen_random_uuid(), name text NOT NULL, short_name text, tier text DEFAULT 'S'::text, prize_pool integer, start_date date, end_date date, hltv_event_id integer, logo_url text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pro_grants (id bigint NOT NULL DEFAULT nextval('pro_grants_id_seq'::regclass), user_id uuid NOT NULL, plan text NOT NULL, reason text NOT NULL, granted_at timestamp with time zone NOT NULL DEFAULT now(), expires_at timestamp with time zone, revoked_at timestamp with time zone, metadata jsonb, created_by uuid);
CREATE TABLE IF NOT EXISTS public.pro_ingest_jobs (id uuid NOT NULL DEFAULT gen_random_uuid(), hltv_url text NOT NULL, hltv_match_id bigint, status text DEFAULT 'pending'::text, match_id uuid, error_msg text, source text DEFAULT 'admin'::text, created_by uuid, created_at timestamp with time zone DEFAULT now(), completed_at timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.pro_insights_cache (id bigint NOT NULL DEFAULT nextval('pro_insights_cache_id_seq'::regclass), context_hash text NOT NULL, response jsonb NOT NULL, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pro_insights_logs (id bigint NOT NULL DEFAULT nextval('pro_insights_logs_id_seq'::regclass), user_id uuid NOT NULL, context_hash text NOT NULL, response_tokens integer DEFAULT 0, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pro_match_maps (id uuid NOT NULL DEFAULT gen_random_uuid(), match_id uuid, map_order integer NOT NULL, map_name text NOT NULL, team_a_score integer NOT NULL, team_b_score integer NOT NULL, team_a_ct_rounds integer, team_a_t_rounds integer, picked_by text, duration_min integer, created_at timestamp with time zone DEFAULT now(), pandascore_game_id bigint, demo_url text, demo_archive_url text);
CREATE TABLE IF NOT EXISTS public.pro_match_players (id uuid NOT NULL DEFAULT gen_random_uuid(), match_map_id uuid, nickname text NOT NULL, team text NOT NULL, country text, kills integer DEFAULT 0, deaths integer DEFAULT 0, assists integer DEFAULT 0, adr numeric(5,1), kast_pct numeric(4,1), hltv_rating numeric(4,2), first_kills integer DEFAULT 0, first_deaths integer DEFAULT 0, clutches integer DEFAULT 0, multi_kills integer DEFAULT 0, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.pro_matches (id uuid NOT NULL DEFAULT gen_random_uuid(), event_id uuid, stage text, format text DEFAULT 'BO3'::text, team_a text NOT NULL, team_b text NOT NULL, team_a_logo text, team_b_logo text, team_a_score integer DEFAULT 0, team_b_score integer DEFAULT 0, winner text, best_player text, best_rating numeric(4,2), match_date timestamp with time zone NOT NULL, hltv_match_id bigint, demo_available boolean DEFAULT false, created_at timestamp with time zone DEFAULT now(), pandascore_match_id bigint, source text DEFAULT 'hltv'::text);
CREATE TABLE IF NOT EXISTS public.profiles (id uuid NOT NULL, full_name text, avatar_url text, faceit_nickname text, faceit_id text, mode text DEFAULT 'player'::text, subscription_tier text DEFAULT 'free'::text, created_at timestamp with time zone DEFAULT now(), stripe_customer_id text, faceit_avatar text, faceit_elo integer, faceit_level integer, scout_opt_in boolean DEFAULT false, scout_role_primary text, scout_role_secondary text, scout_bio text, scout_open_to_offers boolean DEFAULT false, scout_region text, birth_year integer, years_playing_cs integer, country_code text, notification_prefs jsonb DEFAULT '{}'::jsonb, locale text DEFAULT 'fr'::text, referral_code text, referred_by uuid, referred_at timestamp with time zone, welcome_email_sent_at timestamp with time zone, signup_utm_source text, signup_utm_medium text, signup_utm_campaign text, signup_utm_term text, signup_utm_content text, signup_referrer text, signup_landing_url text, signup_at timestamp with time zone, marketing_opt_out boolean NOT NULL DEFAULT false, marketing_opt_out_at timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.refund_requests (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid NOT NULL, stripe_customer_id text, stripe_charge_id text NOT NULL, stripe_refund_id text, stripe_subscription_id text, amount_refunded_cents integer NOT NULL, currency text NOT NULL DEFAULT 'eur'::text, reason text, status text NOT NULL DEFAULT 'pending'::text, error_message text, requested_at timestamp with time zone NOT NULL DEFAULT now(), completed_at timestamp with time zone, ip_hash text, user_agent text);
CREATE TABLE IF NOT EXISTS public.roster_invitations (id uuid NOT NULL DEFAULT gen_random_uuid(), roster_id uuid NOT NULL, inviter_id uuid, invitee_user_id uuid, invitee_nickname text, proposed_role text, message text, status text NOT NULL DEFAULT 'pending'::text, token text, expires_at timestamp with time zone, created_at timestamp with time zone DEFAULT now(), responded_at timestamp with time zone);
CREATE TABLE IF NOT EXISTS public.roster_players (id uuid NOT NULL DEFAULT gen_random_uuid(), roster_id uuid, faceit_nickname text NOT NULL, faceit_elo integer, faceit_level integer, avatar_url text, role text, added_at timestamp with time zone DEFAULT now(), user_id uuid, team_role text, is_captain boolean DEFAULT false, is_sub boolean DEFAULT false, invited_by uuid, joined_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.rosters (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, team_name text NOT NULL DEFAULT 'Mon équipe'::text, created_at timestamp with time zone DEFAULT now(), tag text, region text, description text, visibility text DEFAULT 'team'::text, looking_for_players boolean DEFAULT false, looking_for_roles text[], logo_url text, faceit_team_id text, faceit_team_url text, esea_division text, esea_season text);
CREATE TABLE IF NOT EXISTS public.scout_logs (id bigint NOT NULL DEFAULT nextval('scout_logs_id_seq'::regclass), user_id uuid NOT NULL, nickname text NOT NULL, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.shared_demos (id text NOT NULL, demo_id uuid, user_id uuid, created_at timestamp with time zone DEFAULT now());
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (event_id text NOT NULL, event_type text NOT NULL, api_version text, livemode boolean, received_at timestamp with time zone NOT NULL DEFAULT now(), processed_at timestamp with time zone, error_message text);
CREATE TABLE IF NOT EXISTS public.subscription_events (id bigint NOT NULL DEFAULT nextval('subscription_events_id_seq'::regclass), user_id uuid, event_type text NOT NULL, plan text, stripe_customer_id text, stripe_subscription_id text, ip text, user_agent text, metadata jsonb, created_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.subscriptions (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, stripe_subscription_id text, stripe_customer_id text, plan text, status text, current_period_start timestamp with time zone, current_period_end timestamp with time zone, updated_at timestamp with time zone DEFAULT now(), trial_alert_sent_at timestamp with time zone, cancel_at_period_end boolean NOT NULL DEFAULT false, payment_failed_at timestamp with time zone, dunning_sent_at text, renewal_notice_sent_at text);
CREATE TABLE IF NOT EXISTS public.user_feedback (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, anon_email text, type text NOT NULL, message text NOT NULL, page_url text, user_agent text, viewport text, user_tier text, ip_hash text, status text DEFAULT 'new'::text, admin_response text, responded_at timestamp with time zone, created_at timestamp with time zone DEFAULT now(), ticket_number bigint NOT NULL, tags text[] DEFAULT '{}'::text[], source text DEFAULT 'widget'::text, from_email text, subject text, message_html text, inbound_message_id text, thread_references text);
CREATE TABLE IF NOT EXISTS public.watchlist (id uuid NOT NULL DEFAULT gen_random_uuid(), user_id uuid, faceit_nickname text NOT NULL, faceit_elo integer, avatar_url text, note text, added_at timestamp with time zone DEFAULT now());

-- ── 3. Constraints (PK, FK, UNIQUE, CHECK) ───────────────────────────────
-- NB : peuvent echouer si executes apres CREATE TABLE quand contraintes
-- composees referencent FK. Si erreur, executer en 2 passes (PK avant FK).

ALTER TABLE public.ai_roadmap_cache ADD CONSTRAINT ai_roadmap_cache_pkey PRIMARY KEY (user_id);
ALTER TABLE public.ai_roadmap_cache ADD CONSTRAINT ai_roadmap_cache_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.analyses ADD CONSTRAINT analyses_pkey PRIMARY KEY (id);
ALTER TABLE public.analyses ADD CONSTRAINT analyses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.coach_conversations ADD CONSTRAINT coach_conversations_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_conversations ADD CONSTRAINT coach_conversations_user_id_demo_id_key UNIQUE (user_id, demo_id);
ALTER TABLE public.coach_conversations ADD CONSTRAINT coach_conversations_demo_id_fkey FOREIGN KEY (demo_id) REFERENCES public.demos(id) ON DELETE CASCADE;
ALTER TABLE public.coach_conversations ADD CONSTRAINT coach_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.coach_credits ADD CONSTRAINT coach_credits_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_credits ADD CONSTRAINT coach_credits_user_id_key UNIQUE (user_id);
ALTER TABLE public.coach_credits ADD CONSTRAINT coach_credits_balance_check CHECK (balance >= 0);
ALTER TABLE public.coach_credits ADD CONSTRAINT coach_credits_total_purchased_check CHECK (total_purchased >= 0);
ALTER TABLE public.coach_credits ADD CONSTRAINT coach_credits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.coach_credits_log ADD CONSTRAINT coach_credits_log_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_credits_log ADD CONSTRAINT coach_credits_log_type_check CHECK (type = ANY (ARRAY['purchase'::text, 'consumption'::text, 'expiration'::text, 'refund'::text, 'admin_grant'::text]));
ALTER TABLE public.coach_credits_log ADD CONSTRAINT coach_credits_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.coach_messages ADD CONSTRAINT coach_messages_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_messages ADD CONSTRAINT coach_messages_content_check CHECK (length(content) <= 4000);
ALTER TABLE public.coach_messages ADD CONSTRAINT coach_messages_role_check CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text]));
ALTER TABLE public.coach_messages ADD CONSTRAINT coach_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.coach_conversations(id) ON DELETE CASCADE;
ALTER TABLE public.coach_qa_logs ADD CONSTRAINT coach_qa_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.coach_qa_logs ADD CONSTRAINT coach_qa_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.demos ADD CONSTRAINT demos_pkey PRIMARY KEY (id);
ALTER TABLE public.demos ADD CONSTRAINT demos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.diagnostic_history ADD CONSTRAINT diagnostic_history_pkey PRIMARY KEY (id);
ALTER TABLE public.diagnostic_history ADD CONSTRAINT diagnostic_history_endpoint_check CHECK (endpoint = ANY (ARRAY['ai-roadmap'::text, 'coach-conversational'::text, 'ai-replay-summary'::text, 'pro-insights'::text, 'coach-qa'::text]));
ALTER TABLE public.diagnostic_history ADD CONSTRAINT diagnostic_history_demo_id_fkey FOREIGN KEY (demo_id) REFERENCES public.demos(id) ON DELETE SET NULL;
ALTER TABLE public.diagnostic_history ADD CONSTRAINT diagnostic_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.discord_links ADD CONSTRAINT discord_links_pkey PRIMARY KEY (user_id);
ALTER TABLE public.discord_links ADD CONSTRAINT discord_links_discord_id_key UNIQUE (discord_id);
ALTER TABLE public.discord_links ADD CONSTRAINT discord_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.email_broadcast_log ADD CONSTRAINT email_broadcast_log_pkey PRIMARY KEY (id);
ALTER TABLE public.email_broadcast_log ADD CONSTRAINT email_broadcast_log_slug_key UNIQUE (slug);
ALTER TABLE public.email_inbound_debug ADD CONSTRAINT email_inbound_debug_pkey PRIMARY KEY (id);
ALTER TABLE public.email_unsubscribe_log ADD CONSTRAINT email_unsubscribe_log_pkey PRIMARY KEY (id);
ALTER TABLE public.email_unsubscribe_log ADD CONSTRAINT email_unsubscribe_log_action_check CHECK (action = ANY (ARRAY['unsubscribed'::text, 'resubscribed'::text]));
ALTER TABLE public.email_unsubscribe_log ADD CONSTRAINT email_unsubscribe_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.error_logs ADD CONSTRAINT error_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.error_logs ADD CONSTRAINT error_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.faceit_leaderboard_cache ADD CONSTRAINT faceit_leaderboard_cache_pkey PRIMARY KEY (region);
ALTER TABLE public.faceit_webhook_events ADD CONSTRAINT faceit_webhook_events_pkey PRIMARY KEY (id);
ALTER TABLE public.faceit_webhook_events ADD CONSTRAINT faceit_webhook_events_event_id_key UNIQUE (event_id);
ALTER TABLE public.feature_interests ADD CONSTRAINT feature_interests_pkey PRIMARY KEY (id);
ALTER TABLE public.feature_interests ADD CONSTRAINT feature_interests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.fv_annotations ADD CONSTRAINT fv_annotations_pkey PRIMARY KEY (id);
ALTER TABLE public.fv_annotations ADD CONSTRAINT fv_annotations_user_id_demo_id_round_num_key UNIQUE (user_id, demo_id, round_num);
ALTER TABLE public.fv_annotations ADD CONSTRAINT fv_annotations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.match_players ADD CONSTRAINT match_players_pkey PRIMARY KEY (id);
ALTER TABLE public.match_players ADD CONSTRAINT match_players_match_nickname_unique UNIQUE (match_id, nickname);
ALTER TABLE public.match_players ADD CONSTRAINT match_players_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.matches(faceit_match_id) ON DELETE CASCADE;
ALTER TABLE public.match_players ADD CONSTRAINT match_players_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.match_source_log ADD CONSTRAINT match_source_log_pkey PRIMARY KEY (id);
ALTER TABLE public.match_source_log ADD CONSTRAINT match_source_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.matches ADD CONSTRAINT matches_pkey PRIMARY KEY (id);
ALTER TABLE public.matches ADD CONSTRAINT matches_faceit_match_id_key UNIQUE (faceit_match_id);
ALTER TABLE public.matches ADD CONSTRAINT matches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.password_reset_logs ADD CONSTRAINT password_reset_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.player_advanced_cache ADD CONSTRAINT player_advanced_cache_pkey PRIMARY KEY (player_id);
ALTER TABLE public.pro_demo_events ADD CONSTRAINT pro_demo_events_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_demo_events ADD CONSTRAINT pro_demo_events_event_type_check CHECK (event_type = ANY (ARRAY['round_start'::text, 'round_end'::text, 'freeze_end'::text, 'grenade_thrown'::text, 'grenade_detonated'::text, 'kill'::text, 'death'::text, 'bomb_planted'::text, 'bomb_defused'::text, 'bomb_exploded'::text, 'position_snapshot'::text, 'player_blinded'::text, 'utility_damage'::text]));
ALTER TABLE public.pro_demo_events ADD CONSTRAINT pro_demo_events_grenade_type_check CHECK ((grenade_type IS NULL) OR (grenade_type = ANY (ARRAY['smoke'::text, 'flash'::text, 'molotov'::text, 'incgrenade'::text, 'hegrenade'::text, 'decoy'::text])));
ALTER TABLE public.pro_demo_events ADD CONSTRAINT pro_demo_events_player_team_check CHECK (player_team = ANY (ARRAY['CT'::text, 'T'::text, 'spec'::text]));
ALTER TABLE public.pro_demo_events ADD CONSTRAINT pro_demo_events_pro_match_map_id_fkey FOREIGN KEY (pro_match_map_id) REFERENCES public.pro_match_maps(id) ON DELETE CASCADE;
ALTER TABLE public.pro_demo_patterns ADD CONSTRAINT pro_demo_patterns_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_demo_patterns ADD CONSTRAINT pro_demo_patterns_signature_hash_key UNIQUE (signature_hash);
ALTER TABLE public.pro_demo_patterns ADD CONSTRAINT pro_demo_patterns_map_check CHECK (map = ANY (ARRAY['mirage'::text, 'inferno'::text, 'nuke'::text, 'ancient'::text, 'anubis'::text, 'dust2'::text, 'overpass'::text]));
ALTER TABLE public.pro_demo_patterns ADD CONSTRAINT pro_demo_patterns_pattern_type_check CHECK (pattern_type = ANY (ARRAY['util_lineup'::text, 'position_hold'::text, 'execute_timing'::text, 'post_plant_crossfire'::text, 'opening_position'::text, 'lurk_timing'::text, 'retake_lineup'::text]));
ALTER TABLE public.pro_demo_patterns ADD CONSTRAINT pro_demo_patterns_side_check CHECK ((side IS NULL) OR (side = ANY (ARRAY['CT'::text, 'T'::text, 'both'::text])));
ALTER TABLE public.pro_demo_patterns ADD CONSTRAINT pro_demo_patterns_pro_demo_situation_id_fkey FOREIGN KEY (pro_demo_situation_id) REFERENCES public.pro_demo_situations(id) ON DELETE SET NULL;
ALTER TABLE public.pro_demo_situations ADD CONSTRAINT pro_demo_situations_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_demo_situations ADD CONSTRAINT pro_demo_situations_axes_demonstrated_check CHECK (axes_demonstrated <@ ARRAY['aim'::text, 'crosshair'::text, 'spray'::text, 'utility'::text, 'positioning'::text, 'gamesense'::text, 'economy'::text, 'mental'::text, 'movement'::text, 'comms'::text, 'reaction'::text]);
ALTER TABLE public.pro_demo_situations ADD CONSTRAINT pro_demo_situations_map_active_duty_check CHECK (map = ANY (ARRAY['mirage'::text, 'inferno'::text, 'nuke'::text, 'ancient'::text, 'anubis'::text, 'dust2'::text, 'overpass'::text]));
ALTER TABLE public.pro_demo_situations ADD CONSTRAINT pro_demo_situations_notable_rating_check CHECK ((notable_rating >= 1) AND (notable_rating <= 10));
ALTER TABLE public.pro_demo_situations ADD CONSTRAINT pro_demo_situations_side_check CHECK (side = ANY (ARRAY['CT'::text, 'T'::text, 'both'::text]));
ALTER TABLE public.pro_demo_situations ADD CONSTRAINT pro_demo_situations_situation_type_check CHECK (situation_type = ANY (ARRAY['clutch_won'::text, 'clutch_lost'::text, 'multi_kill'::text, 'opening_kill'::text, 'opening_loss'::text, 'eco_win'::text, 'force_win'::text, 'anti_eco'::text, 'retake_won'::text, 'retake_lost'::text, 'execute_won'::text, 'execute_lost'::text, 'lurk_impact'::text, 'aim_duel'::text, 'post_plant'::text, 'pre_plant'::text, 'flash_assist'::text, 'util_setup'::text]));
ALTER TABLE public.pro_demos ADD CONSTRAINT pro_demos_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_demos ADD CONSTRAINT pro_demos_pro_match_map_id_key UNIQUE (pro_match_map_id);
ALTER TABLE public.pro_demos ADD CONSTRAINT pro_demos_status_check CHECK (status = ANY (ARRAY['pending'::text, 'downloading'::text, 'parsing'::text, 'parsed'::text, 'failed'::text, 'skipped'::text]));
ALTER TABLE public.pro_demos ADD CONSTRAINT pro_demos_pro_match_map_id_fkey FOREIGN KEY (pro_match_map_id) REFERENCES public.pro_match_maps(id) ON DELETE CASCADE;
ALTER TABLE public.pro_events ADD CONSTRAINT pro_events_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_events ADD CONSTRAINT pro_events_hltv_event_id_key UNIQUE (hltv_event_id);
ALTER TABLE public.pro_grants ADD CONSTRAINT pro_grants_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_grants ADD CONSTRAINT pro_grants_plan_check CHECK (plan = ANY (ARRAY['pro'::text, 'team'::text]));
ALTER TABLE public.pro_grants ADD CONSTRAINT pro_grants_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.pro_grants ADD CONSTRAINT pro_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.pro_ingest_jobs ADD CONSTRAINT pro_ingest_jobs_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_ingest_jobs ADD CONSTRAINT pro_ingest_jobs_status_check CHECK (status = ANY (ARRAY['pending'::text, 'fetching'::text, 'parsed'::text, 'failed'::text, 'manual'::text]));
ALTER TABLE public.pro_ingest_jobs ADD CONSTRAINT pro_ingest_jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.pro_ingest_jobs ADD CONSTRAINT pro_ingest_jobs_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.pro_matches(id) ON DELETE SET NULL;
ALTER TABLE public.pro_insights_cache ADD CONSTRAINT pro_insights_cache_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_insights_logs ADD CONSTRAINT pro_insights_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_insights_logs ADD CONSTRAINT pro_insights_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.pro_match_maps ADD CONSTRAINT pro_match_maps_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_match_maps ADD CONSTRAINT pro_match_maps_match_id_fkey FOREIGN KEY (match_id) REFERENCES public.pro_matches(id) ON DELETE CASCADE;
ALTER TABLE public.pro_match_players ADD CONSTRAINT pro_match_players_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_match_players ADD CONSTRAINT pro_match_players_match_map_id_fkey FOREIGN KEY (match_map_id) REFERENCES public.pro_match_maps(id) ON DELETE CASCADE;
ALTER TABLE public.pro_matches ADD CONSTRAINT pro_matches_pkey PRIMARY KEY (id);
ALTER TABLE public.pro_matches ADD CONSTRAINT pro_matches_hltv_match_id_key UNIQUE (hltv_match_id);
ALTER TABLE public.pro_matches ADD CONSTRAINT pro_matches_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.pro_events(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_referral_code_key UNIQUE (referral_code);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_referred_by_fkey FOREIGN KEY (referred_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.refund_requests ADD CONSTRAINT refund_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.roster_invitations ADD CONSTRAINT roster_invitations_pkey PRIMARY KEY (id);
ALTER TABLE public.roster_invitations ADD CONSTRAINT roster_invitations_token_key UNIQUE (token);
ALTER TABLE public.roster_invitations ADD CONSTRAINT roster_invitations_invitee_user_id_fkey FOREIGN KEY (invitee_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.roster_invitations ADD CONSTRAINT roster_invitations_inviter_id_fkey FOREIGN KEY (inviter_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.roster_invitations ADD CONSTRAINT roster_invitations_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES public.rosters(id) ON DELETE CASCADE;
ALTER TABLE public.roster_players ADD CONSTRAINT roster_players_pkey PRIMARY KEY (id);
ALTER TABLE public.roster_players ADD CONSTRAINT roster_players_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.roster_players ADD CONSTRAINT roster_players_roster_id_fkey FOREIGN KEY (roster_id) REFERENCES public.rosters(id) ON DELETE CASCADE;
ALTER TABLE public.roster_players ADD CONSTRAINT roster_players_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.rosters ADD CONSTRAINT rosters_pkey PRIMARY KEY (id);
ALTER TABLE public.rosters ADD CONSTRAINT rosters_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.scout_logs ADD CONSTRAINT scout_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.scout_logs ADD CONSTRAINT scout_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.shared_demos ADD CONSTRAINT shared_demos_pkey PRIMARY KEY (id);
ALTER TABLE public.shared_demos ADD CONSTRAINT shared_demos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.stripe_webhook_events ADD CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (event_id);
ALTER TABLE public.subscription_events ADD CONSTRAINT subscription_events_pkey PRIMARY KEY (id);
ALTER TABLE public.subscription_events ADD CONSTRAINT subscription_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
ALTER TABLE public.user_feedback ADD CONSTRAINT user_feedback_pkey PRIMARY KEY (id);
ALTER TABLE public.user_feedback ADD CONSTRAINT user_feedback_message_check CHECK ((length(message) > 0) AND (length(message) <= 2000));
ALTER TABLE public.user_feedback ADD CONSTRAINT user_feedback_source_check CHECK (source = ANY (ARRAY['widget'::text, 'email'::text, 'api'::text]));
ALTER TABLE public.user_feedback ADD CONSTRAINT user_feedback_status_check CHECK (status = ANY (ARRAY['new'::text, 'read'::text, 'responded'::text, 'closed'::text]));
ALTER TABLE public.user_feedback ADD CONSTRAINT user_feedback_type_check CHECK (type = ANY (ARRAY['positive'::text, 'negative'::text, 'idea'::text, 'bug'::text]));
ALTER TABLE public.user_feedback ADD CONSTRAINT user_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.watchlist ADD CONSTRAINT watchlist_pkey PRIMARY KEY (id);
ALTER TABLE public.watchlist ADD CONSTRAINT watchlist_user_id_faceit_nickname_key UNIQUE (user_id, faceit_nickname);
ALTER TABLE public.watchlist ADD CONSTRAINT watchlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── 4. Indexes (btree, gin, hnsw vector) ─────────────────────────────────

CREATE INDEX IF NOT EXISTS ai_roadmap_cache_cached_at_idx ON public.ai_roadmap_cache USING btree (cached_at DESC);
CREATE INDEX IF NOT EXISTS analyses_user_id_idx ON public.analyses USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_user_demo ON public.coach_conversations USING btree (user_id, demo_id);
CREATE INDEX IF NOT EXISTS idx_coach_conversations_user_recent ON public.coach_conversations USING btree (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_credits_balance_nonzero ON public.coach_credits USING btree (user_id) WHERE (balance > 0);
CREATE INDEX IF NOT EXISTS idx_coach_credits_user ON public.coach_credits USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_credits_log_stripe_session_unique ON public.coach_credits_log USING btree (stripe_session) WHERE (stripe_session IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_coach_credits_log_user ON public.coach_credits_log USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_messages_conversation ON public.coach_messages USING btree (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS coach_qa_logs_user_date_idx ON public.coach_qa_logs USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS demos_user_id_idx ON public.demos USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_diagnostic_history_user_endpoint ON public.diagnostic_history USING btree (user_id, endpoint, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_diagnostic_history_user_recent ON public.diagnostic_history USING btree (user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_discord_links_discord_id ON public.discord_links USING btree (discord_id);
CREATE INDEX IF NOT EXISTS idx_discord_links_linked_at ON public.discord_links USING btree (linked_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_broadcast_log_template_key ON public.email_broadcast_log USING btree (template_key);
CREATE INDEX IF NOT EXISTS idx_email_broadcast_log_triggered_at ON public.email_broadcast_log USING btree (triggered_at DESC);
CREATE INDEX IF NOT EXISTS email_inbound_debug_created_idx ON public.email_inbound_debug USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS email_unsubscribe_log_created_at_idx ON public.email_unsubscribe_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS email_unsubscribe_log_user_id_idx ON public.email_unsubscribe_log USING btree (user_id);
CREATE INDEX IF NOT EXISTS error_logs_created_idx ON public.error_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS error_logs_fingerprint_idx ON public.error_logs USING btree (fingerprint) WHERE (fingerprint IS NOT NULL);
CREATE INDEX IF NOT EXISTS error_logs_resolved_idx ON public.error_logs USING btree (resolved, created_at DESC) WHERE (resolved = false);
CREATE INDEX IF NOT EXISTS idx_faceit_webhook_event_type_recent ON public.faceit_webhook_events USING btree (event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_faceit_webhook_match_id ON public.faceit_webhook_events USING btree (match_id) WHERE (match_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_faceit_webhook_unprocessed ON public.faceit_webhook_events USING btree (event_type, received_at) WHERE (processed_at IS NULL);
CREATE INDEX IF NOT EXISTS feature_interests_user_id_idx ON public.feature_interests USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_interests_anon_unique ON public.feature_interests USING btree (feature_slug, anon_id) WHERE ((user_id IS NULL) AND (anon_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_feature_interests_feature ON public.feature_interests USING btree (feature_slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_interests_user_unique ON public.feature_interests USING btree (feature_slug, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fv_annotations_demo ON public.fv_annotations USING btree (demo_id);
CREATE INDEX IF NOT EXISTS idx_fv_annotations_public ON public.fv_annotations USING btree (is_public) WHERE (is_public = true);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fv_annotations_share_id ON public.fv_annotations USING btree (share_id) WHERE (share_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fv_annotations_user ON public.fv_annotations USING btree (user_id);
CREATE INDEX IF NOT EXISTS match_players_match_idx ON public.match_players USING btree (match_id);
CREATE INDEX IF NOT EXISTS match_players_user_idx ON public.match_players USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_match_source_log_source ON public.match_source_log USING btree (source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_source_log_user ON public.match_source_log USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS matches_created_at_idx ON public.matches USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS matches_status_idx ON public.matches USING btree (status);
CREATE INDEX IF NOT EXISTS matches_user_id_idx ON public.matches USING btree (user_id);
CREATE INDEX IF NOT EXISTS notifications_read_idx ON public.notifications USING btree (user_id, read);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications USING btree (user_id);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications USING btree (user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_logs_email_date ON public.password_reset_logs USING btree (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pac_cached_at ON public.player_advanced_cache USING btree (cached_at);
CREATE INDEX IF NOT EXISTS idx_pac_nickname ON public.player_advanced_cache USING btree (nickname);
CREATE INDEX IF NOT EXISTS idx_pde_event_type ON public.pro_demo_events USING btree (event_type) WHERE (event_type = ANY (ARRAY['grenade_thrown'::text, 'grenade_detonated'::text, 'kill'::text, 'bomb_planted'::text]));
CREATE INDEX IF NOT EXISTS idx_pde_grenade_type ON public.pro_demo_events USING btree (grenade_type) WHERE (grenade_type IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pde_match_map_round ON public.pro_demo_events USING btree (pro_match_map_id, round_num);
CREATE INDEX IF NOT EXISTS idx_pde_player ON public.pro_demo_events USING btree (player_steamid) WHERE (player_steamid IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pde_team_side ON public.pro_demo_events USING btree (pro_match_map_id, player_team, round_num);
CREATE INDEX IF NOT EXISTS idx_pdp_confidence ON public.pro_demo_patterns USING btree (confidence DESC);
CREATE INDEX IF NOT EXISTS idx_pdp_map_type ON public.pro_demo_patterns USING btree (map, pattern_type);
CREATE INDEX IF NOT EXISTS idx_pdp_player ON public.pro_demo_patterns USING btree (player_steamid) WHERE (player_steamid IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pdp_unlinked ON public.pro_demo_patterns USING btree (pro_demo_situation_id) WHERE (pro_demo_situation_id IS NULL);
CREATE INDEX IF NOT EXISTS pro_demo_situations_embedding_idx ON public.pro_demo_situations USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS pro_demo_situations_map_idx ON public.pro_demo_situations USING btree (map);
CREATE INDEX IF NOT EXISTS pro_demo_situations_rating_idx ON public.pro_demo_situations USING btree (notable_rating DESC);
CREATE INDEX IF NOT EXISTS pro_demo_situations_type_idx ON public.pro_demo_situations USING btree (situation_type);
CREATE INDEX IF NOT EXISTS idx_pro_demos_match_map ON public.pro_demos USING btree (pro_match_map_id);
CREATE INDEX IF NOT EXISTS idx_pro_demos_status ON public.pro_demos USING btree (status);
CREATE INDEX IF NOT EXISTS pro_grants_reason_idx ON public.pro_grants USING btree (reason, granted_at DESC);
CREATE INDEX IF NOT EXISTS pro_grants_user_active_idx ON public.pro_grants USING btree (user_id, expires_at DESC) WHERE (revoked_at IS NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pro_ingest_jobs_hltv_id_unique ON public.pro_ingest_jobs USING btree (hltv_match_id) WHERE (hltv_match_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pro_ingest_jobs_status ON public.pro_ingest_jobs USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pro_ingest_jobs_url ON public.pro_ingest_jobs USING btree (hltv_url);
CREATE INDEX IF NOT EXISTS pro_ingest_jobs_created_by_idx ON public.pro_ingest_jobs USING btree (created_by);
CREATE INDEX IF NOT EXISTS pro_ingest_jobs_match_id_idx ON public.pro_ingest_jobs USING btree (match_id);
CREATE INDEX IF NOT EXISTS pro_insights_cache_hash_date ON public.pro_insights_cache USING btree (context_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS pro_insights_logs_user_date ON public.pro_insights_logs USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pro_match_maps_match ON public.pro_match_maps USING btree (match_id, map_order);
CREATE UNIQUE INDEX IF NOT EXISTS pro_match_maps_pandascore_game_idx ON public.pro_match_maps USING btree (pandascore_game_id) WHERE (pandascore_game_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_pro_match_players_map ON public.pro_match_players USING btree (match_map_id);
CREATE INDEX IF NOT EXISTS idx_pro_match_players_nickname ON public.pro_match_players USING btree (lower(nickname));
CREATE INDEX IF NOT EXISTS idx_pro_matches_date ON public.pro_matches USING btree (match_date DESC);
CREATE INDEX IF NOT EXISTS idx_pro_matches_event ON public.pro_matches USING btree (event_id);
CREATE INDEX IF NOT EXISTS idx_pro_matches_teams ON public.pro_matches USING btree (team_a, team_b);
CREATE UNIQUE INDEX IF NOT EXISTS pro_matches_pandascore_id_idx ON public.pro_matches USING btree (pandascore_match_id) WHERE (pandascore_match_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS pro_matches_source_idx ON public.pro_matches USING btree (source);
CREATE INDEX IF NOT EXISTS profiles_marketing_opt_out_idx ON public.profiles USING btree (marketing_opt_out) WHERE (marketing_opt_out = false);
CREATE INDEX IF NOT EXISTS profiles_referral_code_idx ON public.profiles USING btree (referral_code);
CREATE INDEX IF NOT EXISTS profiles_referred_by_idx ON public.profiles USING btree (referred_by) WHERE (referred_by IS NOT NULL);
CREATE INDEX IF NOT EXISTS profiles_signup_utm_source_idx ON public.profiles USING btree (signup_utm_source) WHERE (signup_utm_source IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refund_requests_charge_completed ON public.refund_requests USING btree (stripe_charge_id) WHERE (status = 'completed'::text);
CREATE INDEX IF NOT EXISTS idx_refund_requests_user ON public.refund_requests USING btree (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS roster_invitations_invitee_idx ON public.roster_invitations USING btree (invitee_user_id) WHERE (invitee_user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS roster_invitations_inviter_idx ON public.roster_invitations USING btree (inviter_id);
CREATE INDEX IF NOT EXISTS roster_invitations_nickname_idx ON public.roster_invitations USING btree (lower(invitee_nickname)) WHERE (invitee_nickname IS NOT NULL);
CREATE INDEX IF NOT EXISTS roster_invitations_roster_idx ON public.roster_invitations USING btree (roster_id);
CREATE INDEX IF NOT EXISTS roster_players_invited_by_idx ON public.roster_players USING btree (invited_by);
CREATE INDEX IF NOT EXISTS roster_players_user_id_idx ON public.roster_players USING btree (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS roster_players_user_roster_idx ON public.roster_players USING btree (roster_id, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rosters_faceit_team_id ON public.rosters USING btree (faceit_team_id) WHERE (faceit_team_id IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS rosters_tag_unique_idx ON public.rosters USING btree (upper(tag)) WHERE (tag IS NOT NULL);
CREATE INDEX IF NOT EXISTS rosters_user_id_idx ON public.rosters USING btree (user_id);
CREATE INDEX IF NOT EXISTS scout_logs_user_created_idx ON public.scout_logs USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shared_demos_user_id_idx ON public.shared_demos USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received ON public.stripe_webhook_events USING btree (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type ON public.stripe_webhook_events USING btree (event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_events_stripe_customer ON public.subscription_events USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_subscription_events_type ON public.subscription_events USING btree (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user ON public.subscription_events USING btree (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.user_feedback USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_tags ON public.user_feedback USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_feedback_ticket_number ON public.user_feedback USING btree (ticket_number DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON public.user_feedback USING btree (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON public.user_feedback USING btree (user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_feedback_from_email ON public.user_feedback USING btree (from_email) WHERE (from_email IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_user_feedback_source ON public.user_feedback USING btree (source);

-- ── 5. Row Level Security : enable sur toutes les tables ─────────────────

ALTER TABLE public.ai_roadmap_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_credits_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_qa_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnostic_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_broadcast_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_inbound_debug ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribe_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faceit_leaderboard_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faceit_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fv_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_source_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_reset_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_advanced_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_demo_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_demo_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_demo_situations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_demos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_ingest_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_insights_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_insights_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_match_maps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scout_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_demos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

-- ── 6. RLS Policies ──────────────────────────────────────────────────────
-- Pattern general :
--   - "select_own"        : auth.uid() = user_id  -> user voit ses rows
--   - "*_insert_service"  : service_role only     -> server writes (parser, cron, webhooks)
--   - "deny_clients"      : USING (false)         -> tables sensibles (audit, webhook log)
--   - "public_read"       : USING (true)          -> pro_* tables (data publique non-sensitive)

CREATE POLICY ai_roadmap_cache_select_own ON public.ai_roadmap_cache FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Analyses perso" ON public.analyses FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Insert analyses perso" ON public.analyses FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user reads own conversations" ON public.coach_conversations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY coach_credits_self_select ON public.coach_credits FOR SELECT USING (user_id = auth.uid());
CREATE POLICY coach_credits_log_self_select ON public.coach_credits_log FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "user reads own messages" ON public.coach_messages FOR SELECT USING (EXISTS (SELECT 1 FROM coach_conversations c WHERE c.id = coach_messages.conversation_id AND c.user_id = auth.uid()));
CREATE POLICY coach_qa_logs_read_own ON public.coach_qa_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Demos insert" ON public.demos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Demos perso" ON public.demos FOR ALL USING (auth.uid() = user_id);
CREATE POLICY diagnostic_history_select_own ON public.diagnostic_history FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY discord_links_delete_own ON public.discord_links FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY discord_links_select_own ON public.discord_links FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY email_broadcast_log_deny_clients ON public.email_broadcast_log FOR ALL USING (false);
CREATE POLICY email_inbound_debug_deny_clients ON public.email_inbound_debug FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY "service_role can insert audit logs" ON public.email_unsubscribe_log FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "users can read their own unsub logs" ON public.email_unsubscribe_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY error_logs_deny_clients ON public.error_logs FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY faceit_leaderboard_cache_select ON public.faceit_leaderboard_cache FOR SELECT USING (true);
CREATE POLICY "deny all client reads" ON public.faceit_webhook_events FOR ALL USING (false);
CREATE POLICY "User reads own interests" ON public.feature_interests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "fv_annotations delete own" ON public.fv_annotations FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "fv_annotations insert own" ON public.fv_annotations FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "fv_annotations public read" ON public.fv_annotations FOR SELECT TO authenticated, anon USING (is_public = true);
CREATE POLICY "fv_annotations select own or public" ON public.fv_annotations FOR SELECT TO authenticated USING ((user_id = auth.uid()) OR (is_public = true));
CREATE POLICY "fv_annotations update own" ON public.fv_annotations FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY match_players_insert_service ON public.match_players FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY match_players_select_own ON public.match_players FOR SELECT USING ((auth.uid() = user_id) OR (EXISTS (SELECT 1 FROM matches m WHERE m.faceit_match_id = match_players.match_id AND m.user_id = auth.uid())));
CREATE POLICY match_players_update_service ON public.match_players FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY match_source_log_deny_clients ON public.match_source_log FOR ALL USING (false);
CREATE POLICY matches_insert_service ON public.matches FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY matches_select_own ON public.matches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY matches_update_service ON public.matches FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY notifications_delete_own ON public.notifications FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY notifications_insert_service ON public.notifications FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY notifications_read_own ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY password_reset_logs_deny_clients ON public.password_reset_logs FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY player_advanced_cache_public_read ON public.player_advanced_cache FOR SELECT USING (true);
CREATE POLICY player_advanced_cache_insert_service ON public.player_advanced_cache FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY player_advanced_cache_update_service ON public.player_advanced_cache FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "pro_demo_events read auth" ON public.pro_demo_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "pro_demo_patterns read auth" ON public.pro_demo_patterns FOR SELECT TO authenticated USING (true);
CREATE POLICY pro_demo_situations_select_authenticated ON public.pro_demo_situations FOR SELECT TO authenticated USING (true);
CREATE POLICY "pro_demos read auth" ON public.pro_demos FOR SELECT TO authenticated USING (true);
CREATE POLICY "pro_events public read" ON public.pro_events FOR SELECT USING (true);
CREATE POLICY pro_grants_read_own ON public.pro_grants FOR SELECT TO authenticated USING ((user_id = auth.uid()) AND (revoked_at IS NULL));
CREATE POLICY "Deny all to anon and authenticated" ON public.pro_ingest_jobs FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY pro_insights_cache_deny_clients ON public.pro_insights_cache FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);
CREATE POLICY pro_insights_logs_read_own ON public.pro_insights_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "pro_match_maps public read" ON public.pro_match_maps FOR SELECT USING (true);
CREATE POLICY "pro_match_players public read" ON public.pro_match_players FOR SELECT USING (true);
CREATE POLICY "pro_matches public read" ON public.pro_matches FOR SELECT USING (true);
CREATE POLICY "Insertion profil propre" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Lecture profil propre" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Mise à jour profil propre" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "service role writes refund requests" ON public.refund_requests FOR ALL USING (false);
CREATE POLICY "user reads own refund requests" ON public.refund_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY roster_invitations_read ON public.roster_invitations FOR SELECT USING ((invitee_user_id = auth.uid()) OR (inviter_id = auth.uid()) OR (EXISTS (SELECT 1 FROM rosters r WHERE r.id = roster_invitations.roster_id AND r.user_id = auth.uid())));
CREATE POLICY roster_invitations_write ON public.roster_invitations FOR ALL USING ((invitee_user_id = auth.uid()) OR (inviter_id = auth.uid()) OR (EXISTS (SELECT 1 FROM rosters r WHERE r.id = roster_invitations.roster_id AND r.user_id = auth.uid()))) WITH CHECK ((invitee_user_id = auth.uid()) OR (inviter_id = auth.uid()) OR (EXISTS (SELECT 1 FROM rosters r WHERE r.id = roster_invitations.roster_id AND r.user_id = auth.uid())));
CREATE POLICY roster_players_owner_write ON public.roster_players FOR ALL USING ((EXISTS (SELECT 1 FROM rosters r WHERE r.id = roster_players.roster_id AND r.user_id = auth.uid())) OR (user_id = auth.uid())) WITH CHECK ((EXISTS (SELECT 1 FROM rosters r WHERE r.id = roster_players.roster_id AND r.user_id = auth.uid())) OR (user_id = auth.uid()));
CREATE POLICY roster_players_read ON public.roster_players FOR SELECT USING ((EXISTS (SELECT 1 FROM rosters r WHERE r.id = roster_players.roster_id AND ((r.visibility = 'public') OR (r.user_id = auth.uid())))) OR (user_id = auth.uid()));
CREATE POLICY rosters_owner_write ON public.rosters FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY rosters_public_read ON public.rosters FOR SELECT USING ((visibility = 'public') OR (user_id = auth.uid()));
CREATE POLICY scout_logs_insert_own ON public.scout_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY scout_logs_select_own ON public.scout_logs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "shared_demos owner insert" ON public.shared_demos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "shared_demos public read" ON public.shared_demos FOR SELECT USING (true);
CREATE POLICY stripe_webhook_events_deny_clients ON public.stripe_webhook_events FOR ALL USING (false);
CREATE POLICY subscription_events_deny_clients ON public.subscription_events FOR ALL USING (false);
CREATE POLICY subscriptions_select_own ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "User reads own feedback" ON public.user_feedback FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Delete watchlist perso" ON public.watchlist FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Insert watchlist perso" ON public.watchlist FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Watchlist perso" ON public.watchlist FOR ALL USING (auth.uid() = user_id);

-- ── 7. Notes (NON inclus dans ce dump) ───────────────────────────────────
--
-- Ce dump ne capture PAS :
--   - Functions / triggers : ex. handle_new_user(), update_updated_at_column()
--   - Views materialisees
--   - Sequences (auto-creees par les SERIAL/bigint columns)
--   - Grants / roles
--   - Cron job definitions (gerees par Vercel cron, pas pg_cron)
--   - Storage buckets RLS (gerees via Supabase dashboard)
--
-- Pour avoir le dump VRAIMENT complet :
--
--   supabase db dump --schema public --file supabase-prod-schema-full.sql
--
-- (necessite supabase login + supabase link --project-ref xmyruycvvkmcwysfygcq)
--
-- ─────────────────────────────────────────────────────────────────────────
