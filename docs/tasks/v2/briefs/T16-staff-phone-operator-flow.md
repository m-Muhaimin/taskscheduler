# T16 — Tradesperson phone matching (staff SMS → operator flow)

## Goal
Today the worker treats EVERY inbound SMS as a customer (findOrCreateCustomer →
classify → templated customer replies). But a tradesperson might text the org's
number from their own phone (testing, or actual "operator" moments). Add
**staff-phone recognition**: if the inbound `From` number matches a tradesperson
(member) of the resolved org, route the message to an **operator flow** instead
of the customer flow — no customer row, no customer templating, staff reply path
instead.

## Verified facts (controller investigation — do not re-derive)
- `migrations/004` `rl_tradespeople`: id, email (unique, lowercase), password
  hash (scrypt). **NO phone column exists** — staff phones cannot be stored today.
- `migrations/006` `rl_organization_members`: id, organization_id, user_id,
  role CHECK ('OWNER','STAFF','TECHNICIAN'), unique (organization_id, user_id),
  user_id FK → rl_tradespeople(id). A tradesperson can belong to multiple orgs.
- `migrations/006` `rl_twilio_numbers`: organization_id + phone (unique) — the
  inbound→org resolution table (organization-service.ts:112).
- `apps/api/src/worker/process-inbound-sms.ts`: resolves org by To-number FIRST,
  then `findOrCreateCustomer`, then classify + templated SMS switch.
- `rl_escalations` (migrations/002) exists with `type`, `content`, `state` —
  the worker already escalates ambiguous intents there
  (`escalateAmbiguousIntent`, line ~387).
- No dashboard "staff SMS inbox" exists; the operator flow target here is the
  SAME escalation surface the dashboard already surfaces (step9-escalations-ui),
  so staff messages become visible/actionable without new UI.
- `sendSms` + dry-run semantics: same as T14/T15.

## Files to change
1. `apps/api/src/db/migrations/012-staff-phone.sql` — NEW.
2. `apps/api/src/services/staff-phone-service.ts` — NEW (resolve From → member).
3. `apps/api/src/worker/process-inbound-sms.ts` — branch staff vs customer.
4. Tests: `staff-phone-service.test.ts` (NEW) + extend `process-inbound-sms.test.ts`.

## Exact requirements

### A. Migration 012 — link staff to a phone number
```sql
-- phone per tradesperson (nullable; a tradesperson is not required to have one)
alter table public.rl_tradespeople
  add column if not exists phone text;

-- enforce E.164 + uniqueness per person
alter table public.rl_tradespeople
  drop constraint if exists rl_tradespeople_phone_check,
  add constraint rl_tradespeople_phone_check check (
    phone is null or phone ~ '^\+?[1-9][0-9]{1,14}$'
  );

create unique index if not exists rl_tradespeople_phone_idx
  on public.rl_tradespeople (phone);
```
Design notes:
- Phone lives on the PERSON (rl_tradespeople), not the membership — a number is
  owned by a person, and membership is org-scoped. Resolution: From number →
  person → their org memberships → is the person a member of the RESOLVED org
  (the one owning the To-number)? If yes → staff flow.
- Unique index on phone: a phone should not belong to two people. (If multi-
  staff-shared phones ever matter, revisit; keep it simple now.)

### B. staff-phone-service.ts (new)
- `resolveStaffByPhone(phone, organizationId): Promise<{ tradespersonId,
  email: string } | null>` — one query:
  ```sql
  select t.id, t.email
  from public.rl_tradespeople t
  join public.rl_organization_members m on m.user_id = t.id
  where t.phone = $1 and m.organization_id = $2
  limit 1;
  ```
  Returns null when the number isn't a staff member OF THE RESOLVED ORG (a staff
  member of ANOTHER org texting this number is still a customer of this org —
  keep that behavior; only staff of the owning org get the operator flow).
- Lazy pool singleton, env-free boot (same as organization-service).

### C. worker branch (process-inbound-sms.ts) — BEFORE findOrCreateCustomer
After org resolution (we have organizationId + From phone):
1. `const staff = await resolveStaffByPhone(from, organizationId)`
2. If `staff` → operator flow:
   - Write the message to the escalation surface so the dashboard shows it:
     `insert into rl_escalations (organization_id, type, content, state, metadata)
      values ($1, 'staff_sms', $2, 'OPEN', jsonb_build_object('from', $3,
      'tradesperson_id', $4, 'conversation_id', ...))` — mirror the existing
      escalation shape (check migrations/002 columns before writing; extend
      content to carry body).
   - Send NO customer reply. Complete the job.
   - Optionally send a short staff ack SMS ("Message logged to your dashboard —
     reply there") ONLY if that doesn't clash with the dry-run/dev posture —
     decide in implementation, default ON but logged as dry-run friendly.
   - Do NOT call findOrCreateCustomer/classify for staff messages.
3. Else → existing customer flow untouched.

### D. Tests
- staff-phone-service.test.ts: resolves when membership in org exists; null
  when phone unknown / membership in another org only / phone null in DB.
- process-inbound-sms.test.ts (extend):
  - staff From → escalation row created with type 'staff_sms', NO customer
    created, NO classify, job completes.
  - non-staff From → existing customer flow runs unchanged (regression guard).
  - staff of another org → treated as customer (explicit regression test).

## Out of scope
- No dashboard UI for staff SMS (the escalation surface already shows them).
- No inbound "tradesperson command" grammar (/status, /help for staff) — just
  routing + visibility. A command layer is a follow-up ticket if wanted.
- No SMS ↔ web-session binding (staff still act via the dashboard).
- Do NOT touch T14 (device trust) or T15 (confirm-code). Customer-flow behavior
  must remain byte-for-byte unchanged for non-staff numbers.

## Verify (in order, workdir H:\tradescheduling)
1. `npm test --workspace=apps/api` — full suite green.
2. `npm run typecheck --workspace=apps/api` — no NEW errors.
3. `npm run build --workspace=apps/api` — green.
4. Live smoke (needs a row): set a test tradesperson's phone, enqueue
   inbound_sms from it (dry-run SMS), assert escalation + no customer row; then
   a normal number → customer flow unchanged.

## Report
Per-file diff summary; three-way resolution logic (From → person → org
membership vs owning org); escalation row shape used; test tails.
Do NOT commit.
