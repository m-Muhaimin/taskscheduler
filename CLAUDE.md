# CLAUDE.md

AI scheduling/dispatch assistant for solo tradespeople (plumbers, electricians, HVAC). Auto-confirms bookings via SMS, parses natural-language reschedule replies, and turns missed calls into booked jobs.

## Tech Stack
- **Monorepo**: npm workspaces
- **Frontend**: Next.js 15 (App Router), React 19, Tailwind 4, shadcn/ui
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

### Frontend (`apps/web`)
- `npm run dev --workspace=apps/web`: Start Next.js dev server (port 3000)
- `npm run build --workspace=apps/web`: Build Next.js app
- `npm run test --workspace=apps/web`: Run session core tests

## Architecture

### Repository Layout
- `apps/api`: Express backend.
  - `src/routes`: API endpoints.
  - `src/services`: Business logic (Auth, SMS, Calendar, Intent).
  - `src/worker`: Asynchronous poll loop for processing queued SMS.
  - `src/db/migrations`: SQL schema migrations.
- `apps/web`: Next.js frontend.
  - `src/app`: App Router pages and layouts.
  - `src/components`: shadcn/ui and domain components.
  - `src/lib`: Auth clients and utility functions.
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
- **UI**: Use shadcn/ui primitives; avoid hand-rolling basic components.

## Known Issues / Gotchas
- **Payment Processor**: Currently unresolved (Stripe vs. Paddle). No payment code is implemented.
- **Credentials**: `.env` was previously committed; ensure credentials are rotated and never committed again.
- **Local DB**: Local development uses `embedded-postgres`. Refer to `docs/local-dev.md`.
