-- Migration 012: widen rl_escalations.type CHECK for the RidgeLine Assistant
-- ('customer_escalation' — created when the assistant flags billing/emergency turns).
-- Idempotent: local-db.mjs re-applies all migrations on every boot. Widening does
-- NOT rewrite existing rows — every legacy type is still valid under the new CHECK.
alter table public.rl_escalations
  drop constraint if exists rl_escalations_type_check,
  add constraint rl_escalations_type_check check (type in (
    'ambiguous_intent', 'no_availability', 'calendar_api_failure',
    'sms_delivery_failure', 'processing_error', 'customer_escalation'
  ));