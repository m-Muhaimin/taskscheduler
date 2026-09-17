# Step 1 — Shared domain types

**Source:** docs/build-sequence.md Step 1 + docs/spec-reschedule-flow.md §2.7/2.8/2.9 and §3
**Depends on:** Step 0 (workspaces installed, `@tradescheduler/shared` package exists with `types: ./src/index.ts`, all tsconfigs in place)
**Gate on completion:** `tsc --noEmit` passes in all three workspaces; no runtime changes; API and web still build if a full build is run. **Compiles-and-runs rule: the built apps from Step 0 must still boot unchanged after this step** (no source importing the new types at runtime).

## Global constraints in force for this step

1. **Types-only package.** `@tradescheduler/shared` must never be imported as a value — only `import type` / `export type`. `verbatimModuleSyntax` (root tsconfig) turns any violation into a compile error; that is the enforcement and it must pass.
2. **Exact `.js` extensions on relative imports inside `packages/shared`** (ESM + nodenext): the re-export file uses `./types.js`, not `./types`.
3. **No dependency changes.** Do not install anything; do not edit any `package.json`.
4. **Field shapes are pinned by the spec** — do not add optionality that the spec does not have (e.g. `customerPhone` in the escalation response is `string`, not nullable), and do not invent fields beyond the commented placeholders below.
5. **TS fallback rule from Step 0 still applies** if any `tsc` invocation fails in a way not attributable to our code.

## Files to create/edit

### 1. `packages/shared/src/types.ts` (new) — complete content

Write this file exactly (it is the single source of truth for the whole monorepo's domain model):

```ts
// Shared domain types for tradescheduler.
// TYPES-ONLY package: import with `import type` / `export type` only.
// Field shapes follow docs/spec-reschedule-flow.md §2.7-2.9 and §3,
// and docs/prd-scheduling-assistant.md where the spec is silent.

/** ISO 8601 datetime string, as transported in JSON / stored in Postgres. */
export type IsoString = string;

export type BusinessHours = {
  /** Local wall-clock start, 24-hour 'HH:mm', e.g. '09:00'. */
  start: string;
  /** Local wall-clock end, 24-hour 'HH:mm', e.g. '17:00'. */
  end: string;
  /** IANA timezone name, e.g. 'America/New_York'. */
  timezone: string;
};

export type SmsSettings = {
  /** Template for the 3-slot reschedule offer SMS; slots interpolated at send time (§1.1). */
  rescheduleTemplate: string;
};

export type User = {
  id: string; // UUID
  phoneNumber: string; // tradesperson's phone, E.164
  googleCalendarId: string | null;
  businessHours: BusinessHours;
  smsSettings: SmsSettings;
};

export type BookingStatus = 'pending' | 'confirmed' | 'rescheduled';

export type SmsDirection = 'inbound' | 'outbound';

export type SmsMessage = {
  direction: SmsDirection;
  content: string;
  /** ISO 8601 timestamp. */
  timestamp: IsoString;
  /**
   * Known values used by the flow:
   * 'reschedule-offer' | 'reschedule-confirm' | 'reschedule-no-slots' | 'unknown'
   * | 'invalid-choice' | 'help' | 'no-matching-booking'
   */
  aiIntent: string | null;
  /** 0..1; null when not an AI-classified message. */
  confidence: number | null;
};

export type RescheduleLogEntry = {
  action: 'reschedule-offer' | 'reschedule-confirm' | 'reschedule-completed' | 'reschedule-failed';
  /** ISO 8601 timestamp. */
  timestamp: IsoString;
  details: string;
};

export type Booking = {
  id: string; // UUID
  userId: string; // UUID
  customerPhone: string; // E.164
  customerName: string;
  serviceDescription: string;
  /** ISO 8601 datetime. */
  startTime: IsoString;
  /** ISO 8601 datetime. */
  endTime: IsoString;
  status: BookingStatus;
  /** 'transferred' means the original deposit carried over with no new charge (§1.1). */
  depositStatus: string;
  googleCalendarEventId: string | null;
  smsHistory: SmsMessage[];
  rescheduledFromId: string | null; // UUID of the booking this one was rescheduled from (§3.2)
  rescheduleLog: RescheduleLogEntry[];
};

/**
 * Minimal placeholder. The leads feature is PRD-scoped, not in the reschedule
 * spec; refine shape when the leads feature is actually built.
 */
export type Lead = {
  id: string; // UUID
  phone: string; // E.164
  customerName: string | null;
  serviceDescription: string | null;
  /** Unbounded for now; e.g. 'new' | 'contacted' | 'booked'. */
  status: string;
  /** ISO 8601 timestamp. */
  createdAt: IsoString;
};

export type ConversationStateValue =
  | 'offering_slots'
  | 'awaiting_slot_choice'
  | 'completed'
  | 'escalated';

export type OfferedSlot = {
  optionNumber: 1 | 2 | 3;
  /** ISO 8601 datetime. */
  startTime: IsoString;
  /** ISO 8601 datetime. */
  endTime: IsoString;
};

export type ConversationState = {
  id: string; // UUID
  /** Customer phone, E.164. */
  phone: string;
  userId: string; // UUID
  /** UUID of the booking being rescheduled, null when not applicable. */
  bookingId: string | null;
  state: ConversationStateValue;
  offeredSlots: OfferedSlot[] | null;
  selectedSlot: OfferedSlot | null;
  escalationReason: string | null;
  /** ISO 8601 timestamp. */
  createdAt: IsoString;
  /** ISO 8601 timestamp. */
  updatedAt: IsoString;
  /** ISO 8601 timestamp, null until `state === 'completed'`. */
  completedAt: IsoString | null;
};

/** Twilio inbound-SMS webhook body (application/x-www-form-urlencoded), §2.1. */
export type TwilioInboundSmsPayload = {
  From: string; // customer phone, E.164
  To: string; // tradesperson's Twilio number, E.164
  Body: string;
  MessageSid: string;
  AccountSid: string;
  // Twilio appends more fields (FromCity, FromState, SmsSid, ...).
  [key: string]: string | undefined;
};

/** Twilio Message StatusCallback payload (outbound delivery reports). */
export type TwilioStatusCallbackPayload = {
  MessageSid: string;
  /** e.g. 'sent' | 'delivered' | 'failed' | 'undelivered'. */
  MessageStatus: string;
  ErrorCode: string | null;
  ErrorMessage: string | null;
  To: string;
  From: string;
  AccountSid: string;
  [key: string]: string | null | undefined;
};

export type Intent =
  | 'reschedule'
  | 'confirm'
  | 'help'
  | 'slot-choice'
  | 'unknown'
  | 'no-matching-booking';

export type IntentResult = {
  intent: Intent;
  /** 0..1; confidence < 0.7 escalates as ambiguous_intent (§1.3). */
  confidence: number;
};

/** §2.7 — calendar availability query result item. */
export type AvailableSlot = {
  /** ISO 8601 datetime. */
  startTime: Date;
  /** ISO 8601 datetime. */
  endTime: Date;
};

export type CalendarQueryError = {
  /** e.g. 'calendar_api_error'. */
  type: string;
  message: string;
};

/** §2.7 — never thrown; API failure is reported in `errors`. */
export type GetAvailableSlotsResult = {
  /** Sorted by startTime ascending; up to 20 slots (§2.7 logic step 6). */
  slots: AvailableSlot[];
  /** Non-empty only when the calendar query failed. */
  errors: CalendarQueryError[];
};

/** §2.8 — error shape for all internal functions. */
export type ApiError = {
  /** Known values: 'not_found' | 'bad_request' | 'calendar_api_error' | 'sms_send_error'. */
  type: string;
  message: string;
  /** Machine-readable error code for logging/alerting; null when none. */
  code: string | null;
  details?: Record<string, unknown>;
};

export type EscalationType =
  | 'ambiguous_intent'
  | 'no_availability'
  | 'calendar_api_failure'
  | 'sms_delivery_failure'
  | 'processing_error';

export type EscalationStatus = 'pending' | 'resolved';

export type Escalation = {
  id: string; // UUID
  type: EscalationType;
  customerPhone: string;
  content: string | null;
  status: EscalationStatus;
  /** ISO 8601 timestamp. */
  createdAt: IsoString;
  /** ISO 8601 timestamp; null until resolved. */
  resolvedAt: IsoString | null;
};

/** §2.9 — GET /api/dashboard/escalations response body. */
export type EscalationListResponse = {
  escalations: Escalation[];
  total: number;
  page: number;
  pageSize: number;
};

/** §2.9 — GET /api/dashboard/bookings/:bookingId/reschedule-history response body. */
export type RescheduleHistoryResponse = {
  bookingId: string;
  rescheduleLog: RescheduleLogEntry[];
};
```

### 2. `packages/shared/src/index.ts` (edit — replace entire content)

Replace the Step 0 placeholder comment line with exactly:

```ts
export * from './types.js';
```

### 3. `apps/api/src/types.ts` (new) — barrel re-export

```ts
export type {
  ApiError,
  AvailableSlot,
  Booking,
  BookingStatus,
  BusinessHours,
  CalendarQueryError,
  ConversationState,
  ConversationStateValue,
  Escalation,
  EscalationListResponse,
  EscalationStatus,
  EscalationType,
  GetAvailableSlotsResult,
  Intent,
  IntentResult,
  IsoString,
  Lead,
  OfferedSlot,
  RescheduleHistoryResponse,
  RescheduleLogEntry,
  SmsDirection,
  SmsMessage,
  SmsSettings,
  TwilioInboundSmsPayload,
  TwilioStatusCallbackPayload,
  User,
} from '@tradescheduler/shared';
```

This file is included by `apps/api/tsconfig.json` (`include: ["src"]`), so `tsc` proves the `@tradescheduler/shared` resolution.

### 4. `apps/web/src/types.ts` (new) — same barrel re-export

Identical content to `apps/api/src/types.ts` above (same export list, same `@tradescheduler/shared` specifier). Web's `moduleResolution: "bundler"` resolves the package through its `types` field. This file is swept up by web's `include: ["**/*.ts"]`.

## Verification

All from repo root, Git Bash, non-interactive. Each must exit 0:

```bash
npx tsc --noEmit -p packages/shared
npx tsc --noEmit -p apps/api
npx tsc --noEmit -p apps/web
```

Then the full-build regression (compiles-and-runs rule):

```bash
npm run build --workspaces
```

(Expected: api `tsc` emits — the new `apps/api/src/types.ts` is type-only so `dist` output is unchanged in behavior; web `next build` passes; shared `tsc` passes.)

Optional sanity that nothing changed at runtime: boot API and hit health as in Step 0 (`node apps/api/dist/index.js &` + `curl http://localhost:3001/api/health` → `{"status":"ok"}`), then kill it. If any `tsc`/`next build` failure is not attributable to our code, apply the Step 0 TS fallback rule.

## Where this fits

Step 1 encodes the spec's data model (§3) and API shapes (§2.7–2.9) as the single shared TypeScript source of truth. Steps 2+ consume these types via `@tradescheduler/shared`.

## Fits-gate checklist

- [ ] `packages/shared/src/types.ts` contains all 13 required types: `User`, `Booking`, `Lead`, `SmsMessage`, `ConversationState`, `TwilioInboundSmsPayload`, `TwilioStatusCallbackPayload`, `IntentResult`, `AvailableSlot`, `GetAvailableSlotsResult`, `ApiError`, `EscalationListResponse`, `RescheduleHistoryResponse` (+ documented helpers)
- [ ] `npx tsc --noEmit -p packages/shared` exit 0
- [ ] `npx tsc --noEmit -p apps/api` exit 0
- [ ] `npx tsc --noEmit -p apps/web` exit 0
- [ ] `npm run build --workspaces` exit 0
- [ ] No `package.json` modified; nothing installed