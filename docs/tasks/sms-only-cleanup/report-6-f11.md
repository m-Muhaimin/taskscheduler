# Report 6 — F11: remove the ungated default SMS sender from reschedule-service

Status: **complete.** `npm run typecheck --workspace=apps/api` exit 0; `reschedule-service.test.ts` 21/21 green; full API suite 34 files / 528 tests green. No caller outside the test file depended on the removed default.

## 1. Files edited (exactly the two the brief owns)

| File | Change |
|---|---|
| `apps/api/src/services/reschedule-service.ts` | deleted `defaultSendSms`; `smsSendFn` now **required** at `initiateRescheduleFlow` and `processSlotChoice`; deleted the dead `smsSendFn` param from `confirmReschedule`; `sendSms` value import dropped (type-only now) |
| `apps/api/src/services/reschedule-service.test.ts` | 1 call site given the now-required sender; 9 `confirmReschedule` call sites re-argged |

No other file touched. `sms-service.ts` untouched (`TRANSACTIONAL_KINDS` unchanged — no `reschedule_offer` allowlisted). `worker/process-inbound-sms.ts` untouched. No send payload, message body, flow behavior, or gate logic changed. No commit made.

## 2. The defect, restated

`defaultSendSms` was `(input) => sendSms(input)` and the default value of `smsSendFn` at three signatures. The only payload either live flow builds is `{ to, body }` — **no `customerId`** — and `assertSmsConsent` opens with `if (customerId == null) return;` (`sms-service.ts:122`). A default sender therefore made a proactive customer-facing send **exempt** from consent and, with no `organizationId`, unledgered (no `rl_outbound_messages` row), i.e. invisible on the Messages surface. The type system could not catch a dropped argument because the fallback existed.

## 3. Exact before/after signatures

### `initiateRescheduleFlow`

```ts
// BEFORE  (:91-105)
export async function initiateRescheduleFlow(
  bookingId: string,
  customerPhone: string,
  authFn: AuthFn,
  freeBusyFn: FreeBusyFn,
  listEventsFn: ListEventsFn,
  bookingLookupFn: BookingLookupFn,
  userLookupFn: UserLookupFn,
  smsSendFn: SmsSendFn = defaultSendSms,          // ← :99  ungated fallback
  conversationCreateFn: typeof createConversation = createConversation,
  getAvailableSlotsFn: GetAvailableSlotsFn = schedulingEngine.getAvailableSlots,
  pickOfferedSlotsFn: PickOfferedSlotsFn = schedulingEngine.pickOfferedSlots,
  createEscalationFn: CreateEscalationFn = createEscalation,
  siblingBookingsFn?: SiblingBookingsFn,
): Promise<ConversationState | null> {

// AFTER   (:92-105)
  smsSendFn: SmsSendFn,                           // ← required, no default
  /* rest identical */
```

### `processSlotChoice`

```ts
// BEFORE (:213-219)                        // AFTER (:214-219)
conversationUpdateFn: ConversationUpdateFn = updateConversation,   →  (unchanged)
smsSendFn: SmsSendFn = defaultSendSms,     →  smsSendFn: SmsSendFn,
): Promise<ConversationState | null> {                            →  (unchanged)
```

### `confirmReschedule` — dead parameter deleted

```ts
// BEFORE (:273-282)                                   // AFTER (:274-283)
conversationLookupFn: ConversationLookupFn = getConversationByPhone,   → (unchanged)
conversationUpdateFn = updateConversation,                            → (unchanged)
smsSendFn: SmsSendFn = defaultSendSms,     // DEAD, never invoked   →  (line DELETED)
createEscalationFn = createEscalation,     // was slot 8             →  createEscalationFn = createEscalation,  // now slot 7
```

`confirmReschedule` invokes no sender on the success path or the calendar-failure path — the confirmation SMS is the worker's `sendConfirmationSms`. The parameter was misleading (a reader would believe the function can send) and was the third binding of the ungated fallback. Its docblock now states **SENDS NOTHING** and names the real sender.

### Import hygiene

`import { sendSms, type SendSmsInput }` → `import type { SendSmsInput }`. `sendSms` had no remaining code reference; `SendSmsInput` is still needed by the `SmsSendFn` type. No value `sendSms(` call remains anywhere in the file (the two `sendSms` string occurrences are prose in the new hard-rule comment).

### Enforcement proof (why the type system is the guard)

A scratch probe confirmed a required param followed by initializer params is legal, and that omitting a required one is a hard error:

```
probe2.ts(9,17): error TS2554: Expected 8-9 arguments, but got 7.
```

So dropping the sender, or adding a caller that forgets it, is now a **compile error** (`TS2554`), not a silent downgrade to an ungated send.

## 4. Call sites re-argged

### 4a. `initiateRescheduleFlow` — 1 site (newly required)

| Line | Test | Action |
|---|---|---|
| 206-215 | `initiateRescheduleFlow > returns null when the user is not found` | added `mockSmsSend` (was passing only 7 args; relied on the removed default) |

The other 5 `initiateRescheduleFlow` sites (lines 159, 187, 224, 250, 291) and all 6 `processSlotChoice` sites (333, 357, 367, 376, 385, 398) already passed `mockSmsSend` in the right slot — no change needed.

### 4b. `confirmReschedule` — 9 sites (positional shift, escalation → slot 7)

Each had `mockSmsSend` in slot 7 and `mockCreateEscalation` in slot 8. Removing the dead param shifted `createEscalationFn` into slot 7, so `mockSmsSend` was deleted from each so `mockCreateEscalation` lands in slot 7. Mechanically uniform — no assertion removed to make a test pass.

| Line (post-edit) | Test | Escalation assertion preserved |
|---|---|---|
| 437 | creates a calendar event and returns success with updated booking | `expect(mockCreateEscalation).not.toHaveBeenCalled()` |
| 464 | returns failure when no conversation exists | — |
| 495 | fails closed (`confirmation_required`) when still awaiting its confirmation code | `not.toHaveBeenCalled()` |
| 530 | fails closed (`confirmation_required`) when a `confirmation_code_hash` is still pending | `not.toHaveBeenCalled()` |
| 566 | proceeds normally once the handshake cleared (hash null, awaiting_slot_choice) | — |
| 586 | returns failure when conversation is not in awaiting_slot_choice state | — |
| 608 | returns failure when selectedSlot or bookingId is missing | — |
| 633 | returns failure when booking is not found | — |
| 659 | creates an escalation and returns failure when calendar event creation throws | `toHaveBeenCalledWith(objectContaining({ type: 'calendar_api_failure' }))` + escalated-state write |

The re-arg is **load-bearing, not cosmetic**: had `mockCreateEscalation` stayed in slot 8 it would have been ignored and the real `createEscalation` (a DB call) would have run. The line-659 escalation assertion passing is the proof that the mock now occupies slot 7.

Assertion count: **66 before → 66 after** (`expect(` occurrences, whole file). No assertion deleted.

## 5. Results

```
> npm run typecheck --workspace=apps/api
> tsc --noEmit
TYPECHECK_EXIT=0

> npm run test --workspace=apps/api -- src/services/reschedule-service.test.ts
 ✓ src/services/reschedule-service.test.ts (21 tests) 16ms
 Test Files  1 passed (1)
      Tests  21 passed (21)
TEST_EXIT=0
```

Full API suite (regression check): **34 test files, 528 tests, all passed, exit 0.**

### Typecheck is the caller audit

Exit 0 means no non-test caller relied on the removed default. The only non-test importer is `worker/process-inbound-sms.ts` (grep: the sole `.ts` file besides the service and its test that references these three functions). Its calls are all positionally valid post-change:

| Worker line | Call | Post-change validity |
|---|---|---|
| 328-345 | `initiateRescheduleFlow(bookingId, phone, defaultAuth, freebusy, list, bookingLookup, findUserProfile, flowSmsSender, …)` | passes slot 8 explicitly → required param satisfied |
| 369-375 | `processSlotChoice(phone, choice, undefined, undefined, choiceSmsSender)` | passes slot 5 explicitly → required param satisfied |
| 452-457 | `confirmReschedule(phone, defaultAuth, insert, bookingLookup)` | passes 4 args; never referenced slots 5-8 → unaffected |

No caller was invented and no caller needed repair.

### Note on a worker-test flake observed mid-task (not caused by this change)

Two intermediate runs of `process-inbound-sms.test.ts` (owned by another agent) failed with *different* tests each time — first the two "confirm dead-end" pins, then "T15 lockout re-issue" — while a 7-arg baseline run passed. Those files carry uncommitted edits from a parallel agent and were being written during that window. With `process-inbound-sms.test.ts` (blob `45f94cdf`) and `process-inbound-sms.ts` (blob `08f5b40f`) hash-identical before and after each of 4 consecutive runs, the worker suite is **58/58 green with this change applied**, and the full-suite run above includes it. Flagging it because the controller may be running agents concurrently.

## 6. Consent status of the two reschedule sends — still CHECKED

Both live customer-facing reschedule sends remain consent-gated. The service's payloads are unchanged (`{ to, body }` at :187-190 and :247-250); the `customerId`/`organizationId` come from the injected sender, exactly as before:

| Send | Service call site | Worker sender | Gate result |
|---|---|---|---|
| 3-slot offer | `initiateRescheduleFlow` → `smsSendFn({to, body})` | `flowSmsSender` = `sendSms({ ...input, organizationId, customerId })` (worker :325-326) | customerId present ⇒ gate runs ⇒ requires `hasSmsOptIn` |
| confirm-ask prompt | `processSlotChoice` → `smsSendFn({to, body})` | `choiceSmsSender` = `sendSms({ ...input, organizationId, customerId })` (worker :367-368) | customerId present ⇒ gate runs ⇒ requires `hasSmsOptIn` |
| booking confirmation | not sent here | `sendConfirmationSms(phone, booking, channel, tz, organizationId, customerId)` (worker :488) | unchanged, customerId threaded |

The material difference is negative space: **the ungated route no longer exists.** Before, a caller that omitted the sender got a `sendSms({to, body})` that the gate exempted. Now the sender is mandatory, so every reschedule send must come from a sender the caller chose — and the only production choice threads the in-scope customer, which both routes to the consent check and puts a row in `rl_outbound_messages`. Removing the exemption path cannot regress into an unledgered send, and no `kind` allowlisting was added to compensate.

## 7. For Sentinel / Probe

- **Sentinel:** the removal is enforced by the type system, so audit the *absence* of `defaultSendSms` and the *absence* of any `= defaultSend…` initializer on an `SmsSendFn` param across `apps/api/src`. Confirm `sms-service.ts` `TRANSACTIONAL_KINDS` still holds only the 5 transactional kinds (no `reschedule_offer`, no `reschedule_slot_choice`).
- **Sentinel:** `rg -n "sendSms" apps/api/src/services/reschedule-service.ts` should return comment prose only, zero call sites — the service must never reach real `sendSms` without an injected, customer-threading sender.
- **Probe (mechanical, compile-time):** delete the `flowSmsSender` argument at worker :338 or the `choiceSmsSender` at :374 and confirm `tsc --noEmit` fails with `TS2554` — that is the consent bypass the brief asked to close, now caught at build time rather than at runtime.
- **Probe (runtime, the bypass the probe already proved):** call `initiateRescheduleFlow`/`processSlotChoice` with a sender that forwards `input` verbatim to `sendSms`; the consent gate should now be the only thing standing between you and an exempt send — that is now a *caller* bug that is visible in the code that writes the sender, not a default hidden in a service signature.
