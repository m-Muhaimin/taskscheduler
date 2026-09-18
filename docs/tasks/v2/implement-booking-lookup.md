# Implement real booking lookup (CP04) — replaces TODO stubs

## Status

**Backlog.** Found during checkpoint validation (docs/checkpoint-validation.md,
CP04). Checkpoint 04 of the PRD — not started.

## Current state

The reschedule flow's booking dependency is stubbed:

- `apps/api/src/worker/process-inbound-sms.ts:106` —
  `(id: string) => Promise.resolve(null), // TODO: real booking lookup`
  passed as `bookingLookupFn` to `initiateRescheduleFlow`
- line 107 — `(id: string) => Promise.resolve(null), // TODO: real user lookup`
  passed as `userLookupFn`
- line 97 — `const bookingId = 'TODO-from-store';`

`initiateRescheduleFlow` (reschedule-service.ts:108) returns `null` when
the booking lookup returns null, so the flow silently dead-ends. The
`confirm` path has the same stub (line 140). No appointments table exists.

## Target (CP04 shape)

1. **Appointments table migration** — `ts_appointments`
   (booking_id? user_id, customer_phone, start/end, status, calendar event
   id) — see PRD Booking model (§Data Model Changes).
2. **Concrete `bookingLookupFn`** — real query by bookingId (and by phone
   for the SMS-initiated path), fed from conversation state
   (`ts_conversation_states.booking_id`) rather than the `'TODO-from-store'`
   literal.
3. **Concrete `userLookupFn`** — tradesperson row → { phoneNumber,
   googleCalendarId, businessHours, smsSettings } — unblocks CP05 wiring too.
4. Wire into `process-inbound-sms.ts` replacing all three stubs; delete
   `defaultAuth` cast if AuthFn becomes real (or cross-ref
   docs/tasks/v2/fix-worker-defaultAuth.md).

## Verify

- `npx tsc --noEmit` in apps/api: worker stub errors resolved
- `npx vitest run src/services/reschedule-service.test.ts` — existing suite
  (currently green via injected doubles) still green
- New tests for the concrete lookups (pg-mocked): booking found → flow
  continues; booking missing → returns null (caller handles the dead-end)
- Manual: inbound "RESCHEDULE" for a real booking → offer-SMS with 3 slots
