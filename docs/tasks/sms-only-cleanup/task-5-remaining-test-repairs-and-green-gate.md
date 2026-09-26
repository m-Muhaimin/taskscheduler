# Task 5 brief — Remaining test repairs + the green gate

**Where this fits:** the last task. By the time it runs, Tasks 1–4 have removed
the dead code, fixed the types and config, installed the consent gate, and
repaired the worker. What remains are three test files: one that breaks
typecheck, and two whose assertions still describe the old two-channel product.
This task closes them and proves the whole thing.

**Depends on:** **Tasks 1, 2, 3, 4.** All four must be finished first — the
acceptance criteria here are the three full-suite commands, and any of them can
surface a file this task owns.

---

## 1. Files you own (edit nothing outside this list)

| Action | Path |
|---|---|
| edit | `apps/api/src/services/conversation-domain.test.ts` |
| verify | `apps/api/src/routes/twilio-webhooks.test.ts` |
| verify | `apps/api/src/routes/dashboard/messages.test.ts` |

If a failure traces to a file you do not own, **report it and stop**. Do not
edit around it.

## 2. `apps/api/src/services/conversation-domain.test.ts`

**2a.** `npm run typecheck --workspace=apps/api` currently fails at
**line 164** with a `Channel` argument error. Read lines 155–170; the block is:

```ts
    it('rejects an invalid channel (sms|voice|web only)', async () => {
      const domain = await loadDomain();
      // 'sms' is valid — this should succeed, not reject.
      const validConv = await domain.findOrCreateConversation('cust-1', 'sms');
      expect(validConv).toBeDefined();

      // 'carrier' is not in the valid set — reject.
      await expect(domain.findOrCreateConversation('cust-1', 'carrier')).rejects.toMatchObject({
        code: 'INVALID_CHANNEL',
      });
    });
```

`'carrier'` is not a member of `export type Channel = 'sms'`. Change the second
call so the argument is a non-`Channel` value the compiler accepts but the
runtime validator rejects — a cast is required here because the test's whole
purpose is to pass something the type system forbids:

```ts
      // 'carrier' is not in the valid set — reject. The cast is the point:
      // the runtime guard must reject a value the type system already excludes.
      await expect(
        domain.findOrCreateConversation('cust-1', 'carrier' as unknown as Channel),
      ).rejects.toMatchObject({
        code: 'INVALID_CHANNEL',
      });
```

**2b.** Make sure `Channel` is imported in this test file. If it is not, add it
to the existing `@tradescheduler/shared` (or `../types.js`) type import:

```ts
import type { Channel } from '../types.js';
```

If neither module re-exports `Channel` from this test's perspective, use
`import type { Channel } from '@tradescheduler/shared';` instead. Do not
introduce a new import path that no other file uses.

**2c. Delete the WhatsApp body test.** Lines 207–212 read:

```ts
    it('requires a body for whatsapp inbound (non-voice, like sms) (MISSING_BODY)', async () => {
      ...
      mocks.query.mockResolvedValueOnce({ rows: [{ id: 'conv-1', status: 'open', channel: 'whatsapp' }] });
      ...
    });
```

Read the full test before deleting — the `appendMessage` describe block also has
an SMS counterpart (`appends an SMS message and refreshes the conversation`)
that already covers the `MISSING_BODY` path. Delete only the WhatsApp one, from
its `it(` line through its closing `});`.

**2d.** Leave every other test in the file untouched. In particular the
`findOrCreateConversation` suite, the rest of the `appendMessage` suite, and
all of `messageRow()` / `loadDomain()` / the `vi.mock('pg', ...)` block stay as
committed.

## 3. `apps/api/src/routes/dashboard/messages.test.ts`

**3a.** The test `200 passes ?channel=sms&status=failed&page=2&pageSize=5 through
to the service` requests `?channel=sms` but asserts the service received
`channel: 'whatsapp'` (line 73). The ledger is SMS-only, so the assertion is
wrong. Change line 73 to:

```ts
      expect.objectContaining({ channel: 'sms', status: 'failed', page: 2, pageSize: 5 }),
```

**3b.** Confirm the route's own Zod validation still accepts `channel=sms` and
rejects the unknown values. The test `400 invalid_query for unknown channel/status
values` probes `channel=voice`, `status=deliverd`, `status=all` — leave it
unchanged; `voice` is a conversation channel, not a messaging one, so it must
stay a 400.

**3c.** Do not change any other test in the file, and do not change the
`vi.mock('../../services/outbound-ledger.js', ...)` block. If
`MESSAGE_STATUS_LABEL` in the real ledger no longer has a `'whatsapp'` entry
(Task 1 removed the label maps entry for it), that is expected — the test mocks
the ledger and does not exercise the maps.

## 4. `apps/api/src/routes/twilio-webhooks.test.ts`

This file has no `whatsapp` reference and is expected to need **no** edit.
Read it once and confirm:

- [ ] it does not import `fallback-service.js` or `whatsapp-service.js`
      (Task 1 deleted both; if it does import them, that import is now a
      resolution error — report it).
- [ ] it does not assert a `'retried'` or `'escalated'` transition triggered
      by a `failed` status report.
- [ ] it exercises the inbound-webhook signature gate and the E.164
      normalization, both of which are unchanged.

Make no edit unless one of those three checks fails, and if it does, report
before changing anything.

## 5. The green gate

Run all three, in this order, from the repo root:

```bash
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/api
npm run build --workspace=apps/web
```

**Expected results:**

| Command | Expectation |
|---|---|
| typecheck | exit 0, no output |
| test | 0 failed. The suite is ~53+ tests; any failure is a real gap, not noise. |
| build | success. The `⚠ Found lockfile missing swc dependencies` / `⨯ Failed to patch lockfile` lines are **cosmetic and expected** (see `CLAUDE.md`); the build succeeding is the bar. |

**6. Residual-reference sweep.** Then confirm the only surviving `whatsapp`
mentions are the migration filename and the historical docs:

```bash
rg -n -i "whatsapp" apps packages supabase .env.example render.yaml
```

Expected: only

- `apps/api/scripts/db-migrate.mjs:35` — the migration filename string
- `apps/api/src/db/migrations/014-whatsapp-fallback.sql` — the filename in the
  header warnings, and the `drop constraint if exists` lines are untouched
- `supabase/schema.sql` — at most a path reference to that filename

Anything else — an identifier, an env var, a type member, a UI string, a test
fixture — is a gap. Find the owning task in `PLAN.md` §3 and report it. Do not
fix a file another task owns.

**7. Historical docs are out of scope and must be untouched.** These still
contain `whatsapp` by design and must appear in `git status` as unmodified:

- `docs/tasks/v2/whatsapp-channel-fallback.md`
- `docs/build-sequence.md`
- `docs/tasks/v2/reports/T18-whatsapp-fallback-engine.md`

If any of them shows as modified, revert it with
`git checkout HEAD -- <path>`.

## 6. Final report to the user

Report, in this shape:

1. The three command results (typecheck / test / build) with pass counts.
2. The residual-reference sweep result.
3. Anything you had to report instead of fix, with the file path and the reason
   (wrong owner / blocked / out of scope).
4. A statement that follow-ups F1–F9 in `PLAN.md` §5 remain open — this change
   did not address them.

Do not mark the round complete if any of the three commands is red.

## 7. Acceptance criteria

- [ ] `npm run typecheck --workspace=apps/api` → exit 0.
- [ ] `npm run test --workspace=apps/api` → 0 failed.
- [ ] `npm run build --workspace=apps/web` → success.
- [ ] `rg -n -i "whatsapp" apps packages supabase .env.example render.yaml`
      returns only the migration-filename references.
- [ ] `git status` shows no modification to the three historical docs.
- [ ] `docs/tasks/sms-only-cleanup/` contains `PLAN.md`, `DECISION.md`, and the
      five task briefs.
