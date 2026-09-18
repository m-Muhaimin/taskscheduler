-- Migration 009: Real Google OAuth wiring.
-- Stores per-tradesperson Google OAuth tokens (replaces the interim
-- GOOGLE_REFRESH_TOKEN_<userId> env-var approach) plus one-time consent
-- states for the auth-code flow. Idempotent: local-db.mjs re-applies all
-- migrations on every boot.

create table if not exists public.ts_google_credentials (
  user_id       uuid primary key references public.ts_tradespeople (id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  token_expiry  timestamptz,
  scope         text,
  calendar_id   text,
  updated_at    timestamptz not null default now()
);

comment on table public.ts_google_credentials is
  'Google OAuth tokens per tradesperson (refreshed by googleapis on demand).';

create table if not exists public.ts_oauth_states (
  state      text primary key,
  user_id    uuid not null references public.ts_tradespeople (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.ts_oauth_states is
  'One-time OAuth consent states; rows expire after 10 minutes and are deleted on use.';

create index if not exists ts_oauth_states_expires_idx
  on public.ts_oauth_states (expires_at);

-- RLS: deny-by-default (same convention as migrations 001-008; the API
-- connects as the service/owner role, not as anon/authenticated).
alter table public.ts_google_credentials enable row level security;
alter table public.ts_oauth_states enable row level security;
revoke all on public.ts_google_credentials from anon, authenticated;
revoke all on public.ts_oauth_states from anon, authenticated;
