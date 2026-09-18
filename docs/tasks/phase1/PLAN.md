# Phase 1: Infrastructure & Core Schema

**Source**: `docs/prd-scheduling-assistant.md`  
**Scope**: Repository scaffolding, environment configuration, database design (Supabase), basic auth integration.  
**Out of scope for Phase 1**: SMS flows, AI intent parsing, calendar sync logic, Paddle payment flows, dashboard UI.

---

## Global Constraints

1. **Single package manager decision**: Use `pnpm` workspaces with a root `package.json` and separate `app/` and `server/` workspace packages. This matches the intended Next.js + Express split and lets us share TypeScript config/types later.
2. **Supabase as the source of truth for DB + Auth**: Phase 1 uses Supabase Auth for tradesperson login. All tables live in Supabase Postgres. No separate Express-level auth store.
3. **RLS is mandatory**: Every table created in Phase 1 must have Row Level Security policies that scope rows to `auth.uid()` (the tradesperson). No table is world-readable.
4. **Environment parity**: `.env.example` files must enumerate every variable a running app needs, with placeholder values and comments indicating the source (Twilio console, Google Cloud, Supabase project, Paddle dashboard).
5. **No API keys committed**: `.env` files are gitignored; only `.env.example` lands in the repo.
6. **TypeScript strict mode** for both `app/` and `server/`.
7. **Tailwind CSS + shadcn/ui** for `app/` (per CLAUDE.md hard rule: use shadcn/ui instead of hand-rolled primitives once frontend work begins).
8. **Phase 1 does not send real SMS or charge real payments**. Twilio/Paddle variables are configured but not exercised until later phases.

---

## Dependency Chain

```
Task 1 (scaffold) ─┬─> Task 2 (env) ────────> Task 4 (auth)
                   └─> Task 3 (db schema) ───> Task 4 (auth)
```

- **Task 1** establishes both workspaces and shared tooling. It is the only task that does not depend on any other Phase 1 task.
- **Task 2** (environment files) can run in parallel with Task 1 once the directories exist, but it must happen before Task 3 (so migration scripts can reference env vars) and Task 4 (so auth init can reference env vars). In practice, Task 2 depends on Task 1 for directory structure.
- **Task 3** (database migration + RLS) depends on Task 1 (directories) and Task 2 (env file conventions) but is otherwise independent of Task 4. It produces the schema that Task 4's auth integration will rely on.
- **Task 4** (Supabase Auth integration) depends on Task 1 (server/ exists), Task 2 (env vars), and Task 3 (profiles table exists and has RLS). The auth integration wires Supabase client init, a minimal `/auth/*` route set on the Express backend, and a matching auth hook on the Next.js frontend.

---

## Task List

### Task 1: Repository Scaffolding

Create the workspace skeleton: root `package.json` (pnpm workspaces), `app/` (Next.js App Router + Tailwind + TypeScript + shadcn/ui init), and `server/` (Express + TypeScript). Add `.gitignore` rules, shared TypeScript config, and a basic `pnpm` script surface at the root.

**Files created/edited**:
- `package.json` (root)
- `pnpm-workspace.yaml`
- `tsconfig.json` (shared roots)
- `app/package.json`
- `app/next.config.js`
- `app/tailwind.config.ts`
- `app/postcss.config.js`
- `app/tsconfig.json`
- `app/app/layout.tsx`
- `app/app/page.tsx`
- `app/shadcn.json` (or `components.json` depending on shadcn init)
- `server/package.json`
- `server/tsconfig.json`
- `server/src/index.ts`
- `.gitignore`
- `docs/tasks/phase1/task-1-brief.md` (this brief)

**Depends on**: nothing (Phase 1 entry point).  
**Blocks**: Task 2, Task 3, Task 4.

---

### Task 2: Environment Configuration

Define `.env.example` for `app/`, `server/`, and root (shared vars). Enumerate Twilio, Google Calendar, Supabase, Paddle keys with comments. Add `.env` to `.gitignore` if not already present. Do not create real `.env` files.

**Files created/edited**:
- `app/.env.example`
- `server/.env.example`
- `.gitignore` (ensure `.env` entries exist)
- `docs/tasks/phase1/task-2-brief.md` (this brief)

**Depends on**: Task 1 (directories exist).  
**Blocks**: Task 3, Task 4.

---

### Task 3: Database Design & RLS Migration

Design and create a Supabase migration for core tables: `profiles`, `bookings`, `leads`, `sms_logs`. Implement RLS policies so each tradesperson can only read/write their own rows. Use UUID primary keys, `timestamptz` for timestamps, and enums where the PRD specifies them (status fields, trade types). This task is the schema contract that later phases build on.

**Files created/edited**:
- `supabase/migrations/001_core_schema.sql` (or equivalent migration file path agreed with Supabase CLI)
- `supabase/schema.sql` (declarative reference, optional but recommended for review)
- `docs/tasks/phase1/task-3-brief.md` (this brief)

**Depends on**: Task 1 (directories), Task 2 (env conventions — for annotating which env vars the DB client needs).  
**Blocks**: Task 4 (profiles table + RLS must exist before auth integration).

---

### Task 4: Basic Auth Integration (Supabase Auth)

Integrate Supabase Auth for tradesperson login:
- Server: initialize Supabase client from env, expose minimal auth endpoints (`POST /auth/signup`, `POST /auth/signin`, `GET /auth/me`) that return JWT/session info.
- App: create a Supabase client init module, a basic login page, and an auth state hook that reads the session. No dashboard yet — just the login flow and session persistence.

**Files created/edited**:
- `server/src/auth/router.ts`
- `server/src/auth/service.ts`
- `server/src/supabase/client.ts`
- `server/src/config.ts` (env parsing + validation)
- `app/lib/supabase/client.ts`
- `app/lib/supabase/server.ts` (if using Next.js server client pattern)
- `app/app/login/page.tsx`
- `app/components/auth/login-form.tsx` (or equivalent)
- `app/hooks/use-session.ts`
- `docs/tasks/phase1/task-4-brief.md` (this brief)

**Depends on**: Task 1 (directories), Task 2 (env vars), Task 3 (profiles table + RLS exist).  
**Blocks**: Phase 2 (SMS flows, calendar sync, etc.).

---

## Verification Summary

| Task | How to verify |
|------|---------------|
| 1 | `pnpm install` at root succeeds; `pnpm --filter app dev` and `pnpm --filter server start` bootstrap without errors; directories and configs exist as listed. |
| 2 | `.env.example` files parse as key-value with comments; every variable referenced in later tasks appears here; `.gitignore` blocks `.env`. |
| 3 | Migration applies cleanly against a Supabase project (or local `supabase start`); `\dt` shows `profiles`, `bookings`, `leads`, `sms_logs`; RLS is enabled and policies return rows only for `auth.uid()`. |
| 4 | Signup/signin flows complete against a Supabase project; `/auth/me` returns the tradesperson's session; login page renders and persists session in the app. |

---

## Notes & Open Questions

- **Payment provider**: The PRD specifies Paddle for v1 deposits. Phase 1 only records the env var and the `paddleCustomerId` column on `profiles`; no Paddle integration code is built until a later phase.
- **Auth model**: Supabase Auth handles tradesperson identity. The `profiles` table is the extended metadata (trade type, phone number, calendar ID, Paddle customer ID, SMS templates). RLS ties `profiles` to `auth.uid()`.
- **Twilio phone verification**: The PRD says `phoneNumber` must be Twilio-verified. Phase 1 does not implement verification; it only stores the column and defers verification to a later phase.
- **pnpm vs npm vs yarn**: This plan chooses `pnpm` workspaces. If the team prefers npm workspaces or separate repos, Task 1's root `package.json` and workspace config change accordingly — but the task boundaries stay the same.
