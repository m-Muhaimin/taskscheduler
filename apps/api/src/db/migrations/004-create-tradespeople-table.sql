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
