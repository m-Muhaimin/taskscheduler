/**
 * Migration 003: conversation_states table (build-sequence.md Step 7).
 *
 * Follows the same conventions as 001/002:
 * - Table name: public.ts_conversation_states (TS prefix)
 * - RLS enabled, anon+authenticated revoked (server-only access).
 */

-- ============================================================================
-- tradescheduler (prefix TS) — conversation_states table
-- REPO COPY of the share-ready migration applied via dbctl:
--   ~/.supabase/migrations/TS/TS_003_000_conversation_states_table.sql
-- ============================================================================

create table if not exists public.ts_conversation_states (
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

comment on table public.ts_conversation_states is
  'In-flight SMS conversation state for reschedule flows (RLS deny-by-default)';

create index if not exists ts_conversation_states_phone_idx
  on public.ts_conversation_states (phone);

create index if not exists ts_conversation_states_state_created_idx
  on public.ts_conversation_states (state, created_at);

alter table public.ts_conversation_states enable row level security;
revoke all on public.ts_conversation_states from anon, authenticated;
