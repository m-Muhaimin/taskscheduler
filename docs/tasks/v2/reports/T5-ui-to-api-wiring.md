# T5 Report — UI-to-API Wiring (dashboard)

Status: **complete**
Date: 2026-09-19
Scope: `apps/web` (T5-ui-to-api-wiring brief)

## What was wired

All six dashboard pages now fetch from the real API (`http://localhost:3001/api/dashboard/*`) via a new client-side data layer:

- **`apps/web/lib/dashboard-api.ts`** (new) — `_apiFetch` wrapper with `DashboardApiError` (`.status`), sentinels `NO_ORGANIZATION` (403 `no_organization`) and `SESSION_EXPIRED` (401 → clears `ts_session` cookie + redirects to `/login`), typed helpers `getSummary() / getInboxItems() / getWeekSchedule(weekStart?, weekEnd?) / getJobs() / getCustomers() / getAnalytics()`, and the `useDashboardData(loader, deps)` hook returning `{status: "loading"|"empty"|"ready"|"error", message, retry}` (refetches on deps change; retry re-runs the loader; `SESSION_EXPIRED` results are ignored — navigation handles it).
- **`app/dashboard/page.tsx`** (Overview) — `getSummary()` → `MetricGrid` (API metric DTOs are already `MetricGridItem`-compatible), compact `AiInboxList`, `TodayTimeline`, `RevenueRecoveryBand`. Skeleton bundle overlays every loading state.
- **`app/dashboard/inbox/page.tsx`** — `getInboxItems()` → `AiInboxList` with `showFilters`.
- **`app/dashboard/schedule/page.tsx`** → **`components/dashboard/schedule-view.tsx`** (rewritten) — real fetch with week prev/next nav + "Today" reset. Offset 0 requests **no params** (API uses org-tz current week); other offsets send `weekStart`/`weekEnd` computed from browser-local Monday ± 7n. Day headers/range derived from API `days[].date`; today marker = browser-local day-of-week at offset 0, disabled for other weeks (brief-sanctioned fallback).
- **`app/dashboard/jobs/page.tsx`** — `getJobs()` → `JobsTable`; empty card when `jobs.length === 0`.
- **`app/dashboard/customers/page.tsx`** — `getCustomers()` → `CustomersList`; empty card when `customers.length === 0`.
- **`app/dashboard/analytics/page.tsx`** — `getAnalytics()` → existing `DemandByHourChart` + `ConversationOutcomesChart` plus the four new series cards and two ranked lists.

New components:
- `components/dashboard/analytics-series-card.tsx` — Revenue (30d, $ sum, sparkline), Bookings (30d, bar), AI booking rate (30d, % mean), AI cost (30d, $ sum); `CountUp` headline, `Sparkline`/`bar-grow` body, zero-value dashed "No data yet" panel.
- `components/dashboard/analytics-list-card.tsx` — Top services + Technician load, share-track rows (matches conversation-outcomes styling), per-list empty hints.
- `components/dashboard/empty-state.tsx` (`EmptyState`) and `error-state.tsx` (`ErrorState` — message + retry) used across all pages.
- `skeletons.tsx` — added `AnalyticsSeriesSkeleton`, `AnalyticsListSkeleton`.

Guards/fixes:
- `analytics-charts.tsx` — `DemandByHourChart` zero-guard (all-zero → dashed "No demand recorded yet" instead of NaN bar heights; this was a live 0/0 NaN bug on empty orgs), `ConversationOutcomesChart` empty hint.
- `today-timeline.tsx` — empty-state block when no appointments.
- `greeting.tsx` — real browser-local date (was fixture); name still from `useSession`.
- `lib/types.ts` — `id: number` → `id: string` in `InboxItem/Appointment/JobRow/Customer` (contract check on live DTOs: ids are ULIDs/UUID-like strings).
- `inbox-row.tsx` / `ai-inbox-list.tsx` — `onResolve`/`handleResolve` now `(id: string)`.

## States covered (per page)

loading (skeleton) / error (card + retry) / no-org (403 → `EmptyState`) / empty collection (`EmptyState` or existing component empty state) / ready. 401 → session cleared + redirect to `/login` (data-layer, not per-page).

## Test / build verification

- `npm run test --workspace=apps/web` → **11/11 session-core assertions passed** (test script restored via `tsx` devDep `^4.19.4`, matching `apps/api`).
- `npm run build --workspace=apps/web` → **passes** (15/15 routes compiled, types valid).
  - Preexisting non-fatal: `⚠ Found lockfile missing swc dependencies, patching... ⨯ Failed to patch lockfile` (Next 14.2.35 + root lockfile; occurs on every build on this machine; build completes).
- Live walk via CDP (login with throwaway T2T3 account, `ts_session` cookie set):
  - `/dashboard` — real metrics (`$0`, `0%`, etc.), inbox empty state, timeline empty state, revenue band 0s, real session name + date.
  - `/dashboard/inbox` — filter pills (All 0 / Needs attention 0 / Handled 0) + empty state.
  - `/dashboard/schedule` — API week `Sep 14 – Sep 20`, 7 day columns, "No jobs" cells; next-week nav → `1 week ahead`, `Sep 21 – Sep 27`; Today → back to org week; no error.
  - `/dashboard/jobs`, `/dashboard/customers` — empty cards (real `{jobs:[],customers:[]}`).
  - `/dashboard/analytics` — all 8 cards render, `NaN` absent (zero-guard proven), no console errors on fresh reload.

## Deviation (flagged)

- **`lib/fixtures.ts` was touched**: id literals `1..6` → `"1".."6"` in `inboxItems / todayAppointments / jobs / customers` only. Required — the brief-mandated `id: string` type change made the fixture arrays fail typecheck. Verified the only marketing consumer is `results-band.tsx`, which imports `revenueRecovery` (no `id` field) — no marketing-visible behavior changes. All other fixture exports untouched.
- Dev servers were restarted during verification (`next build` corrupts the shared `.next` of a running `next dev`, and the root `npm install` churned the API out of sync). Now running: web `:3000`, api `:3001` — logs at `%LOCALAPPDATA%\Temp\opencode\ts-web-dev.log` / `ts-api-dev.log`. API health: `GET /api/health` → `{"status":"ok"}` (note: route is `/api/health`, not `/health` as an earlier note recorded).

## Concerns / follow-ups

- `analytics` page relies on API zero-shapes for empty orgs (verified: yes). If the API ever omits keys for a fresh org, `values()` would throw — cheap to harden later if the contract changes.
- Jobs/Customers pages render the same empty card for both the API-level "no org" (403) and a valid org with zero rows; copy identical, states distinct in code.
- The "AI front desk on TV" + "Possible emergency / Take over" block on dashboard pages is pre-existing layout content (not fixtures/US data from this wiring) — flagging so Vision knows it's not a data residue.
- No commits made (controller handles git).