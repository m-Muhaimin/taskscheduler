-- Migration 011: per-flow confirmation codes on rl_conversation_states (T15).
-- Sensitive intents (confirm / new-booking finalization) now require a one-shot
-- 6-digit code: the worker issues a code (persisted as a sha256 HASH only —
-- never the plaintext) with a 10-minute TTL, requires the customer to reply it,
-- and only then proceeds to the calendar mutation. Adds the
-- 'awaiting_confirmation_code' state (the strict CHECK from migration 003 is
-- widened below) plus the per-conversation code columns.
--
-- Idempotent (add column if not exists / drop-if-exists + re-add CHECK):
-- local-db.mjs re-applies all migrations on every boot. Widening a CHECK does
-- NOT rewrite existing rows — every row currently in one of the four legacy
-- states is still valid under the widened constraint, so no backfill is needed.
--
-- RLS untouched: rl_conversation_states is already deny-by-default (migration
-- 003); the API connects as the service/owner role, not anon/authenticated.

-- widen rl_conversation_states.state CHECK to include the new awaiting state
alter table public.rl_conversation_states
  drop constraint if exists rl_conversation_states_state_check,
  add constraint rl_conversation_states_state_check check (
    state in ('offering_slots','awaiting_slot_choice','awaiting_confirmation_code','completed','escalated')
  );

-- per-conversation one-shot code
alter table public.rl_conversation_states
  add column if not exists confirmation_code text,
  add column if not exists confirmation_code_hash text,        -- sha256 of code (don't store plaintext)
  add column if not exists confirmation_code_expires_at timestamptz,
  add column if not exists confirmation_attempts int not null default 0;