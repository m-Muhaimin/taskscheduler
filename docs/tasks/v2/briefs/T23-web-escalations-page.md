# T23 — Web: Escalations page

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; T20 replaced the mock with a DB-backed read — this task surfaces it as `/dashboard/escalations` so real escalations (incl. T16 staff SMS) are triageable in the UI.

## Goal
New primary-nav page at `/dashboard/escalations` showing the org's escalations (pending first, from the API's sort) as a filterable list with status pill, type chip, phone, content, and absolute local-time display — reusing existing page/loading/error/empty patterns.

## Deliverables

### 1. `apps/web/lib/types.ts` (EDIT — add at end)
```ts
export interface EscalationItem {
  id: string;
  type: string;
  typeLabel: string;
  customerPhone: string;
  content: string | null;
  status: "pending" | "resolved";
  createdAt: string;
  createdAtDisplay: string;
  resolvedAt: string | null;
  resolvedAtDisplay: string | null;
}
```

### 2. `apps/web/lib/dashboard-api.ts` (EDIT)
- Import `EscalationListResponse` type from `@tradescheduler/shared` (extend the existing type import block).
- Add after `getCustomers`:
```ts
export function getEscalations(): Promise<EscalationListResponse | NoOrganization | typeof SESSION_EXPIRED> {
  return request<EscalationListResponse>("/api/dashboard/escalations");
}
```

### 3. `apps/web/components/dashboard/escalations-list.tsx` (NEW)
Server-component-free; copy the structure of `customers-list.tsx`/`jobs-table.tsx` patterns:
- `"use client"`. Props: `{ escalations: EscalationItem[] }`.
- Local `type StatusFilter = "all" | EscalationItem["status"]`; `const [status, setStatus] = useState<StatusFilter>("all")`.
- `FilterChips` options (jobs-table pattern): `[{ value: "all", label: "All", count: escalations.length }, { value: "pending", label: "Pending", count: … }, { value: "resolved", label: "Resolved", count: … }]`, `label="Filter escalations by status"`.
- Filter rows client-side: `status === "all" ? escalations : escalations.filter((e) => e.status === status)`.
- Row markup (inside `card overflow-hidden divided`, rows like customers-list `metric-card-rise`):
  - Status pill: `Chip tone={e.status === "pending" ? "danger" : "success"} live={e.status === "pending"}>{e.status === "pending" ? "Pending" : "Resolved"}</Chip>` (import `Chip` from `@/components/ui/chip`).
  - Type chip: `Chip tone="muted">{e.typeLabel}</Chip>`.
  - Phone: `text-[12px] text-ink-muted font-mono`.
  - Content: truncated `text-[13px]` line (keep 1–2 lines, allow `line-clamp-2` via Tailwind arbitrary: `[display:-webkit-box]` — simplest: truncate single line with `truncate` on a max-width container).
  - Time: `text-[11px] text-ink-faint` showing `e.createdAtDisplay` (and `resolvedAtDisplay` when present, prefixed "resolved ").
- Header row with count text: `{filtered.length} of {escalations.length} escalations` (aria-live, customers-list style).
- Empty filtered state (jobs-table style): `No escalations with this status.`

### 4. `apps/web/app/dashboard/escalations/page.tsx` (NEW — copy `customers/page.tsx` shape)
```tsx
"use client";
import { EscalationsList } from "@/components/dashboard/escalations-list";
import { CustomersSkeleton } from "@/components/dashboard/skeletons";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/dashboard/error-state";
import { EmptyState } from "@/components/dashboard/empty-state";
import { getEscalations, useDashboardData } from "@/lib/dashboard-api";

export default function EscalationsPage() {
  const { state, retry } = useDashboardData(() => getEscalations());
  return (
    <div>
      <PageHeader title="Escalations" description="Issues the AI couldn't resolve on its own — triage and fix them here." />
      {state.status === "loading" && <CustomersSkeleton rows={6} />}
      {state.status === "error" && <ErrorState message={state.message} onRetry={retry} label="escalations" />}
      {state.status === "empty" && (
        <EmptyState title="No escalations" description="When the AI can't resolve something — an unbookable request, a calendar failure, a staff text — it lands here for you." />
      )}
      {state.status === "ready" &&
        (state.data.escalations.length === 0 ? (
          <EmptyState title="No escalations" description="When the AI can't resolve something — an unbookable request, a calendar failure, a staff text — it lands here for you." />
        ) : (
          <EscalationsList escalations={state.data.escalations} />
        ))}
    </div>
  );
}
```

### 5. `apps/web/components/dashboard/nav-rail.tsx` (EDIT)
- Import `AlertTriangle` from `lucide-react`.
- Add to `NAV_ITEMS` after Customers: `{ href: "/dashboard/escalations", label: "Escalations", icon: AlertTriangle }`.

## Hard rules
- No shadcn — reuse `Chip`, `FilterChips`, `PageHeader`, `CustomersSkeleton`, `ErrorState`, `EmptyState` only.
- Read-only UI: no resolve button, no optimistic action (plan Decision 1 — resolve is deferred).
- The page renders page-1 data from the API (no client pagination fetch; counts from the rows present — the API's `total` is not sent to the list component).
- No new skeleton components.
- No `npm install`. No commit/push.

## Verify
`npm run build --workspace=apps/web` (Next 14 build type-checks this page + types). Optionally boot `npm run dev --workspace=apps/web -p 3100` and open `/dashboard/escalations` to confirm nav item, loading skeleton, list rendering against the API. Report to `docs/tasks/v2/reports/T23-web-escalations-page.md` (what shipped, build result, visual check notes).