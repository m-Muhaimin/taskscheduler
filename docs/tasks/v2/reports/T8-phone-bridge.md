# T8 — conversation-states phone-bridge fix (dashboard queries) — Report

Status: COMPLETE · Date: 2026-09-19 · Agent: wired (backend/API)
Brief: `docs/tasks/v2/briefs/T8-phone-bridge.md`

## Verdict

**PASS** — all 4 fix sites applied in `apps/api/src/services/dashboard-service.ts`;
typecheck clean; full API suite **309/309 warm** (3 failures on cold run are the
documented pre-existing process-inbound-sms/google-auth flakes — green in
isolation); full live matrix green (9 baseline + 14 seeded-assert + 4 cleanup +
9 after-baseline, all PASS); DB restored to pre-seed state.

## The fix (4 sites, one file)

`rl_conversation_states.conversation_id` (nullable FK, migration 007) is never
populated by the writer (`conversation-service.ts:86` inserts phone/user_id/
booking_id only). All six `s.conversation_id = c.id` joins in dashboard-service
(6 sites = the brief's 4 fixes) are now bridged by the two real keys: **phone**
(display/suggestion semantics) and **membership** (aggregate org scoping via
`rl_organization_members`). Added one table helper
`organizationMembersTable()` (`ORGANIZATION_MEMBERS_TABLE ?? 'rl_organization_members'`,
matches the existing helper pattern; `organization-service.ts` already had the
same helper). Row shapes, params, and arity unchanged on every query.

### 1. Aggregates — membership scoping (summary booking-rate total/completed + series; analytics aiBookingRateByDay)

Before (3 sites): `join conversations c on c.id = s.conversation_id where c.organization_id = $1`
After (all 3, same row shape, same params):

```sql
from public.rl_conversation_states s
where s.user_id in (select user_id from public.rl_organization_members where organization_id = $1)
```

- summary metric 4 total/completed (`[orgId]`) — all-time 1 completed / total
- summary metric 4 7-day series (`[orgId, tz, seriesStart, today]`)
- analytics `aiBookingRateByDay` inner agg (`[start, end, orgId, tz]`, param `$3`)

### 2. Analytics outcomes booked/escalated — membership scoping

Before: same `join conversations c on c.id = s.conversation_id where c.organization_id = $1 and s.state = …`
After (both subselects, `[orgId]`):

```sql
(select count(*)::int from public.rl_conversation_states s
  where s.user_id in (select user_id from public.rl_organization_members where organization_id = $1)
    and s.state = 'completed') as booked,
(select count(*)::int from public.rl_conversation_states s
  where s.user_id in (select user_id from public.rl_organization_members where organization_id = $1)
    and s.state = 'escalated') as escalated,
```

### 3. Analytics outcomes dropped — phone bridge

Before: `not exists (select 1 from states s where s.conversation_id = c.id and s.state = 'completed')`
After (outer query already has conversation `c` with customer `c.customer_id`):

```sql
(select count(*)::int from public.rl_conversations c
  where c.organization_id = $1 and c.status = 'closed'
    and not exists (select 1 from public.rl_conversation_states s
      join public.rl_customers cu on cu.phone = s.phone and cu.id = c.customer_id
      where s.state = 'completed')) as dropped
```

### 4. Inbox `st` lateral — phone bridge

Before: `where s.conversation_id = c.id` · After: `where s.phone = cu.phone`
(`cu` = the conversation's customer, joined in the outer query; `order by s.created_at desc limit 1` kept).

```
left join lateral (
  select s.state, s.offered_slots, s.escalation_reason
  from public.rl_conversation_states s
  where s.phone = cu.phone
  order by s.created_at desc
  limit 1
) st on true
```

No remaining references to `s.conversation_id` in the file (messages keep
`m.conversation_id` — legitimately populated by the writer).

## Static + unit verification

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run typecheck --workspace=@tradescheduler/api` | clean |
| 2 | `npm run test --workspace=@tradescheduler/api` (cold) | 306 passed / 3 failed — the 3 known pre-existing cold-run flakes (process-inbound-sms ×2 timeout/spy, google-auth) |
| 3 | same two files in isolation | **24/24 passed** (flake confirmation, per T2-T3/T7) |
| 4 | full suite warm re-run | **309 passed / 309** (16 files) |

No new service unit test: no `dashboard-service.test.ts` exists (confirmed),
and per the brief the live matrix is the gate. Optional unit test skipped —
the membership-scoping SQL shape is exercised end-to-end by the matrix below.

## Live verification (matrix, against :3001)

Boot: killed stale tsx on 3001 (T7's PID 22232), started fresh
`npx tsx src/index.ts` (PID 2684 after one slower cold start), `GET /api/health`
→ `200 {"status":"ok"}`. Auth: the T2-T3 throwaway account (email read from the
live DB by the harness, password `Verify-Pw-2026!` per T7's final creds — T7
final creds win; org `t2t3-verify-org`, OWNER membership intact).

### Seed SQL (exact, via repo-root `.env` pooler connection, `ssl rejectUnauthorized false`)

```sql
-- isolation tradesperson (FK target for the probe state; NOT a member of the org)
insert into public.rl_tradespeople (email, password_hash, display_name)
values ('t8-isolation-<ts>@example.com', 'scratch-nonempty', 'T8 Isolation Probe') returning id;

-- in-org customer + conversation (org-scoped)
insert into public.rl_customers (organization_id, name, phone)
values (<orgId>, 'T8 Phone-Bridge Customer', '+15551234501') returning id;
insert into public.rl_conversations (organization_id, customer_id, channel, status, current_state)
values (<orgId>, <customerId>, 'sms', 'open', 'new') returning id;

-- state A: completed, org member, 1h ago
insert into public.rl_conversation_states (phone, user_id, state, created_at)
values ('+15551234501', <memberUserId>, 'completed', now() - interval '1 hour') returning id;

-- state B: escalated + offered_slots (LATEST, 30m ago) — proves the inbox picks the latest state
insert into public.rl_conversation_states
  (phone, user_id, state, offered_slots, escalation_reason, created_at)
values ('+15551234501', <memberUserId>, 'escalated',
        '[{"optionNumber":1,"startTime":"2026-09-21T14:00:00.000Z","endTime":"2026-09-21T15:00:00.000Z"},
          {"optionNumber":2,"startTime":"2026-09-22T09:00:00.000Z","endTime":"2026-09-22T10:00:00.000Z"}]'::jsonb,
        'T8 test escalation reason', now() - interval '30 minutes') returning id;

-- state C: ISOLATION PROBE — phone in NO org customer + user NOT in org
insert into public.rl_conversation_states (phone, user_id, state, created_at)
values ('+15551234599', <isoUserId>, 'completed', now() - interval '10 minutes') returning id;
```

All seeded `rl_conversation_states` rows have `conversation_id` **NULL** (verified:
3 NULL / 0 set) — the matrix proves the bridge works with the column unpopulated.

### Matrix (before / after per assertion)

| # | Assertion (API surface) | Baseline (pre-seed) | Seeded (post-fix) | Post-cleanup |
|---|-------------------------|---------------------|-------------------|--------------|
| 1 | summary `ai-booking-rate` value (completed/total → pct) | 0 (PASS) | **50 = 1/2** (PASS) | 0 (PASS) |
| 2 | summary `ai-booking-rate` chartData[6] (today) | 0 (PASS) | **50** (PASS) | 0 (PASS) |
| 3 | analytics `outcomes` length | [] (PASS) | **3** (PASS) | [] (PASS) |
| 4 | analytics outcomes `Booked` pct (count 1) | — | **50** (PASS) | — |
| 5 | analytics outcomes `Escalated` pct (count 1) | — | **50** (PASS) | — |
| 6 | analytics outcomes `Dropped` pct (count 0) | — | **0** (PASS) | — |
| 7 | analytics `aiBookingRateByDay` today value | 0 (PASS) | **50** (PASS) | 0 (PASS) |
| 8 | analytics `aiBookingRateByDay` length | 30 (PASS) | 30 (PASS) | 30 (PASS) |
| 9 | inbox items for org | [] (PASS) | 1 (PASS) | [] (PASS) |
| 10 | inbox suggestion carries offered_slots from LATEST state | — | `"Offer slots: Mon 10:00, Tue 5:00"` (PASS) | — |
| 11 | **Isolation probe**: neither count shows the 3rd state (would be 33/67 if counted) | — | rate=50, booked=50, escalated=50, no inbox row for the probe phone (all PASS) | — |
| 12 | HTTP status codes (summary/analytics/inbox) | 200/200/200 (PASS) | 200/200/200 (PASS) | 200/200/200 (PASS) |

Before-fix, every seeded state would have matched nothing (all joins on a NULL
column): value 0/empty/`""` suggestion — the baseline column IS the before
behavior, now reproduced only when no states exist.

### Cleanup SQL (exact, executed; then verified)

```sql
delete from public.rl_conversation_states where id = any(array[<stateA>, <stateB>, <stateC>]::uuid[]);
delete from public.rl_conversations where id = <convId>;
delete from public.rl_customers where id = <custId>;
delete from public.rl_tradespeople where id = <isoUserId>;
-- safety sweep for the marker phones (0 rows)
delete from public.rl_conversation_states where phone in ('+15551234501', '+15551234599');
```

Verification SQL after cleanup:

```sql
select
  (select count(*) from rl_conversation_states) as states,          -- 0
  (select count(*) from rl_customers)          as customers,         -- 0
  (select count(*) from rl_conversations)      as conversations,     -- 0
  (select count(*) from rl_tradespeople where display_name = 'T8 Isolation Probe') as iso, -- 0
  (select count(*) from rl_tradespeople where email like 't8-isolation-%') as iso_emails; -- 0
```

## Cleanup confirmation

- state rows (completed/escalated/isolation): **0 left**; customer: 0; conversation: 0;
  isolation tradesperson (by display_name AND by `t8-isolation-%` email): **0 left**.
- Pre-existing fixture untouched: `rl_organizations` 1, `rl_organization_members` 1,
  `rl_tradespeople` 4 — all 4 accounts (T2T3 Verify, Fragile Frog FF, T6 Verify Two,
  Email Twin) date from 2026-09-18, pre-dating this session; none are mine, none in
  the org beyond the original OWNER.
- Re-ran steps a–e after cleanup: back to all-zero baseline (9/9 PASS), exit 0.
- Scratch harness (`scripts/scratch-t8-live.mjs`, `scratch-t8-verify.mjs`, state file)
  **removed** — `apps/api/scripts/` contains only the repo's own 3 scripts.

## Deviations / notes

1. **Live matrix ran against a server booted before my one whitespace-only fix.**
   An initial edit mis-indented the outcomes template literal (12 vs 11 spaces inside
   the SQL string — semantically identical SQL). I restarted the server afterwards
   and **re-ran the entire matrix** (baseline → seed → assert → cleanup → baseline)
   on the byte-exact final file: all green again. The matrix above is the final run.
2. **Server boot was slow the second time** (~20–30 s vs ~10 s first boot; tsx cold
   start, empty log until up). Health-checked before every matrix step; the running
   instance (PID 2684) stays up, logs at `/tmp/ts-api.log` — left running like
   T2-T3/T7 did.
3. `render.yaml` shows as modified in `git status` — **pre-existing, not mine**
   (untouched this session; only `apps/api/src/services/dashboard-service.ts` was
   edited, +17/−8).
4. No commit made (controller handles git per repo convention).
5. Optional unit test skipped deliberately (pattern of conversation-domain.test.ts
   is mock-based; the membership scoping SQL is fully exercised by the live matrix).

## For Sentinel / Probe

- Sentinel: the membership subquery is the new org-boundary for all conversation-
  state aggregates — confirm no other service reads states org-wide without it
  (grep found states read only in dashboard-service.ts; `conversation-service.ts`
  writes keyed by phone/user_id).
- Probe: seed a state row whose phone matches an org customer but whose user_id is
  a NON-member (or vice versa) — assert it still shows in inbox `st` (phone-bridge)
  but is excluded from aggregates (membership) — the two gates are intentional and
  orthogonal. Also re-verify `dropped` semantics once a closed conversation exists
  with a completed state for its phone (currently no closed conversations in DB).