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
