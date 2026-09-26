# Report 6 — consent-gate pins for the two unpinned automated sends

Status: **done.** Test-only. No production file changed (proved byte-identical, §3).

Scope: `apps/api/src/worker/process-inbound-sms.test.ts` and this report are the
only code/doc files edited. `docs/tasks/sms-only-cleanup/PLAN.md` gained three
§5 backlog rows.

---

## 1. The gap

`sendSms`'s consent gate (`apps/api/src/services/sms-service.ts:121-127`)
returns early when the send names no `customerId`, so that send is **ungated**.
`assertSmsConsent`'s own doc comment states the exemption is caller discipline:
"Every automated customer-facing send in `worker/process-inbound-sms.ts` threads
the in-scope `customer.id` precisely so it lands here instead of in the
exemption." That is a claim about argument lists, so it can only be enforced by
asserting on the argument lists.

Two argument lists in `process-inbound-sms.ts` had no such assertion:

| Site | Send | Previously exercised by |
|---|---|---|
| `:462` `sendNoMatchingBookingSms(phone, channel, organizationId, customerId)` | confirm dead-end, reached from `performConfirmation` | tests at `:358` and `:920`, both asserting only `objectContaining({ body })` |
| `:809` `issueFlowCodeAndSend(..., customerId)` | confirm-code lockout re-issue (3rd wrong code) | test at `:846`, asserting `body` only |

Neither mounted the gate, so neither could observe `customerId`. Deleting
`customerId` from either list left the suite green.

Note `:809` is the *second* caller of `issueFlowCodeAndSend`; the first
(`:784`, the first-CONFIRM code-issued site) was already pinned by the existing
`T15 confirm_code` test. Only the lockout re-issue branch was open.

## 2. Tests added — 3 new, 55 → 58

All three are added to the existing
`describe('processInboundSms: automated sends are consent-gated')` block and
reuse that block's existing helpers verbatim — `mountConsentGate()`,
`mountGateWithoutConsent()`, `sends()`, `classifyAs()`, `stateRow()`,
`expectGatedSend()`. **No new helper was introduced**, and no second gate
mirror was written. The mirror in `mountConsentGate` is the only stand-in for
`sms-service.ts` in this file (`sms-service.js` is mocked wholesale, so the real
gate cannot run here).

### 2a. `confirm dead-end: the post-mutation no_matching_booking names the customer and its kind` (pins `:462`)

Reaches `:462` specifically: classify `confirm` → `getConversationByPhone` null
→ `confirmReschedule` returns `{ success: false, error: 'No conversation found' }`
→ the dead-end branch. Asserts via the existing `expectGatedSend('no_matching_booking')`,
i.e. `customerId === 'cust-1'`, `kind === 'no_matching_booking'`,
`organizationId === 'org-1'`, exactly one send, and nothing refused.

The `error` string is what selects this branch over the `confirm_failed`
courtesy SMS, so the assertion cannot silently pass against the sibling call
at `:464` (whose kind is `confirm_failed`).

### 2b. `non-vacuity: with no consent record the confirm dead-end SMS is REFUSED, not just annotated` (refusal parity for `:462`)

Mirrors the refusal-parity pattern already at `:1422`: gate mounted with
consent absent (`mountGateWithoutConsent()`), then assert the send is actually
**refused** — `gate.refused === ['no_matching_booking']`, `gate.optIn === false`,
and the job escalates `processing_error` rather than reaching Twilio. The
refusal propagates out of `performConfirmation` into its own `catch`.

No refusal-parity test was added for `:809`, and none can be: `confirm_code` is
in the five-kind `TRANSACTIONAL_OTP_KINDS` allowlist
(`sms-service.ts:23-29`), so that send is admitted by the allowlist regardless
of consent — deliberately, or the verification handshake would deadlock against
the consent record it produces. `:809` is therefore pinned on the threading
(2c) and on allowlist admission, which is the only observable contract it has.

### 2c. `T15 lockout re-issue: the 3rd wrong code names the customer and the confirm_code kind` (pins `:809`)

Reaches `:809` specifically: conversation in `awaiting_confirmation_code` with a
pending hash, `confirmationAttempts: 2`, submitted `'000000'` → attempt 3 trips
`CONFIRM_CODE_MAX_ATTEMPTS` → the `reissued` branch.

Asserts `customerId === 'cust-1'`, `kind === 'confirm_code'`, body is the fresh
code (not the retry prompt), `gate.optIn === false` with `gate.refused === []`
(admitted by the allowlist, not by a consent record), plus no mutation and no
classify.

This send names **no** `organizationId` (`replySms(..., undefined, customerId,
'confirm_code')` at `process-inbound-sms.ts:835`), so it cannot use
`expectGatedSend`, which asserts `organizationId === 'org-1'`. It follows the
inline `sends()` idiom already used by the sibling `confirm_code` /
`code_mismatch` tests in the same block, and additionally pins
`organizationId === undefined` so a future "simplification" is a visible
contract change. That is also why this send writes no `rl_outbound_messages`
row — noted in the test comment.

## 3. Non-vacuity evidence (required)

The production file was backed up before mutating and restored after, then
verified by hash. `process-inbound-sms.ts` was **already modified in the
working tree** (the uncommitted C1 repair), so it was deliberately NOT restored
via git — `git checkout` would have destroyed the prior agent's work.

```
md5 before: ebc194abbf0b967faf672b58a298fa39   (copy of the working-tree file)
md5 after:  ebc194abbf0b967faf672b58a298fa39   → "PRODUCTION FILE RESTORED BYTE-IDENTICAL"
```

### Mutation A — drop `customerId` from `:462`

```diff
- await sendNoMatchingBookingSms(customerPhone, channel, organizationId, customerId);
+ await sendNoMatchingBookingSms(customerPhone, channel, organizationId);
```

```
AssertionError: expected undefined to be 'cust-1' // Object.is equality
AssertionError: expected [] to deeply equal [ 'no_matching_booking' ]
 Test Files  1 failed (1)
      Tests  2 failed | 56 passed (58)
```

Failing, and **only** the two new tests 2a and 2b:

- `× confirm dead-end: the post-mutation no_matching_booking names the customer and its kind`
- `× non-vacuity: with no consent record the confirm dead-end SMS is REFUSED, not just annotated`

The two pre-existing tests that exercise the same path both stayed **green** —
`CP03 wiring > confirm dead-end (no conversation) gets no-matching-booking SMS`
and `T15 > CONFIRM while still offering slots (mid-navigation)`. That is the
gap, reproduced: they never mounted the gate, so the mutation was invisible to
them.

### Mutation B — drop `customerId` from `:809`

```diff
  if (attempts >= CONFIRM_CODE_MAX_ATTEMPTS) {
-   await issueFlowCodeAndSend(conversation.id, conversation.phone, channel, customerId);
+   await issueFlowCodeAndSend(conversation.id, conversation.phone, channel);
    return 'reissued';
  }
```

```
AssertionError: expected undefined to be 'cust-1' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 57 passed (58)
```

Failing, and **only** the new test 2c:

- `× T15 lockout re-issue: the 3rd wrong code names the customer and the confirm_code kind`

The pre-existing `T15 > wrong code on the 3rd attempt: a FRESH code is
re-issued, no mutation` stayed **green** — same conclusion as Mutation A.

Both mutations were reverted and the file re-verified by hash. Note the
stale/expired-code test at `:875` reaches `:784` via the `!pending` branch, not
`:809`; the new test is the only pin on the lockout branch.

## 4. PLAN.md §5 backlog rows added

Three rows appended after `F9`, in the table's existing
`| # | Item | Why deferred |` shape:

- **F10** — `reschedule-service.ts:186` and `:246` pass no `kind`, so
  `rl_outbound_messages.kind` is NULL for the reschedule offer and the
  slot-choice prompt while every sibling send records one. Why-deferred note
  states explicitly that this is data-quality/observability only and **not** a
  consent gap, because the gate keys off `customerId`, not `kind`, and both
  sends do name the customer.
- **F12** — the manual dashboard reply (`process-outbound-sms.ts:84`) sends
  `{to, body}` with no `organizationId`, so it is exempt from the gate (sanctioned:
  a human-composed reply behind `requireAuth` in `routes/dashboard/inbox.ts`) and
  writes no `rl_outbound_messages` row, so every manual reply is invisible on the
  delivery surface. Why-deferred note records that the assertion at
  `process-outbound-sms.test.ts:65` pins the shape while mocking `sendSms` away,
  so the real gate never runs and the exemption is never asserted as
  intentional; deferred pending (a) a gate-exercising test and (b) a
  ledger-visibility decision.
- **M6** — `hasSmsOptIn(customerId)` is not org-scoped and is not cross-checked
  against `organizationId`. Why-deferred note records it as latent today (no
  route accepts a `customerId` from a request body; the only producer is
  org-scoped) and that it needs RLS to matter — cross-referenced to F3.

PLAN §5's global constraints and §6's residue classes were not touched. `F11`
was left alone: it was not in this brief.

## 5. Results

Target file, per the brief:

```
npm run test --workspace=apps/api -- src/worker/process-inbound-sms.test.ts
 Test Files  1 passed (1)
      Tests  58 passed (58)
```

Typecheck:

```
npm run typecheck --workspace=apps/api
> tsc --noEmit
(no output — clean)
```

Full API suite, run to rule out collateral damage:

```
npm run test --workspace=apps/api
 Test Files  34 passed (34)
      Tests  528 passed (528)
```

The other agent's concurrent `reschedule-service.ts` work is green as of this
run: no typecheck error and no test failure in `reschedule-service.ts` or its
test. Nothing to report or defer there.

Self-review against the brief: 3 tests added (both call sites pinned on
`customerId` + `kind`, plus refusal parity on `:462`); existing helpers reused
with no new pattern invented; non-vacuity proved by two mutations and a
byte-identical restore; 3 PLAN rows appended. No dead code, no production
change, no commit, no `npm install`.

## 6. For Sentinel / Probe

- **Sentinel** — the three new tests reuse the existing gate mirror, which is
  itself a re-implementation of `sms-service.ts`'s `assertSmsConsent`. That
  duplication is pre-existing and is the reason the exemption cannot be
  verified end-to-end from a worker test. Worth an audit note: the mirror is
  only as good as its fidelity to `sms-service.ts:23-29` and `:121-127`. The
  real-gate path is covered separately by `sms-service.test.ts`.
- **Probe** — worth probing the mutation direction in reverse: the two
  pre-existing dead-end tests (`:358`, `:920`) are now known to be
  gate-blind. They are not wrong, but they are weaker than their names suggest;
  the new tests carry the actual guarantee. Optionally tighten those two to
  assert `customerId` too, though that is redundant with 2a.
- **Probe** — `F12` is the remaining consent-adjacent item with no test at all
  in the repo: nothing exercises the real gate for the manual dashboard reply.
  That is a live (if sanctioned) exemption asserted only by a mocked shape.
