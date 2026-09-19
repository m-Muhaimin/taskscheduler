/**
 * Migration 008: appointments table (CP04 booking domain) +
 * tradesperson profile columns for the real user lookup.
 *
 * Convention: public.<PREFIX>_<name> (rl_ prefix), RLS deny-by-default,
 * server-only access. Follows 001-007 style.
 */

-- ============================================================================
-- rl_appointments — the Booking entity (PRD §Data Model Changes, spec §3)
-- ============================================================================
create table if not exists public.rl_appointments (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.rl_organizations (id) on delete cascade,
  user_id                 uuid not null references public.rl_tradespeople (id) on delete cascade,
  customer_phone          text not null check (customer_phone ~ '^\+?[1-9][0-9]{1,14}$'),
  customer_name           text,
  service_description     text,
  start_time              timestamptz not null,
  end_time                timestamptz not null,
  status                  text not null default 'pending'
                          check (status in ('pending', 'confirmed', 'rescheduled')),
  deposit_amount          numeric(10, 2),
  deposit_status          text not null default 'pending'
                          check (deposit_status in ('pending', 'paid', 'failed')),
  google_calendar_event_id text,
  rescheduled_from_id     uuid references public.rl_appointments (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.rl_appointments is
  'Booking/appointment domain for the reschedule flow (RLS deny-by-default)';

-- findBookingByPhone: most recent appointment for a customer.
create index if not exists rl_appointments_org_phone_start_idx
  on public.rl_appointments (organization_id, customer_phone, start_time desc);

-- join on user profile lookups.
create index if not exists rl_appointments_org_user_idx
  on public.rl_appointments (organization_id, user_id);

alter table public.rl_appointments enable row level security;
revoke all on public.rl_appointments from anon, authenticated;

-- ============================================================================
-- rl_tradespeople: add nullable profile columns so userLookupFn can read real
-- identity data (CP04 spec: "Get user (tradesperson)" - calendar, hours, SMS).
-- All nullable - old rows keep working; no backfill.
-- ============================================================================
alter table public.rl_tradespeople
  add column if not exists phone_number            text
        check (phone_number ~ '^\+?[1-9][0-9]{1,14}$'),
  add column if not exists google_calendar_id      text,
  add column if not exists business_hours          jsonb,
  add column if not exists sms_reschedule_template text;
