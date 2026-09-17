-- ============================================================================
-- tradescheduler (prefix TS) — jobs table (build-sequence.md Step 4)
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/TS/TS_001_000_jobs_table.sql
-- In the muhai-shared Supabase project every table is public.<PREFIX>_<name>
-- (here ts_jobs) — see ~/.supabase/projects.json.
-- ============================================================================

create table if not exists public.ts_jobs (
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

comment on table public.ts_jobs is
  'tradescheduler queue backbone — internal, server-only access (RLS deny-by-default)';

create index if not exists ts_jobs_status_created_idx
  on public.ts_jobs (status, created_at);

alter table public.ts_jobs enable row level security;
revoke all on public.ts_jobs from anon, authenticated;
