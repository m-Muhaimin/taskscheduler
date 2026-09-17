# Step 9 Escalations UI — Implementation Report

Status: **COMPLETE** (implemented in-session; subagent fleet down — credits exhausted)
Date: 2026-09-18
Brief: `docs/tasks/step9-escalations-ui.md`

## Summary

Finished the in-flight Step 9 escalation surface on top of the committed dashboard
(16de637). All work confined to `apps/web` (UI-only per brief). The pre-existing
escalations page had dead code (`showEmpty` always true, `escalations` state never
populated); it was rebuilt against the fixture store end-to-end.

## R1–R5 status

### R1 — Escalations page renders real data ✅
`apps/web/src/app/dashboard/escalations/page.tsx` fully rewritten:
- Loading: Skeleton rows (via `loadState !== "ready"` from `useDashboardData`)
- Error: destructive Alert + Retry (refetches) — reachable via `?state=error`
- Empty: "No pending escalations" with icon, only when list is empty
- List: `escalation-card` per item; "Requires attention" heading + `N pending` chip
  (chip hidden when 0)
- Resolve: confirm Dialog → `resolveEscalation(id)` → `toast.success("Escalation resolved")`
- No dead code; `cn` no longer imported

### R2 — Fixture escalations ✅
`apps/web/src/lib/fixtures.ts`:
- `Escalation` type imported from `@tradescheduler/shared` (build verified)
- `DashboardState.escalations: Escalation[]`
- `createInitialState` seeds 3: ambiguous_intent (pending, content "can we do it
  later in the week maybe after 4? not sure"), no_availability (pending),
  sms_delivery_failure (resolved, `resolvedAt` set) — all timestamps relative to `now`
- `resolveEscalation(id)` flips status → resolved + `resolvedAt`, publishes via
  existing store publish pattern
`apps/web/src/lib/use-dashboard-data.ts`: exposes `escalations` + `resolveEscalation`
(SSR snapshot includes `escalations: []` to keep skeleton-first SSR).

### R3 — Reschedule history rendered once per surface ✅
- `job-detail-body.tsx` (used by both the mobile sheet and the route page) now renders
  `<RescheduleHistory booking={booking} />`; inline duplicate block + inline label map
  removed
- `reschedule-history.tsx` kept as the single component + single
  `RESCHEDULE_ACTION_LABEL` definition (grep: 1 definition, 1 file)
- `apps/web/src/app/dashboard/jobs/[jobId]/page.tsx`: removed the duplicated
  `<RescheduleHistory />` block and unused `RescheduleHistory`/`cn` imports; stale
  doc-comment cleaned
- `reschedule-log-list.tsx` retained as the row renderer

### R4 — Escalations reachable from navigation ✅
- `app-sidebar.tsx`: Escalations navItem (TriangleAlertIcon, after Week, before
  Settings) + pending-count urgent badge (`bg-urgent text-urgent-foreground`, hidden
  when 0 or sidebar collapsed)
- `site-header.tsx`: `titleFor("/dashboard/escalations")` → "Escalations"
- `apps/web/src/app/dashboard/page.tsx` (Today): needs-attention banner tied to
  existing `pendingCount` — "N unconfirmed replies need you", urgent-soft styling,
  ChevronRightIcon, Links to `/dashboard/escalations`, shown only when
  `loadState === "ready" && pendingCount > 0`

### R5 — Hygiene ✅
- No unused imports remained (build/tsc clean)
- No new dependencies; no `globals.css` token changes; no new UI primitives
  (used existing Button/Card/Dialog/Badge/Alert/Skeleton/Separator)

## Critical fix found during verification: CSS not linked

`apps/web/src/app/layout.tsx` never imported `./globals.css` — the app rendered
**unstyled since the first dashboard commit (16de637)**. Ledger curl checks only
asserted status 200 + text markers, which pass without CSS, so this shipped
undetected. Fix: added `import "./globals.css"` to the root layout.

## Verification (all green)

1. `npm run build --workspace=apps/web` → exit 0; routes: /, /_not-found, /dashboard,
   /dashboard/escalations, /dashboard/jobs/[jobId], /dashboard/settings, /dashboard/week
2. Prod server on :3100 — all routes 200: /dashboard, /dashboard/escalations,
   /dashboard/escalations?state=loading, /dashboard/escalations?state=error,
   /dashboard/week, /dashboard/jobs/bk-today-001, /dashboard/settings
3. Server log clean (no hydration/compile errors during SSRs)
4. SSR markers: escalations + today pages render skeleton (`aria-busy`); log clean
5. CSS: `<link rel="stylesheet" href="/_next/static/css/32cf723b9d10b0e7.css"
   data-precedence="next"/>` present on every dashboard page; stylesheet ~95 KB and
   contains the Solo Sam tokens (`--background/--primary/--urgent: oklch(...)`),
   plus utilities (.bg-urgent, .rounded-xl, .text-muted-foreground, .h-16)
6. grep: `RESCHEDULE_ACTION_LABEL` defined once (reschedule-history.tsx);
   `RescheduleHistory` rendered once per surface

## Deviations / notes

- Subagent gate (task-reviewer) could not run: OpenRouter credits exhausted
  (402 / [openrouter] credits). Diff is small and was reviewed in-session; recommend
  a reviewer pass once the fleet is back before merge.
- `?state=` toggles verified at HTTP level; full hydration interaction
  (dialog confirm flow) pending browser-level validation (vision) once available.
- `docs/tasks/step9-escalations-ui.md` (brief) tracked as untracked — include in UI commit.

## Files changed
M apps/web/src/app/layout.tsx            (CSS fix — also applies to committed shell)
M apps/web/src/app/dashboard/jobs/[jobId]/page.tsx
M apps/web/src/app/dashboard/page.tsx
M apps/web/src/components/app-sidebar.tsx
M apps/web/src/components/job-detail-body.tsx
M apps/web/src/components/site-header.tsx
M apps/web/src/lib/fixtures.ts
M apps/web/src/lib/use-dashboard-data.ts
A apps/web/src/app/dashboard/escalations/page.tsx
A apps/web/src/components/escalation-card.tsx
A apps/web/src/components/reschedule-history.tsx
A apps/web/src/components/reschedule-log-list.tsx
A docs/tasks/step9-escalations-ui.md
A docs/tasks/step9-escalations-ui-report.md
