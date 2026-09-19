# T13 — Deliver queued outbound replies (worker outbound_sms handler)

Status: **DONE** — commits: **none** (per brief, nothing committed)

## (a) Per-file diff summary

1. **`apps/api/src/services/inbox-service.ts`** (modified)
   - Added `import { enqueue } from './queue-service.js';`
   - `enqueueOutboundReply()`: INSERT now ends with `returning id`; the returned row id is
     passed to `await enqueue({ type: 'outbound_sms', payload: { messageId: row.id } })`.
   - Org-guard EXISTS kept unchanged. Signature/return type unchanged (`Promise<void>`).
   - Enqueue failure propagates (rethrow — route 500s; no swallow). No transaction, per brief.
   - No-row path (org guard rejected the insert — other-org race): guard-`return` — the same
     silent no-op as before T13, so behavior is preserved in the only case where nothing was
     queued (nothing to deliver). Rationale + this decision are noted below in (d).

2. **`apps/api/src/worker/process-outbound-sms.ts`** (NEW)
   - `processOutboundSms(job: QueueJob): Promise<void>` per the brief's exact sketch.
   - Guards: missing `messageId` → throw; load query returns no row (message missing OR not
     `direction='outbound'`/`status='queued'`, e.g. already sent) → throw; null body/phone →
     throw (undeliverable).
   - Single joined load query: `rl_messages m → rl_conversations c → rl_customers cu`
     selecting `m.id, m.body, m.status, cu.phone` with `where m.id=$1 and m.direction='outbound'
     and m.status='queued'`.
   - Happy path: `sendSms({ to: phone, body })` → `update rl_messages set status='sent',
     provider_message_id=$2 where id=$1`; if that UPDATE throws → log + rethrow (job fails, row
     stays queued = retryable).
   - sendSms throw: `update rl_messages set status='failed' where id=$1` (a failed UPDATE here is
     logged but the original send error is still rethrown so the job fails with the root cause),
     then `throw err`.
   - Lazy pool singleton + env-override table helpers (`MESSAGES_TABLE`/`CONVERSATIONS_TABLE`/
     `CUSTOMERS_TABLE`, rl_ defaults) — identical style to inbox-service.ts. Env-free boot
     (DATABASE_URL read on first use only). The status UPDATE deliberately sets no `updated_at`
     — `rl_messages` has no such column (schema.sql).

3. **`apps/api/src/worker/index.ts`** (modified)
   - Added `import { processOutboundSms } from './process-outbound-sms.js';`
   - Handlers map: `{ inbound_sms: processInboundSms, outbound_sms: processOutboundSms }`.

4. **`apps/api/src/worker/process-outbound-sms.test.ts`** (NEW — mirrors
   process-inbound-sms.test.ts harness: `vi.hoisted` mocks, `vi.mock('pg', ...)` +
   `vi.mock('../services/sms-service.js', ...)`, `loadWorker()` dynamic import,
   `vi.resetModules()` in afterEach, env teardown).
   - happy path: queued row → `sendSms` called with customer phone + body → second query is the
     `status='sent'` + `provider_message_id=$2` UPDATE with `['msg-1','SM1234567890']`; asserts
     the join SQL + the `direction='outbound'`/`status='queued'` WHERE guard.
   - sendSms rejects → `status='failed'` UPDATE issued, original error rethrown.
   - message not found / not queued (no row) → throws, `sendSms` never called.
   - malformed job (no messageId) → throws before any query.
   - 4 tests, all pass.

5. **`apps/api/src/services/inbox-service.test.ts`** (extended)
   - Added `enqueue` to the hoisted mock + `vi.mock('./queue-service.js', () => ({ enqueue:
     mocks.enqueue }))`; reset in beforeEach.
   - `enqueueOutboundReply` test now mocks the INSERT to return `{ rows: [{ id: 'msg-1' }] }`,
     asserts `returning id` in the SQL and asserts `enqueue` was called with
     `{ type: 'outbound_sms', payload: { messageId: 'msg-1' } }`.
   - New test: org guard rejects the insert (no row returned) → `enqueue` NOT called
     (preserved no-op).

Untouched (as required): process-inbound-sms.ts, T12 files, routes, web, migrations,
render.yaml. NOTE: `apps/api/src/services/ai-usage-service.ts`, `worker/process-inbound-sms.ts`
and `worker/process-inbound-sms.test.ts` show as modified in `git status` but those are
**pre-existing working-copy changes from the T12 line of work — not mine**.

## (b) Verification tails (workdir `H:\tradescheduling`)

1. `npm test --workspace=apps/api`
   - Cold run: 22 files / 365 tests — 8 failures (7 × 5s timeouts + 1 mock-contamination
     assertion) across `auth.test.ts`, `twilio-webhooks.test.ts`, `process-inbound-sms.test.ts`,
     `dashboard-service.test.ts`, and my new outbound test. Cause: first-run collection took
     316s on this machine, blowing the 5s per-test budget while all 22 files transformed
     concurrently; timed-out tests' async continuations then leaked mock state into the next
     test in the same file (the "expected failed but got sent" assertion was exactly that).
   - Every flaky file re-run in isolation: **green** (16/16 inbound, 34/34 auth, 8/8 twilio,
     6/6 dashboard, 4/4 outbound).
   - Warm full-suite re-run: **22 passed (22 files), 365 passed (365 tests), 11.60s** ✅
2. `npm run typecheck --workspace=apps/api` — clean, exit 0, **zero errors** (no new,
   none pre-existing in this workspace; the `@tradescheduler/shared`/`@tradescheduler/ai`
   sources resolve to raw `src/index.ts` so the program spans the workspace — first pass
   > 5 min on H:, warm pass finishes clean).
3. `npm run build --workspace=apps/api` — green, exit 0 (`tsc` emit; dist/worker contains
   `process-outbound-sms.js` alongside the pre-existing files).
4. Live smoke: **not run — environment-blocked**. `apps/api` has no `.env`/`.env.local` at
   all → no `DATABASE_URL` (no local DB creds) and no Twilio creds, so neither the enqueue
   step nor the worker loop can run against a real DB here. Verified instead:
   - The entire delivery contract is covered by `process-outbound-sms.test.ts`
     (load → sendSms → 'sent'+SID persist; sendSms failure → 'failed'+rethrow; not-found → throw).
   - `sendSms`'s dry-run path (`TWILIO_SMS_DRY_RUN=true`, no creds needed) is already
     unit-tested in `sms-service.test.ts` ("dry-runs without Twilio when TWILIO_SMS_DRY_RUN=true")
     — passed in the full suite.
   - Worker dispatch wiring (dequeue → handler map → complete/fail) compiles via the
     `outbound_sms: processOutboundSms` entry and the full build.

## (c) Failed Twilio send ⇒ `status='failed'` (never stuck queued)

Confirmed in `processOutboundSms`: the `sendSms` call is wrapped; on reject the handler first
persists `update rl_messages set status='failed' where id=$1`, then rethrows the original error
so the job also fails visibly in `rl_jobs`. The row can never remain silently `'queued'` after a
send attempt. Covered by the "sendSms rejection marks the row failed and rethrows" test (asserts
the `status='failed'` SQL + params `['msg-1']`). Note: the not-found/not-queued path (row already
`sent`/`failed`, or missing) throws WITHOUT touching status — the row is left exactly as it was;
only an in-flight Twilio failure flips queued→failed.

## (d) Surprises / deviations

1. **Cold-run suite flakiness on this machine** — pre-existing, not caused by T13: the initial
   full-suite run fails 8 tests purely from 5s timeouts under a 316s cold collection; warm
   re-runs are green in 11.6s. Anything touching vitest config (global 5s timeout, or a cache
   warm-up) is out of scope here; flagging for the controller.
2. **No-row guard-return instead of throw** in `enqueueOutboundReply`. The brief's `returning id`
   + enqueue implies a row; when the EXISTS org-guard rejects the insert (other-org race, the
   exact race the guard exists for) the old code silently no-op'd and the route returned 200.
   I preserved that (guard-return) rather than introducing a new 500 for an edge the route's
   pre-check already 404s on, and added a test pinning it. If a 500 is preferred for the race,
   one line changes.
3. Added a 4th test case (malformed job without `messageId`) beyond the brief's 3 — it pins the
   brief-mandated guard line at the top of the handler; no behavioral scope added.
4. `rl_messages` has **no `updated_at`** column — the status UPDATEs intentionally set only
   `status` (+ `provider_message_id` on success); adding `updated_at=now()` would have errored.
5. If the `status='failed'` UPDATE itself fails, the original send error is still rethrown and
   the failure is logged; the row would remain 'queued' (visibly, per the log line + job failure).
   This is the brief's "log + rethrow" posture applied to an already-degraded path.
6. `git status` also shows unrelated pre-existing dirty files (`ai-usage-service.ts`,
   `process-inbound-sms.ts`, `process-inbound-sms.test.ts`, a stray `NUL` file) — untouched.