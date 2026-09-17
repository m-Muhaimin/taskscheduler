# Build Sequence: Reschedule-by-Text Flow

**Spec:** `docs/spec-reschedule-flow.md` (approved)  
**Project:** `tradescheduler/` (Next.js + Express + Supabase + Twilio)  
**Rule:** App compiles and runs after EVERY step. One "go" between steps.

---

## Step 0 — Project bootstrap (S)

**Files created:**
- `package.json` (workspaces: `apps/api`, `apps/web`)
- `apps/api/package.json` (Express, Twilio SDK, googleapis, jsonwebtoken, pg, @supabase/supabase-js, zod, tsx, nodemon)
- `apps/web/package.json` (Next.js 15, React 19, Tailwind 4, shadcn/ui deps)
- `packages/shared/package.json` (@types/node, TypeScript)
- Root `tsconfig.json`, `apps/api/tsconfig.json`, `apps/web/tsconfig.json`
- `apps/api/src/index.ts` — health check `GET /api/health`
- `apps/web/src/app/page.tsx` — placeholder home page
- `.env.example` — all env vars listed, no real values
- `.gitignore` (node_modules, .env, .next, dist, build)

**What changes:** Project goes from "a few TS files in lib/ and hooks/" to a compilable monorepo that starts.

**Verify:**
1. `cd /c/Users/muhai/tradescheduler && npm install` — installs without error
2. `npm run dev` — both API and web start, no crashes
3. `curl http://localhost:3001/api/health` → `{"status":"ok"}` (or whichever port API uses)
4. `open http://localhost:3000` → placeholder page renders (or `curl` returns 200 with page content)
5. `git init && git add . && git commit -m "chore: initial project scaffold"` — one commit, clean tree

**Dependency added:** Twilio SDK (`twilio`), Google APIs (`googleapis`), Express, Next.js, Tailwind, shadcn/ui, Supabase client, jsonwebtoken, pg, zod, tsx. All pinned to current-stable from npm view (Next 15.3.5, React 19.3.0, Express 5.2.1, Twilio 6.1.1, etc.)

**Migration:** None (no DB yet).

---

## Step 1 — Shared types (S)

**Files created/changed:**
- `packages/shared/src/types.ts` — `User`, `Booking`, `Lead`, `SmsMessage`, `ConversationState`, `TwilioInboundSmsPayload`, `TwilioStatusCallbackPayload`, `IntentResult`, `AvailableSlot`, `ApiError`
- `packages/shared/package.json` — exports `types`
- `apps/api/src/types.ts` — re-exports from `@repo/shared` (or imports directly)
- `apps/web/src/types.ts` — re-exports from `@repo/shared`

**What changes:** All apps now share one source of truth for domain types. The spec's data model (§3) is encoded as TypeScript.

**Verify:**
1. `cd packages/shared && tsc --noEmit` — passes
2. `cd apps/api && tsc --noEmit` — can import `@repo/shared` types, no type errors
3. `cd apps/web && tsc --noEmit` — same

**Dependency added:** None (TypeScript is already in the project via Step 0).

**Migration:** None.

**Risk:** Low. Types are descriptive only — no runtime behavior.

---

## Step 2 — Twilio webhook signature verification (S)

**Files created/changed:**
- `apps/api/src/middleware/twilio-signature.ts` — exports `verifyTwilioSignature(req, res, next)` using `twilio.validateRequest()` (Twilio SDK built-in) or manual HMAC-SHA1 against `TWILIO_AUTH_TOKEN`
- `apps/api/src/routes/twilio-webhooks.ts` — `POST /api/twilio/webhooks/inbound-sms`, applies signature middleware FIRST, returns `200 OK` for valid, `401` for invalid, `400` for missing fields
- `apps/api/src/app.ts` (or equivalent Express setup) — mounts `/api/twilio/webhooks/inbound-sms`

**What changes:** The app now accepts Twilio webhooks and rejects forged ones before any processing.

**Verify:**
1. Start the API: `npm run dev` (or `tsx watch apps/api/src/index.ts`)
2. Manual test with a valid Twilio-signed request (use Twilio's `validateRequest` test helpers, or craft a signed request against a test `TWILIO_AUTH_TOKEN`):
   - Valid signature → `200 OK`, empty body, request logged
   - Tampered `Body` → `401 Unauthorized`
   - Missing `X-Twilio-Signature` header → `401 Unauthorized`
   - Missing `From`/`To`/`Body`/`MessageSid` → `400 Bad Request`
3. `curl` or Postman to `POST http://localhost:3001/api/twilio/webhooks/inbound-sms` with form-encoded body → verify 401 without signature

**Dependency added:** None beyond Twilio SDK (already in Step 0).

**Migration:** None.

**Risk:** Low. This is a well-documented Twilio pattern. Risk is in getting the HMAC right — Twilio's SDK `validateRequest` handles it, so prefer that over hand-rolled HMAC.

---

## Step 3 — SMS service (S)

**Files created/changed:**
- `apps/api/src/services/sms-service.ts` — `sendSms({ to, from, body })` wraps `twilioClient.messages.create()`, returns `{ messageSid, status }`, logs to console (or a structured logger), throws on Twilio API error
- `apps/api/src/services/sms-service.test.ts` — unit tests with mocked Twilio client

**What changes:** The app can send SMS via Twilio. This is the primitive that all downstream flows (reschedule offer, confirmation, missed-call auto-text) will use.

**Verify:**
1. Unit tests pass: `cd apps/api && npm test` (or `vitest run`) — mocked Twilio client returns a `messageSid`, error path throws
2. Smoke test with a real Twilio account (requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in `.env`):
   - Send a test SMS to your own number → receive it, note the `MessageSid`
   - **This is the first live Twilio call — confirm you're okay with a test SMS going out before running this.**

**Dependency added:** None (Twilio SDK already in Step 0).

**Migration:** None.

**Risk:** Medium — first live external API call. A misconfigured `TWILIO_PHONE_NUMBER` or invalid `To` number will throw; the service should catch and log, not crash the server. The verify step uses a real Twilio account — you need one with SMS capability.

---

## Step 4 — Job queue + worker foundation (M)

**Files created/changed:**
- `apps/api/src/services/queue-service.ts` — `enqueue({ type, payload })` inserts a row into `jobs` table, returns job ID; `dequeue()` claims the next `pending` job with `FOR UPDATE SKIP LOCKED`, returns it; `complete(jobId)`, `fail(jobId, error)`
- `apps/api/src/worker/index.ts` — worker process that polls `dequeue()` in a loop, dispatches on `type` (stub for now — just logs and completes), sleeps between polls
- `apps/api/src/worker/process-inbound-sms.ts` — stub handler for `type = 'inbound_sms'` — logs the payload and completes the job
- `apps/api/src/db/migrations/001-create-jobs-table.sql` — `jobs` table: `id UUID PK, type TEXT, payload JSONB, status TEXT CHECK (pending/processing/completed/failed), attempts INT, created_at, updated_at, locked_at, locked_by`

**What changes:** The app now has a durable Postgres-backed job queue. Webhooks enqueue; a worker processes. The webhook route from Step 2 is changed to enqueue instead of returning immediately after signature check.

**Verify:**
1. Apply migration: `psql $DATABASE_URL -f apps/api/src/db/migrations/001-create-jobs-table.sql` (or use a migration tool — db browsers / Supabase SQL editor / prisma migrate / drizzle migrate — confirm which tool you're using)
2. Start the API and the worker: `npm run dev` starts API; `npm run worker` (or `tsx watch apps/api/src/worker/index.ts`) starts worker
3. `curl` a valid Twilio webhook payload (with signature) → API returns 200, a row appears in `jobs` with `status = 'pending'`
4. Worker picks up the job → `status = 'processing'` → `status = 'completed'`, logs the inbound SMS payload
5. Check `jobs` table: exactly one row, `status = 'completed'`, `attempts = 1`

**Dependency added:** A Postgres client (`pg` or `@supabase/supabase-js`) for the queue operations. If you're using Supabase JS client, the queue operations use `supabase.from('jobs').insert/update`. If using `pg`, it's raw SQL.

**Migration:** `001-create-jobs-table.sql` — new table, no data loss.

**Risk:** Medium — the queue is the backbone for all async processing. A bug here (e.g., `SKIP LOCKED` wrong, or jobs getting stuck in `processing`) blocks everything downstream. The verify step exercises the full enqueue → process → complete cycle.

---

## Step 5 — Intent parsing: rule-based (M) — RISKIEST UNKNOWN FIRST

**Files created/changed:**
- `apps/api/src/services/intent-service.ts` — `parseIntent(body: string): IntentResult` — rule-based: matches "R"/"reschedule"/"move"/"change time"/"can we move" → `{ intent: 'reschedule', confidence: 0.95 }`; "CONFIRM" → `{ intent: 'confirm', confidence: 0.95 }`; "HELP" → `{ intent: 'help', confidence: 0.95 }`; numeric match against conversation state → `{ intent: 'slot-choice', confidence: 0.9 }`; everything else → `{ intent: 'unknown', confidence: 0.0 }`
- `apps/api/src/services/intent-service.test.ts` — comprehensive test suite: every intent pattern from the spec, edge cases (case variations, punctuation, leading/trailing whitespace, multi-word phrases, non-English characters), confidence boundary tests (exactly 70%, just under 70%)

**What changes:** The worker (Step 4) now calls `parseIntent` on each inbound SMS body and branches on the result. The worker still only logs — no flow logic yet.

**Verify:**
1. Unit tests pass: `npm test` — every rule from the spec produces the expected `IntentResult`
2. Edge case tests pass: "r." → `reschedule` at 0.95; "R!" → same; "maybe later" → `unknown` at 0.0; "1" with no conversation state → `unknown` (not `slot-choice` — slot-choice requires state)
3. Confidence boundary: a pattern that should be 0.70 exactly is classified correctly (the spec says <70% escalates; the boundary test ensures 70% is treated as "confident" and 69% as "not confident")

**Dependency added:** None.

**Migration:** None.

**Risk:** HIGH — this is the riskiest unknown. Rule-based parsing is brittle by nature. The test suite is the safety net. Specific risks:
- A customer writes "can we move it to tomorrow?" — does the rule catch "move" inside a longer sentence? (Test for this.)
- A customer writes "Reschedule please" with capital R — case-insensitive matching must handle it.
- A customer writes "1" meaning "I agree" not "option 1" — the parser must NOT classify bare numbers as `slot-choice` without conversation state. (The test suite must enforce this.)
- Punctuation: "r." / "R!" / "r?" — all must parse as `reschedule`.

**This is the step where the spec's intent classification is proven or disproven.** If the rule-based parser can't handle the real-world variations you care about, we stop, update the spec to add an LLM fallback (deferring per spec non-goals), and get your OK before continuing. The spec says rule-based only for v1 — but if the rules are insufficient, the spec's non-goal on LLM parsing may need to be revisited. That's a spec change, not a code change, and requires your OK.

---

## Step 6 — Inbound SMS processing: dispatch on intent (M)

**Files created/changed:**
- `apps/api/src/worker/process-inbound-sms.ts` — real implementation: loads user by `to` (Twilio number → user), logs inbound SMS to `sms_log` (or booking's `smsHistory`), calls `parseIntent`, branches:
  - `reschedule` → calls `initiateRescheduleFlow` (stub — returns a "not implemented" log for now)
  - `confirm` → calls `confirmPendingBooking` (stub)
  - `help` → calls `sendHelpSms` (stub — sends the HELP SMS via `sms-service`)
  - `unknown` → calls `escalateAmbiguousIntent` (stub — creates escalation record)
  - `slot-choice` → handled by conversation state (not implemented yet — will be Step 9)
  - `no-matching-booking` → sends the "I can't find an upcoming booking" SMS
- `apps/api/src/services/escalation-service.ts` — `createEscalation({ userId, type, customerPhone, content, metadata })` inserts into `escalations` table
- `apps/api/src/db/migrations/002-create-escalations-table.sql` — `escalations` table (from spec §3.1)

**What changes:** The worker now dispatches on intent. Most branches are stubs that log + complete the job. The `help` and `no-matching-booking` branches actually send SMS (end-to-end for those two cases). Escalations are persisted.

**Verify:**
1. Apply migration 002
2. Send a test inbound SMS with body "HELP" (via Twilio) → worker picks it up, sends the HELP SMS to the customer, logs the intent, completes the job
3. Send a test inbound SMS with body "maybe later" → worker picks it up, creates an `escalation` row with `type = 'ambiguous_intent'`, status `pending`, logs, completes
4. Check the `escalations` table: row exists, correct type, correct status
5. Send a test inbound SMS with body "R" → worker picks it up, calls `initiateRescheduleFlow` stub (logs "not implemented"), completes — no SMS sent, no booking created

**Dependency added:** None beyond what's in Step 0.

**Migration:** `002-create-escalations-table.sql` — new table.

**Risk:** Medium — the dispatch logic must correctly route every intent. A misclassification here (e.g., "R" falling through to `unknown`) would silently escalate instead of initiating a reschedule. The verify step tests HELP, unknown, and R specifically. The `help` SMS sending is a real live Twilio call — confirm you're okay with test SMSs going out.

---

## Step 7 — `initiateRescheduleFlow`: calendar availability + slot offer (L)

**Files created/changed:**
- `apps/api/src/services/calendar-service.ts` — `getAvailableSlots({ googleCalendarId, businessHours, excludeBookingIds, windowStart, windowEnd })` — queries Google Calendar `freeBusy`, generates candidate slots within business hours, filters out busy periods and existing bookings, returns up to 20 slots
- `apps/api/src/services/reschedule-service.ts` — `initiateRescheduleFlow({ userId, customerPhone, bookingId })` — the full flow from spec §2.4: load booking (verify confirmed), load user (get calendar ID, business hours, template), compute window, call `getAvailableSlots`, if 0 slots → `handleNoAvailability`, else pick 3, store conversation state, send slot offer SMS via `sms-service`, log
- `apps/api/src/services/conversation-service.ts` — `createConversationState({ phone, userId, bookingId, state, offeredSlots })` inserts into `conversation_states` table; `getConversationState(phone)` loads it; `updateConversationState` updates it
- `apps/api/src/db/migrations/003-create-conversation-states-table.sql` — `conversation_states` table (from spec §3.1)
- `apps/api/src/services/calendar-service.test.ts` — unit tests with mocked Google Calendar API: returns slots, returns empty on no availability, returns error on API failure

**What changes:** The reschedule flow is now real for the "offer slots" half. A customer replying "R" to a confirmation SMS will get a slot offer SMS (3 options) if availability exists.

**Verify:**
1. Apply migration 003
2. Unit tests for `calendar-service` pass with mocked Google Calendar
3. Unit tests for `reschedule-service` pass with mocked calendar + mocked SMS service + mocked conversation service
4. Integration test (with real Twilio, real Google Calendar, real DB — or mocked as needed):
   - Create a test booking (confirmed) in the DB with a test user who has a Google Calendar ID
   - Send an inbound SMS with body "R" from the customer's phone
   - Worker processes it → `initiateRescheduleFlow` runs → slot offer SMS is sent to customer → conversation state is stored → job completes
   - Verify: customer receives the SMS with 3 numbered options; `conversation_states` row exists with `state = 'offering_slots'` and `offeredSlots` populated; `smsHistory` on the booking has the outbound log entry

**Dependency added:** Google Calendar API access (`googleapis` npm package, already in Step 0). Google Cloud credentials (service account JSON or OAuth token) in `GOOGLE_CALENDAR_CREDENTIALS` or `GOOGLE_APPLICATION_CREDENTIALS`. This is a new external dependency — the verify step needs a real Google Calendar that the test user owns, with `freeBusy` API enabled.

**Migration:** `003-create-conversation-states-table.sql` — new table.

**Risk:** HIGH — this is the first step that touches Google Calendar and sends real reschedule SMSs. Specific risks:
- Google Calendar `freeBusy` API may not return the data you expect (e.g., if the calendar is shared, or if the service account doesn't have access). The test must use a calendar the test user actually owns and that the service account can read.
- Slot generation logic (business hours + 1-hour intervals + filtering) must be correct or you'll offer unavailable slots. The unit test with mocked busy periods is the safety net.
- The slot offer SMS is a real customer-facing message — get the wording right before sending real ones. The spec's wording is in §1.1.
- If Google Calendar is unreachable, the flow escalates (spec §1.8) — verify this path too.

---

## Step 8 — `processSlotChoice` + `confirmReschedule`: the rest of the flow (L)

**Files created/changed:**
- `apps/api/src/services/reschedule-service.ts` — add `processSlotChoice({ customerPhone, choice })` and `confirmReschedule({ conversationState, selectedSlot })`
- `apps/api/src/worker/process-inbound-sms.ts` — wire `slot-choice` intent to `processSlotChoice`
- `apps/api/src/services/calendar-service.ts` — add `createCalendarEvent({ googleCalendarId, startTime, endTime, summary, description, attendees })` — inserts an event via Google Calendar API
- Update `apps/api/src/worker/process-inbound-sms.ts` — wire `confirm` intent to `confirmPendingBooking` (real implementation now, not stub)

**What changes:** The full reschedule flow is now complete. Customer replies "R" → gets 3 slots → replies "1" → new booking created, original marked rescheduled, Google Calendar event created, both parties notified, conversation state completed.

**Verify:**
1. End-to-end test (real Twilio, real Google Calendar, real DB — this is the big one):
   - Create a confirmed test booking
   - Send "R" from customer phone → receive slot offer SMS with 3 options
   - Reply "1" → verify:
     - New booking created with `status = 'pending'`, `depositStatus = 'transferred'`, `rescheduled_from_id` = original booking ID
     - Original booking updated to `status = 'rescheduled'`, `reschedule_log` includes the action
     - Google Calendar event created at the selected time with correct summary/description
     - New booking's `googleCalendarEventId` set to the created event ID
     - Confirmation SMS sent to customer ("Your appointment is rescheduled to [time]. Reply CONFIRM to lock it in.")
     - Notification SMS sent to tradesperson ("[customerName] rescheduled to [time]. Reply CONFIRM to lock it in.")
     - Both SMSs logged in new booking's `smsHistory`
     - Conversation state marked `state = 'completed'`, `completedAt` set
   - Reply "CONFIRM" to the confirmation SMS → booking status updates to `confirmed`, "Confirmed. See you on [time]." SMS sent, logged

2. Edge case tests (can be unit/integration with mocked dependencies):
   - Customer replies "4" (invalid choice) → "I only have options 1, 2, and 3" SMS sent, state stays `offering_slots`
   - Customer replies "HELP" mid-flow → HELP SMS sent, state unchanged
   - No availability → escalation created, "I'm fully booked" SMS sent, state `escalated`
   - Google Calendar API failure → retry once, then escalation, no booking created

**Dependency added:** None beyond Google Calendar API (already in Step 7).

**Migration:** None (tables already created in Steps 4 and 7).

**Risk:** HIGH — this is the most complex step and the one that creates real bookings and calendar events. Specific risks:
- Creating a Google Calendar event for the new booking: if this fails after the booking is created, you have a booking with no calendar event. The spec says the booking is created with `status = 'pending'` and `googleCalendarEventId = null`, and an escalation is created. Verify the rollback path: if event creation fails, the booking still exists (pending), the tradesperson is alerted, and they can manually create the event.
- `depositStatus = 'transferred'` — this is a logical state, not a real payment operation. No Paddle or Stripe call is made. Verify that no payment API is called during this flow (the spec says deposit carries over, no new charge).
- Duplicate SMSs: if the worker retries a job that already completed (e.g., due to a crash after completion but before the DB write), you could send duplicate SMSs. The job `complete()` must be atomic with the side effects, or the side effects must be idempotent. Verify idempotency: processing the same job twice does not send duplicate SMSs or create duplicate bookings.
- The "Reply CONFIRM to lock it in" flow (§1.2) is a separate inbound SMS processing path — verify it doesn't conflict with the reschedule flow. A customer who just got a reschedule confirmation SMS and replies "CONFIRM" should confirm the new booking, not trigger another reschedule.

---

## Step 9 — Dashboard: escalations list + booking reschedule history (M)

**Files created/changed:**
- `apps/web/src/app/dashboard/escalations/page.tsx` — escalations list page: loading skeleton, empty state ("No pending escalations"), error state with retry, success state with escalation cards
- `apps/web/src/components/escalation-card.tsx` — single escalation card: type badge (shadcn `Badge`, color-coded by type), masked phone, content snippet, relative time, status badge, "Resolve" button
- `apps/web/src/components/escalation-card.test.tsx` — rendering tests: loading, empty, error, success with one escalation, success with multiple
- `apps/api/src/routes/dashboard/escalations.ts` — `GET /api/dashboard/escalations` — JWT-protected, returns paginated escalation list
- `apps/api/src/routes/dashboard/bookings/[bookingId]/reschedule-history.ts` — `GET /api/dashboard/bookings/:bookingId/reschedule-history` — returns reschedule log for a booking
- `apps/api/src/middleware/auth.ts` — JWT verification middleware (if not already present)
- `apps/web/src/app/dashboard/bookings/[bookingId]/page.tsx` — booking detail page with reschedule history section

**What changes:** The tradesperson can now see escalations and booking reschedule history in the dashboard UI. This is the only UI added by this spec (the flow itself is SMS-driven).

**Verify:**
1. Web app compiles: `cd apps/web && npm run build` — no errors
2. Escalations page loads: `GET /api/dashboard/escalations` with valid JWT → returns list; without JWT → `401`
3. Create a test escalation in the DB (ambiguous intent from Step 6 test) → load the escalations page → card renders with correct type badge, masked phone, content snippet, relative time, status badge, "Resolve" button
4. Click "Resolve" → `PATCH /api/dashboard/escalations/:id/resolve` (or similar) → escalation status updates to `resolved`, `resolved_at` set, UI updates
5. Booking reschedule history: load a booking that has been rescheduled (from Step 8 test) → history section shows the reschedule log entries with timestamps

**Dependency added:** None beyond shadcn/ui components (Card, Badge, Button, Skeleton, Toast) — all added via `npx shadcn add` in Step 0 or as needed here.

**Migration:** None.

**Risk:** Low — this is read-only UI on top of existing APIs. Risks: JWT auth must be correct (401 for invalid tokens), the escalations list must paginate correctly, the "Resolve" action must actually update the DB and reflect in the UI.

---

## Step 10 — Error handling + edge cases hardening (M)

**Files created/changed:**
- `apps/api/src/services/sms-service.ts` — add retry logic: on Twilio error, retry once after 30s; if retry fails, log + create escalation + alert
- `apps/api/src/services/calendar-service.ts` — add retry logic: on Google Calendar API error, retry once after 30s; if retry fails, return empty slots + error entry (caller handles escalation)
- `apps/api/src/worker/index.ts` — add crash recovery: on startup, scan `conversation_states` for any in `offering_slots` or `awaiting_slot_choice` state older than 5 minutes and re-offer or escalate (spec §1.10 — no state should be lost, but a stuck conversation should be cleaned up)
- `apps/api/src/services/intent-service.ts` — add the "re-offer" behavior for "R" received while in `offering_slots` state (spec §6, slot selection bullet 4: re-send the same 3 options with a reminder)
- Update `apps/api/src/services/reschedule-service.ts` — handle the case where `initiateRescheduleFlow` is called but the booking is already `rescheduled` (spec §1.7: send "I can't find an upcoming booking" SMS)

**What changes:** The flow is now robust against the failure modes in the spec. Retry logic, crash recovery, edge case handling are all in place.

**Verify:**
1. Unit tests for retry logic: mock Twilio to fail once then succeed → SMS is sent on retry; mock Twilio to fail twice → escalation created, no SMS sent
2. Unit tests for calendar retry: same pattern
3. Crash recovery test: insert a `conversation_states` row with `state = 'offering_slots'` and `created_at` 10 minutes ago → restart worker → worker detects it and either re-offers or escalates (spec says no state lost, but stuck conversations should be cleaned up — decide which)
4. Edge case: send "R" to a booking that's already `rescheduled` → "I can't find an upcoming booking" SMS sent
5. Edge case: send "R" while in `offering_slots` state (after already receiving slot offer) → re-send the same 3 options with a reminder SMS

**Dependency added:** None.

**Migration:** None.

**Risk:** Medium — retry logic and crash recovery can introduce subtle bugs (e.g., double-retry, or cleaning up conversations that weren't actually stuck). The verify step tests each path. The crash recovery behavior (re-offer vs escalate for stale conversations) is a product decision — confirm which you want before this step.

---

## Step 11 — Final acceptance verify (S)

**Files created/changed:** None (verification only).

**What changes:** Everything is verified against the spec's acceptance checklist (§6).

**Verify — run each line from the spec's acceptance checklist:**

1. Flow initiation: send "R", "reschedule", "move", "change time", "can we move" → all initiate reschedule. Send "maybe later", "idk" → no reschedule, escalation created. Send "R" with no booking → "I can't find an upcoming booking" SMS.
2. Slot offer: verify 3 slots offered, sorted earliest-first, within business hours, excluding original booking and other bookings. Verify SMS wording matches spec.
3. Slot selection: reply 1/2/3 → new booking created. Reply 4 → invalid-choice SMS. Reply "R" again → re-offer.
4. Reschedule confirmation: new booking `pending`/`transferred`/`rescheduled_from_id` set. Original `rescheduled`. Calendar event created. Both SMSs sent and logged. State completed. `reschedule_log` updated.
5. Customer confirms: "CONFIRM" → booking `confirmed`, confirmation SMS sent.
6. Escalations: all 5 escalation types create correct rows. Dashboard shows them. Resolve works.
7. Error handling: invalid signature → 401. Missing fields → 400. Calendar API error → retry + escalate. SMS failure → retry + escalate. Worker restart → state reloaded.
8. Data integrity: every SMS logged. Every booking has SMS history. `conversation_states` row created/updated/completed. `escalations` rows for every escalation. `rescheduled_from_id` linked. `reschedule_log` updated.
9. Dashboard UI: loading skeleton, empty state, error state with retry, success with cards. All shadcn components.

**This step produces the final verification report.** Any line that fails is a spec deviation — stop, update the spec, get your OK, then fix.

---

## Twilio MCP Server

**Official server exists:** `@twilio-alpha/mcp` (Twilio Labs, npm v0.7.0 as of May 2026). Source: https://twilio.com/docs/ai/mcp and https://github.com/twilio/ (Twilio Alpha team).

**What it does:** Auto-generates MCP tools from Twilio's OpenAPI specs. Exposes the full Twilio API surface (~1,800 endpoints across 40+ products). Two built-in tools: `twilio__search` (search APIs/docs by natural language) and `twilio__retrieve` (get full spec for any operation). Configurable via `--services` and `--tags` flags to scope to specific products.

**What it does NOT do:** It is an API discovery server, not an operational server. It does not have pre-built `send_sms`, `receive_sms_webhook`, or `detect_missed_call` tools. Those are your application-level operations, not raw Twilio API endpoints.

**Your tools (`send_sms`, `receive_sms_webhook`, `detect_missed_call`) are application logic, not Twilio API calls.** They involve:
- `send_sms`: call Twilio API to send a message, plus your logging/escalation logic
- `receive_sms_webhook`: your Express route that verifies Twilio signatures and enqueues events
- `detect_missed_call`: your logic that interprets Twilio `StatusCallback` webhooks and rate-limits

These are not things an MCP server can do out of the box — they're your app's business logic. An MCP server can wrap them as tools that an AI coding agent can call during development/debugging, but the MCP server is not the runtime that processes live webhooks.

**Recommendation:** Do not install `@twilio-alpha/mcp` for this project. It's a docs/search tool for AI agents to look up Twilio API details — not an operational server for your SMS flows. What you actually want is one of:

**Option A: MCP server wrapping your own app's tools (recommended for dev/debug)**
Build a small MCP server that exposes your running app's operations as MCP tools — e.g., `send_test_sms`, `lookup_conversation_state`, `list_pending_jobs`. This lets an AI coding agent trigger and inspect your app's behavior during development. This is a thin MCP wrapper around your existing Express routes/services.

**Option B: Direct Twilio SDK in your app (what you already have)**
Your app already uses the Twilio SDK directly (Step 3). The MCP layer is unnecessary for runtime — it's only useful if you want an AI agent to be able to call your app's operations interactively during development.

**Option C: `@twilio-alpha/mcp` for API discovery only**
Install it if you want an AI agent to be able to look up Twilio API details ("how do I send an SMS with Twilio?", "what's the MediaUrl parameter for?"). This is a dev-tool convenience, not a runtime dependency.

**My recommendation:** Skip the Twilio MCP server for now. Your app calls Twilio directly via the SDK. If you want an MCP server for dev/debug, build Option A later (wrap your own tools) — but that's not part of the reschedule flow build sequence. The reschedule flow uses Twilio SDK directly, not an MCP server.

If you want me to scaffold Option A (an MCP server wrapping your app's operations for dev/debug) as a separate step after the build sequence, say so and I'll add it. But it's not required for the reschedule flow to work.

---

**That's the full build sequence + Twilio MCP assessment.** 11 steps, each compile-and-run verifiable, riskiest first (Step 5: intent parsing). One "go" between steps.

For Twilio MCP: the official server exists (`@twilio-alpha/mcp`) but it's an API discovery tool, not an operational server for your SMS flows. Your app calls Twilio directly via the SDK. No MCP server is needed for the reschedule flow to run — install `@twilio-alpha/mcp` only if you want an AI agent to look up Twilio API docs during development.

Ready for your "go" on Step 0.