# Task 3 report — Consent authority + the `sendSms` choke point

**Status:** done. No commit made. No `npm install`.

> **Superseded in part — read §13 "Rulings applied" first.** The controller
> ruled after §1–§12 were written. Ruling 1 moved the gate from inside the
> `try` (after `insertOutbound`) to the **first statement of `sendSms`**, so a
> refused send now writes **no** ledger row; the §2 ordering numbers, §6 AC3
> `rg` output, and §8 are **superseded by §13**. Ruling 2 ratified the §7
> WhatsApp deletion (now recorded as intentional). Ruling 3 fixed the
> `assertSmsConsent` doc-comment path. The gate condition, the five-kind
> transactional allowlist, and the fail-closed semantics are **unchanged** from
> §2/§3.


---

## 1. Files edited (exactly the four owned — nothing else)

| Action | Path | Change |
|---|---|---|
| edit | `apps/api/src/services/consent-service.ts` | +`tableName()`, both queries use it, `recordSmsOptIn` sets the timestamp, doc comment |
| edit | `apps/api/src/services/consent-service.test.ts` | dropped unused `SMS_CONSENT_ROW`, replaced the two tests per §4a/§4b |
| edit | `apps/api/src/services/sms-service.ts` | +`hasSmsOptIn` import, `TRANSACTIONAL_KINDS`, `assertSmsConsent`, call site, doc bullet |
| edit | `apps/api/src/services/sms-service.test.ts` | restored from HEAD, +consent mocks/module mock/default, +new `describe` block, −5 dead WhatsApp tests (§7) |

No file outside the ownership table was edited. No out-of-table file was
needed (see §8).

---

## 2. The gate — exact condition and error type

`apps/api/src/services/sms-service.ts`:

- `assertSmsConsent(input)` at **line 87**, called at **line 145**.
- **Condition (fail-closed):** throw iff `input.customerId` is truthy **AND**
  `input.kind` is not in `TRANSACTIONAL_KINDS` **AND** `hasSmsOptIn(customerId)`
  resolved falsy. Any one of those three short-circuits to allow.
- **Error type:** a plain `Error` (not a subclass) with message
  `sendSms: blocked — no SMS consent record for this customer (consent is
  recorded on their first inbound SMS)`. Chosen per brief §3c. It is
  deliberately not a custom error class — nothing in the codebase has a
  consent-specific error taxonomy, and introducing one would be a signature
  change no other file is contracted for.
- **Side channel:** `console.warn('[sms] refused: no SMS consent record',
  JSON.stringify({ customerId, kind, to }))` before the throw, so the refusal
  is greppable in logs. No message body, matching the PII-free log rule.
- **Ordering invariant (verified):** `assertSmsConsent` (145) sits **after**
  `insertOutbound` (119) and **before** the `TWILIO_SMS_DRY_RUN` branch (152)
  and before `client.messages.create` (175). No Twilio call can precede the
  gate. `rg` output in §6 confirms the line ordering.
  > **SUPERSEDED by §13.1** — the gate is now the first statement of
  > `sendSms` (line 112), above `insertOutbound` (127), so a refused send
  > writes **no** ledger row. The "after insertOutbound" ordering recorded
  > here no longer holds.
- **Fail-closed on error:** a `hasSmsOptIn` throw (e.g. `DATABASE_URL not
  configured`, or a DB outage) propagates out of `assertSmsConsent` → out of
  `sendSms` without reaching Twilio. The gate does not catch-and-allow.

---

## 3. The transactional allowlist

`TRANSACTIONAL_KINDS` (line 16) — exactly the five named kinds, nothing else:

```
verification_code, confirm_code, number_verified, code_mismatch, confirm_failed
```

Typed `ReadonlySet<MessagingKind>` so a new `MessagingKind` cannot silently
join the allowlist by typo.

---

## 4. `consent-service` as the single authority

- `tableName()` is the only place `public.rl_customers` is written down
  (`rg` in §6: one hit, line 32). `CUSTOMERS_TABLE` now genuinely overrides.
- `hasSmsOptIn` keeps the `rows.length === 0 → false` guard and the
  `Boolean(...)` coercion verbatim (§2b).
- `recordSmsOptIn` is one `update` setting `sms_opted_in = true` **and**
  `sms_opted_in_at = now()` (§2c). Idempotent by construction.
- `getPool()`, the `DATABASE_URL` guard, pool options, and the two exported
  names are untouched (§2e).
- **Cross-check:** `rg -n "hasSmsOptIn|recordSmsOptIn|sms_opted_in"
  apps/api/src/services/outbound-ledger.ts` → **no hits (exit 1)**. The ledger
  owns no consent. Acceptance criterion 2 satisfied. (Note for the record:
  Task 1 and Task 2 have already landed in the working tree —
  `whatsapp-service.ts` and `fallback-service.ts` are gone and the ledger's
  consent export is stripped — so AC2's "report if Task 1 has not run" does
  not apply.)

---

## 5. Send call sites — gated vs exempt, with evidence

> **SUPERSEDED IN FULL by §14.** A security review found this section wrong on
> the substance and stale on the lines: it claims booking confirmation is
> consent-gated (it was not — `sendConfirmationSms`'s 6th `customerId?`
> parameter was never supplied by its only call site) and it omits **four**
> automated customer-facing sends that reached `sendSms` with no `customerId`
> and therefore rode the `!customerId` exemption. The re-derived, current
> enumeration is **§14.3**. Nothing below this note should be read as
> describing the current state of the code.

Exhaustive: `rg -n "sendSms" apps/api/src --glob '!*.test.ts'` returns the
definition plus the sites below.

### 5a. GATED (a `customerId` is passed → consent is consulted)

| Site | Evidence | Effect |
|---|---|---|
| `worker/process-inbound-sms.ts:312` `flowSmsSender` — `sendSms({ ...input, organizationId, customerId })`, feeding `initiateRescheduleFlow` | `process-inbound-sms.ts:310-312` | Reschedule slot offer **and** the "reply YES to confirm this slot" prompt. Neither sets `kind` (`reschedule-service.ts:186` and `:246` both call `smsSendFn({ to, body })` with no `kind`), so both take the `hasSmsOptIn` path. **This is the biggest behavior change of the round — see §9.** |
| `worker/process-inbound-sms.ts:538-543` `sendConfirmationSms` → `replySms(phone, body, organizationId, customerId)` | passes `customerId`; `replySms` sets `input.customerId` at `:505` | Booking confirmation is consent-gated. |

### 5b. EXEMPT — staff ack (no `customerId`)

`worker/process-inbound-sms.ts:114` `sendSms({ to: customerPhone, body: 'Message logged to your dashboard — reply there.', organizationId })`. No `customerId` key → `!customerId` branch returns immediately. Matches the brief's named exemption.

### 5c. EXEM — manual dashboard reply (no `customerId`)

`routes/dashboard/inbox.ts:83` and `:121` → `inbox-service.enqueueOutboundReply` (`:125`) writes an `rl_messages` row → `worker/process-outbound-sms.ts:84` `sendSms({ to: row.phone, body: row.body })`. No `customerId`, no `kind`. The tradesperson's own dashboard reply.

> Brief §3c names `routes/dashboard/messages.ts` as the manual-reply site. That
> file has only a `GET /` (`rg -n "router\." apps/api/src/routes/dashboard/messages.ts`
> → one route). The actual manual-reply path is `routes/dashboard/inbox.ts` as
> traced above. The doc comment's *reasoning* is unchanged and correct; only
> the file path reference is stale. Cosmetic — left verbatim per §3c.

### 5d. EXEMPT — the verification / OTP handshake (no `customerId`)

All five OTP sites route through `replySms` **without** a `customerId`:

| Site | Evidence |
|---|---|
| `issueAndSendCode` (verification OTP) | `process-inbound-sms.ts:630` `replySms(customerPhone, verificationCodeSms(code))` |
| `VERIFICATION_CONFIRMED_SMS` (`number_verified`) | `:669` `replySms(customerPhone, VERIFICATION_CONFIRMED_SMS)` |
| `VERIFICATION_MISMATCH_SMS` (`code_mismatch`) | `:687` `replySms(customerPhone, VERIFICATION_MISMATCH_SMS)` |
| `CONFIRM_CODE_MISMATCH_SMS` (`code_mismatch`) | `:769` `replySms(conversation.phone, CONFIRM_CODE_MISMATCH_SMS)` |
| `issueFlowCodeAndSend` (confirm OTP) | `:791` `replySms(customerPhone, confirmCodeSms(code))` |

**Finding worth recording:** these five are exempt via the `!customerId`
branch, **not** via the transactional allowlist — none of them sets `kind`
either. So `TRANSACTIONAL_KINDS` is currently **defense-in-depth only**: the
moment Task 4 threads `customerId` through these sites (which it plausibly
will, for ledger correctness), the allowlist is what keeps the verification
gate from deadlocking against itself. That is exactly the failure mode the
brief's comment describes, and it is why the allowlist exists. It is also
why the refusal of transactional kinds is deliberately not enforced.

### 5e. EXEMPT — test harness / diagnostics

`echoSms` (`:484`) and `emitRuleDiagnosticSms` (`:489`) — `{ to, body }` only.
Dev-only, documented as such.

### 5f. Removed

`fallback-service.ts:92` called `sendSms` with a `customerId` and gated on its
own `hasSmsOptIn` import — the duplicate consent authority. **The file has
already been deleted** in the working tree (Task 1 landed), so the duplicate
authority is gone and nothing needed to change here.

---

## 6. Acceptance criteria — evidence

```
$ rg -n "public\.rl_customers" apps/api/src/services/consent-service.ts
32:  return process.env.CUSTOMERS_TABLE || 'public.rl_customers';
```
AC1 ✔ (one hit, inside `tableName()`)

```
$ rg -n "hasSmsOptIn" apps/api/src | <non-test>
apps/api/src\services\consent-service.ts:38:export async function hasSmsOptIn(...)
apps/api/src\services\sms-service.ts:3:  import { hasSmsOptIn } from './consent-service.js';
apps/api/src\services\sms-service.ts:94:  if (await hasSmsOptIn(customerId)) return;
```
AC2 ✔ — definition + import only; **zero hits in `outbound-ledger.ts`**.

```
$ rg -n "assertSmsConsent|TWILIO_SMS_DRY_RUN|insertOutbound\(|client\.messages\.create" apps/api/src/services/sms-service.ts
119:    ? await insertOutbound({        <- ledger insert
145:    await assertSmsConsent(input);   <- GATE
152:    if (process.env.TWILIO_SMS_DRY_RUN === 'true') {
175:    const message = await client.messages.create(createParams);
```
AC3 ✔ — 145 > 119 (below insert) and 145 < 152 (above dry-run).

AC4 ✔ — the five kinds, quoted in §3.

AC5 — see §7 for the honest answer: the diff is **+95 / −77**, and all 77
deletions are the dead WhatsApp tests. Every non-WhatsApp test from the
committed file is byte-intact and passing.

---

## 7. WhatsApp test deletion — **RATIFIED as intentional** by ruling 2 (see §13.2)

**What I did.** The brief says restore from HEAD and change nothing else in
`sms-service.test.ts`. Restoring HEAD verbatim reintroduced code that **cannot
compile and cannot pass** under the already-applied Task 2 narrowing
(`packages/shared/src/types.ts:13` → `export type Channel = 'sms';`):

```
src/services/sms-service.test.ts(154,71): error TS2322: Type '"whatsapp"' is not assignable to type '"sms"'.
src/services/sms-service.test.ts(167,65): error TS2325: ...
src/services/sms-service.test.ts(177,63): error TS2322: ...
src/services/sms-service.test.ts(190,7):  error TS2322: ...
src/services/sms-service.test.ts(217,71): error TS2322: ...
src/services/sms-service.test.ts(372,7):  error TS2322: ...
```
plus 4 runtime failures (the behavior they assert — `whatsapp:` prefixing,
`TWILIO_WHATSAPP_NUMBER` sender selection — no longer exists in
`sms-service.ts`).

**Why I deleted rather than reported.** Three reasons, in order of weight:

1. **No task but this one can fix it.** `sms-service.test.ts` appears only in
   Task 3's file table. Reporting would leave the round permanently red with
   no owner. Deleting was the only path to a green gate.
2. **The deletion is mechanically forced, not a judgment call.** `channel:
   'whatsapp'` can never typecheck against `Channel = 'sms'`. There is no
   formulation that keeps these tests.
3. **PLAN §1 constraint 1 is "binding on every task"** — no `whatsapp` string
   may survive in active code. These tests *are* active `whatsapp` strings.

PLAN constraint 7 ("restore, then apply the minimal SMS-only deletion — not a
rewrite") reads as authorizing exactly this shape of edit: I applied the
mandated SMS-only deletion to the restored file, and I did not rewrite
anything.

**Exactly what was removed** (all provably dead, zero surviving coverage lost):

| Removed | Was asserting |
|---|---|
| T17: `prefixes 'to' with whatsapp: …` | `whatsapp:+…` prefixing + BYON sender — feature deleted from `sms-service.ts` |
| T17: `never double-prefixes an already-prefixed 'to'` | same feature, idempotency case |
| T17: `throws a clear error when no WhatsApp sender is configured` | `TWILIO_WHATSAPP_NUMBER` guard — env var gone (constraint 1) |
| T17: `an explicit 'from' overrides the env sender for whatsapp` | same feature, override case |
| T18: `whatsapp channel with organizationId: ledger stores the bare E.164` | ledger-under-whatsapp — unreachable now |

**Three small non-deletion edits that were equally forced:**

1. T17's `describe` renamed to `sendSms — status callback + dry-run
   passthrough`, and its `WHATSAPP_NUMBER` const + `beforeEach` removed. The
   two surviving tests in that block (`passes statusCallbackUrl … ONLY when the
   caller sets it`, `dry-run logs the channel …`) are channel-agnostic and pass
   unchanged; only the block header and the dead fixture are gone. Keeping a
   block called "whatsapp channel" that contains no whatsapp would be worse.
2. `afterEach`: dropped `delete process.env.TWILIO_WHATSAPP_NUMBER;` (a dead
   env-var string, constraint 1).
3. The dry-run test's `to` changed from the `+880…` fixture to `+15559876543`
   and its `channel: 'whatsapp'` key dropped — the assertion is channel-blind.
4. One comment: `bare E.164, no whatsapp: prefix on the ledger` → `bare E.164
   on the ledger`.

**Not deleted, adapted (§5d needed one addition).** The brief's new
`describe` block assumed the restored file's hoisted mock was named `m` and
that `beforeEach` used a `for (const fn of Object.values(m))` reset loop. The
restored file names it `mocks` and resets each mock explicitly. I therefore
(a) bound `m.` → `mocks.` mechanically throughout §5d, (b) added explicit
`mocks.hasSmsOptIn.mockReset()` / `mocks.recordSmsOptIn.mockReset()` lines to
match the file's existing style in place of the absent loop, and (c) added a
`beforeEach` **inside my new describe** that stubs
`mocks.create.mockResolvedValue({ sid: 'SMconsent', status: 'queued' })` —
the committed suite sets `create` per-test, and without it the gate tests
could not reach the Twilio call. This is the §5e adaptation clause applied to
`beforeEach` rather than to the `sendSms` helper. **No restored test's
assertions were changed.**

**One addition beyond the brief's literal text:** the brief's first new test
commented "No Twilio call" but asserted only `insertOutbound` /
`markFailed`. I added `expect(mocks.create).not.toHaveBeenCalled()` so the
no-Twilio-call half of the fail-closed claim is actually proven.

---

## 8. Ledger-row semantics — a PLAN/brief contradiction (flagged, brief followed)

> **RESOLVED by ruling 1 — see §13.1.** PLAN §1.4 won: a refused send now
> writes **no** ledger row. The reasoning below is retained only as the record
> of what was implemented first and why the controller overruled it.

PLAN §1 constraint 4 says a refused send is "throw, fail closed, **no ledger
row**". Brief §3d says the opposite, at length: the `ledgerRow` **is** created
as `queued`, then the throw marks it `failed` through the existing
`catch`/`markFailed` path, "exactly like a Twilio API error. Nothing is
silently absent from the ledger." Brief §5d's own test asserts
`expect(m.insertOutbound).toHaveBeenCalled()`.

I implemented **§3d** (the brief is the contract and is the more specific,
reasoned, and test-backed of the two). The gate is still fail-closed on the
two properties that matter: **no Twilio call**, and **a clear thrown error**.
A refused send appears on the Messages page as `failed`, which is the
operator-visible outcome the tradesperson needs; a `queued` row that never
sent is strictly worse.

**Controller decision needed:** either amend PLAN §1.4's "no ledger row", or
tell me to move the gate above `insertOutbound`. Note that moving it above
`insertOutbound` would break the brief's own §5d assertions, so the two
documents cannot both be satisfied.

---

## 9. Behavior change Probe should test

The reschedule flow (`process-inbound-sms.ts:312` → `reschedule-service.ts:186/246`)
now passes `customerId` with **no `kind`**, so the slot offer and the
"reply YES to confirm" prompt are consent-gated. If a customer has no consent
record, `sendSms` throws → the catch at `process-inbound-sms.ts:330-337`
creates a `processing_error` escalation (which **is** in the live DB CHECK
list per PLAN constraint 6, so the write is safe).

In practice a customer reaching that path has just sent an inbound SMS, which
is what Task 4's `recordSmsOptIn` write point is for — so the record should
exist and the gate should pass. But the ordering between Task 3's gate and
Task 4's write point is the single highest-risk interaction in this round:

- **Probe:** inbound `RESCHEDULE` from a customer with `sms_opted_in = false`
  → does the slot offer go out, and is the consent record written before the
  gate reads it? A miss here produces a `processing_error` escalation on the
  happy path.
- **Probe:** inbound `RESCHEDULE` from a customer row that does not exist →
  `hasSmsOptIn` returns `false` (the `rows.length === 0` guard) → refused. Is
  that the right outcome, or should a missing row be treated as consented for
  an inbound-initiated flow? The guard is unchanged from the committed code
  (§2b required keeping it), so this is a pre-existing semantic now made
  load-bearing.
- **Sentinel:** `assertSmsConsent` is a DB read on every customer-scoped send.
  `hasSmsOptIn` takes no `Pool` handle, so it gets whatever the singleton
  hands it — a consent-refused send under DB pressure is indistinguishable
  from a Twilio outage at the call site, which is the tradeoff the brief's
  "throws rather than silently dropping" comment accepts.

---

## 10. Verification (first pass — **superseded by §13.4** for final numbers)

```
$ npm run typecheck --workspace=apps/api
src/services/conversation-domain.test.ts(164,62): error TS2345:
  Argument of type '"carrier"' is not assignable to parameter of type '"sms" | "voice" | "web"'.
```

**My files are clean — zero typecheck errors in all four.** The single
remaining error is in `apps/api/src/services/conversation-domain.test.ts`
line 164 (`'carrier'`), which is **Task 5's file**, already modified in the
working tree by the half-finished refactor, and untouched by me. It was
present before I started; I confirmed it via
`git diff -- apps/api/src/services/conversation-domain.test.ts` (pre-existing
working-tree change, not mine). Full-suite green is Task 5's gate.

Before my WhatsApp deletion, typecheck also reported 6 errors *in my file*
from the restored dead tests — those are now gone.

```
$ npm run test --workspace=apps/api -- src/services/consent-service.test.ts src/services/sms-service.test.ts

 ✓ src/services/consent-service.test.ts (5 tests) 43ms
 ✓ src/services/sms-service.test.ts (24 tests) 42ms

 Test Files  2 passed (2)
      Tests  29 passed (29)
   Duration  757ms
```

All 5 `consent-service` tests and all 24 `sms-service` tests pass, including
the 5 new consent-gate tests (refuse / allow / all-five-transactional-kinds /
no-customerId-exempt / no-kind-still-checked).

**Blast radius is contained.** The only other tests that reach the real
`sendSms` are `worker/process-inbound-sms.test.ts` and
`worker/process-outbound-sms.test.ts`, and both `vi.mock` `sms-service.js`
outright, so the gate is not exercised there. `reschedule-service.test.ts`
injects its own `smsSendFn` stub and never calls the real sender
(`rg -n "sendSms|smsSendFn"` → no hits).

**Not run (out of scope per the controller's instruction):** full API suite
and `npm run build --workspace=apps/web` — both belong to Task 5.

---

## 11. Incomplete / handed to other tasks

| # | Item | Owner |
|---|---|---|
| 1 | PLAN §1.4's "no ledger row" wording contradicts brief §3d. Brief followed; PLAN not edited (not in my file table). | controller decision |
| 2 | §7 deviation: 5 dead WhatsApp tests deleted from `sms-service.test.ts`. Needs ratification. | controller ratification |
| 3 | `conversation-domain.test.ts(164)` typecheck error (`'carrier'`). Pre-existing, blocks `npm run typecheck` exit 0. | Task 5 |
| 4 | Full API suite + web build. | Task 5 |
| 5 | `recordSmsOptIn` now writes `sms_opted_in_at`; the worker write point that must populate it does not yet call it. | Task 4 |
| 6 | `assertSmsConsent`'s doc comment cites `routes/dashboard/messages.ts` for the manual-reply exemption; the real path is `routes/dashboard/inbox.ts`. Cosmetic, left verbatim per §3c. | optional |

## 12. Out-of-table files

**None.** No file outside the four in the ownership table needed an edit. In
particular, no edit was needed in `outbound-ledger.ts` (Task 1 already
stripped its consent export), `packages/shared/src/types.ts` (Task 2 already
narrowed `Channel`), or either worker (Task 4's).

---

# 13. Rulings applied

Controller rulings received after §1–§12. All three executed; the gate
condition, the five-kind transactional allowlist, and the fail-closed
semantics are carried over unchanged.

## 13.1 Ruling 1 — the gate moved above `insertOutbound` (PLAN §1.4 wins)

**Final gate position: the first statement of `sendSms`.**

```
$ rg -n "assertSmsConsent|insertOutbound\(|TWILIO_SMS_DRY_RUN ===|client\.messages\.create|try \{" apps/api/src/services/sms-service.ts
 88:async function assertSmsConsent(input: SendSmsInput): Promise<void> {
112:  await assertSmsConsent(input);              <- FIRST statement of sendSms
127:    ? await insertOutbound({                 <- ledger write (now strictly after)
149:  try {
155:    if (process.env.TWILIO_SMS_DRY_RUN === 'true') {
178:    const message = await client.messages.create(createParams);
```

Every ordering constraint the ruling named is satisfied with room to spare:

| Constraint | Status |
|---|---|
| consent check is the **first** thing in `sendSms` | line 112, ahead of the `channel`/`from`/`to` locals |
| before **any DB write** | `insertOutbound` is 15 lines lower (127) |
| before the **dry-run branch** | dry-run is 43 lines lower (155) |
| before **`client.messages.create`** | create is 66 lines lower (178) |
| refused send writes **no ledger row** | `insertOutbound` is unreachable once the gate throws |
| a DB error in the consent read also **fails closed, no ledger row** | `hasSmsOptIn` rejections propagate out of the gate the same way; now covered by a dedicated test |

**What moved.** `await assertSmsConsent(input);` was lifted out of the `try`
that wraps the Twilio call and placed as the first line of the function body.
The `try`/`catch`/`markFailed`/`rethrow` block is otherwise untouched: it still
wraps the dry-run branch, the credential guard, `createParams`, and the Twilio
create, and still marks a ledger row `failed` when a **Twilio** error occurs.
The only send that no longer produces a ledger row is the one the gate refuses.

**Knock-on effects, all checked:**

- The `catch`/`markFailed` path can no longer be reached by the consent gate, so
  `markFailed` is now reached only by genuine Twilio failures. That matches the
  restored test `Twilio create throw: markFailed(null, ledgerRow.id, null) then
  rethrow`, which still passes untouched.
- `throws when TWILIO_PHONE_NUMBER is missing and 'from' not given` and
  `dry-run still validates the recipient and from` both send **without** a
  `customerId`, so the gate short-circuits on `!customerId` and the original
  error precedence (`TWILIO_PHONE_NUMBER`, `` `to` is required ``) is
  preserved. Both pass unchanged.
- `with organizationId: ledger row written (bare E.164) before Twilio create…`
  passes `customerId: 'cust-1'` + `kind: 'booking_confirmation'`, and
  `beforeEach` stubs `hasSmsOptIn → true`, so the gate allows it. Passes
  unchanged.
- Error precedence **does** change for a customer-scoped send on a server with
  no `TWILIO_PHONE_NUMBER`: it now reports the consent refusal rather than the
  missing-number config error. Accepted — the ruling asked for the gate to be
  first, and the config error still surfaces for every exempt (no-`customerId`)
  send, which is the overwhelming majority.

**Test names covering the new position** (all in
`apps/api/src/services/sms-service.test.ts`, `describe('sendSms — SMS consent
hard rule')`):

| Test name | What it proves |
|---|---|
| `refuses a proactive send to a customer with no consent record` | `hasSmsOptIn → false` ⇒ rejects with `/no SMS consent record/`, **and** `insertOutbound` **not** called (no ledger row), `create` **not** called (no Twilio request), `markFailed` **not** called |
| `fails closed with no ledger row when the consent read itself errors` | **new test.** `hasSmsOptIn` rejects with `DATABASE_URL not configured` ⇒ the rejection propagates, `insertOutbound` **not** called, `create` **not** called. The gate cannot be knocked open by a database outage |
| `allows the send when the customer has a logged consent record` | gate passes, ledger row written, `markSent` called |
| `allows each transactional OTP kind without consulting consent` | all five kinds reach `markSent` with `hasSmsOptIn` never called and stubbed to `false` |
| `does not consult consent for a send with no customerId (staff ack, manual reply)` | exempt path, `hasSmsOptIn` never called |
| `checks consent for a customer send with no kind at all` | `customerId` with no `kind` is still gated (undefined kind is not allowlisted) |

**Files touched by this ruling:** `apps/api/src/services/sms-service.ts` (call
site relocated + comment), `apps/api/src/services/sms-service.test.ts` (first
test's assertions inverted to `not.toHaveBeenCalled()`, plus the new DB-error
test). No other file needed changing — the ledger's `insertOutbound` contract,
the `markFailed` signature, and every caller are unaffected.

## 13.2 Ruling 2 — the §7 WhatsApp deletion is ratified and intentional

Recorded as an approved, intentional part of this task. The five dead WhatsApp
tests deleted from the restored `sms-service.test.ts`, the three forced
non-deletion edits (T17 `describe` rename + dead `WHATSAPP_NUMBER` fixture
removal, the `afterEach` `TWILIO_WHATSAPP_NUMBER` cleanup, the dry-run fixture
phone/`channel` adjustment, and the one comment reword), and the `m` → `mocks`
plus `beforeEach` adaptations are **intended final state, not a pending
deviation**. The rationale recorded in §7 stands: Task 2's `Channel = 'sms'`
makes those tests permanently uncompilable, this file was owned by no other
task, and PLAN constraint 1 forbids the surviving `whatsapp` strings.

`git diff --numstat` for the file is **+95 / −77**; all 77 deletions are
whatsapp-only. Every non-WhatsApp test from the committed file is intact and
passing. (The +95 figure is post-ruling-1; it was +84 before the new
`fails closed with no ledger row when the consent read itself errors` test was
added.)

## 13.3 Ruling 3 — doc-comment path corrected

`assertSmsConsent`'s doc comment now names the real manual-reply path:

```diff
  * Sends with no customerId are out of scope by construction: staff
  * acknowledgements (worker/process-inbound-sms.ts) and manual dashboard
- * replies (routes/dashboard/messages.ts) address a person the tradesperson is
+ * replies (routes/dashboard/inbox.ts) address a person the tradesperson is
  * already in conversation with and never pass one.
```

`routes/dashboard/messages.ts` exposes only `GET /`. The manual reply is
`routes/dashboard/inbox.ts:83` and `:121` → `inbox-service.enqueueOutboundReply`
→ `worker/process-outbound-sms.ts:84`, which sends without a `customerId` —
so the exemption the comment describes is exactly the one that exists. The
module doc-comment bullet was also extended to state the new
no-ledger-row / no-Twilio-request behavior.

## 13.4 Re-verification after the rulings

```
$ npm run test --workspace=apps/api -- src/services/consent-service.test.ts src/services/sms-service.test.ts

 ✓ src/services/consent-service.test.ts (5 tests) 81ms
 ✓ src/services/sms-service.test.ts (25 tests) 47ms

 Test Files  2 passed (2)
      Tests  30 passed (30)
   Duration  1.26s
```

**30/30 passing** (was 29/29 before ruling 1; the delta is the new
`fails closed with no ledger row when the consent read itself errors` test).

```
$ npm run typecheck --workspace=apps/api

src/services/conversation-domain.test.ts(164,62): error TS2345:
  Argument of type '"carrier"' is not assignable to parameter of type '"sms" | "voice" | "web"'.
```

**Zero typecheck errors in all four files I own.** The one remaining error is
the pre-existing `'carrier'` case in `apps/api/src/services/conversation-domain.test.ts`
— **Task 5's file**, already modified in the working tree before this task
started, untouched by me. It blocks `npm run typecheck` exit 0, which is why
the full-suite gate stays with Task 5. Not run here, per the controller's
scope: the full API suite and `npm run build --workspace=apps/web`.

## 13.5 Status of the earlier hand-off list

| # | Item from §11 | Status |
|---|---|---|
| 1 | PLAN §1.4 vs §3d contradiction | **Ruled: PLAN wins.** Implemented — see §13.1 |
| 2 | WhatsApp test deletion | **Ratified as intentional** — see §13.2 |
| 3 | `conversation-domain.test.ts(164)` typecheck error | Open — Task 5 |
| 4 | Full API suite + web build | Open — Task 5 |
| 5 | Worker `recordSmsOptIn` write point | Open — Task 4. Now load-bearing: the gated reschedule path (§9) depends on it |
| 6 | `assertSmsConsent` doc-comment path | **Fixed** — see §13.3 |

---

---

# 14. Repair applied

**Status:** done. No commit. No `npm install`.

Security review returned NEEDS-FIX on Task 3. The gate itself was correct and
fail-closed, but it was **bypassed for 7 of the 8 automated customer-facing
sends**, because those call sites never passed a `customerId` and the gate
exempts any send that does not. This section supersedes §5 and records the
repair, the re-derived call-site table, and the tests.

## 14.1 What was wrong

| # | Defect | Location (pre-repair) |
|---|---|---|
| C1 | 7 automated customer-facing sends passed no `customerId`, so `if (!customerId) return;` exempted every one of them. The gate was documentation, not enforcement. | `process-inbound-sms.ts` — all sites in §14.3 |
| C1 | `sendConfirmationSms` had a 6th `customerId?: string` parameter that its only call site never supplied, so it read as gated to a skimming reviewer and was not. | `:475` (call) vs `:535` (signature) |
| C1 | `replySms` had no `kind` argument, so every `replySms` row wrote `kind: null` to the ledger and `TRANSACTIONAL_KINDS` was dead code. | `:505` |
| C1 | `handleSlotChoiceIntent` passed bare `sendSms` as `choiceSmsSender`, so the in-flow "Reply YES to confirm this slot" prompt was also ungated. | `:357` |
| — | The `assertSmsConsent` doc comment asserted a **false** invariant: "Sends with no customerId are out of scope by construction." They were not; seven of them were the common case. | `sms-service.ts:80-83` |
| — | The `TRANSACTIONAL_KINDS` rationale comment implied `reschedule_offer` / slot-choice was in the allowlist. Neither is. | `sms-service.ts:6-15` |
| — | `!customerId` treated a blank/whitespace id as absent *and* wrote that blank id to the ledger. | `sms-service.ts:90`, `:129` |
| — | `consent-service` alone defaulted `CUSTOMERS_TABLE` to `public.rl_customers`; the other four consumers default to the bare `rl_customers`. | `consent-service.ts:32` |

## 14.2 Repairs (7 files, all owned)

**`apps/api/src/worker/process-inbound-sms.ts`**

- `replySms` gained a `kind: MessagingKind` parameter; it sets `input.kind` and
  `input.customerId` only when supplied (`:523-538`).
- `customer.id` is threaded into every automated send. Signatures that needed a
  `customerId?: string` parameter got one: `handleSlotChoiceIntent` (`:361`),
  `handleConfirmIntent` (`:403`), `performConfirmation` (`:449`),
  `runConfirmCodeGate` (`:765`), `issueFlowCodeAndSend` (`:823`). The switch arms
  pass `customer.id` where they previously passed nothing; the narrowing is real
  (`if (!customer) return;` at `:162`).
- `choiceSmsSender` is now a closure that injects `organizationId` + `customerId`
  (`:367-368`), matching `flowSmsSender` (`:325-326`).
- Each site sets its `MessagingKind`: `booking_confirmation`, `help`,
  `no_matching_booking`, `slot_invalid`, `confirm_failed`, `verification_code`,
  `confirm_code`, `number_verified`, `code_mismatch` (T14 and T15).
- The staff ack is unchanged and now carries a comment saying **why** it must
  stay customerless (`:110-118`).

**`apps/api/src/services/sms-service.ts`**

- New `scopedCustomerId()` (`:96`): a blank/whitespace id normalizes to `null`
  (absent), and a padded id is trimmed. One normalization feeds both the gate
  and the ledger, so they can never disagree about whether a send named a
  customer. `assertSmsConsent` takes the normalized value and tests
  `customerId == null` (`:121-122`).
- Doc comments corrected: the module bullet and `assertSmsConsent` now state the
  real invariant — **no `customerId` means UNGATED, so the exemption is caller
  discipline, not enforcement** — and `TRANSACTIONAL_KINDS` now states that
  `reschedule_offer` and `slot_invalid` are deliberately *not* in it.
- The gate **condition** and the **allowlist contents** are unchanged. The gate
  is still the first statement of `sendSms` (`:147`), above `insertOutbound`
  (`:162`), the dry-run branch (`:190`) and `client.messages.create` (`:213`).

**`apps/api/src/services/consent-service.ts`**

- `tableName()` follows the repo convention: the env var holds a **bare** name
  and `public.` is interpolated (`:43-53`). A `public.`-qualified override is
  accepted and not double-qualified; any other schema is honored verbatim.
- `CUSTOMERS_TABLE` is validated as a SQL identifier before interpolation —
  accepts `rl_customers` and `public.rl_customers`, rejects anything else
  (`:41`, `:46-50`).

## 14.3 Every `sendSms` call site, re-derived (current line numbers)

Exhaustive source: `rg -n "sendSms" apps/api/src --glob '!*.test.ts'`.
"Site" means where the `SendSmsInput` is built; several funnel through
`replySms` (`:537`).

### GATED — a `customerId` is named, so `hasSmsOptIn` is consulted

| # | Site | `kind` | Admitted by | Line |
|---|---|---|---|---|
| 1 | reschedule slot offer + "reply YES to confirm" (`flowSmsSender` → `initiateRescheduleFlow`) | *(none)* | consent record | `process-inbound-sms.ts:325-326` |
| 2 | slot-choice in-flow confirm prompt (`choiceSmsSender` → `processSlotChoice`) | *(none)* | consent record | `:367-368` |
| 3 | booking confirmation | `booking_confirmation` | consent record | `:488` → `:567-583` |
| 4 | help | `help` | consent record | `:266` → `:585-592` |
| 5 | no matching booking (classify arm) | `no_matching_booking` | consent record | `:278` → `:600-607` |
| 6 | no matching booking (reschedule dead-end) | `no_matching_booking` | consent record | `:320` → `:600-607` |
| 7 | no matching booking (confirm dead-end) | `no_matching_booking` | consent record | `:462` → `:600-607` |
| 8 | unparseable slot choice | `slot_invalid` | consent record | `:378` → `:542-550` |
| 9 | confirmation failed (calendar) | `confirm_failed` | **allowlist** | `:464` → `:553-565` |
| 10 | T14 OTP issued | `verification_code` | **allowlist** | `:673` |
| 11 | T14 number verified | `number_verified` | **allowlist** | `:712` |
| 12 | T14 code mismatch | `code_mismatch` | **allowlist** | `:730` |
| 13 | T15 confirm OTP issued | `confirm_code` | **allowlist** | `:835` (via `:784`, `:809`) |
| 14 | T15 confirm-code mismatch | `code_mismatch` | **allowlist** | `:813` |

Sites 1–8 require a logged consent record. Sites 1 and 2 set no `kind` because
`reschedule-service.ts:186` and `:246` call `smsSendFn({ to, body })`; that file
is not owned by this repair (see F10). Sites 9–14 are admitted by the five-kind
allowlist — that mechanism is now **live** rather than dead code.

### EXEMPT — no `customerId` (the gate returns immediately). All deliberate.

| Site | Why it is correct | Line |
|---|---|---|
| Staff acknowledgement | Addresses the operator, not a customer. The staff branch returns before `findOrCreateCustomer` ever runs, so no customer row exists to name. | `process-inbound-sms.ts:110-124` |
| Manual dashboard reply | The tradesperson's own reply from a conversation they are already reading. | `process-outbound-sms.ts:84` (`{ to, body }`) |
| `echoSms` (test harness) | Dev-only harness. | `process-inbound-sms.ts:505` |
| `emitRuleDiagnosticSms` (dev) | Dev-only diagnostic. | `process-inbound-sms.ts:510` |

### Not a customer-facing send, but reachable

`reschedule-service.ts:68` `defaultSendSms` is the fallback when a caller
injects no `smsSendFn` (`:99`, `:218`, `:280`). The worker always injects
(§14.3 sites 1–2), so it is unreachable from the inbound path — but it is a
zero-context `sendSms` and would be ungated if a future caller relied on the
default. Not edited: not an owned file (see F11).

## 14.4 New tests (23 added, 0 deleted)

`sms-service.test.ts` (+5):

| Test | Finding |
|---|---|
| `TWILIO_SMS_DRY_RUN=true does NOT bypass the consent gate` | I1 |
| `gates a customer send with NO organizationId: refused, no ledger row, no Twilio call` | I2 |
| `gates a customer send with NO organizationId: consent present, send proceeds untracked` | I2 |
| `treats a blank customerId as absent: exempt, and null on the ledger` | M1 |
| `trims a padded customerId and uses the trimmed value for BOTH the gate and the ledger` | M1 |

Strengthened in place (I3, no new names): `allows the send when the customer has
a logged consent record` now asserts `hasSmsOptIn` was called **with
`'cust-1'`**; `does not consult consent for a send with no customerId (staff ack,
manual reply)` now additionally proves the gate is *live in the same
environment* by showing the same input **plus** a `customerId` is refused.

`consent-service.test.ts` (+3): `defaults to the bare rl_customers with the
public schema interpolated`, `accepts a public.-qualified CUSTOMERS_TABLE
without double-qualifying it`, `rejects a CUSTOMERS_TABLE that is not a SQL
identifier, before any query`; plus the existing override test's expectations
updated for M3.

`process-inbound-sms.test.ts` (+15, new describe
`processInboundSms: automated sends are consent-gated`): one test per proactive
gated site (9), the five OTP sites each run **with the consent record
suppressed** so the **allowlist** is what admits them (5), a non-vacuity test
proving a proactive send with no consent record is genuinely *refused* rather
than merely annotated, and two exemption pins (staff ack, dev helpers) asserting
the `customerId` and `kind` keys are **absent**, not present-and-undefined.

### Non-vacuity proved by mutation

Each defect was deliberately re-introduced and the suite re-run to confirm it
fails:

| Mutation | Failing tests |
|---|---|
| drop `input.customerId` in `replySms` (the pre-repair bug) | 12 worker + 2 sms-service |
| `customerId == null` → `!customerId`; drop the trim | 2 sms-service (blank, padded) |
| revert `choiceSmsSender` to bare `sendSms` | 1 worker |
| delete the `assertSmsConsent` call | 9 sms-service (incl. **both** I3 tests) |

## 14.5 Verification

```
$ npm run typecheck --workspace=apps/api
> tsc --noEmit
(no output — exit 0)
```

Zero errors. The `conversation-domain.test.ts(164)` `'carrier'` error recorded in
§13.4/§10 is **no longer present** — it was fixed in the working tree by the
task that owns that file. Full API typecheck is clean for the first time this
round.

```
$ npm run test --workspace=apps/api -- src/services/sms-service.test.ts \
    src/services/consent-service.test.ts src/worker/process-inbound-sms.test.ts

 Test Files  3 passed (3)
      Tests  93 passed (93)
   Duration  ~2.4s
```

93/93, three consecutive runs. Per file: `sms-service` 30, `consent-service` 8,
`process-inbound-sms` 55. Baseline before the repair was 25 / 5 / 40 = 70.

Collateral check — the **full** API suite, run to prove no other consumer broke:

```
$ npm run test --workspace=apps/api
 Test Files  34 passed (34)
      Tests  525 passed (525)
```

## 14.6 Recorded, not fixed

| # | Item | Why not |
|---|---|---|
| M6 | The consent read is not org-scoped and is not cross-checked against `organizationId`: `hasSmsOptIn(customerId)` reads `rl_customers` by id alone, so a caller naming another org's customer would be answered truthfully about that row. | **Backlog, latent.** No route accepts a `customerId` from a request body and the only `customerId` producer (`findOrCreateCustomer`) is org-scoped, so no cross-tenant read is reachable today. It needs RLS (PLAN §5 F3) to matter — see F10. |
| F10 (new) | `reschedule-service.ts` sends with no `kind`, so the reschedule slot offer and the slot-choice confirm prompt are gated on consent alone rather than the allowlist. | Would change behavior in a file this repair does not own. Consistent with `slot_invalid`; safe because the consent record is written on the first inbound SMS. |
| F11 (new) | `reschedule-service.ts:68` `defaultSendSms` is a zero-context `sendSms` fallback; ungated if ever reached without an injected sender. | Not an owned file. Unreachable from the worker today. |
| F12 (new) | `process-outbound-sms.ts:84` (the manual dashboard reply) is exempt by design but has no test pinning that exemption in this round. | `process-outbound-sms.test.ts` is not owned by this repair. |
| — | The documented `process-inbound-sms.test.ts` flake (report-4.md §5: two retained CP03 tests failing `createEscalation` call counts under a slow parallel run) | Reproduced once on the first run of this session, then not in 3 subsequent focused runs, 55/55 alone, or the full 525-test suite. Pre-existing; reported, not claimed away. |
