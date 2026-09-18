-- ==============================================================================
-- tradescheduler (prefix TS) — escalations table (build-sequence.md Step 6)
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/TS/TS_002_000_escalations_table.sql
-- In the muhai-shared Supabase project every table is public.<PREFIX>_<name>
-- (here ts_escalations) — see ~/.supabase/projects.json.
-- ============================================================================

create table if not exists public.ts_escalations (
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

comment on table public.ts_escalations is
  'tradescheduler escalations — unresolved operational issues surfaced by the worker (RLS deny-by-default)';

create index if not exists ts_escalations_status_created_idx
  on public.ts_escalations (status, created_at);

alter table public.ts_escalations enable row level security;
revoke all on public.ts_escalations from anon, authenticated;
