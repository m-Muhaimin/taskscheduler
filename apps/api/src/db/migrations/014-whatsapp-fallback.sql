-- ==============================================================================
-- Migration 014: Outbound message ledger (T17 Phase C) — SMS only.
-- ------------------------------------------------------------------------------
-- This migration creates the rl_outbound_messages ledger table used by the
-- delivery-tracking surface on the Messages page. The product is SMS only, so
-- the ledger is SMS only.
--
--   1. rl_outbound_messages — an outbound-message ledger for SMS. One row per
--      tracked outbound SMS with the Twilio MessageSid and delivery status.
--      The Twilio StatusCallback reports on this table.
--
--   2. rl_customers.sms_opted_in / sms_opted_in_at — SMS consent flag. The
--      consent hard rule (never send an SMS without a logged consent record)
--      is enforced in sendSms (services/sms-service.ts), which reads the flag
--      through consent-service before it writes a ledger row or calls Twilio.
--      services/consent-service.ts is the single record/lookup authority for
--      the pair: recordSmsOptIn sets both columns together, hasSmsOptIn reads
--      sms_opted_in.
--
-- Idempotent like every migration here: db-migrate.mjs re-applies its whole
-- list on every run (there is no migration-ledger table, so nothing records
-- that a file already ran), and local-db.mjs re-applies its list the same way
-- — but its list stops at 012, so 013 and 014 are not applied there.
--
-- ⚠ IF YOU APPLIED THE PRE-CLEANUP VERSION OF 014
--   This file IS re-run on an existing database. db-migrate.mjs applies every
--   file on every invocation (only an existsSync skip for a missing file — no
--   migration-ledger table, no "already applied" skip), and render.yaml runs
--   `npm run db:migrate` on every API start and every worker start. Editing
--   this file in place therefore reaches existing databases, not only fresh
--   ones. On a database that ran the pre-cleanup 014, a re-run does the
--   following:
--
--   - It REPLACES both ledger CHECK constraints. Each is a
--     `drop constraint if exists` + `add constraint` pair, so the re-run
--     re-asserts both. rl_outbound_messages_status_check keeps the same
--     seven values the pre-cleanup 014 wrote — this cleanup never changed
--     that CHECK — while rl_outbound_messages_channel_check loses
--     'whatsapp' and is left with ('sms') only. That is the one old
--     constraint this file can repair.
--
--   - It REJECTS such a database if any row still says channel='whatsapp'.
--     Postgres validates a new CHECK against existing rows, so the
--     `add constraint` fails and the migration does not complete. Check for
--     those rows before deploying:
--       select count(*) from public.rl_outbound_messages where channel <> 'sms';
--     db-migrate.mjs sends the whole file as one multi-statement simple
--     query, so Postgres runs it in a single implicit transaction: the
--     failure rolls this migration back whole and the script exits non-zero
--     (014 is the last entry in its MIGRATIONS list, so nothing after it runs
--     either). The `&&` in the render.yaml start commands (API and worker)
--     then short-circuits and the service does not start.
--
--   - It does NOT repair the conversation channel. The pre-cleanup 014 also
--     widened the channel CHECK on rl_conversations to
--     ('sms', 'voice', 'web', 'whatsapp'), and added the columns
--     rl_customers.whatsapp_opted_in / whatsapp_opted_in_at. THIS FILE
--     CONTAINS NO STATEMENT ABOUT EITHER, so a database that applied the old
--     014 keeps that widened CHECK and those columns indefinitely — no
--     re-run of this file removes them.
--
--   That is why an existing environment needs a real follow-up migration 015
--   to undo the conversation-channel widening: this file has no statement
--   that could. 015 is NOT part of this change; it is tracked as follow-up
--   F8 in docs/tasks/sms-only-cleanup/PLAN.md. Dev and CI databases are
--   disposable and can simply be dropped and rebuilt.
--
-- ⚠ The filename still says "whatsapp" for historical reasons. It is kept so
--   the migration lists in apps/api/scripts/db-migrate.mjs and
--   supabase/schema.sql resolve. Nothing in this file is WhatsApp-related.
-- ==============================================================================

-- 1. Outbound message ledger (SMS only).
create table if not exists public.rl_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.rl_organizations (id),
  customer_id uuid references public.rl_customers (id),
  to_phone text not null,                 -- bare E.164
  body text not null,
  channel text not null default 'sms',    -- 'sms' only — SMS-only product
  message_sid text unique,                -- Twilio MessageSid; NULL until sent
  kind text,                              -- outbound kind (e.g. 'reschedule_offer'); set when the caller supplies one, else NULL
  status text not null default 'queued',  -- see CHECK below
  error_code text,                        -- Twilio ErrorCode on delivery failure (NULL otherwise)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rl_outbound_messages is
  'Ledger of outbound SMS messages (T17 Phase C: the Twilio StatusCallback reports on this table)';

alter table public.rl_outbound_messages
  drop constraint if exists rl_outbound_messages_channel_check,
  add constraint rl_outbound_messages_channel_check check (channel in ('sms'));

alter table public.rl_outbound_messages
  drop constraint if exists rl_outbound_messages_status_check,
  add constraint rl_outbound_messages_status_check check (status in (
    'queued', 'sent', 'delivered', 'failed', 'retried', 'escalated', 'blocked_optin'
  ));

create index if not exists rl_outbound_messages_org_created_idx
  on public.rl_outbound_messages (organization_id, created_at desc);

create index if not exists rl_outbound_messages_phone_idx
  on public.rl_outbound_messages (to_phone);

-- deny-by-default: no anon/authenticated access (007 convention). Service role
-- (or the API's own connection) writes/reads this table; client never does.
alter table public.rl_outbound_messages enable row level security;
revoke all on public.rl_outbound_messages from anon, authenticated;

-- 2. SMS consent storage on customers.
alter table public.rl_customers
  add column if not exists sms_opted_in boolean not null default false;

alter table public.rl_customers
  add column if not exists sms_opted_in_at timestamptz;

comment on column public.rl_customers.sms_opted_in is
  'Customer consented to SMS messaging (T17 Phase C: never send without this set)';
