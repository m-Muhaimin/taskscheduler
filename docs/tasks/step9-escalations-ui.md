# Task: Step 9 dashboard UI — Escalations list + reschedule history (fix + finish)

## Context (one line)
`apps/web` implements the approved Solo Sam dashboard brief (`docs/design/dashboard-design-brief.md`);
the core screens are committed and green, but the in-flight Step 9 escalation surface
(`apps/web/src/app/dashboard/escalations/`, `escalation-card.tsx`, `reschedule-history.tsx`,
`reschedule-log-list.tsx`, uncommitted) is half-built with defects. UI-ONLY task: touch nothing
under `apps/api` or `packages/shared`.

## Repo facts a fresh session cannot know
- Stack: Next.js 15.5.25 App Router, React 19.3, Tailwind v4.3.3 CSS-first, shadcn/radix-nova.
- Domain types come from `@tradescheduler/shared` (types-only). `Escalation` lives there;
  `DashboardBooking` (status may be 'completed') is web-local in `lib/fixtures.ts`.
- Data layer is a fixture store (`apps/web/src/lib/fixtures.ts`) consumed via
  `useDashboardData()` in `apps/web/src/lib/use-dashboard-data.ts` (useSyncExternalStore;
  SSR snapshot = loading). DEV state toggles `?state=loading|error` and `?empty=1` already work
  through it. Escalations are NOT in the fixture store yet — add them there, not in page state.
- House patterns (follow them, do not invent new ones):
  - Card: `border border-border p-0 shadow-none ring-0` overrides (radix-nova Card base clashes
    with the brief's flat style — see ledger "Nova Card base classes" note).
  - Error: `Alert variant="destructive"` + `AlertAction` > `Button size="sm"` Retry → `retry()`.
  - Loading: skeleton stack `space-y-3 aria-busy="true"`, `Skeleton className="h-24 rounded-xl"`.
  - Urgent badges: `border-urgent/30 bg-urgent-soft text-urgent-soft-foreground`.
  - Masking/formatting: `maskPhone`, `relativeTime`, `dayKey`, `wallClockParts` from `lib/format.ts`.
- Build/verify commands (from repo root H:\tradescheduling):
  - `npm run build --workspace=apps/web` (must exit 0)
  - `node_modules/.bin/tsc` per workspace does NOT exist at root; run per-workspace tsc via
    `cd apps/web && node_modules/.bin/tsc --noEmit` if needed (build already type-checks).
  - Never use `npx tsc` at root (npm stub package).

## Requirements (all must hold)

### R1 — Fix `apps/web/src/app/dashboard/escalations/page.tsx`
Current bugs (verify before fixing, then remove):
- `const showEmpty = loadState === "ready" && (escalations.length === 0 || true);` — the `|| true`
  makes the empty state ALWAYS render (even when escalations exist). Fix to use the real length.
- `useState<Escalation[]>([])` local state is never initialized with data — the list branch
  `escalations.length > 0` is dead code. Replace local page state with fixture-sourced data.
- Loading/error/empty/success states must follow the TodayPage pattern
  (`apps/web/src/app/dashboard/page.tsx`) exactly: skeleton → Alert+Retry → empty → list.
- Empty-state copy: "No pending escalations — everything's under control." (keep; it already reads well).
- Count chip in the page heading: `N pending` — compute from real data; when N=0 show nothing
  (no "0 pending" chip).
- Resolve action: confirm via Dialog before resolving (brief §4.3: destructive/irreversible
  actions always go through a confirm dialog — resolving an escalation is one). Buttons:
  Cancel / Resolve (default variant). Optimistic fixture-store update after confirm + toast
  `sonner` "Escalation resolved" (`toast.success`).

### R2 — Fixture escalations in the store
- Add to `lib/fixtures.ts`: an `escalations: Escalation[]` array in `DashboardState` + store
  mutations `resolveEscalation(id)` (sets status 'resolved', resolvedAt now) — same
  `useSyncExternalStore` publish pattern as `markBookingDone`.
- Seed 3–4 escalations covering at least: one `ambiguous_intent` (pending, with customer
  content text), one `no_availability` (pending), one `sms_delivery_failure` (resolved,
  resolvedAt set). Use plausible content strings, E.164 phones, recent timestamps relative
  to module load. `content` for one entry should be the customer's confusing reply, e.g.
  "can we do it later in the week maybe after 4? not sure".
- Include a `?state=loading|error` compatible path: they already flow through `useDashboardData`;
  make sure escalations come from the same `appState` (no separate fetch path).
- Keep types exact: `Escalation` from `@tradescheduler/shared` (status 'pending' | 'resolved').

### R3 — De-duplicate reschedule history on the job detail route page
- `apps/web/src/app/dashboard/jobs/[jobId]/page.tsx` currently renders JobDetailBody (which
  includes a reschedule history section) AND a separate `RescheduleHistory` block below it —
  history appears twice. Fix by removing the duplicated rendering in ONE place:
  prefer deleting the JobDetailBody inline history block and using the `RescheduleHistory`
  component inside JobDetailBody instead (single source), OR removing the extra block on the
  route page — pick the option with the least duplication, keep both surfaces (sheet + route)
  showing history exactly once.
- Consolidate the duplicated `RESCHEDULE_ACTION_LABEL` maps (`job-detail-body.tsx` +
  `reschedule-history.tsx`) into one shared definition (e.g. export from
  `reschedule-history.tsx` or `lib/format.ts`) — single source of truth.

### R4 — Make Escalations reachable
- Add "Escalations" to `app-sidebar.tsx` navItems (icon: `TriangleAlertIcon` from lucide-react;
  place after Week, before Settings).
- Desktop badge: pending-escalations count badge in the sidebar item (like the bottom-nav
  Today badge pattern: `bg-urgent text-urgent-foreground`); hidden when 0.
- Bottom nav stays 3 tabs (Today/Week/Settings) — do NOT add a 4th tab. Instead: when there are
  pending escalations, show an orange dot indicator on the Settings tab? NO — keep it simple:
  mobile users reach escalations from the Today screen: add a compact "Needs attention"
  banner row on the Today page (below summary strip, above job list) shown only when
  pendingEscalations > 0: `border-urgent/30 bg-urgent-soft text-urgent-soft-foreground`
  rounded-xl px-4 py-3, text "N unconfirmed replies need you" + chevron, as a Link to
  `/dashboard/escalations`. Visible at all breakpoints on Today (harmless on desktop,
  useful on mobile).
- `site-header.tsx` titleFor: add `/dashboard/escalations` → "Escalations".
- `app-sidebar.tsx` isActive: escalations is its own item (pathname.startsWith works as-is).

### R5 — Hygiene
- Remove unused imports (`cn` in escalations page if unused after edit).
- No `console.log`. No new dependencies. Match existing file conventions (semis style in the
  files you touch is mixed; follow the file you are editing, do not restyle others).
- Do not modify `globals.css` tokens; do not add new UI primitives (use existing shadcn set).

## Verification (run all, report results)
1. `npm run build --workspace=apps/web` → exit 0, no type errors.
2. Boot prod server: `npm run start --workspace=apps/web -- --port 3100` (background), curl matrix:
   - `/dashboard` 200
   - `/dashboard/escalations` 200
   - `/dashboard/escalations?state=loading` 200 (renders skeletons)
   - `/dashboard/escalations?state=error` 200 (renders Alert + Retry)
   - kill the server afterwards (record PID; `kill $PID`).
3. Grep check: `reschedule-history` rendered exactly once per detail surface; single
   RESCHEDULE_ACTION_LABEL definition.
4. Confirm `git status` shows changes only under `apps/web` (+ this brief file if you add it
   to the report path dir). Report any files outside apps/web you had to touch (should be none).

## Report
Write `docs/tasks/step9-escalations-ui-report.md`: what changed per file, verification command
outputs (exit codes, route matrix), deviations from this brief with one-line reasons.
