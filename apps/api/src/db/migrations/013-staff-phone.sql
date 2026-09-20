-- ==============================================================================
-- Migration 013: staff phone numbers + staff_sms escalation type (T16)
-- ------------------------------------------------------------------------------
-- Tradesperson phone matching: a nullable E.164 phone per tradesperson so the
-- worker can recognize when an inbound SMS From belongs to a staff member of
-- the resolved org and route it to the operator flow (escalation surface)
-- instead of the customer flow (no customer row / templating/classify).
--
-- Also widens rl_escalations.type CHECK with 'staff_sms' (mirrors 012's
-- widening style). Idempotent: local-db.mjs re-applies all migrations on boot;
-- the CHECK widening does NOT rewrite existing rows, every legacy type stays
-- valid.
-- ============================================================================

-- phone per tradesperson (nullable; a tradesperson is not required to have one)
alter table public.rl_tradespeople
  add column if not exists phone text;

-- enforce E.164 + uniqueness per person (shared-phone teams: revisit if needed)
alter table public.rl_tradespeople
  drop constraint if exists rl_tradespeople_phone_check,
  add constraint rl_tradespeople_phone_check check (
    phone is null or phone ~ '^\+?[1-9][0-9]{1,14}$'
  );

create unique index if not exists rl_tradespeople_phone_idx
  on public.rl_tradespeople (phone);

-- operator-flow escalation type ('staff_sms' — created when an inbound From
-- matches a staff member of the resolved org; surfaces on the existing
-- dashboard escalations list, no new UI).
alter table public.rl_escalations
  drop constraint if exists rl_escalations_type_check,
  add constraint rl_escalations_type_check check (type in (
    'ambiguous_intent', 'no_availability', 'calendar_api_failure',
    'sms_delivery_failure', 'processing_error', 'customer_escalation',
    'staff_sms'
  ));
