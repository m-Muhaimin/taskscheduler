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

## Auth — JWT login/register (full stack) ✅ (2026-09-18)

Scope (user-selected): full JWT stack — shared types + DB + API + web pages.

Gate evidence:
- [x] `vitest run --workspace=apps/api`: auth suites 26/26 green
      (services/auth-service 9, routes/auth 17 — real HTTP server, mocked `pg`)
- [x] API typecheck: zero errors in any auth file
      (remaining errors are pre-existing, all inside the uncommitted Step-9
      reschedule-service / process-inbound-sms track — not touched)
- [x] `npm run build --workspace=apps/web` exit 0 — `/login` 3.51 kB,
      `/register` 3.7 kB, Middleware 34.1 kB
- [x] prod :3100 gate matrix — no cookie: `/dashboard` + `/dashboard/escalations`
      `307 → /login`; with cookie: `/dashboard` `200`, `/login` + `/register`
      `307 → /dashboard`; bare `/login` + `/register` `200`
- [x] prod :3100 proxy contract through the rewrite: login/register →
      `503 server_not_configured` (no env), malformed body → `400 invalid_body`,
      short password → `400`, `/me` no token → `401 missing_token`,
      `/me` bogus token → `500 server_not_configured`, `/api/health` → `200`

Changes:
- `packages/shared/src/types.ts`: `AuthUser`, `LoginRequest`, `RegisterRequest`,
  `AuthResponse`, `AuthError` union, `AuthErrorResponse`.
- `apps/api/src/db/migrations/004-create-tradespeople-table.sql` (new):
  `ts_tradespeople` — uuid pk, unique lowercased email, `display_name` 1–80,
  `password_hash`; RLS enabled, `anon`/`authenticated` revoked.
- `apps/api/src/services/auth-service.ts` (new): scrypt
  (`N=16384,r=8,p=1`, 64-byte key, 16-byte salt, `timingSafeEqual`), stored as
  `scrypt$N$r$p$salt$hash`; lazy memoized pool; find-by-email / find-by-id /
  create. No new dependencies.
- `apps/api/src/middleware/auth.ts` (new): `requireAuth` — Bearer JWT → `req.auth`;
  mirrors the escalations inline guard (that route left untouched).
- `apps/api/src/routes/auth.ts` (new): `POST /register` 201 / 400 / 409 / 503 / 500,
  `POST /login` 200 / 401 (no enumeration), `GET /me` 200 / 401 / 404; zod
  validation; 7-day HS256 token, `sub` = id.
- `apps/api/src/app.ts`: mounts `/api/auth` before the twilio/dashboard mounts.
- `apps/web/next.config.ts`: `/api/:path*` → `API_BASE_URL` (default :3001) so the
  session cookie is first-party (no CORS).
- `apps/web/src/middleware.ts` (new): `ts_session` presence gate.
- `apps/web/src/lib/auth-client.ts` (new): cookie set/clear + status→copy mapping.
- `apps/web/src/app/login/page.tsx`, `app/register/page.tsx` (new): design-system
  forms (Card/Input/Label/Button/Alert), 44px targets, loading + error states.
- `apps/web/src/app/layout.tsx`: now bare; shell moved to
  `apps/web/src/app/dashboard/layout.tsx` (new) so auth pages render standalone.
- `apps/web/src/app/dashboard/settings/page.tsx`: Account card + Sign out.
- `docs/auth.md` (new, 126 lines): endpoints, env, hashing params, gate matrix,
  verification, limitations.

Bugs fixed while building:
- `guarded()` was `async`, so it returned `Promise<handler>` and Express threw
  `TypeError: argument handler must be a function` — made synchronous.
- scrypt `N=32768` hit OpenSSL's 32 MiB default `maxmem`
  (`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`) — lowered to 16384, documented.
- `GET /me` originally looked up by email — added `findTradespersonById`.

Result: 20 files, ~1,700 lines. API boots with zero env and degrades to explicit
5xx instead of crashing.
Deferred: (1) live-DB run — no Postgres/Docker here, migration 004 unapplied, so
the happy path is mocked-pg only; (2) non-httpOnly cookie risk + CSRF upgrade path
(documented in docs/auth.md); (3) reviewer/vision pass when subagent fleet returns;
(4) dashboard still renders fixtures — token isn't attached to dashboard fetches yet.

## Auth — dashboard session wiring ✅ (2026-09-18)

Wires the dashboard to the real session (identity live; schedule still fixtures).
Follows the auth commit (81513c4) that landed login/register.

Gate evidence:
- [x] `npm run test --workspace=apps/web` — 11/11 session-core assertions
      (no-token, 200, malformed body, non-JSON, 401, 404, 503, 500, 400, network
      throw, and that Authorization: Bearer is attached; fetch injected, no server)
- [x] browser E2E in headless Chrome via CDP — 12/12, against a stub API that keys
      its /me response off the token value (no DB needed)
- [x] SSR `/dashboard` + cookie → 200 with NO fixture data/identity in the HTML
      (gate holds the shell back until the session resolves)
- [x] gate unchanged: no cookie → `307 /login`; `/login` 200; build exit 0

Changes:
- `lib/session-core.ts` (new): `resolveSession(token, fetchImpl)` state machine —
  React-free and document-free so it is testable headlessly. 401/404 → expired,
  5xx → retryable error, 4xx/network → error, malformed 200 body → error.
- `lib/session.tsx` (new): `SessionProvider`/`useSession`; resolves once per mount,
  clears the cookie and redirects on "expired".
- `components/session-gate.tsx` (new): holds the shell back while loading; renders
  the error card (+ Try again) or nothing while redirecting.
- `app/dashboard/layout.tsx`: wrapped in SessionProvider + SessionGate.
- `lib/auth-client.ts`: added `getSessionToken()` + `authedFetch()`.
- `lib/use-dashboard-data.ts`: exposes `sessionUser`; `tradeLabel` now comes from
  the session display name instead of the `TRADE_LABEL` fixture.
- `components/app-sidebar.tsx`: footer shows the live name + email.
- `app/dashboard/settings/page.tsx`: Account card shows the live name/email;
  sign-out goes through `useSession()`; profile cards labelled "Sample data".
- `tests/session-core.test.mts` + `"test"` script in apps/web/package.json.
- `tests/e2e/` (new): stub API + CDP harness + session-wiring scenario (no deps —
  node 22+ global WebSocket).
- `docs/auth.md`: session-wiring section, verification table, build-time gotcha.

Finding worth remembering:
- `API_BASE_URL` is baked into `.next/routes-manifest.json` at BUILD time —
  setting it only for `next start` has no effect. Confirmed by inspecting the
  manifest after each build; the E2E relies on it to aim the app at the stub.

Result: identity is real end-to-end (login → dashboard shows the signed-in
tradesperson; expired token bounces and cleans up; unconfigured server shows a
retryable error with no fixture leak). Schedule + profile data remain fixtures.
Deferred: profile/jobs API, httpOnly cookie + CSRF, reviewer/vision pass
(subagent fleet still down).

## Dev — local Postgres, and the first real sign-in ✅ (2026-09-18)

Closes the "migration 004 has never touched a real database" gap that has been
open since the auth work started.

Gate evidence:
- [x] migration 004 applied to real Postgres 18.4; schema verified by query —
      RLS enabled, grants to anon/authenticated NONE, both CHECK constraints and
      the unique email index present
- [x] API-level flow against the real DB: register 201, /me 200, login 200,
      duplicate register 409, wrong password 401, unknown email 401 with a
      byte-identical body (no enumeration), uppercase email stored normalized
- [x] data-layer security check: scrypt$16384$8$1$ hashes with a distinct salt
      per row, no plaintext substring, no duplicate emails
- [x] browser flow on the real stack (web :3100 -> api :3001 -> Postgres) — 10/10
      register -> dashboard identity -> settings -> reload keeps session ->
      sign out -> log in again

Changes:
- `apps/api/scripts/local-db.mjs` (new) + `db:local` / `db:local:reset` scripts:
  runs embedded Postgres (no Docker, no admin), creating the cluster, database,
  Supabase roles, and applying the auth migration.
- `docs/local-dev.md` (new): start/reset, credentials, the JWT-secret-restart
  caveat, why anon/authenticated are created, and the migration allowlist.
- `.gitignore`: `.localdb/`.
- `embedded-postgres` devDependency — `^18.4.0-beta.17`, a caret range over a
  *beta*, which is what npm resolves for this package. Narrow it to an exact
  version if a dev tool that auto-updates across betas is unwelcome. Installing
  it also alphabetised the dependency lists in apps/api/package.json; no
  versions changed.

Notes:
- The migration's `revoke ... from anon, authenticated` needed those roles to
  exist locally; creating them as NOLOGIN roles keeps the migration verbatim
  rather than locally edited.
- `MIGRATIONS` is an explicit allowlist. The Step-9 escalations /
  conversation_states DDL is deliberately NOT applied — unapproved, still moving.
- Restarting the API with a fresh JWT_SECRET invalidates all sessions; documented
  so it is not mistaken for a bug.
- Local cluster was verified, then `ts_tradespeople` truncated so the tree is empty.

Result: sign-up and sign-in work end-to-end for real, and the auth schema is
proven against an actual Postgres rather than only a mocked `pg`.
Deferred: fixed/persisted JWT_SECRET, committed `.env.example`, CLAUDE.md is now
badly stale ("no code exists yet"), reviewer/vision pass (fleet still down).
