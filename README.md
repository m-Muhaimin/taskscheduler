# RidgeLine - AI Scheduling & Dispatch Assistant

An AI-powered scheduling and dispatch assistant for **solo tradespeople** (plumbers, electricians, HVAC techs). It runs the booking conversation over **SMS** so the tradesperson does not have to: it auto-confirms bookings, parses natural-language reschedule replies, and turns missed calls into booked jobs.

> Frontend branding is **RidgeLine**; the repo/API lineage is `tradescheduler`.

---

## What it does

- **SMS-first booking** - customers text in; Twilio webhooks feed a queue the worker drains, intents are classified, and bookings are created.
- **Natural-language rescheduling** - replies like "can we move it to Thursday?" are parsed into structured reschedule requests that are **never auto-confirmed without an explicit customer reply**.
- **Missed-call recovery** - outreach intents turn missed calls / texts into bookable conversations.
- **Google Calendar sync** - OAuth-linked calendar integration for booked appointments.
- **Solo-trade dashboard** - schedule view, jobs, customers, AI inbox (approve/reply), analytics, and settings, all under a custom **RidgeLine** design system.
- **Consent-first SMS** - every outbound message requires a logged consent record; nothing is sent without it.
- **Provider-agnostic AI** - the LLM layer (`packages/ai`) supports OpenAI, Ollama, and Census providers behind one interface, with an AI usage cost ledger.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Monorepo** | npm workspaces (`npm@11`) |
| **API** | Express 5, TypeScript (ESM), Zod validation, Vitest |
| **Web** | Next.js 14.2 (App Router), React 18.3, Tailwind 3.4 - custom RidgeLine design system |
| **Database** | PostgreSQL - Supabase (hosted) / embedded-postgres (local dev), all tables `rl_`-prefixed |
| **SMS** | Twilio (webhooks + outbound) |
| **Calendar** | Google Calendar API (OAuth 2.0) |
| **AI** | OpenAI / Ollama / Census via `packages/ai` |
| **Deploy** | Render Blueprint (`render.yaml`) |

---

## Repository layout
```
.
├── apps/
│   ├── api/                  # Express backend
│   │   └── src/
│   │       ├── routes/       # HTTP endpoints (auth, twilio-webhooks, google-oauth, dashboard)
│   │       ├── services/     # Business logic (auth, sms, calendar, intent, booking,
│   │       │                 #   reschedule, queue, verification, escalation, ...)
│   │       ├── worker/       # Async poll loops (inbound + outbound SMS processing)
│   │       ├── db/migrations/# SQL schema migrations (001-011)
│   │       ├── middleware/   # auth.ts, twilio-signature.ts
│   │       └── scripts/      # local-db.mjs, db-migrate.mjs, seed-demo-user.mjs
│   └── web/                  # RidgeLine Next.js frontend
│       ├── app/              # (marketing), (auth), dashboard/* (schedule, jobs, inbox...)
│       ├── components/       # Flat RidgeLine design system + domain components
│       ├── lib/              # auth.ts (API wiring), session-core.ts, validation.ts
│       └── middleware.ts     # Gates /dashboard on the ts_session cookie
├── packages/
│   ├── shared/               # @tradescheduler/shared - domain types used by API + web
│   └── ai/                   # @tradescheduler/ai - provider-agnostic LLM layer
├── supabase/schema.sql       # All-in-one schema for fresh-project bootstrap
├── docs/                     # Design, deployment, local-dev, spec docs
├── render.yaml               # Render Blueprint (API + worker + web)
├── package.json              # npm workspaces root
├── package-lock.json
└── tsconfig.json
```

---

## Core pipeline

```
Twilio Webhook --> API Route --> Queue Service --> Worker --> Intent / Calendar Services --> Twilio SMS Reply
      (inbound SMS)   (verify sig)   (rl_jobs)      (poll)      + Booking / Reschedule            (consent-gated)
```

Outbound replies are likewise queued (`outbound_sms` jobs) and delivered by the worker, so nothing is sent outside the consent/verification rules.

---

## Getting started

### Prerequisites

- **Node.js** 22+ and **npm** 11 (`packageManager: npm@11.14.1`)

### 1. Install

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in real values - **never commit `.env`** (it is gitignored). The API is designed to boot without env; external clients (Twilio, Google, Supabase) are constructed lazily when first used.

### 3. Start the local database

```bash
npm run db:local --workspace=apps/api
```

Runs real Postgres binaries via `embedded-postgres` (no Docker / admin rights needed) on port **5432**, creates the `tradescheduler` database and the Supabase-compatible `anon` / `authenticated` roles, then applies the migrations. Reset anytime with:

```bash
npm run db:local:reset --workspace=apps/api
```

Details in [`docs/local-dev.md`](docs/local-dev.md).

### 4. Run the API, worker, and web

```bash
# API (port 3001, watch mode)
npm run dev --workspace=apps/api

# SMS processing worker (separate process)
npm run worker --workspace=apps/api

# Web dashboard (port 3000; use -p 3100 if 3000 is taken)
npm run dev --workspace=apps/web
```

Or start API + web together from the root:

```bash
npm run dev
```

The web app proxies `/api/*` to the API via `next.config.mjs` rewrites (`API_BASE_URL` or `http://localhost:3001`).

### 5. Run tests

```bash
npm run test --workspace=apps/api                 # Vitest suite (services, routes, worker)
npm run test --workspace=apps/web                 # session-core tests (tsx)
npm run test --workspace=@tradescheduler/ai       # AI layer tests
npm run build                                     # build all workspaces
```

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (1) | Postgres connection string (API + queue worker) |
| `JWT_SECRET` | yes | Signs dashboard session JWTs (`ts_session` cookie) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | as needed | Supabase client + service-role access |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | for SMS | Twilio outbound + webhook verification |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | for Calendar | Google OAuth for calendar sync |
| `AI_PROVIDER` | no (2) | `openai` / `ollama` / `census` / `fallback-only` (default) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | if OpenAI | OpenAI provider config |
| `OLLAMA_API_KEY`, `OLLAMA_MODEL`, `OLLAMA_BASE_URL` | if Ollama | Ollama provider config |
| `CENSUS_API_KEY`, `CENSUS_MODEL`, `CENSUS_BASE_URL` | if Census | Census provider config |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV` | no (3) | Payment processor (not yet built) |
| `PORT` / `API_PORT` | no | API port, default `3001` |

(1) The API boots without it; integrations activate lazily. (2) Defaults to `fallback-only`. (3) Placeholder - see Known limitations.

---

## Architecture notes

### Authentication & sessions

- Dashboard login issues a JWT stored in the `ts_session` cookie; `apps/web/middleware.ts` redirects unauthenticated users away from `/dashboard`.
- The web app authenticates API calls through `lib/auth.ts` (`authedFetch`); headless session resolution lives in `lib/session-core.ts`.
- The local `JWT_SECRET` does not persist between `db:local` runs unless you export a fixed value - restarting the API invalidates existing sessions (expected behavior, not a bug).

### SMS pipeline & safety

- Every inbound Twilio webhook is signature-verified via `middleware/twilio-signature.ts`.
- Inbound messages are queued as jobs (`public.rl_jobs`, RLS deny-by-default) and drained by `worker/process-inbound-sms.ts`.
- Sensitive intents (e.g. reschedules) are gated by **one-time verification codes** (`010-customer-verification.sql`, `011-confirmation-codes.sql`) - never auto-confirmed without explicit customer reply.
- Outbound delivery runs through `worker/process-outbound-sms.ts` with the consent record checked.

### Database

- Per-workspace migrations live in `apps/api/src/db/migrations/` (`001`-`011`) - tables use the `rl_` prefix (`rl_jobs`, etc.) and RLS is deny-by-default for `anon`/`authenticated`.
- `npm run db:migrate --workspace=apps/api` applies idempotent (`IF NOT EXISTS`) SQL - used by Render's `preDeployCommand`.
- `supabase/schema.sql` is the all-in-one bootstrap for a fresh Supabase project.
- For hosted Supabase, tables live in the shared project where every table is `public.<PREFIX>_<name>`.

---

## Deployment (Render)

`render.yaml` provisions three services on Render:

| Service | Type | Runs |
|---|---|---|
| `ridgeline-api` | Web | Express API, `dist/index.js`, health at `/api/health` |
| `ridgeline-worker` | Background worker | SMS poll loops, `dist/worker/index.js` |
| `ridgeline` | Web | Next.js app, proxies `/api/*` to the API |

On every deploy, `preDeployCommand` runs `npm run db:migrate` so the schema is current. Follow the one-time secret setup (database URL, JWT secret, Twilio, Google OAuth, `WEB_BASE_URL`) in [`docs/deploy-render.md`](docs/deploy-render.md).

---

## Security & hard rules

- **SMS consent** - never send an SMS without a logged consent record.
- **Reschedule safety** - never auto-confirm a reschedule without an explicit customer reply; sensitive intents require one-time verification codes.
- **Webhook integrity** - Twilio webhook signatures must be verified with `twilio-signature.ts` middleware.
- **Secrets** - `.env` was once committed; credentials have been rotated. Never commit `.env` again.
- Frontend pages reuse the self-contained RidgeLine design system; shadcn/ui is used only for freshly scaffolded admin surfaces.

---

## Known limitations & gotchas

- **Payments** - Paddle is the chosen processor, but deposit/webhook implementation is **not yet built** (placeholder env vars only).
- **npm audit (web)** - `apps/web` runs Next 14.2 for the RidgeLine drop-in, which reintroduces CVEs removed in the old Next 15 stack (11 vulnerabilities at last install: 7 moderate, 2 high, 2 critical). The Next 14 to 15 upgrade path is documented in `docs/tasks/v2/nextjs-upgrade.md`. No `--force` installs.
- **Web build warning (cosmetic)** - "Found lockfile missing swc dependencies... Failed to patch lockfile" is a registry fetch failure offline; builds succeed regardless.
- **Port 3000 contention** - unrelated dev servers can occupy `:3000`; run the web app with `-p 3100` (the `/api` proxy rewrites are port-agnostic).
- **Headless dev quirk (Windows)** - `next dev`/`next start` exit 0 when stdin closes; wrap detached/agent launches with `ext-keepalive.cjs` (holds a stdin pipe open) - same trick for the API (`api-keepalive.cjs`).

---

## Documentation index

| Doc | Contents |
|---|---|
| [`docs/local-dev.md`](docs/local-dev.md) | Embedded-Postgres local setup, `db:local` details |
| [`docs/deploy-render.md`](docs/deploy-render.md) | Render Blueprint provisioning, secrets, OAuth redirect |
| [`docs/auth.md`](docs/auth.md) | Authentication design |
| [`docs/design-system.md`](docs/design-system.md) | Design system reference |
| [`docs/build-sequence.md`](docs/build-sequence.md) | Step-by-step build order |
| [`docs/prd-scheduling-assistant.md`](docs/prd-scheduling-assistant.md) | Product requirements |
| [`docs/spec-reschedule-flow.md`](docs/spec-reschedule-flow.md) | Reschedule flow spec |
| [`docs/spec-customer-conversation-domain.md`](docs/spec-customer-conversation-domain.md) | Conversation domain spec |
| [`docs/tasks/v2/`](docs/tasks/v2/) | V2 checkpoint plans, reports, and briefs (web replacement, AI alignment, etc.) |

---

## Contributing

This is an internal, single-repo product. Work is planned in `docs/tasks/` and executed task-by-task with per-task briefs and reports (see `docs/tasks/v2/briefs/` and `docs/tasks/v2/reports/`).
