# SMS-Only Cleanup — Implementation Plan

Status: approved, ready to execute.
Scope: **faithful cleanup only.** Finish removing the WhatsApp plumbing and the
unsound half-written SMS retry engine. No new schema, no new migration, no new
product behavior beyond the consent hard rule that is already a stated project
hard rule.

## 1. Global constraints (binding on every task)

1. **One outbound channel.** `Channel = 'sms'`. No `whatsapp` identifier,
   string, env var, type member, or UI label may survive in *active* code,
   *active* env config, or *shared types*. Historical documents under
   `docs/tasks/v2/` are a historical record and are **not** rewritten.
2. **No new migration, no live DB writes.** `apps/api/src/db/migrations/014-whatsapp-fallback.sql`
   keeps its filename and its SMS-only body. Code + that one file only.
3. **The ledger and the status callback keep working.** `rl_outbound_messages`
   keeps its 7-value status CHECK and the Messages dashboard keeps rendering
   them. The Twilio status callback marks `queued|sent|delivered|failed`; a
   `failed`/`undelivered` report marks `failed` **and stops**. This round
   produces **no new delivery statuses** and no retry.
4. **Consent is a single choke point.** `sendSms` in
   `apps/api/src/services/sms-service.ts` is the only place the gate lives. If a
   send names a `customerId` and its `kind` is not a transactional OTP kind, a
   logged consent record must exist or the send is refused (throw, fail closed,
   no ledger row). Staff ack and manual dashboard replies never pass
   `customerId` and are therefore exempt.
5. **`consent-service` is the only consent authority.** It honors
   `CUSTOMERS_TABLE`, sets flag **and** timestamp, and is idempotent.
   `outbound-ledger` must not export or own any consent function.
6. **`EscalationType` must match the live DB CHECK.** The DB accepts exactly:
   `ambiguous_intent, no_availability, calendar_api_failure, sms_delivery_failure,
   processing_error, customer_escalation, staff_sms`. Adding a type the DB
   rejects is a production write failure.
7. **Verification discipline.** Test edits are "restore the committed file, then
   apply the minimal SMS-only deletion" — not a rewrite. Several committed test
   files were gutted in the working tree; restoring them recovers coverage that
   a rewrite silently loses.
8. **Verification commands** (run from the repo root, in this order):
   ```bash
   npm run typecheck --workspace=apps/api
   npm run test --workspace=apps/api
   npm run build --workspace=apps/web
   ```
   Focused single file:
   ```bash
   npm run test --workspace=apps/api -- src/services/sms-service.test.ts
   ```
   All three must be green before the round is done. The
   `⚠ Found lockfile missing swc dependencies` line in the web build is
   cosmetic and expected (see `CLAUDE.md`); the build succeeding is the bar.

## 2. End-state contract (what every task serves)

- Single outbound channel SMS. No WhatsApp references in active runtime code,
  `.env.example`, `render.yaml`, active UI, or `@tradescheduler/shared`.
- Ledger + status callback keep working. `failed`/`undelivered` → `failed`,
  stop. No new statuses produced.
- Consent hard rule enforced at `sendSms`; a valid inbound customer SMS writes
  the opt-in record so existing flows keep working; staff/manual sends exempt.
- `consent-service` is the single consent authority; `outbound-ledger` owns no
  consent.
- Migration 014 stays SMS-only; its header records that an environment which
  applied the old 014 needs a future 015.
- API typecheck green, full API test suite green, web build green.
- Exactly one new decision record added:
  `docs/tasks/sms-only-cleanup/DECISION.md`.

## 3. Task list (ordered) and file ownership

**Rule: no file is owned by two tasks. If a task tells you to edit a file it
does not list, stop and report.**

### Task 1 — Drop the dead WhatsApp + fallback-retry surface
`docs/tasks/sms-only-cleanup/task-1-drop-dead-whatsapp-and-retry-engine.md`

| Action | File |
|---|---|
| delete | `apps/api/src/services/whatsapp-service.ts` |
| delete | `apps/api/src/services/whatsapp-service.test.ts` |
| delete | `apps/api/src/services/fallback-service.ts` |
| delete | `apps/api/src/services/fallback-service.test.ts` |
| edit | `apps/api/src/routes/twilio-status.ts` |
| edit | `apps/api/src/routes/twilio-status.test.ts` |
| edit | `apps/api/src/services/phone-utils.ts` |
| edit | `apps/api/src/services/phone-utils.test.ts` |
| edit | `apps/api/src/services/outbound-ledger.ts` |
| edit | `apps/api/src/services/outbound-ledger.test.ts` |

Blocks: nothing. Can run in parallel with Tasks 2 and 3.

### Task 2 — Shared types, config, migration header, decision record
`docs/tasks/sms-only-cleanup/task-2-shared-types-config-and-decision-record.md`

| Action | File |
|---|---|
| edit | `packages/shared/src/types.ts` |
| edit | `apps/api/src/db/migrations/014-whatsapp-fallback.sql` |
| edit | `supabase/schema.sql` |
| edit | `.env.example` |
| verify | `render.yaml` |
| verify | `apps/web/lib/types.ts`, `apps/web/app/dashboard/messages/page.tsx`, `apps/web/components/dashboard/inbox-row.tsx`, `apps/web/components/dashboard/messages-list.tsx` |
| verify | `apps/api/scripts/db-migrate.mjs` |
| create | `docs/tasks/sms-only-cleanup/DECISION.md` |

Blocks: nothing. Can run in parallel with Tasks 1 and 3.

### Task 3 — Consent authority + the `sendSms` choke point
`docs/tasks/sms-only-cleanup/task-3-consent-authority-and-send-gate.md`

| Action | File |
|---|---|
| edit | `apps/api/src/services/consent-service.ts` |
| edit | `apps/api/src/services/consent-service.test.ts` |
| edit | `apps/api/src/services/sms-service.ts` |
| edit | `apps/api/src/services/sms-service.test.ts` |

Blocks: Task 4 (the worker calls `recordSmsOptIn`; its test mocks it).
Can run in parallel with Tasks 1 and 2.

### Task 4 — Inbound worker: E.164 repair, test restore, opt-in write point
`docs/tasks/sms-only-cleanup/task-4-worker-optin-and-inbound-repair.md`

| Action | File |
|---|---|
| edit | `apps/api/src/worker/process-inbound-sms.ts` |
| edit | `apps/api/src/worker/process-inbound-sms.test.ts` |

Depends on: **Task 3** (both files must change together, so a single owner does
both; the consent mock name comes from Task 3).

### Task 5 — Remaining test repairs + the green gate
`docs/tasks/sms-only-cleanup/task-5-remaining-test-repairs-and-green-gate.md`

| Action | File |
|---|---|
| edit | `apps/api/src/services/conversation-domain.test.ts` |
| verify | `apps/api/src/routes/twilio-webhooks.test.ts` |
| verify | `apps/api/src/routes/dashboard/messages.test.ts` |

Depends on: **Tasks 1, 2, 3, 4** — because the acceptance criteria are the
three full-suite commands, and any of them can surface a file this task owns.

## 4. Dependency graph

```
T1 (dead code + status route) ─┐
T2 (types/config/decision)  ───┼──> T5 (green gate)   [T5 also owns the
T3 (consent + sendSms gate) ───┼──> T4 (worker)  ──────>  conversation-domain
                              │                              test repair]
                              └── (T3 blocks T4)
```

- Wave 1 (parallel, disjoint files): **T1, T2, T3**
- Wave 2 (after T3): **T4**
- Wave 3 (after 1–4): **T5**

## 5. Follow-up backlog (NOT in this plan)

Recorded, not fixed. Each needs its own brief.

| # | Item | Why deferred |
|---|---|---|
| F1 | Anonymous `/api/assistant` cross-tenant escalation injection (pre-existing P0) | Out of scope; the cleanup must not widen into the assistant route. |
| F2 | `rl_conversation_states` has no tenant column (pre-existing P0) | Needs a real migration; this round ships no migration. |
| F3 | Zero RLS policies across `rl_*` (pre-existing P0) | Needs a migration + a policy review. |
| F4 | Dual outbound ledgers (`rl_messages` outbound rows and `rl_outbound_messages`) | Reconciling them is a data-model decision, not a cleanup. |
| F5 | Staff phone split (`phone` on the user row vs `phone_number` on the staff row) | Pre-existing schema split; untouched by the WhatsApp removal. |
| F6 | **SMS delivery-failure retry: one retry, immediately, consent-gated** | Decided, deliberately out of scope this round. Design notes: the abandoned attempt marked the original row `retried` *before* `sendSms` inserted an unlinked new row; there was no attempt/parent link; `MAX_RETRY_ATTEMPTS` was declared but never read (unbounded chain); the claim was non-atomic (concurrent callbacks double-send); `markSent` targeted the wrong row; escalation types written were ones the DB CHECK rejects; terminal-status lists disagreed with the ledger DB guard; and the consent gate only ran when `customerId` was set (fail-open). Rebuild it as a new module with a single atomic claim and a real attempt linkage. |
| F7 | The `channel: Channel = 'sms'` parameter threaded through `process-inbound-sms.ts` reply helpers is now dead weight | Removing it changes exported signatures that tests call; out of scope for a faithful cleanup. |
| F8 | An environment that already applied the pre-cleanup 014 needs a real 015 to drop the old constraints | Deliberately deferred; header note only this round. |
| F9 | `apps/api/scripts/local-db.mjs` migration list stops at 012 (missing 013, 014) | Pre-existing gap, unrelated to the WhatsApp removal. |
| F10 | `reschedule-service.ts:186` and `:246` pass no `kind`, so `rl_outbound_messages.kind` is NULL for the reschedule offer and the slot-choice prompt while every sibling send records one | Deferred as out of scope. **Data-quality/observability only — this is NOT a consent gap:** the gate keys off `customerId`, not `kind`, and both sends do name the customer, so they are gated exactly like `slot_invalid`. `reschedule-service.ts` is not an owned file. |
| F12 | The manual dashboard reply (`apps/api/src/worker/process-outbound-sms.ts:84`) sends `{to, body}` with no `organizationId`, so it is exempt from the consent gate **and** writes no `rl_outbound_messages` row — every manual reply is invisible on the delivery surface | Deferred. The exemption is sanctioned (a human-composed reply behind `requireAuth` in `routes/dashboard/inbox.ts`) but is never *asserted* as intentional: the assertion at `process-outbound-sms.test.ts:65` pins the shape while mocking `sendSms` away, so the real gate never runs. Needs (a) a test that exercises the gate to pin the exemption, and (b) a decision on whether manual replies should be ledgered. |
| M6 | `hasSmsOptIn(customerId)` is not org-scoped and is not cross-checked against `organizationId` (`apps/api/src/services/consent-service.ts`) | Deferred: latent today. No route accepts a `customerId` from a request body and the only producer (`findOrCreateCustomer`) is org-scoped, so no cross-tenant read is reachable. It needs RLS to matter — see F3. |

## 6. What "done" looks like

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
- `npm run typecheck --workspace=apps/api` → exit 0.
- `npm run test --workspace=apps/api` → 0 failures.
- `npm run build --workspace=apps/web` → success.
- `docs/tasks/sms-only-cleanup/DECISION.md` exists and records the five approved
  decisions in section 1 of that file.
