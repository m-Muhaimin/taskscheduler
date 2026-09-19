# T5 — Wire the adopted UI to the real dashboard API + richer analytics UI

Context: T4 merged the new dashboard UI into `H:\tradescheduling\apps\web` (fixture-driven, green build).
T2/T3 built the real API: six org-scoped routes under /api/dashboard/* returning the DTOs in
T1 (@tradescheduler/shared "Dashboard DTO v2" section). T5 replaces fixture data with real
fetches page by page, and adds the richer-analytics chart UI the user approved.

## State verified before this brief (T4 landed)
- lib/: auth.ts (REAL — has authedFetch(path, init) that attaches the Bearer from the ts_session cookie), session.tsx, session-core.ts, hooks.ts, validation.ts, types.ts (fixture types, id:number — change to string), fixtures.ts (still used by marketing results-band — keep the file)
- app/dashboard/{page,inbox,schedule,jobs,customers,analytics}/page.tsx all import fixtures
- apps/web/package.json scripts: dev/build/start — the `test` script (tsx tests/session-core.test.mts) is MISSING (T4 overwrote it — RESTORE it + ensure tsx devDep exists)

## 1) Restore the test script
apps/web/package.json: add back `"test": "tsx tests/session-core.test.mts"` and confirm `tsx` is in devDependencies (add at ^4.x matching apps/api's version if missing). Verify: npm run test --workspace=apps/web passes.

## 2) lib/types.ts: id number -> string
Mechanical change (React keys/array ops work with strings). Do NOT change other display fields.

## 3) Data layer (NEW lib/dashboard-api.ts)
Typed fetch helpers over authedFetch (lib/auth.ts) calling RELATIVE /api/dashboard/* paths (proxied by next.config.mjs to the API):
- getSummary(), getInboxItems(), getWeekSchedule(weekStart?, weekEnd?), getJobs(), getCustomers(), getAnalytics()
- Each returns the T1 DTO (import type { ... } from '@tradescheduler/shared').
- On 401: client-side redirect to /login (window.location or router). On 403 no_organization: return a sentinel the pages render as an empty/onboarding state (e.g. an "no data yet" card). On 5xx: throw; pages show an error state via the existing Loadable/empty patterns.
- Keep it thin — no caching/retry for now (one fetch per page mount).

## 4) Page wiring (replace fixture imports)
- dashboard/page.tsx (Overview): getSummary() -> 5 MetricCard metrics (already typed MetricGridItem-compatible: map id/label/value/prefix/suffix/tone/trend/chartData/href straight through), inbox compact (top 4), today timeline (AppointmentDto -> Appointment), revenueRecovery band. Greeting: confirm the user's displayName comes from useSession (greeting.tsx) — if T4 left it hardcoded, fix it.
- inbox/page.tsx: getInboxItems() -> items (existing AiInboxList/InboxRow unchanged; the Approve/Send-reply buttons stay client-local for now — documented deferral, note in report).
- schedule/page.tsx + components/dashboard/schedule-view.tsx: schedule-view currently has HARDCODED WEEK_DATA + fixed mock TODAY + offset navigation. Refactor: accept a data prop or fetch inside; keep the week-offset nav + "Today" reset; label came from the API days; the mock TODAY should become the REAL today (org-tz aware: use the API's weekStart default or browser local date as fallback). GET /api/dashboard/schedule?weekStart&weekEnd computed from the (offset) Monday.
- jobs/page.tsx: getJobs() -> JobsTable.
- customers/page.tsx: getCustomers() -> CustomersList.
- analytics/page.tsx: getAnalytics() -> render ALL of: demandByHour (DemandByHourChart), outcomes (ConversationOutcomesChart), AND the six NEW metrics in matching design language:
  · revenueByDay — 30d revenue line/bars card ("Revenue (30d)", $ format, Sparkline or bars)
  · bookingsByDay — 30d bookings bars card
  · aiBookingRateByDay — 30d % line card
  · aiCostByDay — 30d $ cost card (label "AI cost (30d)")
  · topServices — simple ranked list card ("Top services" — service + count)
  · technicianLoad — ranked list card ("Technician load" — name + count)
  Build these as new small components under components/dashboard/ (e.g. analytics-series-card.tsx + analytics-list-card.tsx) reusing card/Skeleton/CountUp/Sparkline primitives, matching the existing card style (className "card p-5", font-mono values, 11-12.5px labels, accent/success/danger tokens). Keep the aria/alt labels and the entrance animation conventions (metric-card-rise / bar-grow).

## 5) Empty/zero states
- Dashboard empty-org state: when the summary/inbox/jobs/customers responses are zero-shaped, show a friendly empty card (design-consistent, e.g. muted text "No data yet — the AI starts booking here" style), NOT a crash or blank. AiInboxList already has its empty state. Jobs/customers need a minimal one (check their table components; add if missing).
- Error state: on fetch failure show a compact error card with retry (re-fetch on click). Keep it small.

## 6) Verification (ALL)
1. npm run test --workspace=apps/web (restored session-core test)
2. npm run build --workspace=apps/web
3. Dev: API must be running on :3001 (curl http://localhost:3001/api/health; if down: cd /h/tradescheduling/apps/api && nohup npx tsx src/index.ts > /tmp/ts-api.log 2>&1 &). Web dev on :3000 (npm run dev -w apps/web background, log /tmp/ts-web.log).
4. With the throwaway account (real values in docs/tasks/v2/reports/T2-T3-dashboard-api.md "Test data" — read the file for the actual email/password): login -> dashboard (zero-shaped data + empty states render, greeting = displayName), every subpage renders with real 200s from the API, analytics shows all 8 cards/charts with zero/empty series, 401 path: clear cookies -> /dashboard bounces to /login (middleware), schedule week-nav fetches the right week.
5. Console free of errors on each page.
Fix anything found.

## Rules
- Do not touch next.config.mjs, middleware.ts, lib/auth.ts, session files, tests/, or the marketing landing (components/marketing/*).
- Keep fixtures.ts on disk (results-band still uses it) — just stop dashboard pages importing it.
- No schema changes, no new API routes (out of scope; follow-ups listed in report instead if needed).

## Report
Restored-script confirmation, per-page wiring summary, the new analytics components (names/files), empty/error-state approach, verification results with exact commands + curl statuses, any fetch-shape mismatches found vs T1 DTOs (and what you did), dev-server ports/PIDs after tests, deviations, follow-ups (e.g. approve/send API).

## Windows notes
- npm may ignore the bash workdir — cd /h/tradescheduling first, verify pwd if odd.
- Start dev servers in SEPARATE bash invocations (background, logs to /tmp/*.log) so no session blocks.
- The API config loads from repo-root H:\tradescheduling\.env (not apps/api/.env).
