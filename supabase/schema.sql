-- ============================================================================
-- tradescheduler (RidgeLine) — COMPLETE SCHEMA, all-in-one (RL prefix)
-- ============================================================================
-- Target : Supabase project ref wxdykoarmieneynvfz (muhai-shared, us-west-1)
-- Purpose: create the FULL tradescheduler schema in one paste into the
--          Supabase SQL editor. Safe to re-run — every statement is
--          idempotent (IF NOT EXISTS / add column if not exists / drop+add).
-- Build  : verbatim concatenation of apps/api/src/db/migrations/001..009
--          (rl_ prefix, matches git HEAD 20bb9cf + cba5256). Running this on
--          a fresh project reproduces exactly the state of the live project.
-- Expect : 15 public tables: rl_jobs, rl_escalations, rl_conversation_states,
--          rl_tradespeople, rl_ai_usage, rl_organizations,
--          rl_organization_members, rl_twilio_numbers, rl_customers,
--          rl_customer_addresses, rl_conversations, rl_messages,
--          rl_appointments, rl_google_credentials, rl_oauth_states.
--          ALL tables: RLS enabled + anon/authenticated revoked
--          (server-only/back-end access; not exposed via the Data API).
-- Order  : 001→009 dependency order (orgs → customers → conversations →
--          appointments → google oauth).
-- ============================================================================

-- ============================================================================
-- tradescheduler (prefix RL) — jobs table (build-sequence.md Step 4)
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/RL/RL_001_000_jobs_table.sql
-- In the muhai-shared Supabase project every table is public.<PREFIX>_<name>
-- (here rl_jobs) — see ~/.supabase/projects.json.
-- ============================================================================

create table if not exists public.rl_jobs (
  id         uuid primary key default gen_random_uuid(),
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  status     text not null default 'pending'
             check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts   integer not null default 0,
  locked_at  timestamptz,
  locked_by  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rl_jobs is
  'tradescheduler queue backbone — internal, server-only access (RLS deny-by-default)';

create index if not exists rl_jobs_status_created_idx
  on public.rl_jobs (status, created_at);

alter table public.rl_jobs enable row level security;
revoke all on public.rl_jobs from anon, authenticated;
-- ==============================================================================
-- tradescheduler (prefix RL) — escalations table (build-sequence.md Step 6)
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/RL/RL_002_000_escalations_table.sql
-- In the muhai-shared Supabase project every table is public.<PREFIX>_<name>
-- (here rl_escalations) — see ~/.supabase/projects.json.
-- ============================================================================

create table if not exists public.rl_escalations (
  id         uuid primary key default gen_random_uuid(),
  type       text not null
             check (type in (
               'ambiguous_intent',
               'no_availability',
               'calendar_api_failure',
               'sms_delivery_failure',
               'processing_error'
             )),
  customer_phone  text not null,
  content    text,
  status     text not null default 'pending'
             check (status in ('pending', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

comment on table public.rl_escalations is
  'tradescheduler escalations — unresolved operational issues surfaced by the worker (RLS deny-by-default)';

create index if not exists rl_escalations_status_created_idx
  on public.rl_escalations (status, created_at);

alter table public.rl_escalations enable row level security;
revoke all on public.rl_escalations from anon, authenticated;
/**
 * Migration 003: conversation_states table (build-sequence.md Step 7).
 *
 * Follows the same conventions as 001/002:
 * - Table name: public.rl_conversation_states (RL prefix)
 * - RLS enabled, anon+authenticated revoked (server-only access).
 */

-- ============================================================================
-- tradescheduler (prefix RL) — conversation_states table
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/RL/RL_003_000_conversation_states_table.sql
-- ============================================================================

create table if not exists public.rl_conversation_states (
  id               uuid primary key default gen_random_uuid(),

  phone            text not null,              -- customer phone, E.164
  user_id          uuid not null,              -- tradesperson UUID
  booking_id       uuid,                       -- booking being rescheduled; null when N/A

  state            text not null
                   check (state in (
                     'offering_slots',
                     'awaiting_slot_choice',
                     'completed',
                     'escalated'
                   )),

  -- The 3 slots offered to the customer (JSONB; shape = OfferedSlot[]).
  offered_slots    jsonb,

  -- The slot the customer picked (JSONB; shape = OfferedSlot).
  selected_slot    jsonb,

  -- Why the flow escalated, if applicable.
  escalation_reason text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz                 -- set when state = 'completed'; null otherwise
);

comment on table public.rl_conversation_states is
  'In-flight SMS conversation state for reschedule flows (RLS deny-by-default)';

create index if not exists rl_conversation_states_phone_idx
  on public.rl_conversation_states (phone);

create index if not exists rl_conversation_states_state_created_idx
  on public.rl_conversation_states (state, created_at);

alter table public.rl_conversation_states enable row level security;
revoke all on public.rl_conversation_states from anon, authenticated;
-- ============================================================================
-- tradescheduler (prefix RL) — tradespeople table (dashboard JWT auth)
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/RL/RL_004_000_tradespeople_table.sql
-- In the muhai-shared Supabase project every table is public.<PREFIX>_<name>
-- (here rl_tradespeople) — see ~/.supabase/projects.json.
--
-- Auth model (PRD "JWT auth for tradesperson dashboard"):
--   email + password  ->  scrypt hash stored here; JWT signed on success.
-- One row per tradesperson account. The dashboard's richer profile
-- (User: phone, calendar, hours, sms settings) stays in fixtures for now
-- and is NOT this table's job — this is purely the identity/credential row.
-- ============================================================================

create table if not exists public.rl_tradespeople (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique
                check (email = lower(email)),
  password_hash text not null,
  display_name  text not null
                check (length(display_name) between 1 and 80),
  created_at    timestamptz not null default now()
);

comment on table public.rl_tradespeople is
  'tradescheduler auth identities — internal, server-only access (RLS deny-by-default)';

create unique index if not exists rl_tradespeople_email_idx
  on public.rl_tradespeople (email);

alter table public.rl_tradespeople enable row level security;
revoke all on public.rl_tradespeople from anon, authenticated;
-- ============================================================================
-- tradescheduler (prefix RL) — ai_usage table (Checkpoint 01 §3 cost tracking)
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/RL/RL_005_000_ai_usage_table.sql
-- In the muhai-shared Supabase project every table is public.<PREFIX>_<name>
-- (here rl_ai_usage) — see ~/.supabase/projects.json.
-- ============================================================================

create table if not exists public.rl_ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  request_id         text not null,
  provider           text not null,
  model              text not null,
  tokens_input       integer not null,
  tokens_output      integer not null,
  estimated_cost_usd numeric(10,6) not null default 0,
  source             text not null default 'llm'
                     check (source in ('llm', 'merged')),
  created_at         timestamptz not null default now()
);

comment on table public.rl_ai_usage is
  'per-LLM-call usage + cost ledger — internal, server-only access (RLS deny-by-default)';

create index if not exists rl_ai_usage_created_idx
  on public.rl_ai_usage (created_at desc);

create index if not exists rl_ai_usage_request_idx
  on public.rl_ai_usage (request_id);

alter table public.rl_ai_usage enable row level security;
revoke all on public.rl_ai_usage from anon, authenticated;
-- ============================================================================
-- tradescheduler (prefix RL) — organizations + organization_members (Checkpoint 02)
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/RL/RL_006_000_organizations_table.sql
-- In the muhai-shared Supabase project every table is public.<PREFIX>_<name>
-- (here rl_organizations) — see ~/.supabase/projects.json.
--
-- Tenant model (PRD Checkpoint 02):
--   replaces single-tradesperson identity with organizations + members
--   (OWNER / STAFF / TECHNICIAN). rl_tradespeople stays as the identity /
--   credential row; rl_organization_members links a tradesperson to an org.
--   rl_twilio_numbers maps an inbound Twilio number to its org — the
--   resolution path for inbound SMS (CP03 spec H.2).
-- ============================================================================

create table if not exists public.rl_organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null
             check (length(name) between 1 and 120),
  slug       text not null unique
             check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  timezone   text not null default 'America/New_York',
  status     text not null default 'active'
             check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rl_organizations is
  'tenant root — internal, server-only access (RLS deny-by-default)';

create unique index if not exists rl_organizations_slug_idx
  on public.rl_organizations (slug);

alter table public.rl_organizations enable row level security;
revoke all on public.rl_organizations from anon, authenticated;

-- ============================================================================
-- RL_010 addendum — org-scoped ai_usage + per-org settings (mirror of
--   ~/.supabase/migrations/RL/RL_010_000_ai_usage_org_org_settings.sql)
-- Adds rl_ai_usage.organization_id (FK → rl_organizations, on delete cascade;
-- nullable so pre-org rows keep working) + (organization_id, created_at) index,
-- and rl_organizations.settings (jsonb, default '{}'). Idempotent.
-- ============================================================================

alter table public.rl_ai_usage
  add column if not exists organization_id uuid
  references public.rl_organizations(id) on delete cascade;

create index if not exists rl_ai_usage_org_created_idx
  on public.rl_ai_usage (organization_id, created_at desc);

alter table public.rl_organizations
  add column if not exists settings jsonb not null default '{}'::jsonb;

comment on table public.rl_ai_usage is
  'per-LLM-call usage + cost ledger, org-scoped via organization_id — internal, server-only access (RLS deny-by-default)';

comment on table public.rl_organizations is
  'tenant root with per-org settings jsonb — internal, server-only access (RLS deny-by-default)';

-- ---------------------------------------------------------------------------
-- organization_members — links rl_tradespeople identities to an org.
-- ---------------------------------------------------------------------------

create table if not exists public.rl_organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null
                  references public.rl_organizations(id) on delete cascade,
  user_id         uuid not null
                  references public.rl_tradespeople(id) on delete cascade,
  role            text not null
                  check (role in ('OWNER', 'STAFF', 'TECHNICIAN')),
  created_at      timestamptz not null default now()
);

comment on table public.rl_organization_members is
  'org membership — internal, server-only access (RLS deny-by-default)';

create unique index if not exists rl_organization_members_org_user_idx
  on public.rl_organization_members (organization_id, user_id);

create index if not exists rl_organization_members_user_idx
  on public.rl_organization_members (user_id);

alter table public.rl_organization_members enable row level security;
revoke all on public.rl_organization_members from anon, authenticated;

-- ---------------------------------------------------------------------------
-- twilio_numbers — inbound Twilio number → org resolution (CP03 spec H.2).
-- ---------------------------------------------------------------------------

create table if not exists public.rl_twilio_numbers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null
                  references public.rl_organizations(id) on delete cascade,
  phone           text not null unique
                  check (phone ~ '^\+?[1-9][0-9]{1,14}$'),
  created_at      timestamptz not null default now()
);

comment on table public.rl_twilio_numbers is
  'Twilio number → org mapping — internal, server-only access (RLS deny-by-default)';

create unique index if not exists rl_twilio_numbers_phone_idx
  on public.rl_twilio_numbers (phone);

alter table public.rl_twilio_numbers enable row level security;
revoke all on public.rl_twilio_numbers from anon, authenticated;
-- ============================================================================
-- tradescheduler (prefix RL) — customer + conversation domain (Checkpoint 03)
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/RL/RL_007_000_customer_conversation_tables.sql
-- In the muhai-shared Supabase project every table is public.<PREFIX>_<name>
-- (here rl_customers, rl_conversations, rl_messages) — see ~/.supabase/projects.json.
--
-- Implements docs/spec-customer-conversation-domain.md schema section C,
-- with repo-convention rl_ prefixes. Also adds rl_conversation_states.conversation_id
-- (spec D3) linking the reschedule state to the conversation domain.
--
-- NOTE: body is NULLABLE on rl_messages (spec C6 — voice-before-transcript).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------

create table if not exists public.rl_customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null
                  references public.rl_organizations(id) on delete cascade,
  name            text,
  phone           text not null
                  check (phone ~ '^\+?[1-9][0-9]{1,14}$'),
  email           text
                  check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.rl_customers is
  'customers — internal, server-only access (RLS deny-by-default)';

alter table public.rl_customers
  drop constraint if exists rl_customers_org_phone_key,
  add constraint rl_customers_org_phone_key unique (organization_id, phone);

create index if not exists rl_customers_org_idx
  on public.rl_customers (organization_id);

alter table public.rl_customers enable row level security;
revoke all on public.rl_customers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- customer_addresses
-- ---------------------------------------------------------------------------

create table if not exists public.rl_customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null
              references public.rl_customers(id) on delete cascade,
  label       text not null
              check (length(label) between 1 and 120),
  line1       text not null,
  line2       text,
  city        text,
  state       text,
  postal_code text,
  country     text not null default 'US',
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.rl_customer_addresses is
  'customer service addresses — internal, server-only access (RLS deny-by-default)';

create unique index if not exists rl_customer_addresses_customer_label_idx
  on public.rl_customer_addresses (customer_id, label);

alter table public.rl_customer_addresses enable row level security;
revoke all on public.rl_customer_addresses from anon, authenticated;

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------

create table if not exists public.rl_conversations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null
                     references public.rl_organizations(id) on delete cascade,
  customer_id        uuid not null
                     references public.rl_customers(id) on delete cascade,
  channel            text not null
                     check (channel in ('sms', 'voice', 'web')),
  status             text not null default 'open'
                     check (status in ('open', 'closed', 'escalated')),
  intent             text,
  current_state      text not null default 'new',
  assigned_user_id   uuid,
  missing_information jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  closed_at          timestamptz
);

comment on table public.rl_conversations is
  'conversation domain — internal, server-only access (RLS deny-by-default)';

create index if not exists rl_conversations_org_status_updated_idx
  on public.rl_conversations (organization_id, status, updated_at);

create index if not exists rl_conversations_customer_idx
  on public.rl_conversations (customer_id);

alter table public.rl_conversations enable row level security;
revoke all on public.rl_conversations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

create table if not exists public.rl_messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null
                      references public.rl_conversations(id) on delete cascade,
  provider            text not null
                      check (provider in ('twilio', 'manual')),
  provider_message_id text,
  direction           text not null
                      check (direction in ('inbound', 'outbound')),
  body                text,          -- nullable: voice-before-transcript (C6)
  status              text not null default 'received'
                      check (status in ('queued', 'sent', 'delivered', 'failed', 'received')),
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

comment on table public.rl_messages is
  'conversation messages — internal, server-only access (RLS deny-by-default)';

create index if not exists rl_messages_conversation_created_idx
  on public.rl_messages (conversation_id, created_at);

create index if not exists rl_messages_provider_message_idx
  on public.rl_messages (provider, provider_message_id);

alter table public.rl_messages enable row level security;
revoke all on public.rl_messages from anon, authenticated;

-- ---------------------------------------------------------------------------
-- D3: link reschedule state rows to the conversation domain
-- ---------------------------------------------------------------------------

alter table public.rl_conversation_states
  add column if not exists conversation_id uuid
  references public.rl_conversations(id) on delete set null;
/**
 * Migration 008: appointments table (CP04 booking domain) +
 * tradesperson profile columns for the real user lookup.
 *
 * Convention: public.<PREFIX>_<name> (rl_ prefix), RLS deny-by-default,
 * server-only access. Follows 001-007 style.
 */

-- ============================================================================
-- rl_appointments — the Booking entity (PRD §Data Model Changes, spec §3)
-- ============================================================================
create table if not exists public.rl_appointments (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.rl_organizations (id) on delete cascade,
  user_id                 uuid not null references public.rl_tradespeople (id) on delete cascade,
  customer_phone          text not null check (customer_phone ~ '^\+?[1-9][0-9]{1,14}$'),
  customer_name           text,
  service_description     text,
  start_time              timestamptz not null,
  end_time                timestamptz not null,
  status                  text not null default 'pending'
                          check (status in ('pending', 'confirmed', 'rescheduled')),
  deposit_amount          numeric(10, 2),
  deposit_status          text not null default 'pending'
                          check (deposit_status in ('pending', 'paid', 'failed')),
  google_calendar_event_id text,
  rescheduled_from_id     uuid references public.rl_appointments (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.rl_appointments is
  'Booking/appointment domain for the reschedule flow (RLS deny-by-default)';

-- findBookingByPhone: most recent appointment for a customer.
create index if not exists rl_appointments_org_phone_start_idx
  on public.rl_appointments (organization_id, customer_phone, start_time desc);

-- join on user profile lookups.
create index if not exists rl_appointments_org_user_idx
  on public.rl_appointments (organization_id, user_id);

alter table public.rl_appointments enable row level security;
revoke all on public.rl_appointments from anon, authenticated;

-- ============================================================================
-- rl_tradespeople: add nullable profile columns so userLookupFn can read real
-- identity data (CP04 spec: "Get user (tradesperson)" - calendar, hours, SMS).
-- All nullable - old rows keep working; no backfill.
-- ============================================================================
alter table public.rl_tradespeople
  add column if not exists phone_number            text
        check (phone_number ~ '^\+?[1-9][0-9]{1,14}$'),
  add column if not exists google_calendar_id      text,
  add column if not exists business_hours          jsonb,
  add column if not exists sms_reschedule_template text;
-- Migration 009: Real Google OAuth wiring.
-- Stores per-tradesperson Google OAuth tokens (replaces the interim
-- GOOGLE_REFRESH_TOKEN_<userId> env-var approach) plus one-time consent
-- states for the auth-code flow. Idempotent: local-db.mjs re-applies all
-- migrations on every boot.

create table if not exists public.rl_google_credentials (
  user_id       uuid primary key references public.rl_tradespeople (id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  token_expiry  timestamptz,
  scope         text,
  calendar_id   text,
  updated_at    timestamptz not null default now()
);

comment on table public.rl_google_credentials is
  'Google OAuth tokens per tradesperson (refreshed by googleapis on demand).';

create table if not exists public.rl_oauth_states (
  state      text primary key,
  user_id    uuid not null references public.rl_tradespeople (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.rl_oauth_states is
  'One-time OAuth consent states; rows expire after 10 minutes and are deleted on use.';

create index if not exists rl_oauth_states_expires_idx
  on public.rl_oauth_states (expires_at);

-- RLS: deny-by-default (same convention as migrations 001-008; the API
-- connects as the service/owner role, not as anon/authenticated).
alter table public.rl_google_credentials enable row level security;
alter table public.rl_oauth_states enable row level security;
revoke all on public.rl_google_credentials from anon, authenticated;
revoke all on public.rl_oauth_states from anon, authenticated;

-- ============================================================================
-- VERIFICATION — run after executing the schema (expect 15 rl_* tables)
-- ============================================================================
select tablename
from pg_tables
where schemaname = 'public' and tablename like 'rl_%'
order by 1;

-- Spot-check RLS (expect relrowsecurity = t on every rl_ table):
select relname, relrowsecurity from pg_class
where relnamespace = 'public'::regnamespace and relname like 'rl_%'
order by relname;
