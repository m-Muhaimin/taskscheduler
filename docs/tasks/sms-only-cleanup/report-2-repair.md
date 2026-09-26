# Task 2 repair — factual-accuracy findings (round 2)

Scope of this pass: comment- and doc-only repairs to the four owned files. No
DDL, no TypeScript, no behavior change, no commit, no `npm install`, and no
statement executed against any database (both `.sql` files were treated as text
only). Nothing outside the finding list was changed.

Files edited:

| File | Findings applied |
|---|---|
| `apps/api/src/db/migrations/014-whatsapp-fallback.sql` | C1, I1, I2, I3, I4, M1 |
| `supabase/schema.sql` | I2, I4 |
| `docs/tasks/sms-only-cleanup/DECISION.md` | I5 |
| `docs/tasks/sms-only-cleanup/PLAN.md` | residue ruling (§6) |

---

## C1 — the warning header was factually wrong (most serious)

`014:23-24` claimed "014 is not re-run on an existing database — migrations are
recorded and skipped — so editing this file fixes fresh databases only."

**Verified false, as the finding states:**

- `apps/api/scripts/db-migrate.mjs:50-58` — `for (const file of MIGRATIONS)`
  calls `await client.query(readFileSync(path, "utf8"))` for *every* file on
  *every* invocation. The only skip is `if (!existsSync(path))` at `:52-55`.
  Verified there is no migration-ledger table anywhere in the repo:
  `rg -i "schema_migrations|applied_migrations|migration_log|migrations_ran"`
  (excluding `node_modules`/`docs`) returns nothing.
- `render.yaml:24` (`ridgeline-api`) and `render.yaml:83` (`ridgeline-worker`)
  both start with `npm run db:migrate --workspace=apps/api && ...`, so the
  migration script runs on every service start.
- The old header also attributed the re-apply to `local-db.mjs`, whose list
  stops at 012 (see M1).

**Additional truth the header now carries**, established from
`git show HEAD:apps/api/src/db/migrations/014-whatsapp-fallback.sql`:

- The pre-cleanup 014 widened **two channel** constraints — the ledger's
  (`('sms', 'whatsapp')`) and `rl_conversations`' (`('sms','voice','web',
  'whatsapp')`, section 3 of that file) — and created
  `rl_customers.whatsapp_opted_in / whatsapp_opted_in_at`. Its **status** CHECK
  is the same seven values the current file writes; this cleanup never changed
  it.
- The current 014 has **no `rl_conversations` statement and no `drop column`**,
  so a database that applied the old 014 keeps the widened conversation CHECK
  and the two leftover columns indefinitely. That is the real reason 015 is
  required, and 014's re-run cannot supply it.

**Before** (lines 19-27):

```
-- ⚠ IF YOU APPLIED THE PRE-CLEANUP VERSION OF 014
--   An environment that ran 014 before the SMS-only cleanup (when it still
--   widened the channel and status constraints) needs a follow-up migration
--   015 to replace those two CHECK constraints with the SMS-only definitions
--   in this file. 014 is not re-run on an existing database — migrations are
--   recorded and skipped — so editing this file fixes fresh databases only.
--   015 is NOT part of this change; it is tracked as follow-up F8 in
--   docs/tasks/sms-only-cleanup/PLAN.md. Dev and CI databases are disposable
--   and can simply be dropped and rebuilt.
```

**After** (lines 25-66):

```
-- ⚠ IF YOU APPLIED THE PRE-CLEANUP VERSION OF 014
--   This file IS re-run on an existing database. db-migrate.mjs applies every
--   file on every invocation (only an existsSync skip for a missing file — no
--   migration-ledger table, no "already applied" skip), and render.yaml runs
--   `npm run db:migrate` on every API start and every worker start. Editing
--   this file in place therefore reaches existing databases, not only fresh
--   ones. On a database that ran the pre-cleanup 014, a re-run does the
--   following:
--
--   - It REPLACES both ledger CHECK constraints. Each is a
--     `drop constraint if exists` + `add constraint` pair, so the re-run
--     re-asserts both. rl_outbound_messages_status_check keeps the same
--     seven values the pre-cleanup 014 wrote — this cleanup never changed
--     that CHECK — while rl_outbound_messages_channel_check loses
--     'whatsapp' and is left with ('sms') only. That is the one old
--     constraint this file can repair.
--
--   - It REJECTS such a database if any row still says channel='whatsapp'.
--     Postgres validates a new CHECK against existing rows, so the
--     `add constraint` fails and the migration does not complete. Check for
--     those rows before deploying:
--       select count(*) from public.rl_outbound_messages where channel <> 'sms';
--     db-migrate.mjs sends the whole file as one multi-statement simple
--     query, so Postgres runs it in a single implicit transaction: the
--     failure rolls this migration back whole and the script exits non-zero
--     (014 is the last entry in its MIGRATIONS list, so nothing after it runs
--     either). The `&&` in the render.yaml start commands (API and worker)
--     then short-circuits and the service does not start.
--
--   - It does NOT repair the conversation channel. The pre-cleanup 014 also
--     widened the channel CHECK on rl_conversations to
--     ('sms', 'voice', 'web', 'whatsapp'), and added the columns
--     rl_customers.whatsapp_opted_in / whatsapp_opted_in_at. THIS FILE
--     CONTAINS NO STATEMENT ABOUT EITHER, so a database that applied the old
--     014 keeps that widened CHECK and those columns indefinitely — no
--     re-run of this file removes them.
--
--   That is why an existing environment needs a real follow-up migration 015
--   to undo the conversation-channel widening: this file has no statement
--   that could. 015 is NOT part of this change; it is tracked as follow-up
--   F8 in docs/tasks/sms-only-cleanup/PLAN.md. Dev and CI databases are
--   disposable and can simply be dropped and rebuilt.
```

Three required points are covered explicitly: (a) 015 is needed because this
file contains no `rl_conversations` statement, so the widened conversation
CHECK survives forever; (b) the ledger block is drop+add, so a re-run REPLACES
both ledger CHECKs, and a surviving `channel='whatsapp'` row makes the
`add constraint` fail and abort — with the pre-flight `select` an operator can
run first; (c) editing 014 in place does reach existing databases.

**Second half of C1 (`014:21`)** — "widened the channel and status constraints"
is gone. It is replaced by the precise statement at lines 36-38: the status
CHECK "keeps the same seven values the pre-cleanup 014 wrote — this cleanup
never changed that CHECK". Verified by diffing HEAD's status CHECK
(`'queued', 'sent', 'delivered', 'failed', 'retried', 'escalated',
'blocked_optin'`) against the current one — identical, and the new comment
blocks now say so.

Notes on two claims that are reasoned from code plus documented Postgres
protocol semantics rather than from an executed test (no DB was touched, per
the brief): that a failing statement inside the file rolls the whole file back
(`db-migrate.mjs:56` passes the file to `client.query` with no parameter
values, i.e. the simple-query protocol, where a multi-statement Query message
runs in one implicit transaction), and that the resulting non-zero exit
short-circuits `&&` in `render.yaml:24`/`:83` (the error propagates out of the
`try` at `db-migrate.mjs:49-59`, the top-level `await` rejects, and
`package.json`'s `db:migrate` is a bare `node scripts/db-migrate.mjs`).

---

## I1 — `comment on table` named a deleted subsystem

The old text named the "delivery-failure fallback engine", a subsystem deleted
in Task 1 (`fallback-service.ts` is gone per `git status`: `D
apps/api/src/services/fallback-service.ts`), and contradicted `014:10` in the
same file.

**Before** (`014:50-51`):
```
comment on table public.rl_outbound_messages is
  'Ledger of outbound SMS messages (T17 Phase C: delivery-failure fallback engine reads this table)';
```

**After** (`014:88-89`) — now byte-identical to `supabase/schema.sql:601-602`:
```
comment on table public.rl_outbound_messages is
  'Ledger of outbound SMS messages (T17 Phase C: the Twilio StatusCallback reports on this table)';
```

Verified: the consumer is the Twilio Message StatusCallback route —
`apps/api/src/routes/twilio-status.ts` (`getByMessageSid` + `markStatus`,
`twilio-status.ts:42-73`) and `outbound-ledger.ts:1-4` ("updated by the Twilio
StatusCallback route (/api/twilio/webhooks/status) as delivery reports
arrive"). `schema.sql` already carried the correct text, so only 014 changed.

---

## I2 — the `kind` column comment described a deleted phase

**Before** (`schema.sql:594`): `-- outbound kind (e.g. 'reschedule_offer'); NULL until Phase D writes`
(Phase D is deleted — DECISION.md D2.)

**After**, identical in both files (`014:81`, `schema.sql:594`):
`-- outbound kind (e.g. 'reschedule_offer'); set when the caller supplies one, else NULL`

Verified that `kind` is written today: `outbound-ledger.ts:136` inserts the
`kind` column and `:145` binds `input.kind`; `sms-service.ts:168` supplies
`kind: input.kind ?? null` when it writes the ledger row. So the column is
populated whenever the caller supplies a kind and NULL otherwise — which is
what the new text says. (The old `014:43` text, "NULL until written", was
merely stale rather than false; it now matches `schema.sql` byte for byte.)

---

## I3 — the consent hard rule was attributed to the wrong module

The old text put enforcement in `consent-service.ts` "which reads these two
columns". Both halves were wrong.

**Before** (`014:13-15`):
```
--      The consent hard rule (never send an SMS without a logged consent
--      record) is enforced in services/consent-service.ts, which reads these
--      two columns.
```

**After** (`014:12-18`):
```
--   2. rl_customers.sms_opted_in / sms_opted_in_at — SMS consent flag. The
--      consent hard rule (never send an SMS without a logged consent record)
--      is enforced in sendSms (services/sms-service.ts), which reads the flag
--      through consent-service before it writes a ledger row or calls Twilio.
--      services/consent-service.ts is the single record/lookup authority for
--      the pair: recordSmsOptIn sets both columns together, hasSmsOptIn reads
--      sms_opted_in.
```

Verified:
- The gate is in `sendSms`: `assertSmsConsent` is defined at
  `sms-service.ts:121` and its single call site is `sms-service.ts:147`, inside
  `sendSms` (`:138`), ahead of the ledger insert (`:162`) and
  `client.messages.create` (`:213`) — matching PLAN §1.4 ("the only place the
  gate lives") and the comment at `sms-service.ts:49-55`.
- `consent-service.ts` is the only non-migration code touching the pair:
  `rg sms_opted_in apps/api/src --glob '!*.test.ts'` returns hits only in
  `consent-service.ts` and the migration. `hasSmsOptIn` selects
  `sms_opted_in` alone (`:60`); `recordSmsOptIn` sets flag and timestamp
  together (`:73-74`).

---

## I4 — mirror drift between 014 and schema.sql

All three named pairs are now byte-identical. Proof: the DDL bodies
(`014:72-121` vs `schema.sql:586-633`) diff to only the two section-heading
comments (see "left as-is" below), and each shared string occurs exactly once
in each file:

| Comment | 014 | schema.sql |
|---|---|---|
| `comment on table` text | 1× | 1× |
| `kind` trailing comment | 1× | 1× |
| `channel` trailing comment | 1× | 1× |

Before: `channel` was `-- 'sms' only — SMS-only product` in 014 and
`-- 'sms'` in schema.sql; `kind` and the table comment also differed (see I1,
I2). 014's texts were the accurate ones, so `schema.sql:592` and `:594` were
updated to match 014.

**No DDL changed.** Verified two ways: (1) a block-level diff of the two files'
DDL sections shows the SQL statements are byte-identical to each other, exactly
as they were before this pass; (2) every line I touched is a comment — the
`-- ...` prefix in both column lines, the `-- 1.`/`-- 2.` region untouched, and
the `comment on table` string literal. Preserved verbatim, as I4 requires: the
7-value status CHECK, the ledger channel CHECK, both `create index if not
exists` statements, the `enable row level security` + `revoke all ... from
anon, authenticated` pair, and the two consent columns with their
`comment on column`.

---

## I5 — wrong follow-up citation in DECISION.md

**Before** (`DECISION.md:32`): "A rebuild is tracked as follow-up F8/F6 in
`PLAN.md` …"
**After:** "A rebuild is tracked as follow-up F6 in `PLAN.md` …"

Verified against PLAN §5: the retry rebuild is **F6** ("SMS delivery-failure
retry: one retry, immediately, consent-gated"), while **F8** is "An environment
that already applied the pre-cleanup 014 needs a real 015 to drop the old
constraints" — D5's subject, not D2's. `DECISION.md:60` already cited F6 alone
and is now consistent with line 32.

---

## M1 — wrong script attributed for the re-apply

**Before** (`014:17`): "-- Idempotent like every migration here (local-db.mjs
re-applies all on boot)."
**After** (`014:20-23`):
```
-- Idempotent like every migration here: db-migrate.mjs re-applies its whole
-- list on every run (there is no migration-ledger table, so nothing records
-- that a file already ran), and local-db.mjs re-applies its list the same way
-- — but its list stops at 012, so 013 and 014 are not applied there.
```

Verified: `local-db.mjs:36-49` ends its `MIGRATIONS` array at
`012-assistant-escalation-type.sql` and never applies 013 or 014 (this is the
known gap logged as PLAN F9); the re-applier is `db-migrate.mjs:50-58`. The
old text attributed the behavior to the wrong script *and* overstated it.

---

## Residue ruling — PLAN §6 amended

`packages/shared/src/types.ts` was not touched, per the ruling.

**Before** (`PLAN.md:176-179`): the end-state check allowed only two classes —
the migration filename and comments referencing it as a path — which is
unsatisfiable, because `types.ts:158`/`:593` document the removal and
`phone-utils.test.ts:39` proves a `whatsapp:`-prefixed address is rejected.

**After** (`PLAN.md:176-191`):

```
- `rg -i whatsapp` over `apps/`, `packages/`, `supabase/`, `.env.example`,
  `render.yaml` returns only these three deliberate residue classes and no
  others:
  1. the historical migration filename `014-whatsapp-fallback.sql`, and the
     comments that reference that filename as a path (it is kept so the
     migration list in `apps/api/scripts/db-migrate.mjs` and the mirror note in
     `supabase/schema.sql` still resolve);
  2. comments that explicitly document the WhatsApp removal — e.g.
     `packages/shared/src/types.ts` ("SMS only — WhatsApp inbound has been
     removed", "SMS only — no WhatsApp fallback") and 014's warning header,
     which names the pre-cleanup constraints and columns the removal retired
     and states what a re-run of 014 does and does not repair on an environment
     that ran the old 014;
  3. deliberate negative-assertion test literals that prove a `whatsapp:`-
     prefixed address is REJECTED, e.g. `phone-utils.test.ts:39`
     (`countryCodeFromE164('whatsapp:+8801712345678')` → `null`).
  None of the three is a live WhatsApp code path. No identifiers, no env vars,
  no type members, no UI strings.
```

No other PLAN constraint was touched; §1's binding rules, §2's end-state
contract, §5's backlog and the three verification commands are unchanged.

**One judgment call to flag:** class 2 originally carried a single example (the
filename note in 014's header). The C1 rewrite necessarily names the retired
values (`'whatsapp'`, `whatsapp_opted_in`, `whatsapp_opted_in_at`) so the
operator knows exactly which rows to look for before deploying — so 014's
warning block itself now contributes `whatsapp` hits. I kept the three-class
structure exactly as instructed and added the warning header as a *second named
example of class 2* rather than widening the class or dropping the operator
information. Class 2's scope (comments that document the removal) is unchanged.

**Verification** — `rg -n -i whatsapp apps packages supabase render.yaml
.env.example` returns 11 hits, each mapping to exactly one class:

| Hit | Class |
|---|---|
| `supabase/schema.sql:11`, `supabase/schema.sql:572`, `db-migrate.mjs:35`, `014:68` | (1) filename / filename-as-path |
| `014:70` ("Nothing in this file is WhatsApp-related") | (2) |
| `014:39`, `014:42`, `014:56`, `014:57` (C1 warning block) | (2) |
| `packages/shared/src/types.ts:158`, `packages/shared/src/types.ts:593` | (2) |
| `apps/api/src/services/phone-utils.test.ts:39` | (3) |

No identifier, env var, type member, UI string, or live code path. `.env.example`
and `render.yaml` produce zero hits.

---

## Deliberately left as-is (and why)

1. **The two section-heading comments still differ between the mirrors**:
   `-- 1. Outbound message ledger (SMS only).` / `-- 2. SMS consent storage on
   customers.` in 014, versus no `-- 1.` line and
   `-- SMS consent storage on customers (T17 Phase C).` in `schema.sql`. I4
   named exactly three drifted pairs and also forbids changing comment lines
   that no finding requires, so I left these. They are section prose, not
   mirrored claim text. Cheap to align if you want zero delta.
2. **`schema.sql` carries no 015 caveat.** Its block header (`:570-584`) does
   not repeat 014's new warning. This is a truthful divergence, not an
   oversight: `schema.sql` is the one-paste full-schema bootstrap for a *fresh*
   project (`:2-7`, `:17`), and it is not in either migration runner's list, so
   the "database that already applied the pre-cleanup 014" scenario does not
   apply to it. Adding the caveat was not a finding, so I did not.
3. **`DECISION.md:51-55` (D5) is now loosely worded** — "Its header now warns
   that an environment which applied the pre-cleanup 014 needs a future 015 to
   *replace the old constraints*." After the C1 correction, 014's own re-run
   replaces the two ledger CHECKs; 015 is needed only for the
   `rl_conversations` widening (and, implicitly, to drop the leftover
   `whatsapp_opted_in*` columns). D5 is not false — 015 *is* needed to replace
   one of the old constraints — but it under-specifies. I5 only asked me to fix
   the F8/F6 citation, so I did not rewrite D5. Worth a one-line follow-up if
   you want the decision record to match the migration header exactly.
4. **No out-of-scope finding fixed.** For the record, the leftover
   `rl_customers.whatsapp_opted_in / whatsapp_opted_in_at` columns on any
   environment that ran the old 014 are real and now documented in 014's
   warning (C1a), but nothing drops them — that is F8's 015 scope, not this
   round.

## Not done / cannot verify here

- Nothing was executed against any database, so the two protocol-level claims
  in the C1 warning (single implicit transaction per file; non-zero exit
  short-circuiting `&&`) are verified by reading `db-migrate.mjs`,
  `apps/api/package.json` and `render.yaml` plus documented Postgres
  simple-query semantics — not by an observed run.
- `npm run typecheck` / `npm run test` / `npm run build` were not run: this pass
  changed no TypeScript and no executable SQL, and the brief forbade install
  and DB execution. The verification actually performed is the `rg` residue
  check, the mirror byte-identity diff, and the claim-by-claim code reads cited
  above.
- No commit was made.
