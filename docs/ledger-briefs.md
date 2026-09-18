# Build ledger

Rule (from build-sequence.md): app compiles and runs after EVERY step. One gate per step.

## Step 0 — Project bootstrap ✅ DONE (2026-09-18)

Fits-gate checklist (all pass):

- [x] `npm install` exit 0
- [x] `npm run build --workspaces` exit 0 (api tsc emit, web next build, shared tsc noEmit)
- [x] `curl http://localhost:3001/api/health` → 200 + `{"status":"ok"}`, booted with no `.env`
- [x] web placeholder rendered (200, page contains "tradescheduler")
- [x] git: single commit `chore: initial project scaffold`; working tree clean
- [x] `.env.example` staged; no `.env` / `node_modules` / `.next` / `dist` staged
- [x] TS outcome recorded (below)

Notes:

- `typescript` pinned to 5.9.3 in api/web/shared (7.0.2 failed: Go-native compiler has no stable
  programmatic API — Next 15.5.25 type-checker cannot import `typescript`; same would break vitest tooling).
- `next` bumped 15.3.5 → 15.5.25: 15.3.5 is npm-deprecated with CVE-2025-66478.
- Non-existent pins fixed: `jsonwebtoken` 9.0.10 → 9.0.3, `pg` 8.23.1 → 8.23.0.
- Implemented as `apps/api/src/app.ts` (createApp factory) + `index.ts` (bootstrap) for testability.
- Tsconfig errata: api `extends` corrected to `../../tsconfig.json` (see docs/briefs/README.md).

## Step 1 — Shared types — pending
## Step 2 — Twilio webhook signature — pending
## Steps 3-11 — pending

## Step — Dashboard UI (Solo Sam, design brief) ✅ (2026-09-18)

Brief: `docs/design/dashboard-design-brief.md`. Work confined to `apps/web` (shared/api untouched).

Gate evidence:
- [x] per-workspace `tsc --noEmit` exit 0
- [x] `npm run build --workspace=apps/web` exit 0 (7 routes: /, /dashboard, /dashboard/week, /dashboard/settings, /dashboard/jobs/[jobId], /_not-found)
- [x] booted prod server, curl matrix: / → 307 /dashboard; /dashboard, /dashboard/week, /dashboard/settings, /dashboard/jobs/bk-today-001, /dashboard/jobs/bogus-id, ?state=loading|error, ?empty=1 → all 200
- [x] SSR markers: settings shows Business hours/Timezone/America/New_York; bogus job id renders "Job not found"; /dashboard SSR renders skeletons (aria-busy) + shell (Solo Sam/Today/Week/Settings); server log clean (no prerender/hydration errors)
- [x] git: separate `feat:` (UI) and `docs:` (ledger/briefs) commits; working tree clean after

Notes / learnings:
- React 19 `useSyncExternalStore` REQUIRES `getServerSnapshot` during SSR — missing it fails the build ("Missing getServerSnapshot"). Pattern: server snapshot = loading state (skeletons), client snapshot = fixture store → hydration-safe for client-data pages.
- Nova `SidebarMenuButton` with `tooltip` prop renders a Radix `<Tooltip>` unconditionally → the shell needs `<TooltipProvider delayDuration={0}>` around `<SidebarProvider>` (matches shadcn demo composition); build failed without it on first prerender.
- Nova Card base classes (`py-(--card-spacing)`, `gap-(--card-spacing)`, `ring-1 ring-foreground/10`, CardTitle `font-heading font-medium`) clash with the brief's flat style → every card component overrides `border border-border ring-0` (+ explicit padding); recorded in decisions.
- Deps pruned to kill the block-demo footprint: removed recharts, @tanstack/react-table, @dnd-kit/core|modifiers|sortable|utilities (chart/table/dnd ambitions are out of scope until a later step). No remaining src references.
- Fixture data is client-only; every page SSR-renders loading skeletons, then hydrates (calendar selected-day + date labels would otherwise mismatch).
- Dev toggles for AC3 verification without rebuilds: `?state=loading|error` and `?empty=1` (URL override in `lib/use-dashboard-data.ts`), `retryLoad()` clears the override.
- Rulings Q1–Q8 implemented (count badge at sm+, Monday-start weeks, bottom-sheet + route detail, business-tz labels shown only when device tz differs, etc.) — see decisions table for the interpretive ones (maskPhone, rescheduled accent, shadcn radix-nova drift).

## Step 2 — Twilio webhook signature verification ✅ (2026-09-18)
- apps/api/src/middleware/twilio-signature.ts — Twilio SDK validateRequest; 401 on missing header / invalid sig / no TWILIO_AUTH_TOKEN (fails closed, env read inside handler → env-free boot preserved)
- apps/api/src/routes/twilio-webhooks.ts — POST /api/twilio/webhooks/inbound-sms; sig first → 400 missing_fields (From/To/Body/MessageSid) → 200 empty body, logged only
- mounted in createApp at /api/twilio/webhooks
- vitest suite (5/5): valid 200, tampered 401, no header 401, missing fields 400, no-token 401
- ERRATA/learnings:
  - `npx tsc` from repo root pulls the npm stub package "tsc" — never use it; run per-workspace via `node_modules/.bin/tsc` (TS 5.9.3 is nested per-workspace, not hoisted)
  - twilio-node validateRequest does NOT URL-encode param values (verified in lib/webhooks/webhooks.js toFormUrlEncodedParam) — signers must use raw key+value canonical strings
  - background server processes: `kill $!` works from bash; taskkill not available in git-bash; verify orphans via powershell Get-NetTCPConnection/Get-Process
  - npm run --workspaces exit code must be captured via $? of npm itself, not a pipe (tail masks failures)

## Step 3 — SMS service ✅ (2026-09-18)
- apps/api/src/services/sms-service.ts — sendSms({to, from?, body}) → {messageSid, status}; per-call twilio client construction (no module-scope env reads → env-free boot preserved, no client-cache → trivially mockable); from defaults to TWILIO_PHONE_NUMBER (guard throws if missing); creds guard throws; API error logged + rethrown; trail logged minus message body (PII)
- DEVATION from brief: `from` is optional with env fallback (brief had it required) — superset, satisfies brief call shape
- tests: 5/5 (happy path + exact create() args, from-fallback, missing-creds guard, missing number guard, error rethrow) — vi.mock('twilio') via vi.hoisted factory
- REAL-SMS smoke intentionally SKIPPED — requires real Twilio creds + user consent for a test SMS; unit-mock evidence stands in

## Step 9 UI — Escalations surface (Solo Sam, design brief §9) ✅ (2026-09-18)

Brief: `docs/tasks/step9-escalations-ui.md`. Report: `docs/tasks/step9-escalations-ui-report.md`.
All work confined to `apps/web` (UI-only). Uncommitted apps/api Step 9 work untouched.

Gate evidence (in-session; subagent fleet down — OpenRouter credits 402):
- [x] `npm run build --workspace=apps/web` exit 0 (7 routes incl. /dashboard/escalations)
- [x] prod server :3100 — curl matrix all 200: /dashboard, /dashboard/escalations,
      /dashboard/escalations?state=loading, /dashboard/escalations?state=error,
      /dashboard/week, /dashboard/jobs/bk-today-001, /dashboard/settings
- [x] server log clean during SSR sweep
- [x] grep gates: single RESCHEDULE_ACTION_LABEL definition; reschedule history
      rendered once per detail surface (sheet + route both via JobDetailBody)
- [x] CSS linked: `<link rel="stylesheet" data-precedence>` present on all dashboard
      pages (~95 KB bundle; contains --background/--primary/--urgent oklch tokens,
      .bg-urgent, .text-muted-foreground, .rounded-xl, .h-16)

CRITICAL FINDING — CSS was never linked:
- `apps/web/src/app/layout.tsx` lacked `import "./globals.css"` since the first
  dashboard commit (16de637) → app shipped unstyled; ledger curl checks (status +
  text markers) pass without CSS so it went undetected. Fixed in this step.
- Lesson: SSR/curl gates must also assert a `<link rel="stylesheet">` + that the
  bundle contains token vars — add to the standard gate checklist.

R1–R5 delivered: escalations page rebuild (loading/error/message/empty/list +
confirm-dialog resolve + toast), fixture escalation store (3 seeds + resolveEscalation
via useDashboardData, types from @tradescheduler/shared), reschedule-history deduped
into single shared component (route page + sheet render via JobDetailBody), navigation
entry (sidebar Escalations item + pending urgent badge, header title, Today
needs-attention banner → /dashboard/escalations), hygiene (no dead code, no new deps,
no token changes, no new primitives).

Deferred:
- [ ] task-reviewer/reviewer + vision (browser-level hydration/interaction check) once
      the subagent fleet is back — diff is small and self-reviewed in-session
- [ ] commit of the UI work (repo has uncommitted apps/api work from its own Step 9
      track — keep the UI commit scoped to apps/web + docs/tasks)

## Design system hardening (UI primitives + docs) ✅ (2026-09-18)

Skills: frontend-design (quality-floor discipline) + design-system (audit →
fix-at-source → document). Brief pins identity (blue/orange utility, flat, system
fonts); enhancements confined to consistency/discipline, zero visual-identity drift.

Gate evidence:
- [x] `npm run build --workspace=apps/web` exit 0 (7 routes; sizes down ~1–2 kB/page
      from class-string removals)
- [x] prod server :3100 curl matrix all 200 (5 routes incl. ?state=loading|error toggles)
- [x] CSS bundle contains new surface classes: `--header-height`, `.rounded-4xl`,
      `.text-urgent-soft-foreground`, `bg-urgent` (badge variants compiled)
- [x] grep gates: `STATUS_LABEL` declared exactly once (lib/status.ts);
      `variant="urgent*"` used 6×/1× at the right sites; no residual manual
      urgent class strings outside badge.tsx/base

Changes:
- `ui/card.tsx`: base now flat `border border-border shadow-none ring-0` (was nova
  `ring-1 ring-foreground/10`) → removes the 10-site override ritual. Call sites
  keep only their deltas (p-0 / py-12 / size-sm / urgent accent).
- `ui/badge.tsx`: new `urgent` (soft orange) + `urgent-solid` (filled orange)
  variants; `[a]:hover` states included.
- `lib/status.ts` (new): single `STATUS_LABEL` + `statusBadgeVariant()`; job-card
  and job-detail-body now import (deleted 2 local copies).
- Nav count pills (app-sidebar Escalations, bottom-nav Today unconfirmed) now
  `Badge variant="urgent-solid"` (~14px → 20px touch target, consistent).
- `--header-height: 3.5rem` promoted to globals.css token; site-header drops its
  inline style + CSSProperties import.
- Escalations empty state div → `Card` (base now provides flat border styling).
- `docs/design-system.md` (new, 167 lines): tokens, components, variants,
  states, motion, a11y, status mapping, rules/anti-patterns — the working system
  documented per design-system skill ("if it's not documented, it doesn't exist").

Result: 15 files changed, +38/−61 net (duplication collapsed into single sources).
Deferred: reviewer/vision pass when subagent fleet returns (credits issue).
