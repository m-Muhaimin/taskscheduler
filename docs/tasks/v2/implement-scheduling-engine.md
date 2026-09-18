# Implement CP05 — Real Scheduling Engine

**Status: DONE (2026-09-19)** — implements `docs/prd-scheduling-assistant.md:72`.

## What shipped

- **`src/services/scheduling-engine.ts`** (new): timezone-correct scheduling engine on
  top of `calendar-service.ts`.
  - Pure pipeline: `generateCandidateSlots` (wall-clock business hours via
    `Intl.DateTimeFormat('en-CA', { hourCycle: 'h23' })` + fixed-point UTC offset
    iteration; DST-safe `zonedMidnightMs`), `filterBlockedPeriods` (free/busy +
    buffer), `filterBookingBlocks` (sibling bookings, `excludeBookingIds` opt-out),
    `filterBeforeNotice` (minimum-notice config), `sortAndLimit`.
  - `pickOfferedSlots`: 3 offers, day-spread (one per day first, then earliest
    remaining), grouped by the user's timezone when supplied.
  - `createSchedulingEngine(config)` → `{ getAvailableSlots, pickOfferedSlots }`;
    default export-less named `schedulingEngine` singleton (60-min slots, no
    buffer, no minimum notice). Matches the calendar-service failure contract:
    API failures are captured into `errors`, never thrown.
  - Exported `defaultFreeBusy` / `defaultListEvents` from calendar-service
    (additive; needed as engine orchestrator defaults). File normalized to LF.
- **`src/services/scheduling-engine.test.ts`** (new): 25 tests — tz offsets (NY
  EDT/EST, UTC), zoned midnight, date-line wall clock, slot generation (60/90-min,
  multi-day, overnight rejection), blocks/buffer, booking blocks + exclusion,
  notice window, day-spread picker (tz and non-tz), orchestrator end-to-end
  (free/busy filtering, sibling bookings, excludeBookingIds, minimum notice,
  auth-failure, free/busy-failure degradation).

## Wiring

- **`reschedule-service.ts`**: `GetAvailableSlotsFn` gains an optional
  `opts?: { excludeBookingIds?: string[] }` (structurally assignable to the
  engine's signature); `PickOfferedSlotsFn` gains `timeZone?: string`; defaults
  swapped from calendar-service stubs to `schedulingEngine.getAvailableSlots` /
  `schedulingEngine.pickOfferedSlots`; new optional `siblingBookingsFn` param
  (position 13). `initiateRescheduleFlow` now loads sibling bookings, filters out
  the booking being rescheduled, passes `existingBookings` + `excludeBookingIds`,
  and picks offers grouped by `user.businessHours.timezone`.
- **`booking-service.ts`**: new `findUserBookingsInWindow(orgId, userId, fromIso,
  toIso)` — strict-overlap (`start_time < $3 AND end_time > $4`), org-scoped,
  pending/confirmed only, ordered ASC (+ 2 unit tests; file now 11 tests).
- **worker** (`process-inbound-sms.ts`): passes the full 13 positional args —
  `createConversation`, engine fns, `createEscalation`, and the bound sibling
  lookup `findUserBookingsInWindow(organizationId, userId, fromIso, toIso)`.
  Worker test: 2 call-assertions updated to 13 args; mocks extended.
  booking-service import restored to all 5 names.

## Verification

- Engine suite: 25/25 pass. Booking suite: 11/11. Worker suite: 12/12 (repeat run;
  first-run-after-edit transform flake known). Reschedule suite: pre-existing
  `confirmReschedule` failure only (unchanged).
- Full API suite: **256 passed / 1 pre-existing failure (257 total)**.
- `npx tsc --noEmit`: only the 2 pre-existing errors (RescheduleLogEntry TS2304,
  Escalation TS2694).

## Notes / follow-ups

- Google OAuth wiring (real `defaultAuth` credentials) remains the next
  integration step; engine is fully testable with injected fns today.
- The pre-existing `confirmReschedule` failure (line ~427) and the 2 tsc errors
  are tracked separately from this checkpoint.
