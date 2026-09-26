# Task 2 brief — Shared types, config, migration header, decision record

**Where this fits:** the WhatsApp product decision was taken in code but never
fully propagated: the shared package, the env template, and the schema
comments still advertise a second channel, and `EscalationType` has grown two
members the live DB CHECK rejects. This task makes the declared surface match
reality. It adds the single decision record that every other task cites.

**Depends on:** nothing. May run in parallel with Tasks 1 and 3.
**Blocks:** Task 5 (the green gate).

---

## 1. Files you own (edit nothing outside this list)

| Action | Path |
|---|---|
| edit | `packages/shared/src/types.ts` |
| edit | `apps/api/src/db/migrations/014-whatsapp-fallback.sql` |
| edit | `supabase/schema.sql` |
| edit | `.env.example` |
| verify | `render.yaml` |
| verify | `apps/web/lib/types.ts` |
| verify | `apps/web/app/dashboard/messages/page.tsx` |
| verify | `apps/web/components/dashboard/inbox-row.tsx` |
| verify | `apps/web/components/dashboard/messages-list.tsx` |
| verify | `apps/api/scripts/db-migrate.mjs` |
| create | `docs/tasks/sms-only-cleanup/DECISION.md` |

**No source file in `apps/api/src/` is yours.** Tasks 1, 3, 4, and 5 own those.

## 2. `packages/shared/src/types.ts`

**2a.** Delete the two members the live DB CHECK rejects. Replace lines 231–240:

```ts
export type EscalationType =
  | 'ambiguous_intent'
  | 'no_availability'
  | 'calendar_api_failure'
  | 'sms_delivery_failure'
  | 'processing_error'
  | 'customer_escalation'
  | 'staff_sms';
```

The live CHECK is exactly these seven. `outbound_failure` and `blocked_optin`
would fail every write.

**2b.** `Channel` (line 13) is already `export type Channel = 'sms';`. Leave it.

**2c.** Leave `TwilioInboundSmsPayload` (lines 157–167) alone. Its `Channel?`
field is optional and SMS-only, and `MessageDeliveryStatus` must keep all seven
values so historical rows keep rendering.

**2d.** Leave `MessagingConfigStatusDto` (lines 592–601) alone. The
`fallbackCountries` field is a READ-ONLY presence readout for the SMS
config-status endpoint; renaming a DTO field is a breaking API change that no
consumer in this repo needs. Its doc comments already say "SMS only".

**2e.** Make sure the file ends with a trailing newline.

## 3. `apps/api/src/db/migrations/014-whatsapp-fallback.sql`

The filename stays: `apps/api/scripts/db-migrate.mjs:35` and
`supabase/schema.sql` reference it by path, and renaming a migration that some
environments have already applied would break their migration history.

**3a. Replace the header block** (currently lines 1–17) with:

```sql
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
--   2. rl_customers.sms_opted_in / sms_opted_in_at — SMS consent flag.
--      The consent hard rule (never send an SMS without a logged consent
--      record) is enforced in services/consent-service.ts, which reads these
--      two columns.
--
-- Idempotent like every migration here (local-db.mjs re-applies all on boot).
--
-- ⚠ IF YOU APPLIED THE PRE-CLEANUP VERSION OF 014
--   An environment that ran 014 before the SMS-only cleanup (when it still
--   widened the channel and status constraints) needs a follow-up migration
--   015 to replace those two CHECK constraints with the SMS-only definitions
--   in this file. 014 is not re-run on an existing database — migrations are
--   recorded and skipped — so editing this file fixes fresh databases only.
--   015 is NOT part of this change; it is tracked as follow-up F8 in
--   docs/tasks/sms-only-cleanup/PLAN.md. Dev and CI databases are disposable
--   and can simply be dropped and rebuilt.
--
-- ⚠ The filename still says "whatsapp" for historical reasons. It is kept so
--   the migration lists in apps/api/scripts/db-migrate.mjs and
--   supabase/schema.sql resolve. Nothing in this file is WhatsApp-related.
-- ==============================================================================
```

**3b. Inside the `create table`**, change the `-- 'sms' only (WhatsApp removed)`
trailing comment on the `channel` column to:

```sql
  channel text not null default 'sms',    -- 'sms' only — SMS-only product
```

**3c. Do not change** the `status` CHECK list, the `channel` CHECK, the indexes,
the RLS lines, the consent columns, or the `comment on column` lines. Historical
rows still carry `retried` / `escalated` / `blocked_optin`, and the dashboard
renders them.

**3d.** Do not add a `-- down` section; no migration in this repo has one.

## 4. `supabase/schema.sql`

Two edits, both prose.

**4a.** Replace lines 594–595:

```sql
comment on table public.rl_outbound_messages is
  'Ledger of outbound SMS/WhatsApp messages (T17 Phase B + D: delivery-failure fallback engine reads this table)';
```

with:

```sql
comment on table public.rl_outbound_messages is
  'Ledger of outbound SMS messages (T17 Phase B + D: the Twilio StatusCallback reports on this table)';
```

**4b.** Replace lines 628–630:

```sql
-- The conversation channel CHECK is already set to 'sms' | 'voice' | 'web' in
-- the CREATE TABLE above. WhatsApp has been removed from the product, so no
-- widening is needed.
```

with:

```sql
-- The conversation channel CHECK is 'sms' | 'voice' | 'web' in the CREATE TABLE
-- above. The product is SMS only, so no channel widening is needed.
```

**4c. Do not change** the status CHECK at lines 601–605, the channel CHECK at
597–599, the consent columns, or the file's reference to the migration filename
if one exists (it is a path, not prose — leave it).

## 5. `.env.example`

**5a. Delete lines 14–15**, the two-line comment:

```
# WhatsApp fallback engine (T18): SMS-first delivery with a one-shot WhatsApp
# retry when an SMS delivery report comes back failed/undelivered.
```

**5b. Keep lines 16–20 as they are** — `API_BASE_URL` and
`TWILIO_MESSAGE_STATUS_CALLBACK_URL` are live. But move them up so they sit
directly under `TWILIO_PHONE_NUMBER` (line 12) and are introduced by this
comment:

```
# Twilio (SMS)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
# Public base URL for the API — used to derive the Twilio StatusCallback URL
# (<API_BASE_URL>/api/twilio/webhooks/status). Override it directly with
# TWILIO_MESSAGE_STATUS_CALLBACK_URL when the API sits behind a proxy/rewrite.
API_BASE_URL=
TWILIO_MESSAGE_STATUS_CALLBACK_URL=
```

**5c. Delete lines 21–45 entirely** — `TWILIO_WHATSAPP_NUMBER`,
`WHATSAPP_FALLBACK_COUNTRIES`, and all 14 `WHATSAPP_TEMPLATE_*` lines plus their
four comment lines. That block is now dead config: the code that read it is
being deleted in Task 1.

**5d.** Leave the rest of the file (Auth, Supabase, Twilio verify, AI, calendar)
untouched. End with a single blank line before `# Auth (dashboard JWT)`.

## 6. Verify only (edit only if you find an actual `whatsapp` reference)

Run this and confirm it returns nothing:

```bash
rg -n -i "whatsapp" render.yaml apps/web/lib/types.ts apps/web/app/dashboard/messages/page.tsx apps/web/components/dashboard/inbox-row.tsx apps/web/components/dashboard/messages-list.tsx
```

- `render.yaml` — expected **no matches** (it lists only `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` at lines 34/37/40 and 92/95/98).
  Nothing to do.
- The four web files — expected **no matches**. The dashboard filters on
  `sms` and renders the seven statuses. Nothing to do.

If any of them *does* match, fix only the string literal; do not restructure.

## 7. `apps/api/scripts/db-migrate.mjs`

Line 35 is `"014-whatsapp-fallback.sql",` inside the migration list. **Leave it.**
The filename is unchanged (see §3). No edit.

## 8. Create `docs/tasks/sms-only-cleanup/DECISION.md`

Write this file verbatim. It is the one decision record this change adds; every
other task cites it, so the wording is load-bearing.

```markdown
# Decision record — SMS-only cleanup

Date: 2026-09-25
Status: accepted

Context: the product is SMS only. A half-finished second channel (WhatsApp) and
a half-finished SMS retry engine (delivery-failure → WhatsApp fallback) were
built on top of the SMS pipeline. Both were abandoned mid-way and the working
tree is mid-refactor.

## 1. Decisions

### D1 — No WhatsApp surface remains
The WhatsApp channel is removed from the API, the shared package, the env
template, the deployment config, and the dashboard. There is no partial
WhatsApp support left: no env var, no type member, no route branch, no UI label.

### D2 — No delivery-failure retry, this round
The Twilio StatusCallback records `failed` / `undelivered` as `failed` and
stops. There is no retry, no fallback channel, and no new delivery status.
The previously half-built retry engine is deleted rather than finished, because
it was unsound in ways that would need redesign rather than repair:
the original row was marked `retried` before the replacement was inserted
(so a crash in between silently lost the message), there was no attempt/parent
link between the original and the retry, the declared max-attempt cap was
never read (unbounded retry chain), the "already claimed" check was a
non-atomic read-then-write (two concurrent callbacks would each send), the
success path marked the wrong row as sent, the escalation types it wrote are
ones the live DB CHECK rejects, the terminal-status lists disagreed with the
ledger's own write-once guard, and its consent check only ran when a
`customerId` happened to be set — fail-open for every staff and manual send.
A rebuild is tracked as follow-up F8/F6 in `PLAN.md` and must be a new module
with a single atomic claim and a real attempt linkage.

### D3 — The ledger keeps its seven statuses
`rl_outbound_messages` keeps `queued | sent | delivered | failed | retried |
escalated | blocked_optin` in the migration CHECK, in `OutboundStatus`, and in
the dashboard label maps. Nothing writes the last three today; historical rows
already contain them, so narrowing the CHECK would break rendering old history.
`blocked_optin` is deliberately not terminal: it is a pre-delivery consent
refusal, so a later real delivery report for the same SID is still recorded.

### D4 — Consent lives in one place
`apps/api/src/services/consent-service.ts` is the only authority for
`sms_opted_in` / `sms_opted_in_at`. It honors `CUSTOMERS_TABLE`, sets the flag
and the timestamp together, and is idempotent. The outbound ledger no longer
exports `hasSmsOptIn`. A valid inbound customer SMS records the opt-in before
classification, so a customer who has replied has a consent record and the
outbound gate passes for them.

### D5 — Migration 014 is edited in place, with a warning header
`014-whatsapp-fallback.sql` keeps its filename (it is referenced by path in
`db-migrate.mjs` and `schema.sql`) and its SMS-only body. Its header now warns
that an environment which applied the pre-cleanup 014 needs a future 015 to
replace the old constraints. 015 is not part of this change.

## 2. What is explicitly NOT decided here

- Whether a failed SMS should ever be retried, and under what consent and
  attempt-linking rules. See follow-up F6.
- The data-model problems listed as F1–F5 and F8–F9 in `PLAN.md`
  (cross-tenant escalation injection, tenant-less conversation states, zero
  RLS policies, dual outbound ledgers, the staff phone split, and the missing
  015). Each needs its own decision.
- Any change to the seven-value `EscalationType` set. It must match the live
  DB CHECK; see D3-adjacent note in `PLAN.md` §1.6.
```

## 9. Acceptance criteria

- [ ] `rg -n -i "whatsapp" packages/shared` → only doc-comment prose that says
      "SMS only" is acceptable; no identifier. Expected: **no matches**.
- [ ] `rg -n -i "whatsapp" .env.example render.yaml` → **no matches**.
- [ ] `rg -n "'outbound_failure'|'blocked_optin'" packages/shared/src/types.ts`
      → these must appear **only** inside `MessageDeliveryStatus` /
      `OutboundStatus`-equivalent status unions if at all, and **never** in
      `EscalationType`. Verify `EscalationType` has exactly seven members.
- [ ] `rg -n -i "whatsapp" supabase/schema.sql` → at most a path reference to
      the migration filename. No prose about a second channel.
- [ ] `git diff --stat` for this task touches only the four files in §1's
      edit/create rows.
- [ ] `docs/tasks/sms-only-cleanup/DECISION.md` exists with all five decisions
      D1–D5 and its "not decided here" section.

## 10. Verification

```bash
npm run typecheck --workspace=apps/api
```

This task removes two `EscalationType` members. If typecheck fails inside
`apps/api/src/**` because something still *constructs* one of them, that is
Task 1's or Task 5's file, not yours — report the exact location instead of
editing it. `npm run build --workspace=apps/web` must still succeed if you had
to touch a web file at all.
