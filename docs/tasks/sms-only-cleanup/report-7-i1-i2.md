# Report 7 — I1 (terminal-status guard untested) + I2 (report-2 record accuracy)

Date: 2026-09-26
Scope: repair of two findings from the final whole-branch review. Narrow by
instruction — no production change was kept, no commit, no `npm install`, no
database execution, no subagent dispatched.

## 0. Files changed (3 owned + this report)

| Path | Change |
|---|---|
| `apps/api/src/services/outbound-ledger.test.ts` | +7 tests, new `describe('terminal-status guard (I1) …')` block. No production edit kept. |
| `apps/api/src/routes/twilio-status.test.ts` | Hardcoded `TERMINAL_STATUSES` copy removed from the `vi.mock` factory; replaced by a read from the real module + an explanatory comment. **No route assertion touched.** |
| `docs/tasks/sms-only-cleanup/report-2.md` | §1 row amended + a correction subsection added below the table (I2). |
| `docs/tasks/sms-only-cleanup/report-7-i1-i2.md` | This file. |

`apps/api/src/services/outbound-ledger.ts` is **byte-identical to its pre-round
state** — see the restore hash in §2.

---

## 1. I1 — tests added

New block in `outbound-ledger.test.ts:200-308`, `describe('terminal-status
guard (I1) — a failed row must stay updatable')`, using the file's existing
conventions unchanged: the same `pg` `Pool` mock (`mocks.query` for all
`getPool().query()` calls), the same `loadService()` re-import-per-test
convention, and the same `mocks.query.mock.calls[0] as [string, unknown[]]`
extraction idiom as the pre-existing tests. No new mock plumbing was needed —
`markSent` / `markFailed` / `markStatus` all write through `getPool().query()`,
which the existing mock already covers.

Shared helper + constant:

```ts
function guardExcludedStatuses(sql: string): string[] {
  return [...sql.matchAll(/status <> '([^']+)'/g)].map((m) => m[1]).sort();
}
const EXPECTED_TERMINAL = ['delivered', 'escalated', 'retried'];
```

| # | Test | What it pins |
|---|---|---|
| 1 | `TERMINAL_STATUSES is exactly delivered\|retried\|escalated — never failed` | The exported array **is** the three-way set, and `not.toContain('failed')`. |
| 2 | `markStatus excludes the three terminal statuses and does NOT exclude failed` | The real emitted SQL: `update public.rl_outbound_messages`, `set status = $2`, `error_code = coalesce($3, error_code)`, `where id = $1`, each of `status <> 'delivered' / 'retried' / 'escalated'` present, `status <> 'failed'` **absent**, params `['ledger-1','delivered','30007']`. |
| 3 | `the markStatus SQL guard and TERMINAL_STATUSES are the same set (drift either way fails)` | Cross-check: `guardExcludedStatuses(sql)` deep-equals `[...TERMINAL_STATUSES].sort()`. **This is the load-bearing test** — see §2.3. |
| 4 | `a late delivered report over a failed row is expressible — no guard mentions failed` | The `failed` token appears **nowhere** in the emitted statement, and the `failed`→`delivered` transition is bound as params with `errorCode` defaulting to `null`. |
| 5 | `markSent writes sent + the SID under the same guard, params [sid, id]` | `set status = 'sent'`, `message_sid = $1`, `where id = $2`, `(message_sid is null or message_sid = $1)`, guard set == the three terminals, params `['SM123','ledger-1']`. |
| 6 | `markFailed writes failed + coalesced SID/error under the same guard, params [sid, id, code]` | `set status = 'failed'`, `message_sid = coalesce($1, message_sid)`, `error_code = coalesce($3, error_code)`, `where id = $2`, guard set == the three terminals and `not.toContain('failed')` — *the write that records the failure must not itself be what closes the row* — params `[null,'ledger-1','30007']`. |
| 7 | `all three status writers emit the identical three-way guard clause` | Regex-extracts the trailing guard from all three statements and asserts all three equal `"and status <> 'delivered' and status <> 'retried' and status <> 'escalated'"`, pinning the conjunction shape and order (not merely the member set). |

Test count for the file: **9 → 16**.

### Why test 3 exists

The guard exists at **two** levels, and neither alone is sufficient to pin:

- **DB level** — `TERMINAL_GUARD` (a hardcoded string, `outbound-ledger.ts:46-47`)
  in every `UPDATE`.
- **Route level** — `TERMINAL_STATUSES` (the exported array, `:39-43`), read by
  `twilio-status.ts:49` to short-circuit a terminal row before any write.

`TERMINAL_STATUSES` and `TERMINAL_GUARD` are two independent declarations of the
same concept, and nothing enforced agreement between them. Test 3 asserts they
are the same set, so drift fails **in either direction**: an array-only edit
(the exact one-token mutation below, which leaves the SQL guard untouched) fails,
and a guard-string-only edit fails too. Tests 1 and 2 pin each artifact
absolutely; test 3 pins the invariant between them.

---

## 2. Non-vacuity evidence

### 2.1 The mutation

Added one token — `'failed',` — to `TERMINAL_STATUSES` in
`apps/api/src/services/outbound-ledger.ts:39-43`:

```ts
 export const TERMINAL_STATUSES: readonly OutboundStatus[] = [
   'delivered',
   'retried',
   'escalated',
+  'failed',
 ];
```

### 2.2 Result — the new tests fail

`npm run test --workspace=apps/api -- src/services/outbound-ledger.test.ts`

```
 FAIL  … > TERMINAL_STATUSES is exactly delivered|retried|escalated — never failed
AssertionError: expected [ 'delivered', 'escalated', …(2) ] to deeply equal [ 'delivered', 'escalated', 'retried' ]
- Expected
+ Received
  [
    "delivered",
    "escalated",
+   "failed",
    "retried",
  ]
 ❯ src/services/outbound-ledger.test.ts:210:43

 FAIL  … > the markStatus SQL guard and TERMINAL_STATUSES are the same set (drift either way fails)
AssertionError: expected [ 'delivered', 'escalated', 'retried' ] to deeply equal [ 'delivered', 'escalated', …(2) ]
 ❯ src/services/outbound-ledger.test.ts:242:40

 Test Files  1 failed (1)
      Tests  2 failed | 14 passed (16)
```

### 2.3 Full-suite blast radius under the mutation — the finding is confirmed

`npm run test --workspace=apps/api` (34 files) with the mutation in place:

```
 Test Files  1 failed | 33 passed (34)
      Tests  2 failed | 533 passed (535)
```

Exactly **2** failures, both new tests in `outbound-ledger.test.ts`. Critically,
**`src/routes/twilio-status.test.ts` PASSED under the mutation** — which
independently confirms the finding: its hardcoded `TERMINAL_STATUSES` copy made
it structurally incapable of catching this. The pre-round suite would have gone
fully green on a production change that breaks the preserved guarantee.

### 2.4 Restore — by content, hash-verified (no `git checkout`)

The tree has uncommitted work in `outbound-ledger.ts` from earlier tasks (two
doc-comment hunks), so restoring via git would have destroyed it. Instead the
file was copied to a temp backup **before** mutating, and restored with `cp`
afterwards:

```
$ sha256sum apps/api/src/services/outbound-ledger.ts  # baseline, pre-mutation
c893a39ca4652273a400e308902232ecf9cfe5e2ec8085e689de9e49b5bef53f

$ cp <backup> apps/api/src/services/outbound-ledger.ts
$ sha256sum apps/api/src/services/outbound-ledger.ts  # after restore
c893a39ca4652273a400e308902232ecf9cfe5e2ec8085e689de9e49b5bef53f
```

**Restore hash == baseline hash: `c893a39ca4652273a400e308902232ecf9cfe5e2ec8085e689de9e49b5bef53f`.**
Byte-identical. `TERMINAL_STATUSES` verified back at 3 members; the residual
`git diff` on the file contains only the pre-existing doc-comment hunks (no
`TERMINAL_STATUSES` / `failed` residue).

A second mutation round was run later in the round (for §3) and also restored to
the same hash.

---

## 3. `twilio-status.test.ts` — the duplicated `TERMINAL_STATUSES` copy

The route genuinely reads `TERMINAL_STATUSES` (`twilio-status.ts:3,49`), so the
mock cannot simply drop it: removing the value outright would make
`TERMINAL_STATUSES.includes(...)` throw, the route's `try/catch` would swallow
it into a 200, `markStatus` would never fire, and 3 route assertions would fail.
So the copy was **eliminated at its root** instead of being duplicated or merely
annotated. The factory is now async and sources the real value:

```ts
// The ledger is MOCKED in this file, so everything here proves the ROUTE's
// behavior and intent only — not the ledger's SQL guard. The real
// terminal-status guarantee ('failed' must stay updatable, i.e. absent from
// TERMINAL_STATUSES) is asserted against the real module in
// src/services/outbound-ledger.test.ts. TERMINAL_STATUSES is the one value the
// route actually reads, so it is supplied from the real module rather than
// hardcoded here — a local copy would drift from production silently.
vi.mock('../services/outbound-ledger.js', async () => {
  const actual = await vi.importActual<typeof import('../services/outbound-ledger.js')>(
    '../services/outbound-ledger.js',
  );
  return {
    getByMessageSid: mocks.getByMessageSid,
    markStatus: mocks.markStatus,
    TERMINAL_STATUSES: actual.TERMINAL_STATUSES,
  };
});
```

`getByMessageSid` / `markStatus` stay mocked; the comment states plainly that
the ledger is mocked and that the real guard is asserted in
`outbound-ledger.test.ts`, as the brief allows.

**Bonus result — this converted a vacuous pre-existing test into a live one.**
Re-applying the one-token mutation, the untouched test at
`twilio-status.test.ts:177` (`a failed row is NOT terminal — a later genuine
delivered report still marks it delivered`) now **fails**:

```
 FAIL  src/routes/twilio-status.test.ts > … > a failed row is NOT terminal — a later genuine delivered report still marks it delivered
 FAIL  src/services/outbound-ledger.test.ts > … > TERMINAL_STATUSES is exactly delivered|retried|escalated — never failed
 FAIL  src/services/outbound-ledger.test.ts > … > the markStatus SQL guard and TERMINAL_STATUSES are the same set (drift either way fails)
 Test Files  2 failed (2)
      Tests  3 failed | 24 passed (27)
```

So the guarantee is now guarded at two independent levels (ledger + route) with
zero new assertions in the route file, and the two copies can no longer drift.
No existing route assertion was weakened, removed, or reordered.

---

## 4. I2 — `report-2.md` record correction

`report-2.md:19` claimed "§2c `TwilioInboundSmsPayload`, §2d
`MessagingConfigStatusDto` untouched". That is false as written, and no other
report in `docs/tasks/sms-only-cleanup/` mentions `whatsappNumberConfigured`
(0 hits), so the change was undocumented anywhere.

**Verified against the diff** (`git diff -- packages/shared/src/types.ts`): the
`MessagingConfigStatusDto` hunk at lines 590-599 does remove
`whatsappNumberConfigured: boolean` and rewrites three WhatsApp doc comments.
The same hunk also shows `TwilioInboundSmsPayload` **was** edited too (header
gained "SMS only — WhatsApp inbound has been removed."; `From`'s inline
"(WhatsApp inbound arrives as whatsapp:+880…)" note dropped — doc comments only,
no type member). The §2c half of that same clause was therefore also false, so
both are corrected: fixing only half would have left the clause untruthful.

The correction is a record edit only:

- §1's `packages/shared/src/types.ts` row no longer says "untouched"; it states
  §2c/§2d were edited and points at the correction.
- A new `### Correction (2026-09-26, whole-branch review)` subsection directly
  below the table records: the `whatsappNumberConfigured: boolean` member **was
  removed**; the three doc comments rewritten; one comment added; **and why it is
  correct and must not be reverted** — the field reports
  `TWILIO_WHATSAPP_NUMBER`, which §5c deleted from `.env` and §6 confirmed is
  gone from `render.yaml`, so under the SMS-only decision it could only ever
  read `false`. It also records that `fallbackCountries` and the 13-key
  `templateConfigured` map were kept, and that §5 Incomplete #2 already described
  the §2c result correctly and needed no edit.

**`packages/shared/src/types.ts` was not touched** by this round — the removal
stands as-is. No other claim in `report-2.md` was altered; the rest of the file
is unchanged, and §5 Incomplete #2 is left as it was.

---

## 5. Results

| # | Command | Result |
|---|---|---|
| V1 | `npm run typecheck --workspace=apps/api` | **exit 0**, clean. (Baseline before this round was also clean.) |
| V2 | `npm run test --workspace=apps/api -- src/services/outbound-ledger.test.ts src/routes/twilio-status.test.ts` | **2 files / 27 tests passed** (16 + 11; baseline was 9 + 11 = 20). |
| V3 | `npm run test --workspace=apps/api` (full) | **34 files / 535 tests passed.** Baseline 528 + 7 new. |

Test count: 528 → 535 (+7). No test was removed, skipped, or made
implementation-coupled beyond the SQL strings the brief asked to pin.

### Production tree untouched

`apps/api/src/services/outbound-ledger.ts` restored to
`c893a39ca4652273a400e308902232ecf9cfe5e2ec8085e689de9e49b5bef53f`. No other
production file was edited. No commit. No `npm install`. No database access.

## 6. For Sentinel / Probe

- **Audit:** the two-level guard duplication (`TERMINAL_STATUSES` array vs
  `TERMINAL_GUARD` string) is now asserted consistent by
  `outbound-ledger.test.ts` test 3 — any future edit to either must update both
  or fail. Worth confirming no *other* module re-declares the terminal set.
- **Probe:** `twilio-status.test.ts` now depends on the real
  `outbound-ledger.js` via `vi.importActual`, so the real module is evaluated in
  that test's module graph (`pg` is imported but no connection is opened — the
  pool is lazy and no write function is called through the real module). If a
  future change made `outbound-ledger.ts` import-time side-effectful, this test
  would be the first to notice. Not a concern today.
- **Out of scope, flagged not fixed:** report-2.md §5 Incomplete #2 references
  `types.ts:593` for `fallbackCountries`' doc comment; that line number has since
  shifted (now ~596). Cosmetic, left alone.
