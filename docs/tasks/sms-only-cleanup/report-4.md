# Task 4 report — Inbound worker: E.164 repair, test restore, opt-in write point

Status: **complete.** Typecheck clean for both owned files; focused suite 40/40 green.

## 1. Files edited (exactly the two the brief owns)

| File | Change |
|---|---|
| `apps/api/src/worker/process-inbound-sms.ts` | 4 edits (§2a, §2b, §2c, §2e) |
| `apps/api/src/worker/process-inbound-sms.test.ts` | restored from HEAD, then §3a–§3f |

No other file was touched. No commit made. No install run.

## 2. Worker changes, with line evidence

| Brief | Line | Content |
|---|---|---|
| §2a E.164 repair | **34** | `const E164_RE = /^\+?[1-9][0-9]{1,14}$/;` — was `/^\\+?[1-9][0-9]{1,14}$/`, now exactly one backslash. Verified live: matches `+15551234567`, rejects `+15551234567:ext1`. |
| §2b consent import | **17** | `import { recordSmsOptIn } from '../services/consent-service.js';` — directly after the `conversation-service.js` import (line 16). |
| §2c opt-in write point | **159–163** | comment block + `await recordSmsOptIn(customer.id);` |
| §2e stale comment | **490–494** | `replySms` docblock now reads "Customer reply: always SMS. Keeps the legacy sendSms shape…". `replySms` body unchanged. |

### Exact placement of the opt-in write point

```
156:  if (!customer) return; // defensive — findOrCreateCustomer never returns null
157:
158:  // Consent hard rule, write point: a customer who has replied to us has
159:  // demonstrably consented to SMS at this number. Record it here — once, for
160:  // the inbound message — so sms-service.ts's outbound gate passes for their
161:  // later proactive sends. Idempotent; the staff flow above already returned.
162:
163:  await recordSmsOptIn(customer.id);
164:
165:  let verifiedNow = false;
```

It sits after the `if (!customer) return;` guard and before `let verifiedNow = false;`,
exactly as the brief dictates. Ordering evidence in the file:

- staff flow returns first — `if (staffResolved) return;` at line **126** → no opt-in
  write for a staff phone;
- customer row exists — `findOrCreateCustomer` inside the try/catch at **132**;
- **163** the opt-in write;
- T14 verification gate — **168** (may `return` early at 172);
- `classifyStep` — **202**.

So `rg -n "recordSmsOptIn"` shows the import (17) and exactly one call site (163), both
before `classifyStep` (202). Nothing in the file sends a gated SMS before line 163, and
every path that reaches a gated send (T14 verification-code SMS, T15 confirm-code SMS,
classify dispatch, reschedule flow) runs after it.

Per §2c the write is **not** wrapped in try/catch — a failure propagates and the job
never classifies. The `recordAiUsage` block's best-effort try/catch (line ~222) was left
untouched.

## 3. Test-file changes

Restored first: `git checkout HEAD -- apps/api/src/worker/process-inbound-sms.test.ts`
(working-tree copy was 1119 lines; committed file is 1277).

- **§3a** line **31** → `recordSmsOptIn: vi.fn(), // consent write point (SMS only)`
- **§3b** line **73** → `recordSmsOptIn: m.recordSmsOptIn,`
- **§3c** `beforeEach` untouched (the existing `for (const fn of Object.values(m)) fn.mockReset();`
  resets the new mock; default customer is `VERIFIED`).
- **§3d** T17 WhatsApp suite deleted (HEAD lines 944–1042, 99 lines).
- **§3e** T18 WhatsApp opt-in suite deleted (HEAD lines 1113–1277, 165 lines, incl. the
  local `unverifiedCustomer()` helper).
- **§3f** SMS consent suite appended at line **1014** (8 tests).
- **§3g** CP03 + T14 + T15 + T16 untouched.

Resulting structure: `CP03 wiring` (170, with nested T14 at 550 and T15 at 721),
`T16 staff-phone operator flow` (944), `SMS consent write point` (1014). `vi.mock('pg')`
retained at line 34. 1183 lines, 40 tests.

### Masked fixtures / duplicated T16

Both were artifacts of the discarded working-tree half-rewrite, not of the committed
file: the restored HEAD file has zero `***` masked-phone fixtures (verified by scan) and
exactly one `T16 staff-phone operator flow` describe. Restoring from HEAD resolved both,
so no additional fixture edits were needed. Every phone literal in the new suite is a
real E.164 (`+15551234567`, `+15559876543`).

### Proof the retained suites survived byte-for-byte

A line-by-line comparison of the restored+edited file against `HEAD`:

- HEAD lines 1–943 vs current 1–943: **2 differing lines** — only line 31 and line 73
  (the intended §3a/§3b mock renames). Every other line, including all of CP03, T14 and
  T15, is identical.
- T16 suite, HEAD 1043–1112 vs current 944–1013: **0 differing lines**.

The `�` in the CP03 describe name is a pre-existing U+FFFD in the committed file; §3g said
keep the retained suites as committed, so it was left alone.

## 4. How the flowSmsSender interaction is covered

`handleRescheduleIntent` builds `flowSmsSender` as
`sendSms({ ...input, organizationId, customerId })` (line 319) — a `customerId` with **no**
`kind`, so the Task 3 gate in `sms-service.ts` applies (`if (!customerId) return;` →
`if (kind && TRANSACTIONAL_KINDS.has(kind)) return;` → `hasSmsOptIn` → throw).

Because this test file mocks `../services/sms-service.js` wholesale, the real gate cannot
be invoked here. The two tests added at lines **1112** and **1158** therefore assert the
contract this file can actually prove, by standing in a faithful mirror of that gate:

1. **`a gated reply send (customerId, no kind) does not throw: the opt-in write lands first`**
   (line 1112). `recordSmsOptIn` flips a flag; the `sendSms` mock throws
   `SMS consent required for …` for any send with a `customerId`, no `kind`, and no
   consent record — exactly the gate's condition. `initiateRescheduleFlow` is stubbed to
   invoke the worker's real `flowSmsSender` (8th arg) once. The test asserts
   `processInboundSms` **resolves** (no consent throw), that `recordSmsOptIn` was called
   once with `'cust-1'`, that the send really was gated (`customerId: 'cust-1'`,
   `organizationId: 'org-1'`, `kind` undefined), and — via `invocationCallOrder` — that
   the opt-in write ran **before** that send.
2. **`records the opt-in ONCE per inbound job, not once per gated send`** (line 1158).
   The stub issues two sends through `flowSmsSender`; asserts `sendSms` was called twice
   and `recordSmsOptIn` exactly once. Proves per-inbound, not per-send.

The brief's own §3f suite additionally covers the before-classify ordering, cross-inbound
idempotency, the T14-gate path, the staff exemption, the visible failure, and the
non-E.164 rejection.

**Residual gap, by design:** an end-to-end proof against the *real* `sendSms` gate belongs
in `apps/api/src/services/sms-service.test.ts`, which Task 3 owns and which the brief
assigns the gate's coverage to. Nothing in my two files can exercise it without unmocking
`sms-service`, which would contradict the restored committed mock structure.

## 5. Verification

```bash
npm run typecheck --workspace=apps/api
```

**Exit 2 — one pre-existing error, not in my files:**

```
src/services/conversation-domain.test.ts(164,62): error TS2345:
  Argument of type '"carrier"' is not assignable to parameter of type '"sms" | "voice" | "web"'.
```

That is `apps/api/src/services/conversation-domain.test.ts` — the file PLAN §3 assigns to
**Task 5** ("the acceptance criteria are the three full-suite commands, and any of them
can surface a file this task owns"). `process-inbound-sms.ts` and
`process-inbound-sms.test.ts` produce **zero** typecheck errors. Per the brief's §5 I
report the failing test and the type it names rather than editing the other task's file.
**Task 5 must repair it: a `MessagingKind`/`Channel` member left over in
`conversation-domain.test.ts:164` — the same class of stale-member reference the WhatsApp
removal left behind.**

```bash
npm run test --workspace=apps/api -- src/worker/process-inbound-sms.test.ts
```

```
 Test Files  1 passed (1)
      Tests  40 passed (40)
   Duration  2.15s
```

40/40, including all 8 SMS-consent tests. Run 8 times consecutively (plus once with
`node_modules/.vite` deleted to force a cold transform): **8/8 green**.

**One anomalous run to flag.** The very first run of this file after my edits reported
`Tests 2 failed | 38 passed (40)`, with both failures in *retained committed* CP03 tests
and both showing `expected "spy" to be called 1 times, but got 2 times` on
`m.createEscalation`:

- `rejects a non-E.164 From with an escalation and never touches customers` (line 171)
- `escalates when the Twilio number is not registered to any org` (line 190)

That run took 11.45s versus ~2.1s for every subsequent run. I could not reproduce it in 8
subsequent runs (including cold-cache, and including a direct `npx vitest run -t` of each
test in isolation, which passes). Neither test names a mock that Tasks 1/3 renamed
(`sendSms`, `insertOutbound`, `hasSmsOptIn`); both count only `createEscalation`. I believe
it was an environment/timing artifact of that one run, not a property of the code — but I
am reporting it rather than claiming it away, because the same file runs as part of
Task 5's full-suite gate. If it recurs there, it is a flake in the *restored* file, not
one introduced by this task.

## 6. Acceptance criteria

| Criterion | Result |
|---|---|
| `E164_RE` is `/^\+?[1-9][0-9]{1,14}$/` | line 34, one backslash |
| `recordSmsOptIn` import + single call site, both before `classifyStep` | lines 17, 163 vs 202 |
| `rg -i whatsapp apps/api/src/worker` → no matches | no matches in either file |
| `rg recordWhatsAppOptIn apps` → no matches | no matches in `apps` or `packages` |
| T17 + T18 gone, CP03/T14/T15/T16 kept | verified byte-for-byte (§3 above) |
| `vi.mock('pg')` retained | line 34 |

Note on the brief's §4 criterion "exactly four `describe` blocks": the file has **five**
`describe` calls — three top-level (CP03 at 170, T16 at 944, SMS consent at 1014) plus the
T14 (550) and T15 (721) sub-describes that §3g explicitly requires keeping. The criterion's
substance (T17 and T18 are gone) is met; I read the count as a wording slip rather than an
instruction to delete coverage §3g mandates.

## 7. Incomplete / out of table

- **No out-of-table file was needed.** Both edits fit the two owned files.
- Nothing in the brief is unfinished.
- Task 5 must fix `conversation-domain.test.ts:164` before the round's typecheck gate can
  go green; that file is outside my table.
- Pre-existing, untouched: the U+FFFD in the CP03 `describe` name (committed content, §3g).
- Backlog items F6/F7 in PLAN §5 remain deferred by design — `flowSmsSender` still threads
  `customerId` and no `kind`, which is exactly why it is gated and why the opt-in write at
  line 163 has to precede it.
