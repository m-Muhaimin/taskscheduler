# Fix undefined `defaultAuth` in process-inbound-sms.ts

## Status: ✅ DONE (commit 0ce9ad6)

## Status

**Backlog.** Found during checkpoint validation (docs/checkpoint-validation.md,
CP04 runtime landmine #1). Pre-existing on main.

## Current state

`apps/api/src/worker/process-inbound-sms.ts` lines 101 and 138 reference a
`defaultAuth` identifier that does not exist in scope:

- line 101: `defaultAuth as Parameters<typeof initiateRescheduleFlow>[2]`
- line 138: `defaultAuth as Parameters<typeof confirmReschedule>[1]`

`tsc --noEmit` flags both (TS2304: Cannot find name 'defaultAuth'). At
runtime, any inbound SMS that hits the `reschedule` or `confirm` intent
path throws `ReferenceError: defaultAuth is not defined` — the flow cannot
work even with a real booking present.

## Target

Provide a real `AuthFn` matching
`apps/api/src/services/calendar-service.ts` `AuthFn` type
 (`(userId, calendarId) => Promise<CalendarAuthResult>`), i.e. resolve a
Google Calendar access token for the tradesperson. Until Google OAuth token
storage exists (no calendar credentials in DB today — see CP05 gap), the
fix is a typed `defaultAuth` that:
1. reads what identity data exists (`ts_tradespeople` row),
2. returns a clear typed error / escalation instead of a ReferenceError,
3. keeps the reschedule flow escapable (escalation, not crash).

## Verify

- `npx tsc --noEmit` in apps/api: the 2 defaultAuth errors gone (6 → 4
  pre-existing remain: conversation-domain-e2e x2, reschedule-service x1,
  reschedule-service.test x1)
- `npx vitest run src/services/reschedule-service.test.ts src/worker/*` —
  no regressions; worker smoke: enqueue an inbound_sms with "RESCHEDULE" →
  observes an escalation (not a throw), with real Google creds absent.
