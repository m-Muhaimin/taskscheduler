-- ==============================================================================
-- Migration 014: WhatsApp fallback channel plumbing (T17 Phase B)
-- ------------------------------------------------------------------------------
-- The WhatsApp fallback ENGINE (delivery-failure detection + auto-retry over
-- WhatsApp) is a later phase. Phase B only ships the PLUMBING the engine will
-- stand on:
--
--   1. rl_outbound_messages — an outbound-message ledger shared by ALL
--      channels (sms + whatsapp). Phase C+ consumers append one row per
--      outbound SMS/WhatsApp with the Twilio MessageSid and delivery status.
--      The engine later polls this table for failed deliveries. Columns are
--      deliberately engine-shaped (message_sid UNIQUE, status CHECK ); the
--      ledger WRITE points (sendSms) are Phase C.
--
--   2. rl_customers.whatsapp_opted_in / whatsapp_opted_in_at — consent flag
--      (opt-in moment) for WhatsApp fallback delivery. STORAGE ONLY in Phase B:
--      opt-in WRITE points ship with the engine; the consumer-facing policy
--      (never fall back without an explicit opt-in) is already baked into the
--      shared README hard-rules so later phases cannot forget it.
--
--   3. rl_conversations.channel CHECK widened sms|voice|web -> + whatsapp, so
--      the worker can record WhatsApp conversations with channel='whatsapp'.
--      Mirrors 012's widening style: drop + re-add the constraint (renamed
--      auto-name rl_conversations_channel_check), no existing rows rewritten.
--
-- Idempotent like every migration here (local-db.mjs re-applies all on boot).
-- 007 created rl_conversations with an UNNAMED inline CHECK on channel, so
-- Postgres auto-named it rl_conversations_channel_check; the drop below must
-- carry that exact auto-derived name.
-- ============================================================================

-- 1. Outbound message ledger (all channels; engine-shaped for Phase D).
create table if not exists public.rl_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.rl_organizations (id),
  customer_id uuid references public.rl_customers (id),
  to_phone text not null,                 -- bare E.164 (no whatsapp: prefix)
  body text not null,
  channel text not null default 'sms',    -- 'sms' | 'whatsapp'
  message_sid text unique,                -- Twilio MessageSid; NULL until sent
  kind text,                              -- outbound kind (e.g. 'reschedule_offer'); NULL until Phase D writes
  status text not null default 'queued',  -- see CHECK below
  error_code text,                        -- Twilio ErrorCode on delivery failure (NULL otherwise)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.rl_outbound_messages is
  'Ledger of outbound SMS/WhatsApp messages (T17 Phase B + D: delivery-failure fallback engine reads this table)';

alter table public.rl_outbound_messages
  drop constraint if exists rl_outbound_messages_channel_check,
  add constraint rl_outbound_messages_channel_check check (channel in ('sms', 'whatsapp'));

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

-- 2. WhatsApp consent storage on customers (write points are Phase D).
alter table public.rl_customers
  add column if not exists whatsapp_opted_in boolean not null default false;

alter table public.rl_customers
  add column if not exists whatsapp_opted_in_at timestamptz;

comment on column public.rl_customers.whatsapp_opted_in is
  'Customer consented to WhatsApp fallback delivery (T17 Phase D writes; Phase B storage only — never fall back without this set)';

-- 3. Widen the conversation channel CHECK (007 inline check was auto-named
-- rl_conversations_channel_check).
alter table public.rl_conversations
  drop constraint if exists rl_conversations_channel_check,
  add constraint rl_conversations_channel_check check (channel in ('sms', 'voice', 'web', 'whatsapp'));