# CLAUDE.md

AI scheduling/dispatch assistant for solo tradespeople (plumbers, electricians, HVAC). Auto-confirms bookings via SMS, parses natural-language reschedule replies, and turns missed calls into booked jobs.

## Tech Stack
- **Monorepo**: npm workspaces
- **Frontend (apps/web, RidgeLine)**: Next.js 14.2.35 (App Router), React 18.3, Tailwind 3.4, custom design system. Replaced the Next 15/shadcn web as a drop-in per docs/tasks/v2/ridgeline-web-replacement.md. (Historic stack: Next 15, React 19, Tailwind 4, shadcn/ui.)
- **Backend**: Express 5 (TypeScript, ESM), Node.js
- **Database**: Postgres (Supabase / embedded-postgres for local dev)
- **Integrations**: Twilio (SMS), Google Calendar API
- **Shared**: `@tradescheduler/shared` (Domain types)

## Commands

### Global
- `npm run dev`: Starts both API and Web in parallel
- `npm run build`: Builds all workspaces

### Backend (`apps/api`)
- `npm run dev --workspace=apps/api`: Start API in watch mode (tsx)
- `npm run test --workspace=apps/api`: Run Vitest suite
- `npm run db:local --workspace=apps/api`: Spin up embedded Postgres for local dev
- `npm run worker --workspace=apps/api`: Start the SMS processing worker

### Frontend (`apps/web`) — RidgeLine branded UI
- `npm run dev --workspace=apps/web`: Start Next.js dev server (default port 3000; pass `-- -p 3100` if 3000 is occupied)
- `npm run build --workspace=apps/web`: Build Next.js app
- `npm run start --workspace=apps/web` (or `next start -p 3100`): serve the production build
- `npm run test --workspace=apps/web`: Run session-core tests (tsx)

## Architecture

### Repository Layout
- `apps/api`: Express backend.
  - `src/routes`: API endpoints.
  - `src/services`: Business logic (Auth, SMS, Calendar, Intent).
  - `src/worker`: Asynchronous poll loop for processing queued SMS.
  - `src/db/migrations`: SQL schema migrations.
- `apps/web`: RidgeLine branded Next.js frontend (Next 14, flat structure; wired to the API via an `/api` proxy).
  - `app`: App Router pages (marketing, `(auth)/login|signup|forgot-password`, `dashboard/*` incl. settings).
  - `components`: Flat design-system + domain components (no shadcn; own tokens in `globals.css`).
  - `lib`: `auth.ts` (API wiring, `ts_session` cookie, `authedFetch`, error copy), `session.tsx` (SessionProvider), `session-core.ts` (headless session resolution), `validation.ts`.
  - `middleware.ts`: Gate on `ts_session` — `/dashboard` requires it, auth pages redirect away when present.
  - `next.config.mjs`: rewrites `/api/:path*` → `API_BASE_URL ?? http://localhost:3001`.
  - `tests/session-core.test.mts`: session resolution tests (run via tsx).
- `packages/shared`: Core domain types used by both API and Web.

### Core Pipeline
`Twilio Webhook` $\rightarrow$ `apps/api (Route)` $\rightarrow$ `Queue Service` $\rightarrow$ `Worker` $\rightarrow$ `Intent/Calendar Services` $\rightarrow$ `Twilio SMS Reply`.

## Code Conventions
- **Backend**: ESM modules, Zod for validation, Vitest for testing.
- **Frontend**: App Router, Tailwind 4, shadcn/ui components.
- **Types**: All shared domain entities must reside in `@tradescheduler/shared`.

## Hard Rules
- **SMS Consent**: Never send an SMS without a logged consent record.
- **Reschedule Safety**: Never auto-confirm a reschedule without an explicit customer reply.
- **Security**: Twilio webhook signatures must be verified using `twilio-signature.ts` middleware.
- **UI**: Use shadcn/ui primitives; avoid hand-rolling basic components. (Exception: `apps/web` is a self-contained RidgeLine design system — don't shadcn-ify it in place; use shadcn only for new admin surfaces scaffolded fresh.)

## Known Issues / Gotchas
- **Payment Processor**: Paddle (deposit/webhook implementation not yet built)
- **npm audit (web)**: `apps/web` runs Next 14.2 (RidgeLine drop-in, see docs/tasks/v2/ridgeline-web-replacement.md), which re-introduces CVEs removed from the old stack — 11 vulnerabilities at last install (7 moderate, 2 high, 2 critical). Accepted for the RidgeLine rebrand; Next 14 upgrade path is documented in docs/tasks/v2/nextjs-upgrade.md. Root still shows the `uuid` moderate chain via `googleapis@148.0.0`. No `--force` installs.
- **Credentials**: `.env` was previously committed; ensure credentials are rotated and never committed again.
- **Local DB**: Local development uses `embedded-postgres`. Refer to `docs/local-dev.md`.

- **Production boot (Render)**: the workspace packages `@tradescheduler/shared` and `@tradescheduler/ai` ship raw TypeScript (`"main": "src/index.ts"`, internal `.js`-suffixed imports) with no dist build, so they only resolve at runtime under a `.js→.ts`-aware loader. `node dist/index.js` (Node ≥22.6 native type-stripping) crashes with `ERR_MODULE_NOT_FOUND: packages/shared/src/types.js`. The API `start` and `worker:start` scripts therefore run `node --import tsx dist/...` (`tsx` is a runtime dependency of `apps/api`). Dev/worker already used tsx; keep it that way if render.yaml start commands change.
- **Web build warning (cosmetic)**: every web build prints `⚠ Found lockfile missing swc dependencies... ⨯ Failed to patch lockfile` (TypeError in patch-incorrect-lockfile.js). It is a registry fetch that fails offline; even pinning `@next/swc-win32-x64-msvc@14.2.33` in web devDependencies doesn't satisfy it. Builds succeed regardless — ignore.
- **Headless dev quirk (Windows)**: `next dev`/`next start` exit code 0 when stdin closes (detached/agent launches). Wrap spawns with `C:UsersmuhaiAppDataLocalTempopencode
ext-keepalive.cjs` (holds a stdin pipe open) — same trick for the API (api-keepalive.cjs, sets `KEEPALIVE_CWD`/`KEEPALIVE_BIN`/`KEEPALIVE_ARGS`).
- **Port 3000 contention**: unrelated dev servers can occupy :3000 (observed `K:
idgeline-dashboard-scaffold`). Run apps/web with `-p 3100` when that happens — the `/api` proxy rewrites are port-agnostic.
