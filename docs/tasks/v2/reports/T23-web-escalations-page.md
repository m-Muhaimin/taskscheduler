# T23 — Web: Escalations page (report)

## Status
DONE (implemented in working tree; nothing committed — controller commits after review).

## What shipped

`/dashboard/escalations` is a new primary-nav page that surfaces the T20
DB-backed read as a filterable, read-only triage list — pending first (the
API's sort), with status pill, type chip, phone, truncated content, and
absolute org-timezone display. Read-only per plan Decision 1: no resolve
button, no optimistic action, no mutation helper added.

### 1. `apps/web/lib/types.ts` (EDIT, +13)
- `EscalationItem` interface appended verbatim from the brief (id, type,
  typeLabel, customerPhone, content, status, createdAt, createdAtDisplay,
  resolvedAt, resolvedAtDisplay). Structurally identical to the shared
  `EscalationDto`, so API rows pass through without mapping.

### 2. `apps/web/lib/dashboard-api.ts` (EDIT, +5)
- `EscalationListResponse` added to the existing `@tradescheduler/shared`
  type-import block (alphabetical: after `DashboardSummaryResponse`, before
  `InboxActionResponse`).
- `getEscalations()` added immediately after `getCustomers()`, exact signature
  from the brief (`request<EscalationListResponse>("/api/dashboard/escalations")`
  → `Promise<EscalationListResponse | NoOrganization | typeof SESSION_EXPIRED>`).
  Inherits the shared 401/403/5xx contract: 401 clears the cookie and redirects
  to /login; `no_organization` → /onboarding/workspace; 5xx → the page's
  compact error card with retry.

### 3. `apps/web/components/dashboard/escalations-list.tsx` (NEW)
Client component cloned from the customers-list/jobs-table patterns:
- `type StatusFilter = "all" | EscalationItem["status"]`; `useState("all")`.
- `FilterChips` (jobs-table style) — All / Pending / Resolved with live counts
  derived from the rows present (the API's `total` is intentionally not sent
  to the list, per brief); `label="Filter escalations by status"`.
- Header row (customers-list style, `aria-live="polite"`):
  `{filtered.length} of {escalations.length} escalations`.
- Rows in `card overflow-hidden divided`, `metric-card-rise` hover row with
  staggered `animationDelay` (mirrors customers-list):
  - Status pill `Chip tone={pending ? "danger" : "success"} live={pending}`
    ("Pending" / "Resolved").
  - `Chip tone="muted"` type label (e.g. "Staff message" — server formatted
    `typeLabel`, no client-side label map).
  - Phone `text-[12px] text-ink-muted font-mono`.
  - Content `text-[13px] truncate` on a `max-w-[56ch]` container with a
    `title` attribute so truncated text stays accessible on hover.
  - Time column `text-[11px] text-ink-faint`: `createdAtDisplay`, plus
    `resolved {resolvedAtDisplay}` when present.
- Empty filtered state (jobs-table style): `No escalations with this status.`
- Null `content` renders no content line (no empty whitespace row).

### 4. `apps/web/app/dashboard/escalations/page.tsx` (NEW — customers/page.tsx shape)
Verbatim from the brief: `PageHeader title="Escalations"` with the triage
description, `CustomersSkeleton rows={6}` on loading, `ErrorState label
"escalations"` on error, `EmptyState` on 403-empty or zero-length rows, then
`EscalationsList escalations={state.data.escalations}` when ready.

### 5. `apps/web/components/dashboard/nav-rail.tsx` (EDIT, +2)
- `AlertTriangle` added to the lucide-react import (between Users and
  BarChart3, mirroring nav order).
- `NAV_ITEMS` entry after Customers:
  `{ href: "/dashboard/escalations", label: "Escalations", icon: AlertTriangle }`.
  Sliding active pill, `aria-current`, and drawer behavior all come free from
  the existing `isActive`/`NavLink` machinery (pathname prefix match handles
  the nested route).

### Hard rules honored
- Shadcn-free: reuses only `Chip`, `FilterChips`, `PageHeader`,
  `CustomersSkeleton`, `ErrorState`, `EmptyState`. No new skeleton
  components.
- Read-only UI — no resolve affordance anywhere (grep: no resolve on the page).
- Page renders page-1 rows; counts come from rows present, `total` unused.
- No `npm install`, no commit.

## Verification

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` (cwd `apps/web`) | PASS (clean; no `typecheck` script exists in apps/web package.json — `tsc --noEmit` is the equivalent) |
| `npm run build --workspace=apps/web` | PASS — `✓ Compiled successfully`, type + lint phase clean, 18/18 static pages generated incl. `○ /dashboard/escalations` (1.55 kB, 102 kB first load). The repeated `⚠ Found lockfile missing swc dependencies … Failed to patch lockfile` warnings are the known cosmetic issue per CLAUDE.md — builds succeed regardless |

No test suite covers this work: apps/web's only tests are the session-core
unit tests (`npm test` → `tsx tests/session-core.test.mts`), which exercise
`lib/session-core.ts` — untouched here — so nothing regression-relevant to run.

## Decisions / deviations
- **Live-browser check skipped (optional per brief):** `/dashboard` is gated by
  the `ts_session` middleware, and rendering a real list needs the API running
  against an org with seeded escalations (T20's DB-backed read). The brief
  marks the dev-boot check optional; build + tsc cover the type/route wiring.
  Recommend a smoke test once a seeded dev DB is up: nav item lands on the
  page, skeleton → list rows with pending red/pulsing chip, `resolved`
  prefix on the time column for resolved rows, chip-filtered re-count.
- **Content line skips when `content` is null** (type is `string | null`) —
  otherwise an empty 13px line would pad every no-content row.
- **Truncated content carries a `title` attribute** so the full escalation
  text is reachable on hover despite single-line truncation.
- **No changes outside the 5 deliverable files.** The other modified/untracked
  paths in `git status` (API route/service/tests, T19–T22 briefs + reports,
  the `ui-extended-backend-surfaces.md` plan) are pre-existing working-tree
  context from earlier tasks — left as-is.

## Visual notes
- Pending → `chip-danger` with the live `pulse-dot` ("something is happening
  right now" — matches Inbox/Jobs live-chip semantics); Resolved →
  `chip-success` static. Type labels use `chip-muted`. This is the exact tone
  treatment the Chip component already formalizes (one implementation across
  inbox rows, jobs, the auth aside) — no new color tokens or tonal states.
- Layout preserves the dashboard's two-column row grammar: flexible left
  column (chips → mono phone → truncated content) + right-aligned fixed
  timestamp column. Narrow screens: right column stays, left truncates via
  `min-w-0`.