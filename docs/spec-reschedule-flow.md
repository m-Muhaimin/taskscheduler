# Spec: Reschedule-by-Text Flow

**Version:** 1.0  
**Status:** Approved  
**Scope:** Customer replies "R" to a booking confirmation SMS → AI parses intent → offers 3 open slots from the tradesperson's Google Calendar → customer picks one → calendar updates → both parties notified.

---

## 1. Behavior

### 1.1 Happy path: customer-initiated reschedule

**Given** a confirmed booking exists for `user_id` with `customer_phone`, `startTime`, `endTime`, `status = 'confirmed'`, and a Google Calendar `googleCalendarId` linked  
**When** the customer replies "R" (case-insensitive, optionally with punctuation: "r", "R.", "r!", "reschedule", "move", "change time", "can we move") to the last confirmation SMS sent for that booking  
**Then**
- [x] System identifies the booking by matching `customer_phone` + recency (last confirmation SMS sent to that phone within the last 7 days that has not already been rescheduled)
- [x] Intent is classified as `reschedule` with confidence ≥ 70%
- [x] System queries Google Calendar for free/busy slots for `user_id`'s `googleCalendarId` within `businessHours` for the next 14 days
- [x] System selects 3 open slots that are:
  - Within `businessHours.start`–`businessHours.end` (local time)
  - Not already booked (no existing `Booking` with overlapping `startTime`/`endTime` and `status IN ('pending', 'confirmed')`)
  - Not on the same day as the original booking if the original booking is within 24 hours (avoid same-day confusion unless no other option exists)
- [x] System stores conversation state: `phone = customer_phone`, `booking_id = original_booking_id`, `state = 'offering_slots'`, `offeredSlots = [{optionNumber: 1, startTime, endTime}, {optionNumber: 2, ...}, {optionNumber: 3, ...}]`
- [x] System sends SMS to `customer_phone`: _"I can reschedule you. Here are 3 open times: 1) [Day Mon DD at HH:mm], 2) [Day Mon DD at HH:mm], 3) [Day Mon DD at HH:mm]. Reply with the number to pick one."_ — using the tradesperson's `smsSettings.rescheduleTemplate` with slot interpolation
- [x] System logs outbound SMS in `booking.smsHistory` with `direction = 'outbound'`, `aiIntent = 'reschedule-offer'`, `confidence = 1.0`

**Given** the above slot offer was sent  
**When** the customer replies with a valid option number (1, 2, or 3) matching one of the offered slots  
**Then**
- [x] System matches the reply to the offered slot by `optionNumber`
- [x] System creates a new `Booking` record:
  - `userId` = same as original
  - `customerPhone`, `customerName`, `serviceDescription` = copied from original
  - `startTime` = selected slot start, `endTime` = selected slot end
  - `status = 'pending'`
  - `depositStatus = 'transferred'` (the original deposit carries over — no new Paddle charge, no Stripe touch)
  - `googleCalendarEventId = null` (to be created)
  - `smsHistory = []` (new conversation thread for the new booking)
- [x] System updates the original booking: `status = 'rescheduled'`, adds a `smsHistory` entry: `{direction: 'outbound', content: 'Rescheduled to [new time].', timestamp, aiIntent: 'reschedule-confirm', confidence: 1.0}`
- [x] System creates a Google Calendar event for the new booking via Google Calendar API (insert event at `startTime`–`endTime` with `summary = serviceDescription`, `description = customerName + booking ID`, `attendees = [customer_phone as email if available, tradesperson email]`)
- [x] System updates the new booking: `googleCalendarEventId = created_event_id`
- [x] System sends SMS to `customer_phone`: _"Your appointment is rescheduled to [Day Mon DD at HH:mm]. Reply CONFIRM to lock it in."_
- [x] System sends SMS to `user.phoneNumber` (tradesperson): _"[customerName] rescheduled to [Day Mon DD at HH:mm]. Reply CONFIRM to lock it in."_
- [x] System logs both outbound SMSs in the new booking's `smsHistory`
- [x] System marks conversation state: `state = 'completed'`, `completedAt = now`

### 1.2 Happy path: customer confirms the rescheduled slot

**Given** a new booking exists with `status = 'pending'` and `customer_phone` has been sent a "Reply CONFIRM to lock it in" SMS  
**When** the customer replies "CONFIRM" (case-insensitive) to that SMS  
**Then**
- [x] System identifies the pending booking by matching `customer_phone` + recency
- [x] System updates booking: `status = 'confirmed'`
- [x] System sends SMS to `customer_phone`: _"Confirmed. See you on [Day Mon DD at HH:mm]."_
- [x] System logs the inbound CONFIRM in `smsHistory`

### 1.3 Edge case: ambiguous intent (confidence < 70%)

**Given** an inbound SMS from `customer_phone` that does not clearly match any known intent pattern  
**When** rule-based parsing returns `confidence < 70%` (or no match at all)  
**Then**
- [x] System does NOT proceed with any booking action
- [x] System sends SMS to `customer_phone`: _"I didn't catch that. Reply 'HELP' for options or call me."_
- [x] System logs the inbound SMS with `aiIntent = 'unknown'`, `confidence = <actual score>`
- [x] System creates an `Escalation` record (see Data section) with `type = 'ambiguous_intent'`, `customer_phone`, `content`, `status = 'pending'`
- [x] System sends an internal notification (dashboard alert) to the tradesperson: "Customer [customer_phone] sent an unclear message — review in dashboard"

### 1.4 Edge case: no open slots available

**Given** a reschedule intent is confirmed (confidence ≥ 70%)  
**When** Google Calendar query returns 0 open slots within `businessHours` for the next 14 days  
**Then**
- [x] System does NOT send a slot offer
- [x] System sends SMS to `customer_phone`: _"I'm fully booked for the next two weeks. I'll reach out when something opens up — or call me to discuss alternatives."_
- [x] System logs outbound SMS with `aiIntent = 'reschedule-no-slots'`
- [x] System creates an `Escalation` record with `type = 'no_availability'`, `status = 'pending'`
- [x] System updates conversation state: `state = 'escalated'`, `escalationReason = 'no_open_slots'`

### 1.5 Edge case: customer replies with an invalid option number

**Given** the system has offered slots [1, 2, 3]  
**When** the customer replies with "4" or "5" or any number not in the offered set  
**Then**
- [x] System does NOT create a booking
- [x] System sends SMS to `customer_phone`: _"I only have options 1, 2, and 3. Which one works for you?"_
- [x] System logs the inbound SMS with `aiIntent = 'invalid-choice'`
- [x] System keeps conversation state as `state = 'offering_slots'` (does not reset the offered slots)

### 1.6 Edge case: customer replies "HELP"

**Given** any active conversation state  
**When** the customer replies "HELP" (case-insensitive)  
**Then**
- [x] System sends SMS to `customer_phone`: _"You can reply: R to reschedule, CONFIRM to confirm a booking, or call [user.phoneNumber] directly."_
- [x] System logs the inbound SMS with `aiIntent = 'help'`
- [x] System does NOT change booking state

### 1.7 Edge case: customer replies to a booking that doesn't exist or has already been rescheduled

**Given** `customer_phone` replies "R" but no confirmed booking exists for that phone within the last 7 days, or the only matching booking has `status = 'rescheduled'`  
**When** the system tries to identify the booking  
**Then**
- [x] System sends SMS to `customer_phone`: _"I can't find an upcoming booking for you. If you need to book, reply with your service need."_
- [x] System logs the inbound SMS with `aiIntent = 'no-matching-booking'`
- [x] System does NOT create an escalation (this is a customer confusion case, not a failure)

### 1.8 Failure state: Google Calendar API unavailable

**Given** a reschedule intent is confirmed  
**When** the Google Calendar API returns an error (5xx, auth expiry, quota exceeded)  
**Then**
- [x] System retries once after 30 seconds
- [x] If the retry also fails, system sends SMS to `customer_phone`: _"I'm having trouble checking my schedule right now. I'll try again shortly — or call me to reschedule manually."_
- [x] System logs the error with `errorType = 'calendar_api_failure'`
- [x] System creates an `Escalation` record with `type = 'calendar_api_failure'`, `status = 'pending'`
- [x] System does NOT create or modify any booking

### 1.9 Failure state: SMS send fails (Twilio error)

**Given** the system attempts to send any outbound SMS (slot offer, confirmation, notification)  
**When** Twilio returns an error (undelivered, invalid number, rate limit, etc.)  
**Then**
- [x] System retries once with a 30-second delay
- [x] If the retry fails, system logs the error with `twilioError` details
- [x] System creates an `Escalation` record with `type = 'sms_delivery_failure'`, `status = 'pending'`
- [x] System sends a dashboard alert to the tradesperson
- [x] System does NOT proceed to the next step in the flow (e.g., if the slot offer SMS fails, the customer never gets the offer, and the conversation state is not advanced)

### 1.10 Failure state: conversation state lost (worker restart mid-flow)

**Given** a conversation is in progress (e.g., slots have been offered, waiting for customer reply)  
**When** the worker process restarts or crashes  
**Then**
- [x] On restart, the worker reloads all active conversation states from Postgres
- [x] No state is lost — the customer's next reply is processed against the stored state
- [x] No duplicate SMSs are sent (state machine checks current state before acting)

---

## 2. API Contract

### 2.1 Inbound SMS webhook (Twilio)

**Endpoint:** `POST /api/twilio/webhooks/inbound-sms`

**Validation:** Twilio signature verification (HMAC-SHA1) via `TWILIO_AUTH_TOKEN`. Invalid/missing signature → `401 Unauthorized`. This is the FIRST check; no processing occurs before it.

**Request body (Twilio FormData / application/x-www-form-urlencoded):**

| Field | Type | Required | Description |
|---|---|---|---|
| `From` | string (E.164) | yes | Customer's phone number |
| `To` | string (E.164) | yes | Tradesperson's Twilio number |
| `Body` | string | yes | SMS content |
| `MessageSid` | string | yes | Twilio message ID |
| `AccountSid` | string | yes | Twilio account ID |

**Response:** `200 OK` with empty body (Twilio requires 200 within 5 seconds). No processing happens synchronously — the webhook enqueues an event and returns immediately.

**Error responses (before signature check):**
- `401 Unauthorized` — invalid or missing Twilio signature
- `400 Bad Request` — missing required fields (`From`, `To`, `Body`, `MessageSid`)

### 2.2 Internal: Enqueue inbound SMS event

**Function:** `enqueueInboundSmsEvent({ from, to, body, messageSid, accountSid })`

**Output:** Job ID (string, UUID). Job type = `inbound_sms`.

**Side effects:** Inserts a row into the `jobs` table with `status = 'pending'`.

### 2.3 Internal: Process inbound SMS (worker)

**Function:** `processInboundSms({ from, to, body, messageSid })`

**Steps:**
1. Verify `to` maps to a valid `user_id` (look up by Twilio phone number)
2. Log inbound SMS: insert into `sms_log` (or append to relevant `booking.smsHistory`)
3. Parse intent (rule-based)
4. Branch on intent:
   - `reschedule` → call `initiateRescheduleFlow({ userId, customerPhone, bookingId })`
   - `confirm` → call `confirmPendingBooking({ customerPhone })`
   - `help` → call `sendHelpSms({ customerPhone })`
   - `unknown` → call `escalateAmbiguousIntent({ userId, customerPhone, content })`
   - `slot-choice` → handled by conversation state (see 2.5)
   - `no-matching-booking` → call `sendNoMatchingBookingSms({ customerPhone })`

**Output:** void. All results are side effects (SMS sent, records created/updated).

**Errors:** Any unhandled error logs and creates an `Escalation` record with `type = 'processing_error'`.

### 2.4 Internal: Initiate reschedule flow

**Function:** `initiateRescheduleFlow({ userId, customerPhone, bookingId })`

**Inputs:**
- `userId` (string, UUID)
- `customerPhone` (string, E.164)
- `bookingId` (string, UUID) — the confirmed booking to reschedule

**Steps:**
1. Load `booking` by ID → verify `status = 'confirmed'` and `userId` matches
2. Load `user` by ID → get `googleCalendarId`, `businessHours`, `smsSettings.rescheduleTemplate`, `phoneNumber`
3. Parse the original booking's start/end time → calculate the reschedule window (next 14 days from now, or from `startTime` if the booking is more than 14 days out)
4. Call `getAvailableSlots({ googleCalendarId, businessHours, excludeBookingIds: [bookingId], windowStart, windowEnd })`
5. If 0 slots returned → call `handleNoAvailability({ userId, customerPhone, bookingId })` and return
6. Select 3 slots (first 3 from the available list, sorted by earliest)
7. Store conversation state
8. Send slot offer SMS
9. Log everything

**Output:** void.

**Errors:**
- `404 NotFound` — booking not found or not in confirmed status
- `400 BadRequest` — user has no Google Calendar linked
- `502 BadGateway` — Google Calendar API error (after retry)

### 2.5 Internal: Process slot choice

**Function:** `processSlotChoice({ customerPhone, choice })`

**Inputs:**
- `customerPhone` (string, E.164)
- `choice` (string or number) — the option number the customer replied with

**Steps:**
1. Load conversation state by `customerPhone` → verify `state = 'offering_slots'`
2. Match `choice` to `offeredSlots[choice - 1]`
3. If no match → send invalid-choice SMS, return
4. Call `confirmReschedule({ conversationState, selectedSlot })`

**Output:** void.

### 2.6 Internal: Confirm reschedule

**Function:** `confirmReschedule({ conversationState, selectedSlot })`

**Inputs:**
- `conversationState` (object) — the full conversation state record
- `selectedSlot` (object) — `{ startTime, endTime }`

**Steps:**
1. Load original booking by `conversationState.bookingId`
2. Load user by `conversationState.userId`
3. Create new booking (see 1.1)
4. Update original booking to `status = 'rescheduled'`
5. Create Google Calendar event for new booking
6. Send confirmation SMS to customer
7. Send notification SMS to tradesperson
8. Mark conversation state complete

**Output:** void.

**Errors:**
- `500 InternalServerError` — Google Calendar event creation fails after retry → new booking is created with `status = 'pending'` and `googleCalendarEventId = null`, an `Escalation` is created, and the tradesperson is alerted to manually create the calendar event

### 2.7 Internal: Calendar availability query

**Function:** `getAvailableSlots({ googleCalendarId, businessHours, excludeBookingIds, windowStart, windowEnd })`

**Inputs:**
- `googleCalendarId` (string)
- `businessHours` (object) — `{ start: '09:00', end: '17:00', timezone: 'America/New_York' }`
- `excludeBookingIds` (string[]) — booking IDs to exclude from availability check (the original booking being rescheduled)
- `windowStart` (Date) — start of search window
- `windowEnd` (Date) — end of search window

**Output:**
```typescript
type AvailableSlot = {
  startTime: Date;  // ISO 8601
  endTime: Date;    // ISO 8601
};
type GetAvailableSlotsResult = {
  slots: AvailableSlot[];  // sorted by startTime ascending
  errors: Array<{ type: string; message: string }>;
};
```

**Logic:**
1. Query Google Calendar `freeBusy` for the date range
2. Parse busy periods
3. Generate candidate slots within `businessHours` at 1-hour intervals (or 30-minute if `businessHours` allows)
4. Filter out slots that overlap with busy periods
5. Filter out slots that overlap with existing `Booking` records (status `pending` or `confirmed`) excluding `excludeBookingIds`
6. Return up to 20 candidate slots (the caller picks 3)

**Errors:** If Google Calendar API is unreachable, return `{ slots: [], errors: [{ type: 'calendar_api_error', message: '...' }] }`. Do not throw.

### 2.8 API error shape (all internal functions)

```typescript
type ApiError = {
  type: string;       // e.g. 'not_found', 'bad_request', 'calendar_api_error', 'sms_send_error'
  message: string;    // human-readable
  code: string | null; // machine-readable error code for logging/alerting
  details?: Record<string, unknown>;
};
```

### 2.9 Dashboard API (for tradesperson to view escalations and reschedule history)

**GET /api/dashboard/escalations**

**Auth:** JWT (Bearer token in Authorization header). Invalid/expired/ missing → `401 Unauthorized`.

**Response:** `200 OK`
```typescript
type EscalationListResponse = {
  escalations: Array<{
    id: string;
    type: 'ambiguous_intent' | 'no_availability' | 'calendar_api_failure' | 'sms_delivery_failure' | 'processing_error';
    customerPhone: string;
    content: string | null;
    status: 'pending' | 'resolved';
    createdAt: string; // ISO 8601
    resolvedAt: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
};
```

**GET /api/dashboard/bookings/:bookingId/reschedule-history**

**Response:** `200 OK`
```typescript
type RescheduleHistoryResponse = {
  bookingId: string;
  rescheduleLog: Array<{
    action: 'reschedule-offer' | 'reschedule-confirm' | 'reschedule-completed' | 'reschedule-failed';
    timestamp: string;
    details: string;
  }>;
};
```

---

## 3. Data: Schema Changes + Migrations

### 3.1 New tables

**`conversation_states`**

```sql
CREATE TABLE conversation_states (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL,           -- customer phone (E.164), indexed
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id    UUID,                    -- the booking being rescheduled (if applicable)
  state         TEXT NOT NULL CHECK (state IN (
    'offering_slots',
    'awaiting_slot_choice',
    'completed',
    'escalated'
  )),
  offered_slots JSONB,                   -- [{optionNumber: 1, startTime: 'ISO', endTime: 'ISO'}, ...]
  selected_slot JSONB,                   -- {optionNumber: 1, startTime: 'ISO', endTime: 'ISO'} or null
  escalation_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_conversation_states_phone ON conversation_states(phone);
CREATE INDEX idx_conversation_states_user_id ON conversation_states(user_id);
CREATE INDEX idx_conversation_states_state ON conversation_states(state) WHERE state IN ('offering_slots', 'awaiting_slot_choice');
```

**`escalations`**

```sql
CREATE TABLE escalations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
    'ambiguous_intent',
    'no_availability',
    'calendar_api_failure',
    'sms_delivery_failure',
    'processing_error'
  )),
  customer_phone TEXT,                   -- if applicable
  content       TEXT,                    -- the SMS content that triggered escalation
  status        TEXT NOT NULL CHECK (status IN ('pending', 'resolved')) DEFAULT 'pending',
  metadata      JSONB,                   -- arbitrary context (error details, booking ID, etc.)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES users(id)
);

CREATE INDEX idx_escalations_user_id ON escalations(user_id);
CREATE INDEX idx_escalations_status ON escalations(status) WHERE status = 'pending';
```

### 3.2 Modifications to existing tables

**`bookings` — add `rescheduled_from_id`**

```sql
ALTER TABLE bookings ADD COLUMN rescheduled_from_id UUID REFERENCES bookings(id);
CREATE INDEX idx_bookings_rescheduled_from_id ON bookings(rescheduled_from_id);
```

This links a new booking to the original booking it was rescheduled from. Useful for history and audit.

**`bookings` — add `rescheduleLog` (JSONB)**

```sql
ALTER TABLE bookings ADD COLUMN reschedule_log JSONB DEFAULT '[]'::jsonb;
```

Stores the reschedule action log (mirrors the API response in 2.9). Alternative: a separate `reschedule_events` table. For v1, JSONB on the booking is simpler and sufficient.

### 3.3 Migration order

1. Create `conversation_states` table
2. Create `escalations` table
3. Add `rescheduled_from_id` to `bookings`
4. Add `reschedule_log` to `bookings`

All migrations are reversible (DROP TABLE / ALTER COLUMN ... DROP).

---

## 4. UI States (Dashboard)

The dashboard is where the tradesperson sees escalations and reschedule activity. This spec covers the minimal UI needed to surface the flow's output — not a full dashboard rebuild.

### 4.1 Escalations list

**State: loading**  
- Skeleton / spinner while `GET /api/dashboard/escalations` resolves

**State: empty**  
- "No pending escalations" with a checkmark icon  
- Only shown when `total === 0`

**State: error**  
- "Failed to load escalations. Pull to refresh."  
- Retry button

**State: success (with items)**  
- List of escalation cards, each showing:
  - Type (badge: `ambiguous_intent` = amber, `no_availability` = blue, `calendar_api_failure` = red, `sms_delivery_failure` = red, `processing_error` = red)
  - Customer phone (masked: `+1 (555) ***-****` or full if user taps to reveal)
  - Content snippet (first 80 chars)
  - Created time (relative: "2m ago")
  - Status badge: `pending` = amber, `resolved` = green
  - Action button: "Resolve" (marks `status = 'resolved'`, sets `resolved_at = now`)

### 4.2 Booking detail — reschedule history

**State: loading** — skeleton  
**State: empty** — "No reschedule history for this booking"  
**State: success** — chronological list of reschedule actions with timestamps

### 4.3 shadcn/ui components used (per project rule)

- `Card` — escalation card container
- `Badge` — type and status badges
- `Button` — "Resolve" action, "Retry" button
- `Skeleton` — loading states
- `Toast` — success/error feedback after actions
- `DropdownMenu` — optional: mask/unmask phone number

No hand-rolled UI primitives. If a shadcn component doesn't exist for a needed pattern, add it via `npx shadcn add`, not custom code.

---

## 5. Non-Goals (deliberately skipped)

- **LLM-based intent parsing.** v1 uses rule-based parsing only. The extension point is defined (the `parseIntent` function returns `{ intent, confidence }`), and an LLM fallback can be plugged in later without changing the flow logic. The PRD's "LLM fallback for reschedule" is deferred.
- **Customer-facing web UI.** The entire flow is SMS-driven. No web portal for customers to reschedule.
- **Multi-slot pagination.** Only 3 slots are offered per the PRD. If a customer rejects all 3, the flow escalates (no "show me 3 more" behavior).
- **Timezone conversion UI.** The tradesperson sets `businessHours.timezone` in settings (out of scope for this spec). The backend handles conversion; the UI just displays the final time in the customer's SMS.
- **Deposit re-collection.** The original deposit carries over (`depositStatus = 'transferred'`). No new Paddle charge, no Stripe touch.
- **Google Calendar offline fallback.** If the calendar API is down, the flow escalates. No local cache of calendar state.
- **Bulk reschedule.** One booking at a time. No "reschedule all my bookings" behavior.
- **Tradesperson mobile app.** The tradesperson is notified via SMS only. No push notifications or in-app alerts for this flow (dashboard escalation list is the only UI).
- **SMS opt-out handling (STOP/BUSY).** Out of scope for v1. If a customer replies "STOP", the system logs it but does not implement opt-out logic yet.

---

## 6. Acceptance Checklist

Verify each line independently. A line is "done" only when the behavior matches the spec exactly.

### Flow initiation
- [x] Customer replies "R" (any case/punctuation variant) to a confirmation SMS → system identifies the booking and initiates reschedule
- [x] Customer replies "reschedule", "move", "change time" → same behavior as "R"
- [x] Customer replies something ambiguous (e.g., "maybe later", "idk") → system does NOT initiate reschedule, sends "I didn't catch that" SMS, creates escalation
- [x] Customer replies "R" but has no confirmed booking → system sends "I can't find an upcoming booking" SMS
- [x] Customer replies "R" to a booking that's already been rescheduled → system sends "I can't find an upcoming booking" SMS

### Slot offer
- [x] System queries Google Calendar for the tradesperson's free/busy slots within `businessHours` for the next 14 days
- [x] System excludes the original booking's time slot from availability
- [x] System excludes any other confirmed/pending bookings from availability
- [x] System returns exactly 3 open slots, sorted earliest-first
- [x] System sends SMS with 3 numbered options using `smsSettings.rescheduleTemplate`
- [x] System stores conversation state with `state = 'offering_slots'` and `offeredSlots`
- [x] System logs the outbound SMS in `smsHistory`

### Slot selection
- [x] Customer replies "1" (matching first offered slot) → system creates new booking at that time
- [x] Customer replies "2" or "3" → same behavior
- [x] Customer replies "4" (not in offered set) → system sends "I only have options 1, 2, and 3" SMS, keeps state as `offering_slots`
- [x] Customer replies "R" again while in `offering_slots` state → system treats as a new intent, not a valid choice (behavior: either ignore or re-offer — spec: re-send the same 3 options with a reminder)

### Reschedule confirmation
- [x] New booking is created with `status = 'pending'`, `depositStatus = 'transferred'`, `rescheduled_from_id` pointing to original
- [x] Original booking is updated to `status = 'rescheduled'`
- [x] Google Calendar event is created for the new booking at the selected time
- [x] New booking's `googleCalendarEventId` is set to the created event ID
- [x] Confirmation SMS is sent to customer: "Your appointment is rescheduled to [time]. Reply CONFIRM to lock it in."
- [x] Notification SMS is sent to tradesperson: "[customerName] rescheduled to [time]. Reply CONFIRM to lock it in."
- [x] Both SMSs are logged in the new booking's `smsHistory`
- [x] Conversation state is marked `state = 'completed'`, `completedAt = now`
- [x] `reschedule_log` on the original booking includes the reschedule action

### Customer confirms
- [x] Customer replies "CONFIRM" to the rescheduled booking's confirmation SMS → booking status updates to `confirmed`
- [x] "Confirmed. See you on [time]." SMS is sent to customer
- [x] CONFIRM is logged in `smsHistory`

### Escalations
- [x] Ambiguous intent (confidence < 70%) → escalation created with `type = 'ambiguous_intent'`, status `pending`
- [x] No availability → escalation created with `type = 'no_availability'`, status `pending`
- [x] Google Calendar API failure → escalation created with `type = 'calendar_api_failure'`, status `pending`
- [x] SMS send failure → escalation created with `type = 'sms_delivery_failure'`, status `pending`
- [x] All escalations appear in `GET /api/dashboard/escalations` with correct type, customer phone, content, status, and created time
- [x] Tradesperson can resolve an escalation via the dashboard (marks `status = 'resolved'`, sets `resolved_at`)

### Error handling
- [x] Invalid Twilio signature → `401 Unauthorized`, no processing
- [x] Missing required fields in webhook → `400 Bad Request`
- [x] Google Calendar API error → retry once, then escalate (no booking created/modified)
- [x] Twilio SMS send error → retry once, then escalate (no flow advancement)
- [x] Worker restart mid-flow → conversation state reloaded from Postgres, no state lost, no duplicate SMSs

### Data integrity
- [x] `conversation_states` row is created when slots are offered, updated on choice, marked complete on confirmation
- [x] `escalations` row is created for every escalation scenario
- [x] `rescheduled_from_id` links new booking to original
- [x] `reschedule_log` on original booking records the action
- [x] No booking is created without a corresponding SMS log entry
- [x] No SMS is sent without a logged consent record (customer replied to a confirmation SMS, initiating the flow — that reply is the consent log entry)

### Dashboard UI
- [x] Loading state shows skeleton/spinner
- [x] Empty state shows "No pending escalations"
- [x] Error state shows retry option
- [x] Success state shows escalation cards with type badge, masked phone, content snippet, relative time, status badge, and "Resolve" button
- [x] All UI components are shadcn/ui (Card, Badge, Button, Skeleton, Toast) — no hand-rolled primitives

---

**That's the spec.** Approve it and I'll implement exactly this — no deviations without updating the spec and getting your OK first.
