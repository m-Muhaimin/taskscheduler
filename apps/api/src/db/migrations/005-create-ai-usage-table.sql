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
