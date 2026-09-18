-- ============================================================================
-- tradescheduler (prefix TS) — customer + conversation domain (Checkpoint 03)
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/TS/TS_007_000_customer_conversation_tables.sql
-- In the muhai-shared Supabase project every table is public.<PREFIX>_<name>
-- (here ts_customers, ts_conversations, ts_messages) — see ~/.supabase/projects.json.
--
-- Implements docs/spec-customer-conversation-domain.md schema section C,
-- with repo-convention ts_ prefixes. Also adds ts_conversation_states.conversation_id
-- (spec D3) linking the reschedule state to the conversation domain.
--
-- NOTE: body is NULLABLE on ts_messages (spec C6 — voice-before-transcript).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------

create table if not exists public.ts_customers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null
                  references public.ts_organizations(id) on delete cascade,
  name            text,
  phone           text not null
                  check (phone ~ '^\+?[1-9][0-9]{1,14}$'),
  email           text
                  check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.ts_customers is
  'customers — internal, server-only access (RLS deny-by-default)';

alter table public.ts_customers
  add constraint ts_customers_org_phone_key unique (organization_id, phone);

create index if not exists ts_customers_org_idx
  on public.ts_customers (organization_id);

alter table public.ts_customers enable row level security;
revoke all on public.ts_customers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- customer_addresses
-- ---------------------------------------------------------------------------

create table if not exists public.ts_customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null
              references public.ts_customers(id) on delete cascade,
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

comment on table public.ts_customer_addresses is
  'customer service addresses — internal, server-only access (RLS deny-by-default)';

create unique index if not exists ts_customer_addresses_customer_label_idx
  on public.ts_customer_addresses (customer_id, label);

alter table public.ts_customer_addresses enable row level security;
revoke all on public.ts_customer_addresses from anon, authenticated;

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------

create table if not exists public.ts_conversations (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null
                     references public.ts_organizations(id) on delete cascade,
  customer_id        uuid not null
                     references public.ts_customers(id) on delete cascade,
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

comment on table public.ts_conversations is
  'conversation domain — internal, server-only access (RLS deny-by-default)';

create index if not exists ts_conversations_org_status_updated_idx
  on public.ts_conversations (organization_id, status, updated_at);

create index if not exists ts_conversations_customer_idx
  on public.ts_conversations (customer_id);

alter table public.ts_conversations enable row level security;
revoke all on public.ts_conversations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

create table if not exists public.ts_messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null
                      references public.ts_conversations(id) on delete cascade,
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

comment on table public.ts_messages is
  'conversation messages — internal, server-only access (RLS deny-by-default)';

create index if not exists ts_messages_conversation_created_idx
  on public.ts_messages (conversation_id, created_at);

create index if not exists ts_messages_provider_message_idx
  on public.ts_messages (provider, provider_message_id);

alter table public.ts_messages enable row level security;
revoke all on public.ts_messages from anon, authenticated;

-- ---------------------------------------------------------------------------
-- D3: link reschedule state rows to the conversation domain
-- ---------------------------------------------------------------------------

alter table public.ts_conversation_states
  add column if not exists conversation_id uuid
  references public.ts_conversations(id) on delete set null;
