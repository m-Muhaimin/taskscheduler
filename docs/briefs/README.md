# Build briefs — index & decisions

Project: tradescheduler (reschedule-by-text flow). Source of truth for each step:

| Step | Brief | Status |
|---|---|---|
| 0 | [step0-bootstrap.md](step0-bootstrap.md) | ✅ DONE (see ledger) |
| 1 | [step1-shared-types.md](step1-shared-types.md) | pending |
| 2 | (to be written — Twilio webhook signature) | pending |
| 3+ | per build-sequence.md | pending |

## Decisions (record)

| Topic | Decision | Reasoning / status |
|---|---|---|
| Shared package name | `@tradescheduler/shared` (build-sequence said `@repo/shared`) | Consistency with `@tradescheduler/api` / `@tradescheduler/web` |
| Ports | API 3001 (`process.env.PORT ?? 3001`), web 3000 | Per build-sequence verify steps |
| TypeScript | pinned **5.9.3** in all three workspaces (fallback rule applied) | TS 7.0.2 is the Go-native compiler with no stable programmatic API; Next 15.5.25's type-checker cannot `require('typescript')` → its own checker fails. 5.9.3 is newest 5.x. |
| Next.js | **15.5.25** (was 15.3.5) | 15.3.5 deprecated: CVE-2025-66478 security vulnerability. Stays on Next 15 line per approved stack. |
| jsonwebtoken | **9.0.3** (was 9.0.10) | 9.0.10 does not exist on npm. |
| pg | **8.23.0** (was 8.23.1) | 8.23.1 does not exist on npm. |
| DB client for Step 4 queue | deferred | pg and @supabase/supabase-js both present; `.env.example` carries `DATABASE_URL` + `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` |
| tsconfig strategy | root = solution-style (`files: []` + references, compiler opts base); api/shared = `nodenext` ESM; web = Next shape (`bundler`) | Per step0 brief. `tsc -b` from root intentionally not used (no `composite`). |
| Env-free boot | hard rule: no `process.env` reads at module scope except `PORT` in index.ts; clients constructed lazily | Server must boot with no `.env`. |

## Errata (brief bugs found during execution)

- `step0-bootstrap.md` §5 `apps/api/tsconfig.json` used `"extends": "../tsconfig.json"` — wrong from `apps/api/` (resolves to `apps/tsconfig.json`). Corrected to `"../../tsconfig.json"`.
- `step0-bootstrap.md` §7 specified a single `index.ts`; implementation splits `app.ts` (createApp factory) + `index.ts` (bootstrap) so Step 2 tests can import the app. Same behavior.
