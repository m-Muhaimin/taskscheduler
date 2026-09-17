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
