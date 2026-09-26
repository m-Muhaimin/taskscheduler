# Report 10 — confirm-code handshake caller: consent gap at :201

**Scope:** surgical repair of one live consent gap plus one cosmetic indentation
defect on the adjacent lines.
**Files touched (owned, and only these):**
- `apps/api/src/worker/process-inbound-sms.ts`
- `apps/api/src/worker/process-inbound-sms.test.ts`

No commit. No `npm install`. No wholesale rewrite of either file.

---

## 1. The defect

`processInboundSms`'s T15 confirm-code branch ran the verified booking
confirmation through `performConfirmation` **without** the customer id, so
`customerId` was `undefined` at every layer down to the consent gate and the
send rode the gate's `customerId == null` exemption.

## 2. Exact before / after (`:197-204`)

**BEFORE** (6-space indent inside a 4-space block, stray blank line, dropped id):

```ts
  if (conversation?.state === 'awaiting_confirmation_code') {
      const outcome = await runConfirmCodeGate(conversation, body, channel, customer.id);

    if (outcome === 'verified') {
      await performConfirmation(organizationId, customerPhone, channel);
    }
    return;
  }
```

**AFTER** (4-space style, no stray blank line, id threaded):

```ts
  if (conversation?.state === 'awaiting_confirmation_code') {
    const outcome = await runConfirmCodeGate(conversation, body, channel, customer.id);

    if (outcome === 'verified') {
      // Same contract as the handleConfirmIntent caller below: the booking
      // confirmation names the in-scope customer, so sms-service.ts's consent
      // gate applies instead of exempting the send for want of a customerId.
      await performConfirmation(organizationId, customerPhone, channel, customer.id);
    }
    return;
  }
```

Two changes, both on adjacent lines:

1. **`:204` — the fix.** `customer.id` is passed. It is the identifier actually
   in scope at that point: the same expression one line above (`:198`) and
   narrowed non-null by the defensive `if (!customer) return;` at `:162`. No
   new lookup, no re-query.
2. **`:198-199` — cosmetic.** The 6-space `const outcome = ...` normalized to the
   file's 4-space style; the stray blank line between it and the `if` removed.
   A three-line comment was added at the fixed call site to name the contract
   (matching the existing convention at `:364-366`), so the next reader does not
   "simplify" the argument away.

Deliberately **not** changed: `performConfirmation`'s and `sendConfirmationSms`'s
signatures stay `customerId?: string`. They are shared with the correct
caller at `:429` (`performConfirmation(organizationId, customerPhone, channel,
customerId)` from `handleConfirmIntent`) and with tests; every production call
site now threads the id, so making the parameter required would widen the blast
radius for zero behavioral gain. No message body, no OTP/verification send, and
the `organizationId: undefined` convention used by the five OTP sends (`:663`
`:702` `:720` `:803` `:825`) is untouched. Nothing in `sms-service.ts` touched.

## 3. Safety argument, re-checked against the code

I re-verified each of the four claims rather than taking them on trust:

| Claim | Verified how | Result |
|---|---|---|
| A consent record necessarily exists before the gated send | `recordSmsOptIn(customer.id)` at `:168` is above the branch at `:197` in the same function body, and there is no `return` between them except the non-null guard at `:162` (which does not return when the customer exists) | **Confirmed** — the send being newly gated is always backed by a record written microseconds earlier in the same request. Gating refuses nothing that should have gone out. |
| The other caller is downstream of the write too | `handleConfirmIntent` is dispatched at `:261`, i.e. after `:168`, and it already passed `customerId` at `:429` | **Confirmed** — unaffected by this change (it was already correct). |
| The gate genuinely applies to `booking_confirmation` | `sms-service.ts:23-29` — `TRANSACTIONAL_KINDS` is exactly `verification_code`, `confirm_code`, `number_verified`, `code_mismatch`, `confirm_failed`. `booking_confirmation` is not a member. | **Confirmed** — the allowlist exemption cannot absorb it; only a real consent record admits the send. |
| The exemption is the fail-open shape | `sms-service.ts:121-122` — `assertSmsConsent` returns immediately on `customerId == null`, and `scopedCustomerId` (`:96-101`) normalizes an absent/blank id to `null` | **Confirmed** — the signature omitting the argument is indistinguishable at the gate from a deliberate exemption. |

**One correction to the brief's consequence framing** (does not change the fix).
The brief said the ungated send also got "no `rl_outbound_messages` ledger row",
hence invisible on the Messages surface. Reading the ledger path: the ledger row
is written when `organizationId` is present (`sms-service.ts:161-170`), and
`organizationId` **was** already threaded at the pre-fix `:201` (it is
`performConfirmation`'s first positional parameter and is non-null past the
`:83-90` early return). `getOutboundMessages` filters on `organization_id` only
(`outbound-ledger.ts:303`) — it does not require a non-null `customer_id`. So
pre-fix, that confirmation already wrote a ledger row, already got a derived
`statusCallbackUrl` (`:174-182`), and already appeared in the Messages list. The
genuine, live loss was (a) **no consent check at all** and (b) the row landing
with `customer_id = NULL`, so it could not be attributed to the customer or
linked to a conversation. The repair closes both, and the pin below asserts the
attribution, not the ledger row's existence.

## 4. Tests added

Two tests in the existing `processInboundSms: automated sends are consent-gated`
describe block, immediately after the two existing `booking_confirmation` pins
and before the confirm-dead-end section — so the two callers of
`performConfirmation` now sit side by side with two pins each. Reused helpers:
`mountConsentGate`, `mountGateWithoutConsent`, `sends`, `expectGatedSend`,
`stateRow`, `confirmedBooking`. No new helper was introduced.

1. **`confirm-code verified: the booking confirmation names the scoped customer and its kind`**
   Drives the real branch: `getConversationByPhone` returns `stateRow` in
   `awaiting_confirmation_code` with a matching `sha256Hex('482913')` hash and a
   far-future expiry, body is the bare code. Asserts `classifyStep` never ran
   (the code reply is still not an intent), then `expectGatedSend('booking_confirmation')`
   — the single send carries `customerId: 'cust-1'`, `kind:
   'booking_confirmation'`, `organizationId: 'org-1'` — plus `gate.optIn === true`,
   proving admission came from the consent record and not the allowlist.

2. **`non-vacuity: confirm-code verified with no consent record REFUSES the
   confirmation SMS`** (refusal parity)
   Same drive with `mountGateWithoutConsent()` (the consent write lands and
   records nothing — the worst case for the gate). Asserts
   `gate.refused === ['booking_confirmation']`, `gate.optIn === false`,
   `sendSms` attempted exactly once, and a `processing_error` escalation. Also
   pins `updateBookingTimes` still ran once: the consent gate is an **outbound**
   boundary and the calendar mutation is not rolled back, so nobody reads the
   refusal as a failed confirmation.

No existing test was modified or removed.

## 5. Non-vacuity evidence

Temporarily reverting **only** the `:204` argument (by content — the
`customer.id` argument deleted from the call, no other change):

```
$ npm run test --workspace=apps/api -- src/worker/process-inbound-sms.test.ts -t "confirm-code verified"

 × confirm-code verified: the booking confirmation names the scoped customer and its kind
   → expected undefined to be 'cust-1' // Object.is equality
 × non-vacuity: confirm-code verified with no consent record REFUSES the confirmation SMS
   → expected [] to deeply equal [ 'booking_confirmation' ]

 AssertionError: expected undefined to be 'cust-1'
   1315|  expect(list[0].customerId).toBe('cust-1');
 AssertionError: expected [] to deeply equal [ 'booking_confirmation' ]
   1494|  expect(gate.optIn).toBe(false);

 Test Files  1 failed (1)
      Tests  2 failed | 57 skipped (59)
```

Both fail for the right reason: the first proves the send carried no
`customerId` (`undefined`, i.e. the exemption shape); the second proves the gate
refused nothing — `[]` — so the confirmation went out ungated. Not a
tautological assertion pair.

**Restore confirmation.** The line was restored by content with the edit tool —
**not** `git checkout` (this file carries substantial uncommitted work from
earlier tasks, and `git checkout` would have destroyed it). Post-restore state,
read back from disk:

```ts
      await performConfirmation(organizationId, customerPhone, channel, customer.id);
```

The green run below (59/59) was executed after the restore, so the passing state
is the restored state.

## 6. Results

| Command | Result |
|---|---|
| `npm run typecheck --workspace=apps/api` | **exit 0** (`tsc --noEmit`, no output) |
| `npm run test --workspace=apps/api -- src/worker/process-inbound-sms.test.ts` | **1 file / 59 tests passed** (was 57; +2) |
| `npm run test --workspace=apps/api` (full) | **34 files / 536 tests passed** (was 34 / 534; +2, no failures) |

No other file was modified. (`apps/api/vitest.config.ts` shows as untracked in
`git status`, but it was created by a concurrent agent's report-11 task, not by
this repair.)

## 7. For Sentinel / Probe

- **Sentinel:** the audit point is `assertSmsConsent`'s `customerId == null`
  early return — it remains caller discipline, not enforcement. This repair
  closed the last automated customer-facing send that exploited it in this
  file. The two remaining legitimate exempts are the staff ack (`:120-124`,
  pinned by `'staff ack stays exempt'`) and the manual dashboard reply in
  `routes/dashboard/inbox.ts`; a future automated send that omits the id would
  be exempt again and, per `scopedCustomerId`, would also write
  `customer_id: NULL` to the ledger — the new test's `expectGatedSend` is the
  tripwire for that.
- **Probe:** the behavioral change is that a confirm-code-verified confirmation
  is now subject to a DB consent read (`hasSmsOptIn`) before Twilio, and its
  ledger row now carries `customer_id`. Live probe path: customer replies with
  the 6-digit code while `awaiting_confirmation_code` → expect the
  `booking_confirmation` row in `rl_outbound_messages` to have a non-null
  `customer_id` and a StatusCallback-delivered status. If the consent read
  fails, the gate fails **closed** (the send throws into `performConfirmation`'s
  catch → `processing_error` escalation) and the calendar mutation stands
  un-notified — that is the intended trade, and worth a synthetic check.
