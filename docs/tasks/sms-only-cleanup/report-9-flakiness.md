# Report 9 — API suite flakiness under parallel load

**Status: PRE-EXISTING. Not introduced by the uncommitted SMS-only cleanup. Should NOT block this branch.**

Confidence: **PROVEN** (root cause reproduced on demand at HEAD, and again on the working
tree, at the default 5000ms `testTimeout`).

---

## 1. Answer to the priority question: introduced here, or already there?

**Already there. Pre-existing at HEAD (`93d0928`).** This is not a regression from the
uncommitted worker/SMS change.

I proved it non-destructively with `git worktree add` into a temp dir outside the repo
(no `git stash`; the working tree was never touched), ran the suite at HEAD under load, and
got the *identical* failure signature — including a run that produced **exactly 3 failures**,
matching the report under investigation:

```
===== HEAD 93d0928 @3x load  h3a.json  total=537 passed=535 FAILED=2 =====
  [src/worker/process-inbound-sms.test.ts] idx0 dur=5027ms prevDur=-
     name: processInboundSms - CP03 wiring rejects a non-E.164 From with an escalation an
     err : Error: STACK_TRACE_ERROR                     <-- 5000ms timeout
  [src/worker/process-inbound-sms.test.ts] idx1 dur=26ms prevDur=5027ms/failed
     name: processInboundSms - CP03 wiring escalates when the Twilio number is not regist
     err : AssertionError: expected "spy" to be called 1 times, but got 2 times

===== HEAD 93d0928 @3x load  h3b.json  total=537 passed=534 FAILED=3 =====
  [src/worker/process-inbound-sms.test.ts] idx0 dur=5019ms  err: Error: STACK_TRACE_ERROR
  [src/worker/process-inbound-sms.test.ts] idx1 dur=5818ms  err: Error: STACK_TRACE_ERROR
  [src/worker/process-inbound-sms.test.ts] idx2 dur=107ms   err: AssertionError: expected "spy" to be called with arguments: [ 'org-1', '+15551234567' ]

===== HEAD 93d0928 @3x load  h3c.json  total=537 passed=537 FAILED=0 =====
```

The two slow tests cost the same at HEAD as in the working tree — the uncommitted change is
in fact marginally *faster*, because it removed the WhatsApp fallback service from the
worker's import graph:

| first-test of file | HEAD `93d0928` | working tree | delta |
|---|---|---|---|
| `services/google-auth-service.test.ts` | 2251 ms | 2216 ms | -35 ms |
| `worker/process-inbound-sms.test.ts`  | 2381 ms | 2301 ms | -80 ms |

`google-auth-service.test.ts` is not touched by the uncommitted change at all, and
`process-inbound-sms.ts`'s change *reduced* its import cost.

### Correction to the baseline numbers in the brief

Measured directly, same command, both revisions:

| | files | tests |
|---|---|---|
| HEAD `93d0928` | 36 | 537 |
| working tree (uncommitted) | 34 | 534 |

The uncommitted change deletes 2 files (`fallback-service.test.ts` = 13 tests,
`whatsapp-service.test.ts` = 7 tests, i.e. 20 tests) and adds **net +17 tests**.
So the accurate statement is **537 -> 534, net +17**, not "528 baseline / 535 now / +7".
The conclusion is unaffected — the change *adds* coverage and does not create the flake —
but the merge-evidence line should quote the measured 537/534 rather than 528/535.

---

## 2. The failure mode, captured

Two distinct effects, one root cause.

### 2a. Primary: a 5000 ms test timeout charged to a module import

Real output, 3x-concurrent run of the **working tree**, default settings:

```
x  src/worker/process-inbound-sms.test.ts > processInboundSms - CP03 wiring >
   rejects a non-E.164 From with an escalation and never touches customers   5089ms
   -> Test timed out in 5000ms.
 x  src/worker/process-inbound-sms.test.ts > processInboundSms - CP03 wiring >
   escalates when the Twilio number is not registered to any org            1268ms
 Test Files  1 failed | 33 passed (34)
```

Heavier run (8384 ms and 12766 ms variants also observed):

```
 x  ... > rejects a non-E.164 From ...                      8384ms  -> Test timed out in 5000ms.
 x  ... > escalates when the Twilio number is not registered  584ms
 x  ... > confirm success persists the reschedule ...        12766ms  -> Test timed out in 5000ms.
 x  src/services/conversation-domain.test.ts > findOrCreateCustomer >
    creates a customer via upsert on first contact          5110ms  -> Test timed out in 5000ms.
```

**The named test is always `rejects a non-E.164 From with an escalation and never touches
customers`** — the *first* test in `process-inbound-sms.test.ts`. It is the only genuinely
slow test in the suite, and it is slow for a boring reason (section 3).

### 2b. Secondary: a misleading cascade into the *next* test

The second failure in each pair is **not** a slow test and **not** a timeout. It is collateral:

```
AssertionError: expected "spy" to be called 1 times, but got 2 times
```

Mechanism, confirmed by reading the test source:

- `process-inbound-sms.test.ts:176` (idx0) and `:190` (idx1) both assert
  `expect(m.createEscalation).toHaveBeenCalledTimes(1)`.
- `beforeEach` (`:115-117`) does `for (const fn of Object.values(m)) fn.mockReset()`.
- When idx0 **times out**, Vitest rejects the awaiting promise but does **not cancel the
  in-flight work**. The abandoned `worker.processInboundSms(...)` keeps running.
- idx1's `beforeEach` resets the mock counters, idx1 runs its own invocation (1 call), then
  idx0's zombie invocation finally fires `createEscalation` -> idx1 observes **2**.

**This is why the report says "3 failures" for what is really one slow test**: a timeout
leaks async work into the following test, so the failure count exceeds the number of
genuinely-affected tests. It also explains "the SAME tests pass in isolation" — in isolation
idx0 finishes in ~2.3 s, never times out, leaks nothing, and idx1 sees exactly 1.

`conversation-domain.test.ts` idx0 fails for the same reason (it is the other file whose
first test carries a big import charge), and at heavier load idx1/idx2 of
`process-inbound-sms.test.ts` time out too. It is a cascade, not 3 independent bugs.

---

## 3. Root cause

**There is no `vitest.config.ts` anywhere in this repo.** Verified: no `vitest.config.*`,
no `vite.config.*`, no `vitest.workspace.*` in `apps/api/` or the repo root. The suite runs
on 100% Vitest defaults (`vitest@3.2.7`):

- `pool: 'forks'`
- `maxWorkers = Math.max(1, availableParallelism() - 1)` = **7 on this 8-core box**
  (`node_modules/vitest/dist/chunks/doctor.DR3u0Z_G.js:121`)
- `fileParallelism: true`
- **`testTimeout: 5000`**

Causal chain:

1. **15 test files use a `loadX()` helper that does `await import('./x.js')` *inside* the
   test body**, paired with `vi.resetModules()` in `afterEach` (the repo's house pattern for
   re-reading `process.env` per test): `ai-usage-service`, `auth-service`,
   `booking-service`, `consent-service`, `conversation-domain`, `escalation-service`,
   `google-auth-service`, `inbox-service`, `organization-service`, `outbound-ledger`,
   `queue-service`, `staff-phone-service`, `process-inbound-sms`, `process-outbound-sms`.
2. Because the import is *inside* the timed region, the module-graph transform cost is
   **charged to `testTimeout`**, and `vi.resetModules()` makes it repeat per test.
   Proven: with `--testTimeout=800` the first test of each such file fails with
   `Test timed out in 800ms.` at 2647 ms / 2632 ms.
3. For 13 of the 15 files that cost is trivial (13-60 ms). For **two** it is enormous:
   - `google-auth-service.js` pulls in **`googleapis`** — `require('googleapis')` alone is
     **913 ms** across **545** API surfaces, all of which Vite must transform.
   - `process-inbound-sms.js` pulls the whole worker dependency graph.
4. So those two files charge **2.2-2.9 s to their first test** — 44-58% of the 5000 ms
   budget before any contention. The other 532 tests are all **<= 258 ms**: a 9x cliff
   between the two slow tests and everything else.
5. 7 forks transforming googleapis-sized graphs concurrently on 8 logical cores at 2.4 GHz
   with only **2.1-2.6 GB free RAM** pushes those two first tests over 5000 ms.
6. The timeout then leaks in-flight work into the next test (2b), inflating the count.

### Measured load sensitivity (the whole case in one table)

`process-inbound-sms.test.ts` first test, against the 5000 ms default:

| conditions | duration | % of budget |
|---|---|---|
| solo | 2301 ms | 46% |
| 2 concurrent suites | 4209 / 3560 ms | 84% |
| 2 concurrent suites | **4751 ms** | **95%** |
| 3 concurrent suites | 5178 / 6946 ms | **over budget -> fail** |

It needs only a **1.05x** further slowdown to fail. That is why it is intermittent, why it
looks load-dependent, and why the "concurrent second full-suite run" (reported clean) sits
right on the boundary. Whole-suite wall time: 11.0 s solo -> 21.8 s at 2x -> ~42 s at 3x.

---

## 4. Is there a single shared resource being contended?

**Not a database. Not a port. Not shared module state. The contended resource is CPU
scheduling against a fixed 5000 ms wall-clock budget.**

Ruled out, with evidence:

- **No real Postgres in tests.** 14 of 34 test files `vi.mock('pg')`. The only two that do
  not (`routes/auth.test.ts`, `services/sms-service.test.ts`) mock the service layer that
  constructs the pool, so no `new Pool` ever reaches a live connection.
  `embedded-postgres` appears **only** in `scripts/local-db.mjs` — never in a `globalSetup`,
  never in a test. There is no `globalSetup` at all. Pools are lazy and all use
  `max: 5, connectionTimeoutMillis: 5000` — irrelevant, since none is ever opened.
- **No port contention.** 10 test files call `app.listen(0)` and do real loopback `fetch`
  (auth, assistant, workspace, google-oauth, twilio-webhooks, twilio-status, and the four
  `dashboard/*` files). `listen(0)` means the OS assigns a unique ephemeral port per
  process, and each file uses its own origin, so no fixed port is shared. The real loopback
  `fetch` is a mild extra latency source but not a *shared* resource, and it cannot explain
  a 2.3 s test that does no I/O.
- **No cross-file mock leakage.** `isolate: true` is the default and `pool: 'forks'` gives
  each file a fresh process; `vi.mock` factories are per-file. The leakage found is *within*
  one file (a timed-out test's zombie work), not across files.
- **No fake timers.** `grep -rn "useFakeTimers" --include=*.test.ts` returns **0 hits**.
  All timers are real.
- **What is actually shared:** the 8 logical cores / ~2.5 GB free RAM, the 7-fork default
  pool, and the 5000 ms per-test budget the import cost is charged against.

---

## 5. Minimal, lowest-risk fix (recommendation only — NOT applied)

All three candidates were validated under 3x concurrent load, and the wall-clock cost of each
was measured on an unloaded run.

| # | Change | 3x load | Wall clock (unloaded) |
|---|---|---|---|
| baseline | none | **FAILS (2-3 failures)** | 13.0 s |
| **1** | **`testTimeout: 20000`** | **PASSES (534/534)** | **13.3 s (+2%)** |
| 2 | `maxWorkers: 2` | PASSES (534/534) | 19.2 s (+48%) |
| 3 | `fileParallelism: false` | PASSES (534/534) | 30.6 s (+136%) |
| 4 | `pool: 'threads'` / `isolate: true` / `sequence.concurrent: false` | not needed | - |

### Ranked

**R1 (recommended): add `apps/api/vitest.config.ts` with `testTimeout: 20000`.**

Lowest risk by a wide margin: it touches **no test and no production code**, only raises a
ceiling that no legitimate test in this suite comes near (slowest real test work is 258 ms;
532 of 534 tests are under 100 ms). It removes the whole failure class rather than narrowing
its window, at a cost of ~0.3 s wall clock.
*Trade-off:* a genuinely hanging test now takes 20 s to fail instead of 5 s. It also *masks*
rather than *fixes* the underlying "module import inside the timed test body" cost. Acceptable:
that cost is a one-time 2.3 s and is not itself a defect.

**R2 (complement, same file): `maxWorkers: 4`.** Halves CPU oversubscription, which is the
actual physical trigger, and buys real headroom for the two import-heavy files on a low-RAM
laptop. Costs ~6 s wall clock. Add *with* R1, not instead of it — R1 alone already passed 3x
load, but R1+R2 gives a much wider margin on slower CI runners.
*Trade-off:* ~48% slower suite.

**R3: fix the house pattern (the true fix, wrong branch).** Hoist the `await import()` out of
the test body (top-level import) and drop `vi.resetModules()`, or import once in `beforeAll`.
That removes the cost from `testTimeout` entirely and would let the suite keep an honest
5000 ms default.
*Trade-off:* touches 15 test files and risks breaking tests that rely on `resetModules()` to
re-read `process.env` at module scope. **Do not bundle into the SMS cleanup** — independent
work with its own regression surface.

**R4: `fileParallelism: false`. Not recommended as a default** — it works (validated) but
costs 2.4x wall clock and only masks CPU contention. Reserve it for bisecting a bad run.

**Explicitly not recommended:**
- `sequence.concurrent: false` — already the effective default; no `describe.concurrent`
  anywhere in the suite. No-op.
- `isolate: true` — already the default under `pool: 'forks'`. No-op.
- A per-file DB/pool fix — there is no DB in the test path at all.

### Exact config change (for the implementer, in a follow-up commit)

New file `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default is 5000ms. 15 test files re-import their module graph *inside* the
    // test body (vi.resetModules() + `await import()`), so the one-time module
    // transform is charged to testTimeout. Two of those graphs are large
    // (googleapis = 913ms require / 545 surfaces; the full worker graph), which
    // parks their first test at 2.2-2.9s — 44-58% of the old budget before any
    // load. Under 2-3x parallel load they cross 5000ms and fail. The timeout then
    // leaks the still-running invocation into the next test, which reports a
    // misleading "expected spy to be called 1 times, but got 2 times".
    // No real test work in this suite exceeds 258ms, so a 20s ceiling is safe.
    testTimeout: 20_000,
    // Vitest defaults to availableParallelism()-1 = 7 forks on this 8-core,
    // ~8GB laptop. 7 concurrent googleapis-sized transforms is the physical
    // trigger; 4 keeps real headroom. Costs ~6s wall clock.
    maxWorkers: 4,
  },
});
```

Verified equivalent on the command line (no file written):
`npx vitest run --testTimeout=20000` and `npx vitest run --maxWorkers=2` each reported
`FAILED=0` under 3x concurrent load.

### What to verify after the fix

1. `npm run test --workspace=apps/api` — 34 files / 534 tests, 0 failed.
2. Run **three** suites concurrently and confirm all three report `FAILED=0`. This is the
   loop that went red reliably before the fix; it is the acceptance gate.
3. Confirm the tests named in 2a no longer time out, and that the
   `expected "spy" to be called 1 times, but got 2 times` cascade is gone.
4. Re-run at HEAD + the config to confirm the config alone is what fixes it.

---

## 6. Is `apps/web` affected? No — dismissed.

- `apps/web` has **no vitest dependency at all** (`devDependencies.vitest` = NONE).
- Its test script is `tsx tests/session-core.test.mts` — a single-process, single-file run of
  **11 pure-function assertions** on `lib/session-core.ts`. Confirmed passing:
  `11/11 session-core assertions passed`.
- That file contains **no** `listen()`, **no** `new Pool`, **no** `DATABASE_URL`, and **no**
  network `fetch` (only one `await import`, of a local `session-core` module).
- It never runs inside a worker pool, never shares a port, DB, or module registry with
  `apps/api`, and finishes in well under a second.

There is no plausible mechanism by which API-suite load could affect it.

---

## 7. Verdict: should this block the current change?

**No. Log it as a separate backlog item and let the SMS-only cleanup proceed.**

- The flakiness is **proven pre-existing** — reproduced on HEAD `93d0928` with the identical
  signature, including a 3-failure run matching the original report. The uncommitted change
  did not create it and measurably *reduced* the cost of the hot file.
- It is a **test-harness configuration gap** (a missing `vitest.config.ts` meeting a
  `testTimeout`-charged module import on a low-RAM Windows box), not a defect in the SMS
  consent/worker logic under review.
- The change is a **net +17 tests** with no regression signal: 537 -> 534 after removing the
  20 dead WhatsApp/fallback tests.

The one legitimate caveat, stated honestly: the flake *does* weaken this branch's "all tests
green" evidence, because a reviewer re-running the suite under load can see a red run that has
nothing to do with the diff. The correct response is the cheap, config-only R1+R2 fix **in its
own commit**, so that from then on the green evidence is trustworthy.

**Recommended follow-up ticket:** "Add `apps/api/vitest.config.ts` with
`testTimeout: 20000` + `maxWorkers: 4` (config-only, no test changes) to stop the
`process-inbound-sms.test.ts` / `google-auth-service.test.ts` first tests from timing out
under parallel load." Then a separate, larger ticket for R3 (hoist the `await import()` out
of test bodies in the 15 affected files).

---

### Appendix — evidence index

| Claim | How established |
|---|---|
| No vitest config exists | `ls vitest.config.* vite.config.*` in `apps/api/` and repo root -> none |
| `maxWorkers` default = 7 | `node_modules/vitest/dist/chunks/doctor.DR3u0Z_G.js:121`; box has 8 logical CPUs |
| Default `testTimeout` = 5000 | observed `Test timed out in 5000ms.` with no config present |
| `googleapis` is the heavy import | `require('googleapis')` = 913 ms, 545 exported surfaces |
| Import is charged to `testTimeout` | `--testTimeout=800` fails the first test of both hot files at 2632/2647 ms |
| Cost lands on the *first* test only | 2-file run: test #1 = 2953/2871 ms, tests #2+ = 5-61 ms |
| Load slope | measured 2301 -> 4751 -> 5178/6946 ms at 1x/2x/3x |
| Cascade mechanism | `process-inbound-sms.test.ts:176` and `:190` both assert `toHaveBeenCalledTimes(1)`; `:115-117` `mockReset()` all mocks; the timed-out invocation keeps running |
| Pre-existing | HEAD worktree run reproduced the same signature, incl. a 3-failure run (`h3b.json`) |
| No DB in tests | 14/34 files `vi.mock('pg')`; the other 2 mock the pool-constructing services; `embedded-postgres` only in `scripts/local-db.mjs` |
| No port contention | 10 files use `app.listen(0)` (OS-assigned ephemeral port per process) |
| No fake timers | `grep -rn useFakeTimers --include=*.test.ts` -> 0 hits |
| `apps/web` unaffected | no vitest dep; `tsx tests/session-core.test.mts` = 11 pure assertions, 11/11 pass |
| Fix validation | `--testTimeout=20000`, `--maxWorkers=2`, `--fileParallelism=false` each 534/534 `FAILED=0` at 3x load |
| Working tree untouched | `git status --porcelain` byte-identical before and after; temp worktree created and removed |

**Reproduction rate of the loop used above:** solo 0/5 failures; 2x concurrent load 0/3 runs
failing but worst test at 95% of budget; 3x concurrent load 2 of 3 runs failing. Run three
suites concurrently to reproduce.
