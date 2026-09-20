# T14 — OTP device verification (first-contact phone verification)

**Status: DONE.** All requirements implemented; full API suite green on the final
run (376/376); typecheck + build clean; nothing committed (working tree left
dirty per the brief).

## Per-file diff summary

| File | Type | What changed |
| --- | --- | --- |
| `apps/api/src/db/migrations/010-customer-verification.sql` | **NEW** (+22) | The 4 verification columns on `public.rl_customers`, exact SQL from the brief (`phone_verified_at timestamptz`, `verification_code text`, `verification_code_expires_at timestamptz`, `verification_attempts int not null default 0`), each `add column if not exists`. Header comment documents idempotency + no-backfill. No other migration files created. |
| `apps/api/src/services/verification-service.ts` | **NEW** (+39) | Pure primitives per section B: `issueCode()` = `String(randomInt(0, 10**6)).padStart(6,'0')` (crypto-random, uniform 6-digit); `verifyCode(expected, input)` = same-length guard + `timingSafeEqual` on `Buffer.from` values, returns boolean, never throws. No pool/env/persistence (the UPSERT_COLUMNS note is honored — persistence is in the worker). |
| `apps/api/src/services/verification-service.test.ts` | **NEW** (+37) | 5 tests: issueCode is 6-digit numeric (×100), codes differ across calls, verifyCode true on exact match, false on same-length/longer/shorter/non-numeric, never throws (length guard). No mocks needed — pure. |
| `apps/api/src/worker/process-inbound-sms.ts` | modified (+128/-1) | Added `Pool` import, `type Customer` import, `issueCode/verifyCode` import; lifted `customer` out of the domain-write `try` (was block-scoped); inserted the gate; added the T14 gate section at the end (lazy `getPool`, `issueAndSendCode`, `runVerificationGate`, copy constants, `VerificationOutcome` type). |
| `apps/api/src/worker/process-inbound-sms.test.ts` | modified (+193/-1) | Added `pg` Pool mock (recording `poolQuery` — same pattern as `process-outbound-sms.test.ts`), `DATABASE_URL` env in `beforeEach`, made the shared default customer **verified** (so all 14 pre-T14 tests exercise the no-gate steady state unchanged), and added a `processInboundSms: T14 verification gate` describe with 6 tests (see below). |
| `apps/api/src/services/conversation-domain.ts` | modified (+19/-3) | *(Beyond the brief's file list — required for correctness; see Decisions.)* `Customer` interface gains `phoneVerifiedAt/verificationCode/verificationCodeExpiresAt/verificationAttempts`; `CustomerRow` gains the 4 snake_case columns; `toCustomer` maps them (defensive `?.`/`??` so pre-010 rows — and the existing conversation-domain tests' fixtures — default to unverified); `findOrCreateCustomer`'s `returning` clause now includes the 4 columns. |
| `apps/api/scripts/local-db.mjs` | modified (+1) | *(Beyond the brief's file list — required wiring; see Decisions.)* Appended `"010-customer-verification.sql"` to the static `MIGRATIONS` array so `npm run db:local` actually applies 010. |

## Exact gate placement (file:line)

- `apps/api/src/worker/process-inbound-sms.ts:108-116` — the gate itself, immediately **after** the customer+conversation+message `try/catch` (which ends line 101) and **before** the classify prep (`getConversationByPhone` at 118-125) / `classifyStep` (129) / dispatch switch (166):
  - `108` `if (!customer) return;` (defensive type-narrow)
  - `109` `if (!customer.phoneVerifiedAt) {`
  - `110` `const outcome = await runVerificationGate(customer, customerPhone, body);`
  - `111-115` `if (outcome !== 'verified-now') { … return; }` — early return = job completes with NO classify/dispatch/escalation
- `apps/api/src/worker/process-inbound-sms.ts:419-523` — gate implementation section: lazy `pool`/`getPool()` (421-433), constants (435-445), `issueAndSendCode()` (455-467), `runVerificationGate()` (472-523).

`appendMessage` of the inbound (lines 82-88) is untouched — every inbound message is still recorded before the gate runs.

**On the brief's `complete(job)`:** the actual `complete(jobId: string)` is invoked by `worker/index.ts:35-37` after any handler resolves; no existing handler completes its own job (that would double-complete). The gate therefore achieves "complete(job) with NO classify/reply" by returning early from the handler. Behavior is identical to the brief's intent; no new queue-service call was added.

## Gate behavior implemented (brief section C)

1. `phoneVerifiedAt` set → gate never runs (zero DB writes; verified-customer test asserts `poolQuery` never called).
2. No `verification_code` OR expired (`expires_at <= now`) → issue fresh code, `update rl_customers set verification_code=$2, verification_code_expires_at=now()+interval '10 minutes', verification_attempts=0 where id=$1`, send `Your verification code is <code>. Reply with it to continue.`, return (no classify).
3. Pending code → compare `body.trim()` via `verifyCode`:
   - MATCH → `update … set phone_verified_at=now(), verification_code=null, verification_code_expires_at=null, verification_attempts=0`, send `Number verified!`, then **fall through** to the existing classify/dispatch for THIS message.
   - MISMATCH → `verification_attempts = verification_attempts + 1`; if attempts `< 3` → send `That doesn't match — try again.` + return; if `>= 3` → re-issue a NEW code (fresh SMS, attempts reset to 0) + return.
4. No failed-verification escalation to `rl_jobs`/escalations — the SMS re-issue loop is the only retry path (asserted: `createEscalation` not called in every gate-stop test).

## How existing unverified customers are treated on first post-migration text

Migration 010 does **not** backfill: every pre-existing `rl_customers` row has
`phone_verified_at = NULL` and `verification_attempts = 0` (default). On their
first text after deploy they hit gate step 2 (`verification_code` is NULL) and
receive the 6-digit code SMS; classify/reply are suppressed until they reply
with the code. Their inbound message is still recorded in `rl_messages` via the
unchanged `appendMessage`. This is acceptable for this stage and documented in
the migration header comment (per the brief's "no data backfill needed").

## Tests

### New tests

`verification-service.test.ts` — **5/5 pass** (solo tail below).

`process-inbound-sms.test.ts` → `processInboundSms: T14 verification gate` — **6/6 pass**:
1. unverified + no code → code SMS sent to From, code+TTL persisted (asserted on the recorded UPDATE params), **classify NOT called**, no escalation.
2. unverified + expired code → fresh code re-issued (new body ≠ stale code), no classify.
3. unverified + **correct** code → `phone_verified_at=now()` UPDATE persisted, `Number verified!` sent, then `classifyStep` called with `body: '246810'` (fall-through dispatch = help SMS; 2 sendSms total).
4. wrong code **under** the limit → attempt-increment UPDATE, `That doesn't match — try again.`, no classify.
5. wrong code on the **3rd** attempt (stored attempts=2) → fresh code re-issued, `try again` NOT sent, classify never called.
6. verified customer → gate skipped, zero `poolQuery` calls, classify runs normally (help SMS).

The brief listed 5 gate scenarios; I split its "wrong code x3" bullet into the
two MISMATCH branches (under-limit vs. exhausted) so both specified behaviors
are pinned. Harness style mirrors the existing file (hoisted `vi.fn()` mocks +
`vi.resetModules()` per test) and the `pg` recording-Pool mock is copied from
`process-outbound-sms.test.ts:13`.

### Full-suite results (`npm test --workspace=apps/api`)

Three runs on the same working tree (see Surprises for why they differ):

| Run | Result |
| --- | --- |
| 1 | 373/376 — 3 failures, all environmental: 2× `Test timed out in 5000ms` (`process-inbound-sms` first test, and the untouched `google-auth-service.test.ts`) + 1 cascade (`escalates when the Twilio number…` saw 2 escalations because the timed-out test's late-resolving promise landed in the next test's reset mock). |
| 2 | 375/376 — the only failure was `process-inbound-sms › rejects a non-E.164 From…` timing out at 5000ms (pre-existing; pristine files reproduce it). |
| 3 | **376/376 pass, 23/23 files** — green. |

```
 Test Files  23 passed (23)
      Tests  376 passed (376)
```

Deterministic worker-file proof (my gate tests included, CLI-only timeout raise — no repo change):

```
 ✓ src/worker/process-inbound-sms.test.ts (22 tests) 3452ms
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

`verification-service.test.ts` tail:

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### Typecheck (`npm run typecheck --workspace=apps/api`)

```
> @tradescheduler/api@0.1.0 typecheck
> tsc --noEmit
```
(clean, exit 0)

### Build (`npm run build --workspace=apps/api`)

```
> @tradescheduler/api@0.1.0 build
> tsc
```
(clean, exit 0)

## Optional live smoke — NOT run

I did **not** run the optional live smoke (brief Verify step 4). It requires a
live DB with migration 010 applied (embedded local Postgres on :5433 via
`npm run db:local`, or the shared Supabase project via `dbctl apply RL_010`),
which is database-side execution/deploy-time work outside this ticket's scope
and outside what I can verify without applying the migration to a live store.
What I verified instead:

- The gate's **exact SQL statements** and their **parameter binding** are asserted through a recording `pg` Pool mock in the worker tests (code+TLL write, `phone_verified_at=now()` write, attempt increment).
- The full worker control flow is exercised end-to-end (org resolve → customer/conversation/message → gate → classify/dispatch) against mocked services, covering every branch in section C.
- `sendSms` is asserted at its contract (`{to, body}`); dry-run behavior (`TWILIO_SMS_DRY_RUN=true`) is pre-existing and untouched.
- 010 is idempotent and now wired into `local-db.mjs`, so the smoke can be run by the controller/shipwright after `db:local` (or after `dbctl apply` on the shared project).

## Surprises

1. **Pre-existing test flake, not a regression.** The first test in
   `process-inbound-sms.test.ts` cold-loads the worker's import graph in
   ~3.2-4s; under machine load this crosses vitest's default 5000ms
   `testTimeout`, and the timed-out test's late-resolving promise can
   contaminate the *next* test's reset mock (`createEscalation` called twice).
   Proven pre-existing: I temporarily restored the pristine
   `process-inbound-sms.{ts,test.ts}` via `git checkout` and the same first test
   still timed out (test time 11.47s); an untouched file
   (`google-auth-service.test.ts`) also timed out once in run 1. I did **not**
   change any timeout config (out of scope); the final full run was green
   376/376.
2. **Untracked `NUL` file at repo root** (`H:\tradescheduling\NUL`, 92 bytes,
   mtime Sep 20 01:49 — before this session). Not created by me and not touched;
   flagging it in case a stray Windows redirection left it behind.
3. The T15/T16 brief files are present as untracked docs but no T15/T16 code was
   touched.

## Decisions beyond the brief (flagged for review)

1. **`conversation-domain.ts` extended** (not in the brief's 4-file list). The
   brief's gate reads `customer.phone_verified_at` / `verification_code` /
   `…_expires_at` / `verification_attempts` off the `findOrCreateCustomer`
   result, but that function's `returning` clause omitted the new columns (and
   `Customer` didn't type them) — at runtime every customer would therefore
   have read as unverified, permanently trapping verified customers in the
   gate. I added the 4 columns to the `returning` clause + interface + mapping
   (defensive defaults so pre-010 fixtures/mocks stay unverified). Zero extra
   queries per message.
2. **`local-db.mjs` MIGRATIONS array wired.** Migrations are applied from a
   static array; without adding 010 the file would exist but never run locally
   (and the optional smoke could not be attempted). One-line addition.
3. **Re-issue resets `verification_attempts` to 0.** The brief's step-2 SQL
   lists only code + expiry; its lockout clause ("reset code to a NEW code")
   doesn't mention the counter. Resetting on every fresh code is a no-op for a
   brand-new row (default 0) and is required for the "3 attempts per code"
   budget to be meaningful after a lockout — otherwise one wrong reply to the
   new code would re-issue again. Implemented in the single `issueAndSendCode`
   helper used by both the initial-issue and lockout paths.
4. **6 worker gate tests instead of the brief's 5 bullets** — split "wrong code
   x3" into under-limit vs. exhausted branches (both are specified MISMATCH
   behaviors). No repository timeout/config changes.

Nothing committed — all changes remain in the working tree.
