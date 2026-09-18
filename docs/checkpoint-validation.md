# Checkpoint Validation Report

**Date:** 2026-09-19
**Basis:** `main` @ `c176c7d` (V2 checkpoint campaign merged)
**Reference:** docs/prd-scheduling-assistant.md (checkpoints defined at lines 54–77)

## Summary

| CP  | Requirement | Status | Verdict |
|-----|-------------|--------|---------|
| 01  | LLM Layer | ✅ IMPLEMENTED | packages/ai complete, 31/31 tests, merged |
| 02  | Tenant model (organizations + organization_members) | ❌ NOT IMPLEMENTED | No org tables/services |
| 03  | Customer + Conversation domain | ⚠️ PARTIAL | Service code exists, no migration, not wired |
| 04  | Booking/Appointment domain | ❌ NOT IMPLEMENTED | Booking lookup is a stub |
| 05  | Scheduling Engine | ❌ NOT IMPLEMENTED | Calendar primitives exist, no engine, not live-wired |
| 06  | AI Booking Agent | ❌ NOT IMPLEMENTED | LLM lib exists, zero production imports |
| 07  | Comms hardening | ⚠️ PARTIAL | Queue + sig verification done; retry/DLQ/tracking missing |
| 08  | Dashboard real data | ❌ NOT IMPLEMENTED | API + web both still fixture-backed |
| 09  | Technicians + Dispatch + Job Lifecycle | ❌ NOT IMPLEMENTED | Escalations only |
| 10  | Revenue Loop | ❌ NOT IMPLEMENTED | No leads/missed-call/Paddle/analytics |

**Score: 1 implemented, 2 partial, 7 not started** — consistent with PRD's own
checkpoint labels ("Checkpoint 01 — implemented", rest "Planned work (not started)").

## Evidence

### CP01 — LLM Layer ✅
`packages/ai`: AIProvider interface, OpenAI adapter (structured output via
`response_format: json_schema`, usage tracking, retry logic, error mapping),
rule fallback wrapping shared `parseIntent`, superset rule (rule confidence
≥0.9 overrides LLM). `ai_usage` ledger (migration 005 + ai-usage-service.ts).
Env vars in `.env.example`. Tests: 31/31, tsc clean.

### CP02 — Tenant model ❌
Migrations present: 001-jobs, 002-escalations, 003-conversation-states,
004-tradespeople, 005-ai-usage. Identity = single `ts_tradespeople`
(email + password hash only). No `organizations`/`organization_members`
table, no org service. CP03 spec even declares CP02 as prerequisite.

### CP03 — Customer/Conversation ⚠️ PARTIAL
- ✅ `conversation-domain.ts`: `findOrCreateCustomer/Conversation/Message`
  (upserts with race tie-breaking); spec at docs/spec-customer-conversation-domain.md
- ❌ Tables `public.customers`, `public.conversations`, `public.messages`
  have NO migration in repo; domain requires CP02's `organization_id`
- ❌ Not wired anywhere: `process-inbound-sms.ts` uses old
  `conversation-service.ts` (`ts_conversation_states` — slot-choice state only)
- ⚠️ `conversation-domain-e2e.ts`: manual script (process.exit), 2 pre-existing tsc errors

### CP04 — Booking/Appointment ❌
`reschedule-service.ts` defines `BookingLookupFn`/`UserLookupFn` + 3-handler
flow, but worker calls with `bookingId = 'TODO-from-store'` and
`(id) => Promise.resolve(null)` stubs (process-inbound-sms.ts:97,106–107).
No appointments table. ⚠️ Worker references undefined `defaultAuth`
(lines 101, 138 — pre-existing tsc errors); a real reschedule SMS would
throw at runtime.

### CP05 — Scheduling Engine ❌
No `SchedulingEngine` service. `calendar-service.ts` has primitives
(`getAvailableSlots`, `pickOfferedSlots`, `createCalendarEvent`,
FreeBusyFn/ListEventsFn) but no engine and no live calendar credentials
in production wiring.

### CP06 — AI Booking Agent ❌
`grep "@tradescheduler/ai"` in production code: zero hits. Only
`ai-classify.test.ts` (tests `classifyStep` with mock provider). Worker
uses rule-based `parseIntent` only. `recordAiUsage` has no production
callers (ai-usage-service.ts:8 confirms "worker will call ... next to").

### CP07 — Comms hardening ⚠️ PARTIAL
- ✅ Durable Postgres queue (`ts_jobs`): atomic claim FOR UPDATE SKIP LOCKED,
  attempts counter, worker survives bad jobs
- ✅ Twilio signature verification middleware (/inbound-sms → 401 invalid)
- ❌ `fail()` just marks `failed`: no retry/requeue, no backoff, no dead-letter
- ❌ No delivery tracking (no status-callback endpoint; sms-service has no
  messageStatus handling)
- ❌ No rate limiting; no MessageSid idempotency dedup
- ⚠️ CVE audit documented in CLAUDE.md (2 remaining, fix paths known)

### CP08 — Dashboard real data ❌
`routes/dashboard/*` return hardcoded fixtures (comments: "Replace with a
Postgres/Supabase query when the data layer lands" — escalations.ts:32,
reschedule-history.ts:32). Web uses `lib/fixtures.ts` via
`use-dashboard-data.ts`; no fetch to /api/dashboard anywhere in web.
JWT auth + UI shells real; data not.

### CP09 — Technicians/Dispatch/Job Lifecycle ❌
`ts_jobs` is the queue backbone, NOT business jobs. No technicians table,
no dispatch logic, no job lifecycle. Exist: `ts_escalations` +
escalation-service + escalations UI (real, fixture data); jobs list/detail
pages (fixtures).

### CP10 — Revenue Loop ❌
No Lead model, no missed-call/voice webhook (only /inbound-sms), no
follow-up automation, no analytics reading `ai_usage`, no Paddle code
(CLAUDE.md: "Paddle (deposit/webhook implementation not yet built)").

## Runtime landmines (pre-existing, unblocked by this validation)

1. **`defaultAuth` undefined** in process-inbound-sms.ts (lines 101, 138) —
   reschedule/confirm SMS paths throw at runtime; tsc already flags it.
2. **Booking lookup stubs** — `(id) => Promise.resolve(null)` means the
   reschedule flow can never find a booking (CP04 gap).

## Dependency chain

CP02 → CP03 → (CP06, CP08); CP04/CP05 → CP06. PRD ordering is a hard chain.
