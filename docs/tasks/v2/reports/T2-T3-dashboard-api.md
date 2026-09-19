# T2+T3 — Dashboard data layer + six real API routes — Report

Date: 2026-09-19 · Agent: wired (backend/API) · Brief: `docs/tasks/v2/briefs/T2-T3-dashboard-api.md`

## What was built

- **`apps/api/src/services/dashboard-service.ts`** (new, ~920 lines): org-scoped query layer for all dashboard reads — `getSummary`, `getInboxItems`, `getWeekSchedule`, `getJobs`, `getCustomers`, `getAnalytics`, plus `getOrgNow(tz)` (today + Monday). Lazy singleton Pool (`DATABASE_URL` read on first use; `ssl: { rejectUnauthorized: false }`), table helpers with env override + `rl_` default, tz always parameterized, day bucketing via `(ts AT TIME ZONE $tz)::date`.
- **`apps/api/src/services/organization-service.ts`** (+31): `OrgContext` + `getOrgContextByUserId(userId)` → `{ organizationId, timezone }` via members→orgs join (status='active', tz fallback `America/New_York`).
- **Six new routes** under `apps/api/src/routes/dashboard/` (`summary.ts`, `inbox.ts`, `schedule.ts`, `jobs.ts`, `customers.ts`, `analytics.ts`), all `requireAuth` → org ctx (`403 no_organization`) → service → 200; `400 invalid_query` (schedule validation only); `500 server_error`. Mounted in `dashboard/index.ts`.
- **Refactor**: `escalations.ts` and `bookings/[bookingId]/reschedule-history.ts` — inline `authorize` removed, shared `requireAuth` from `middleware/auth.js`.

## Verification (all done)

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run typecheck --workspace=@tradescheduler/api` | clean |
| 2 | `npm run test --workspace=@tradescheduler/api` | **287 passed / 287** (16 files) |
| 3 | env | brief says `apps/api/.env` — **actual: repo-root `H:\tradescheduling\.env`** (`src/env.ts` loads `../../../.env` from `src/`) |
| 4 | live counts (scratch pg script, pooler, `ssl rejectUnauthorized false`) | **orgs=0, members=0, tradespeople=0** at start; after seed: 1/1/1 (see Test data) |
| 5 | boot `tsx src/index.ts` + hit routes with real Bearer token | see per-route table |
| 6 | fix 500s | found + fixed 2 (see Bugs) |

### Live counts (pre-seed, answers "does the dashboard show data")
`rl_organizations=0, rl_organization_members=0, rl_tradespeople=0` — the **fresh DB is completely empty** (project replaced 2026-09-19). All `rl_*` tables exist and are empty.

### Per-route status + sample body (Bearer token of throwaway; org seeded)

| Route | Status | Sample body (abridged) |
|---|---|---|
| `GET /api/dashboard/summary` | 200 | `{"metrics":[{"id":"appointments-today","label":"Appointments today","value":0,"trend":{"deltaLabel":"—","direction":"flat","good":true},"chartData":[0,0,0,0,0,0,0]}, …5 cards],"inbox":[],"today":[],"revenueRecovery":{"missedCalls":0,"recovered":0,"booked":0,"estimatedRevenue":0,"sparkline":[…30 zeros…]}}` |
| `GET /api/dashboard/inbox` | 200 | `{"items":[]}` |
| `GET /api/dashboard/schedule` | 200 | `{"weekStart":"2026-09-14","weekEnd":"2026-09-21","days":[{"date":"2026-09-14","items":[]}, …7 days]}` (org-tz Monday default) |
| `GET /api/dashboard/jobs` | 200 | `{"jobs":[]}` |
| `GET /api/dashboard/customers` | 200 | `{"customers":[]}` |
| `GET /api/dashboard/analytics` | 200 | `{"demandByHour":[0×24],"outcomes":[],"revenueByDay":[{"date":"2026-08-21","value":0}, …30 days],"bookingsByDay":[…],"aiBookingRateByDay":[…],"aiCostByDay":[…],"topServices":[],"technicianLoad":[]}` |
| `GET /api/dashboard/escalations` (refactored) | 200 | fixtures with valid token (member of any org no longer required) |
| `GET /api/dashboard/bookings/apt-1/reschedule-history` (refactored) | 200 | `{"bookingId":"apt-1","rescheduleLog":[]}` |
| all six, garbage token | 401 | `{"error":"invalid_token"}` (middleware) |
| all six, valid token, **no org** (pre-seed) | 403 | `{"error":"no_organization"}` |
| schedule edge cases | 400 | reversed range, 9-week range, `2026-02-30`, `abc` → `{"error":"invalid_query"}`; one-sided param falls back to org-tz week defaults (documented decision) |

Empty org → zero-shaped 200s confirmed (not 500s).

## Bugs found & fixed (step 6)

1. **`avgDeposit` in getSummary**: stray `group by 1` on an aggregate-only select → Postgres error → summary 500. Removed.
2. **Parameter-arity mismatches** (Postgres rejects extra binds; surfaced only on live DB, not unit tests): `getSummary` booking-rate query passed `[orgId, tz]` to a `$1`-only statement (`rateTotal`); `getInboxItems` passed `[orgId, tz, limit]` to a `$1/$2` statement. Fixed; audited all 31 `q()` calls (rest correct).
3. **Schedule route**: zod regex accepted non-calendar dates (`2026-02-30` normalizes in V8; would 500 on Postgres cast) → added calendar-date round-trip refinement → 400 `invalid_query`.

## Test data created (for cleanup — NOT migrations, no DDL)

- Throwaway tradesperson: `id=6e2a135e-7eb3-4221-afd7-ce703e850b0e` · email `t2t3-verify.20260919@example.com` · password `Verify-Pw-2026!` (created via `POST /api/auth/register`; the only account)
- Test org: `id=a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007` · name `T2T3 Verify Org (test data)` · slug `t2t3-verify-org` · tz `America/New_York`
- Membership: `id=190af2d1-97d5-47b9-8db5-c25bee631b51` · role `OWNER`

Cleanup SQL (kept intentionally NOT executed — the empty org may be wanted for T4+ UI development):
```sql
delete from rl_organization_members where id = '<member id>';
delete from rl_organizations where id = '<org id>';
delete from rl_tradespeople where id = '<tradesperson id>';
```
Or leave: dashboard routes demonstrably work with an empty org.

## Deviations from the brief

1. **`.env` location**: brief §4.3 says `apps/api/.env`; the file lives at the **repo root** (`H:\tradescheduling\.env`). `src/env.ts` already loads it — no change made.
2. **No seeded creds existed** (empty DB) → registered a throwaway (see Test data) instead of logging in; seeded ONE org + OWNER membership (inserts only, no new tables/migrations) to exercise the zero-shaped 200 path the brief requires.
3. **One-sided `weekStart`/`weekEnd`**: if exactly one is supplied, both fall back to the org-tz current-week defaults (200). Stricter "both or neither" would be a one-line change; flagged not implemented.
4. **Dev server**: port 3001 was already occupied by a leftover `api-keepalive.cjs` + `tsx watch` stack (stale). Killed it; final verification ran on a clean `tsx src/index.ts` instance (still running, logs to `/tmp/ts-api.log`).
5. Test suite flake: `vitest` 5s per-test timeout blows up on a **cold first run** (3 worker-test failures once; green on isolation and every warm run). Pre-existing, not caused by this change.

## Schema-forced semantic choices (per brief's report request)

- **Job status map**: `rl_appointments.status` only allows `pending|confirmed|rescheduled` — no completed/in-progress. `JOB_STATUS_MAP` = confirmed→`Scheduled`, pending→`Needs dispatch`, rescheduled→`Scheduled`. `'Completed'/'In progress'` are future states and are NOT invented.
- **`aiCostByDay` is a GLOBAL series**: `rl_ai_usage` has no org column. Noted in code + the shared type comment.
- **Escalations have no org column**: attributed to an org only via `customer_phone` joining org customers (never global).
- **`rl_conversation_states` links by `phone`, not `conversation_id`** (the D3 column is nullable and empty) — booking-rate/inbox-state joins bridge through `customers.phone`... actually the code joins `conversation_states.conversation_id → conversations.id` where the column exists but is NULL for all rows → zero-state data at present. For correctness with real data, the state→conversation attribution would need `customers.phone` bridging (`s.phone = cu.phone where cu.id = c.customer_id`); **flagged for Sentinel/Architect** — current join yields empty results even when states exist.
- **AI booking rate** = completed/total conversation-states (org), pct rounded.
- **Schedule `days` = exactly 7** regardless of the allowed ≤8-week query window (brief-mandated).

## For Sentinel / Probe

- Audit: parameter arity in `dashboard-service.ts` (all 31 `q()` calls currently match; a unit test that counts `$N` vs args length would have caught both bugs).
- Probe: seed appointments/customers/conversations/states and re-verify urgent-flag merge (`queryTodayAppointments` escalation/esc-conversation phone logic) and the inbox state-suggestion fallback (outbound body → offered slots → escalation reason) — both untestable with an empty DB.
- Server on `:3001` is the plain-tsx instance started during verification (PID 28856, no auto-reload); controller may want to restore the keepalive/watch convention.

## Commits
None — controller handles git (per brief). Working tree: 5 modified (types.ts is T1's), 7 untracked files (6 routes + dashboard-service.ts); all scratch scripts removed from `apps/api/scripts/`.