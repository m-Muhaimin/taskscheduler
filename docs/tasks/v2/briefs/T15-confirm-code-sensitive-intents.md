# T15 — Confirm-by-code for sensitive intents (reschedule/cancel gates)

## Goal
Today a customer's numeric slot choice (= the `slot-choice`/`confirm` path) is
acted on purely on the strength of "they replied to the SMS thread". If an
attacker (or a stray reply) causes a slot confirm, the worker creates a calendar
event (`confirmReschedule`). Add a **per-flow confirmation code**: before the
calendar-mutating steps (confirming the reschedule / new booking), the worker
sends a 6-digit code to the customer and requires them to reply with it; only a
matching code proceeds to the mutation. Codes are one-shot, short-lived, and
bound to the conversation.

## Verified facts (controller investigation — do not re-derive)
- `apps/api/src/worker/process-inbound-sms.ts` dispatch switch (line 147):
  - `reschedule` → `initiateRescheduleFlow` (offers 3 slots — non-mutating SMS).
  - `slot-choice` → `processSlotChoice` (validates numeric choice; on success
    sends a **confirm-ask** SMS "Reply CONFIRM to lock it in" — still non-mutating).
  - `confirm` → `confirmReschedule` (creates the calendar event + marks booking
    confirmed — **THE mutation**).
  - Line 99: conversation-state lookup by phone (needed for slot-choice intent).
- `apps/api/src/services/reschedule-service.ts`: `initiateRescheduleFlow` (91),
  `processSlotChoice` (213), `confirmReschedule` (273). The mutation lives in
  `confirmReschedule` (calendar insert) and in the `confirm` case's follow-up
  (line 306: `status: 'confirmed'` persist).
- State table (`migrations/003`): `rl_conversation_states` with a **strict CHECK**:
  `state in ('offering_slots','awaiting_slot_choice','completed','escalated')`.
  Any new state value REQUIRES a migration to widen the CHECK.
- `sendSms` + dry-run semantics: same as T14 (`sms-service.ts`).
- Existing slot-choice/confirm flow relies on conversation-state rows to carry
  `offered_slots` / `selected_slot` jsonb.
- No code/mutation-confirmation primitive exists today (T14 introduces
  `verification-service.ts` — T15 builds ON that, do not re-invent).

## Files to change
1. `apps/api/src/db/migrations/011-confirmation-codes.sql` — NEW.
2. `apps/api/src/services/verification-service.ts` — add flow-code helpers
   (T14 file; extend, don't fork).
3. `apps/api/src/worker/process-inbound-sms.ts` — gate the `confirm` (and
   `new-booking`/`slot-choice` finalization) path.
4. `apps/api/src/services/reschedule-service.ts` — `confirmReschedule` accepts
   (or is preceded by) a verified-code check; fail closed otherwise.
5. Tests: extend `process-inbound-sms.test.ts` + `verification-service.test.ts`.

## Exact requirements

### A. Migration 011 — widen state CHECK + code columns
```sql
-- widen rl_conversation_states.state CHECK to include the new awaiting state
alter table public.rl_conversation_states
  drop constraint if exists rl_conversation_states_state_check,
  add constraint rl_conversation_states_state_check check (
    state in ('offering_slots','awaiting_slot_choice','awaiting_confirmation_code','completed','escalated')
  );

-- per-conversation one-shot code
alter table public.rl_conversation_states
  add column if not exists confirmation_code text,
  add column if not exists confirmation_code_hash text,        -- sha256 of code (don't store plaintext)
  add column if not exists confirmation_code_expires_at timestamptz,
  add column if not exists confirmation_attempts int not null default 0;
```
Store `confirmation_code_hash` (sha256 via node:crypto), never the plaintext.
Keep the plaintext out of DB except during the single compare window.

### B. verification-service.ts additions
- `issueFlowCode(): { code, hash }` — 6-digit crypto-random, returns both.
- `verifyFlowCode(expected, input): boolean` — constant-time compare.
- `sha256Hex(s): string` helper (used by worker to compare against stored hash).
- Keep pure; persistence stays in the worker.

### C. worker gate — only the mutating final step
The confirm-ask SMS already exists ("Reply CONFIRM to lock it in"). Replace the
direct `CONFIRM`-text match with a code handshake:
1. When the flow reaches the point where a confirmation is about to be persisted/
   calendar-mutated (the `confirm` intent path, and slot-choice finalization):
   - If conversation state has NO `confirmation_code_hash` → issue code, persist
     `confirmation_code_hash` + `confirmation_code_expires_at` (now()+10min),
     set state `awaiting_confirmation_code`, send SMS
     "Reply with <code> to confirm your appointment change." and complete
     (NO mutation yet).
   - If user's next message body == the code (verify against hash, constant-time) →
     clear the code fields, proceed to `confirmReschedule` / mutation, then
     continue the normal post-mutation SMS.
   - Wrong code → increment `confirmation_attempts`; < 3 → re-ask; >= 3 →
     re-issue a fresh code (same loop as T14's semantics).
2. `confirmReschedule` (reschedule-service.ts:273): add a defensive guard —
   if called while the conversation still has an un-cleared
   `awaiting_confirmation_code` state or a pending hash, throw/return
   `{ error: 'confirmation_required' }` instead of mutating. Fail-closed: no
   code verified → no calendar event.
3. Slot-choice WITHOUT a pending confirmation (mid-navigation) must NOT trigger
   the gate — the gate applies at the FINAL (re)confirmation step only, i.e.
   when `confirmReschedule` would actually run.

### D. Tests
- process-inbound-sms.test.ts:
  - confirm path: first confirm message → code SMS sent, state =
    `awaiting_confirmation_code`, NO calendar mutation (assert reschedule-service
    mutation not called).
  - code reply math → mutation called once, code fields cleared, normal
    confirmation SMS follows.
  - wrong code x3 → fresh code re-issued, no mutation.
  - slot-choice mid-navigation (no pending confirm) → unaffected, no gate.
- verification-service.test.ts: issueFlowCode → 6-digit + hash consistency
  (sha256(code) === hash); verifyFlowCode true/false; tampered hash compare
  doesn't throw.

## Out of scope
- No cancellation (cancel) flow exists yet to gate — if the intent surface grows
  one later, reuse the same helper.
- No dashboard involvement (the tradesperson is not part of this handshake).
- No Twilio Verify; self-issued per conversation.
- Do NOT touch T14 (device trust) or T16 (staff-phone).
- Outbound `outbound_sms` worker (T13) untouched.

## Verify (in order, workdir H:\tradescheduling)
1. `npm test --workspace=apps/api` — full suite green.
2. `npm run typecheck --workspace=apps/api` — no NEW errors.
3. `npm run build --workspace=apps/api` — green.
4. Optional live smoke: TWILIO_SMS_DRY_RUN=true — run a full reschedule flow:
   trigger reschedule → pick slot → CONFIRM → assert code SMS, state
   awaiting_confirmation_code, no calendar write; reply code → assert mutation
   + confirmation SMS. Then a wrong-code reply → re-ask, no mutation.

## Report
Per-file diff summary; exactly where the gate sits relative to `confirmReschedule`;
the state-machine transitions (which states enter/leave `awaiting_confirmation_code`);
test tails; any surprise in CHECK-widening (older rows, index).
Do NOT commit.
