# Task 1 report — Drop the dead WhatsApp + fallback-retry surface

Status: **complete**, with two deviations flagged in §4 below.
Commits: **none** (per instructions — nothing committed).
Report: `docs/tasks/sms-only-cleanup/report-1.md`

## 1. Files deleted (4) — via `git rm`, recorded in the index

| File | Note |
|---|---|
| `apps/api/src/services/whatsapp-service.ts` | dead throw-stub, zero importers |
| `apps/api/src/services/whatsapp-service.test.ts` | asserted only the stub |
| `apps/api/src/services/fallback-service.ts` | the unsound SMS retry engine |
| `apps/api/src/services/fallback-service.test.ts` | — |

All four had uncommitted working-tree modifications (the gutted stubs), so
`git rm` needed `-f`. The pre-deletion working-tree copies were backed up to
`C:/Users/muhai/AppData/Local/Temp/opencode/sms-only-task1-backup/` before the
forced removal; the real implementations remain in `HEAD`.

## 2. Files edited (6) — all from the §1 table

| File | Change |
|---|---|
| `apps/api/src/routes/twilio-status.ts` | §3a–3c |
| `apps/api/src/routes/twilio-status.test.ts` | §4a–4g |
| `apps/api/src/services/phone-utils.ts` | §5 (+1 comment word, see §4a) |
| `apps/api/src/services/phone-utils.test.ts` | §6a–6f (restored from HEAD first) |
| `apps/api/src/services/outbound-ledger.ts` | §7a–7c |
| `apps/api/src/services/outbound-ledger.test.ts` | §8a–8d (restored from HEAD first) |

Per PLAN constraint 7, both test files were restored with
`git checkout HEAD -- <path>` and then received **only** the SMS-only deletion —
no rewrites. Coverage recovered versus the gutted working-tree versions:
`outbound-ledger.test.ts` went from 127 lines of self-mocking stubs (which
mocked the module under test and asserted nothing) back to the real
`vi.mock('pg')`-driven 9 tests, including the page/pageSize, clamping and
`OUTBOUND_MESSAGES_TABLE` cases that the working-tree file had lost entirely.

## 3. Exact behavioral changes

### Runtime (the only behavior that changed)

1. **`POST /api/twilio/webhooks/status` no longer retries.**
   `failed`/`undelivered` now performs exactly one ledger write,
   `markStatus(row.id, 'failed', errorCode)`, then breaks. The `processFailedSms`
   import and the `if (row.channel === 'sms')` retry/fallback block are gone, as
   is the `markStatus(row.id, 'retried')` re-mark.
   - **Before:** a failed SMS could be re-sent and the row re-marked
     `retried` | `escalated` | `blocked_optin`.
   - **After:** the row stays `failed` until a human acts. No new delivery
     status is ever produced by this route.
   - **Idempotency/retry semantics preserved:** the `TERMINAL_STATUSES` early
     return, the `queued` no-op, the always-200 reply, the signature-FIRST
     ordering, and the catch-all 200 are all untouched (§3d honored). A
     `failed` row is not terminal, so a later genuine `delivered` report is
     still recorded — unchanged behavior.
2. **Ledger no longer owns consent or a retry writer.** `hasSmsOptIn` and
   `markRetried` deleted from `outbound-ledger.ts`; neither had any importer
   after the fallback-service deletion (verified: `markRetried`/`hasSmsOptIn`
   were imported solely by the now-deleted `fallback-service.ts`).
3. **`toChannelAddress` deleted** from `phone-utils.ts`. It was an identity
   function (`phone.trim()`) with a dead `channel` parameter and zero callers.
   `phone-utils` now exports exactly `normalizeChannelAddress` and
   `countryCodeFromE164`.
4. **`OutboundRow` is no longer exported** — the four remaining uses
   (`toRow`, three `query<OutboundRow>` generics) are all inside the file, per
   §7b's stated rationale. Restored to `interface OutboundRow {`.

No schema, migration, config, shared-type, or DB change was made. Nothing sends
SMS. No new status value is written anywhere.

## 4. Deviations and judgment calls

**(a) One comment word in `phone-utils.ts` (unrequested; §5 vs §9 conflict).**
§5 says "leave `normalizeChannelAddress` and `countryCodeFromE164` as they are",
but the JSDoc on `normalizeChannelAddress` contained the literal `WhatsApp`
(`No WhatsApp prefix normalization`), which fails §9's
`rg -i whatsapp … returns no matches in any .ts file` gate for a file **I own**.
Since §9 is an acceptance criterion and the comment is stale anyway (it
describes prefix normalization the function no longer does), I reworded one
line, dropping only the word and keeping the meaning:
`No channel-prefix normalization — inbound From/To are Twilio phone numbers.`
No function body, signature, or behavior was touched. Revert is a one-word edit
if you prefer strict §5.

**(b) §9's bullet 2 cannot pass in full, by the brief's own construction.**
§6e *mandates* adding `expect(countryCodeFromE164('whatsapp:+8801712345678'))
.toBeNull()`, which puts a `whatsapp` literal in `phone-utils.test.ts`, a file I
own. I implemented §6e verbatim as instructed. Note this is also the only
residual `whatsapp` in my six files, it is a test string (not an identifier,
env var, type member, or UI label, per PLAN constraint 1), and it asserts the
*correct* behavior — `countryCodeFromE164` returns `null` for a prefixed
address. The committed version asserted `'+880'`, which is **false** against the
current implementation; §6e corrects a genuinely broken test.

**(c) `type OutboundLedgerRow` is an unused import in `twilio-status.ts`** and I
left it. It was already unused in the working tree before I started (`row` is
inferred from `getByMessageSid`), `noUnusedLocals` is not enabled so it does not
fail typecheck, and §3a scoped my removal to line 4 only. Flagging it as
pre-existing dead code for the controller rather than making an unrequested edit.

## 5. Verification

**Command (brief §10), from repo root:**

```bash
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/api -- src/routes/twilio-status.test.ts src/services/phone-utils.test.ts src/services/outbound-ledger.test.ts
```

**Focused tests: PASS — 3 files, 25/25 tests.**

```
 ✓ src/services/phone-utils.test.ts (6 tests) 5ms
 ✓ src/services/outbound-ledger.test.ts (9 tests) 121ms
 ✓ src/routes/twilio-status.test.ts (10 tests) 102ms
 Test Files  3 passed (3)
      Tests  25 passed (25)
```

`twilio-status.test.ts` uses `createApp()`, which mounts every route — it boots
cleanly, confirming the four deleted modules left no dangling import.

**Typecheck: one error, and it is NOT in a file I own.**

```
src/services/conversation-domain.test.ts(164,62): error TS2345:
  Argument of type '"carrier"' is not assignable to parameter of type '"sms" | "voice" | "web"'.
```

`apps/api/src/services/conversation-domain.test.ts` is **Task 5's file**. The
error is a test asserting that the invalid literal `'carrier'` is rejected — a
pre-existing artifact of the half-finished refactor (that file is `M` in the
working tree and I never opened it for edit). Per the brief's "report it rather
than editing a file you do not own", I did not touch it. **My six files produce
zero typecheck errors**, so Task 5 should expect to clear this. The full-suite
green gate is Task 5's per the plan.

**§9 acceptance criteria:**

| # | Criterion | Result |
|---|---|---|
| a | `git status` shows 4 deletions + 6 modifications, all from the §1 table | **PASS** — exactly `D `×4, ` M `×6, no other path touched by me |
| b | no `whatsapp` in any `.ts` file | **PARTIAL — see below** |
| c | `rg "fallback-service\|whatsapp-service" apps` returns nothing | **PASS** (exit 1, no matches) |
| d | `phone-utils.ts` exports exactly the two functions | **PASS** |
| e | `outbound-ledger.ts` exports no `hasSmsOptIn`, no `markRetried` | **PASS** (also: no `markRetried`/`hasSmsOptIn` anywhere) |

**§9b residual inventory.** After my work, `rg -i whatsapp apps/api/src` returns
only: `worker/process-inbound-sms.ts:495` (Task 4 — excused verbatim in §9);
`db/migrations/014-whatsapp-fallback.sql` lines 29/31 (Task 2 — the retained
migration *filename* and comments referencing it as a path, explicitly allowed
by PLAN §6, and a `.sql` not a `.ts` file); `routes/dashboard/messages.test.ts:73`
and `services/conversation-domain.test.ts:207,209` (both **Task 5's**);
`services/sms-service.test.ts` (~18 hits, **Task 3's** — `TWILIO_WHATSAPP_NUMBER`
suite); and `services/phone-utils.test.ts:39`, the single §6e-mandated literal
discussed in §4(b). **Zero runtime WhatsApp remains in my six files.**

## 6. Files I touched that were not in my table

**None.** No file outside the §1 table was created, edited, or deleted. The two
files I read but did not write — `services/conversation-domain.test.ts` and
`db/migrations/014-whatsapp-fallback.sql` — were read-only inspections for
verification, and `docs/tasks/sms-only-cleanup/report-1.md` is this report,
required by the controller. No `npm install` was run. Nothing under
`docs/tasks/v2/` was modified. Nothing was committed.

## 7. Handoff notes

- **Task 5:** `conversation-domain.test.ts(164)` is the one typecheck error
  blocking green, and it is yours to fix. Also yours: the
  `dashboard/messages.test.ts:73` `channel: 'whatsapp'` literal.
- **Task 3:** `sms-service.test.ts` still has a full `TWILIO_WHATSAPP_NUMBER` /
  `channel: 'whatsapp'` describe block (~18 `whatsapp` hits) — expected, it is
  your file.
- **Task 2:** `DECISION.md` is referenced from two comments I wrote
  (`twilio-status.ts`, `outbound-ledger.ts`) and does not exist yet; it must
  land in this round or those two pointers dangle.
- **Sentinel/Probe:** worth probing that a `failed` delivery report now yields
  exactly one `UPDATE` and no re-send, and that a `delivered` report arriving
  *after* a `failed` one is still recorded (the non-terminal-`failed` path).
  Behavioral note for review: with no retry engine, a genuine carrier failure
  now leaves a row `failed` indefinitely with no automated recovery — that is
  the intended outcome of this round (PLAN F6), and `MAX_RETRY_ATTEMPTS` was
  never read, so no unbounded chain can occur.
