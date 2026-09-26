# Report 3 — Repair

**Task:** Task 3 (SMS consent gate), repair pass.
**Verdict addressed:** security review `NEEDS-FIX` — C1 plus the documentation,
customer-id-normalization and table-name defects listed below.
**Author:** Wired (backend).
**Date:** 2026-09-26.

**Status: complete.** No commit made. No `npm install` run. No files outside the
allowlist were edited.

---

## 1. Summary

`sendSms` enforces a hard rule — never send an SMS to a customer without a
logged consent record — by refusing any send that names a `customerId` unless a
consent record exists or the message `kind` is one of five transactional OTP
kinds. That gate was implemented correctly and was fail-closed. The problem was
that **nothing fed it**.

Seven of the eight automated customer-facing sends in
`apps/api/src/worker/process-inbound-sms.ts` never passed a `customerId`, so the
gate's `if (!customerId) return;` exempted every one of them. The consent check
was real code that almost never ran, and its doc comment asserted a false
invariant — that customerless sends are "out of scope by construction" — which
is what let the gap survive review. The `kind` allowlist was the mirror image:
also correct, also completely dead, because no call site set a `kind`.

The repair threads the in-scope `customer.id` and an explicit `MessagingKind`
into every automated send, wraps the two injected sender callbacks so they
cannot be passed contextless, normalizes the customer id once so the gate and
the ledger can never disagree about it, and rewrites the two comments that made
the gap look intentional. **The gate condition and the allowlist contents are
untouched** — only the inputs to them changed.

Separately: `consent-service` was the only one of five `CUSTOMERS_TABLE`
consumers that defaulted to `public.rl_customers` instead of the repo's bare-name
convention, and it interpolated the env var into SQL without validating it.

---

## 2. Findings and resolutions

| ID | Finding | Resolution | Verified by |
|---|---|---|---|
| **C1** | 7 of 8 automated customer-facing sends rode the `!customerId` exemption. | Threaded `customer.id` into all of them; `kind` added at each. | 15 new worker tests; mutation (see §5) |
| **C1** | `sendConfirmationSms` had a `customerId?` parameter its only caller never supplied — it *looked* gated in review and was not. | Caller `:488` now passes it; the parameter is load-bearing. | `booking_confirmation: names the customer and the booking_confirmation kind` |
| **C1** | `handleSlotChoiceIntent` passed bare `sendSms` as `choiceSmsSender`, so the in-flow "Reply YES to confirm this slot" prompt was ungated. | `choiceSmsSender` is now a closure injecting `organizationId` + `customerId` (`:367-368`), matching `flowSmsSender` (`:325-326`). | `slot_choice: the in-flow confirm prompt names the customer too` — fails if the closure is reverted |
| **C1** | `replySms` took no `kind`, so all its rows wrote `kind: null` and `TRANSACTIONAL_KINDS` was unreachable. | `replySms` gained `kind: MessagingKind` (`:523-538`). | 5 OTP tests assert exact `kind` values |
| **—** | `assertSmsConsent`'s comment claimed customerless sends were "out of scope by construction". **False** — they were the common case. | Rewritten to state the real invariant: no `customerId` means **UNGATED**; the exemption is caller discipline, not enforcement. | — (comment) |
| **—** | `TRANSACTIONAL_KINDS`' comment implied `reschedule_offer` / slot-choice was in the allowlist. Neither is. | Corrected; explicitly says they are deliberately not. | — (comment) |
| **M1** | `!customerId` treated a blank/whitespace id as absent, yet that blank id was written to the ledger. | `scopedCustomerId()` (`:96`) normalizes blank → `null` and trims padding; **one** value feeds both the gate and the ledger. | `treats a blank customerId as absent…`, `trims a padded customerId…` |
| **M2** | `consent-service` alone defaulted `CUSTOMERS_TABLE` to `public.rl_customers`; the other four consumers use the bare name. | `tableName()` (`:43-53`) defaults to bare `rl_customers` and interpolates `public.`, matching repo convention. Accepts a `public.`-qualified override without double-qualifying. | `defaults to the bare rl_customers with the public schema interpolated`, `accepts a public.-qualified CUSTOMERS_TABLE without double-qualifying it` |
| **M3** | The env var went into SQL unvalidated. | `SQL_IDENTIFIER_RE` (`:41`) validates before interpolation; fails loudly on anything else. | `rejects a CUSTOMERS_TABLE that is not a SQL identifier, before any query` |
| **I1** | Dry-run could mask a refusal. | Test pins that `TWILIO_SMS_DRY_RUN=true` still hits the gate. | `TWILIO_SMS_DRY_RUN=true does NOT bypass the consent gate` |
| **I2** | A send with no `organizationId` had no defined behavior. | Pinned both branches: refused with no ledger row and no Twilio call, or consent-present-and-then-sent-untracked. Behavior unchanged; now specified. | 2 tests |
| **I3** | Gate tests were vacuous — deleting the gate entirely left them green. | `hasSmsOptIn` call assertions added, and the customerless test now proves the same gate refuses once a `customerId` is added. | mutation: deleting the gate call fails 9 tests incl. both I3 tests |

### Unchanged on purpose

The gate condition and the five-kind allowlist. `sendSms`'s first statement is
still `await assertSmsConsent(...)` at `:147`, above `insertOutbound` (`:162`),
the dry-run branch (`:190`) and `client.messages.create` (`:213`).

---

## 3. Every `sendSms` call site, re-derived

Full table with current line numbers is in **report-3.md §14.3**. Summary: 14
gated customer-facing sites (8 gated on a consent record, 5 admitted by the OTP
allowlist, with the reschedule offer counted in both descriptions by
construction), 4 deliberately exempt sites (staff ack, manual dashboard reply,
and the two dev-only helpers), and 1 unreachable zero-context fallback
(`reschedule-service.ts:68`, not an owned file).

The two exemptions that matter are unchanged in intent:

- **Staff ack** — addresses the operator, not a customer. The staff branch
  returns before `findOrCreateCustomer` runs, so there is no customer row to
  name. It now carries a comment saying so, so nobody "fixes" it later.
- **Manual dashboard reply** (`process-outbound-sms.ts:84`) — the tradesperson's
  own reply inside a conversation they are already reading.

---

## 4. Tests

**23 added, 0 deleted, 0 renamed.** 70 → 93 tests in the three owned suites.

- `sms-service.test.ts` 25 → 30
- `consent-service.test.ts` 5 → 8
- `process-inbound-sms.test.ts` 40 → 55

The worker's new `describe` block stands in a mirror of the real gate
(`../services/sms-service.js` is mocked wholesale in that file) that reproduces
`assertSmsConsent` exactly: no `customerId` → ungated; transactional kind →
ungated; otherwise refused unless `recordSmsOptIn` ran. The five OTP tests run
with the consent write stubbed to record **nothing**, so what admits them is the
allowlist and nothing else. One further test asserts a proactive send with no
consent record is *refused* — the pre-repair code would have sent it.

### Non-vacuity proved by mutation

Each defect was reintroduced on purpose, the suite re-run, and the restore
verified (`rg MUTATED` clean):

| Mutation | Result |
|---|---|
| drop `input.customerId` in `replySms` | 14 failures (12 worker, 2 sms-service) |
| `customerId == null` → `!customerId`; drop the trim | 2 failures (blank, padded) |
| revert `choiceSmsSender` to bare `sendSms` | 1 failure (the in-flow prompt) |
| delete the `assertSmsConsent` call | 10 failures, incl. both I3 tests |

---

## 5. Verification

```
$ npm run typecheck --workspace=apps/api
> tsc --noEmit
(no output — exit 0)
```

The `conversation-domain.test.ts(164)` `'carrier'` error carried in report-3.md
§10/§13.4 is **no longer present** — fixed in the working tree by the task that
owns that file. The full API typecheck is clean for the first time this round.

```
$ npm run test --workspace=apps/api -- src/services/sms-service.test.ts \
    src/services/consent-service.test.ts src/worker/process-inbound-sms.test.ts

 Test Files  3 passed (3)
      Tests  93 passed (93)
```

93/93 on three consecutive runs (~2.4s each).

Collateral check — the whole API suite, to prove no other consumer of these
services broke:

```
$ npm run test --workspace=apps/api
 Test Files  34 passed (34)
      Tests  525 passed (525)
```

---

## 6. Recorded, not fixed

| ID | Item | Reason |
|---|---|---|
| **M6** | `hasSmsOptIn(customerId)` is not org-scoped and is not cross-checked against `organizationId`. | **Backlog, latent.** No route accepts a `customerId` from a request body and the only producer (`findOrCreateCustomer`) is org-scoped, so no cross-tenant read is reachable today. It needs RLS (PLAN §5 F3) to matter. |
| F10 | `reschedule-service.ts` sends with no `kind`, so the reschedule offer and slot-choice prompt are gated on consent rather than the allowlist. | Not an owned file. Consistent with `slot_invalid`; safe because consent is written on the first inbound SMS. |
| F11 | `reschedule-service.ts:68` `defaultSendSms` is a zero-context `sendSms` fallback. | Not an owned file; unreachable from the worker today. |
| F12 | The manual dashboard reply's exemption has no pinning test. | `process-outbound-sms.test.ts` is not an owned file. |
| — | Known `process-inbound-sms.test.ts` flake (report-4.md §5): two CP03 tests fail `createEscalation` call counts on a slow parallel run. | Reproduced once, then not in 3 focused runs, 55/55 alone, or the 525-test suite. Pre-existing; reported rather than claimed away. |

---

## 7. Files changed

| File | Change |
|---|---|
| `apps/api/src/services/sms-service.ts` | `scopedCustomerId`; gate + ledger share one normalized id; three comments corrected. Gate condition and allowlist unchanged. |
| `apps/api/src/services/consent-service.ts` | Bare-name `tableName()` with `public.` interpolation; SQL identifier validation. |
| `apps/api/src/worker/process-inbound-sms.ts` | `customer.id` + `kind` threaded into every automated send; `choiceSmsSender` wrapped; five helper signatures extended; staff-ack exemption documented. |
| `apps/api/src/services/sms-service.test.ts` | +5 tests; 2 strengthened. |
| `apps/api/src/services/consent-service.test.ts` | +3 tests; 1 updated for M3. |
| `apps/api/src/worker/process-inbound-sms.test.ts` | +15 tests in a new `describe`. |
| `docs/tasks/sms-only-cleanup/report-3.md` | §5 marked **superseded in full**; §14 appended (defects, repairs, full call-site table, tests, verification, backlog). |

---

## 8. For Sentinel and Probe

**Sentinel — audit:**
1. `sms-service.ts:140-147` — the gate is still the first statement, above the
   ledger insert, the dry-run branch and the Twilio call. Confirm no future edit
   moves it below `:190`.
2. `sms-service.ts:121-122` — `customerId == null`, not `!customerId`. Any caller
   passing `''` must not reach this function expecting a gate.
3. `consent-service.ts:43-53` — `CUSTOMERS_TABLE` is interpolated into SQL after
   `SQL_IDENTIFIER_RE`. Confirm the regex is still there if that file is touched.
4. `process-inbound-sms.ts:523-538` — `replySms` sets `customerId`/`kind` only
   when truthy. A new `sendXxxSms` helper that forgets to forward its `kind`
   re-opens C1's dead-allowlist half; grep new helpers for `kind`.
5. `reschedule-service.ts` and `process-outbound-sms.ts` are untouched and
   remain open items F10/F11/F12 — do not read their behavior as reviewed here.

**Probe — test:**
1. The five OTP sends must be admitted by the **allowlist** with the consent
   record suppressed. If a future change makes any of them depend on
   `recordSmsOptIn`, the T14/T15 tests will fail — that is the signal.
2. The two exemption pins assert the `customerId` and `kind` keys are
   **absent**, not `undefined`. A refactor to always set them (even to
   `undefined`) will fail them, correctly.
3. A send with no `organizationId` and a customer must not create a ledger row.
4. Re-run the full suite (not just the three files) before believing the fix:
   `consent-service`'s table-name default is consumed by four other modules.
