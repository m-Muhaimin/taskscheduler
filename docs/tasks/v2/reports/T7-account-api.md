# T7 — Account profile API: PATCH /api/auth/profile + POST /api/auth/change-password — Report

Status: COMPLETE · Date: 2026-09-19

## What was built

### 1) Shared type (`packages/shared/src/types.ts`) — types-only
- `AuthUser` extended with `phoneNumber: string | null;` (placed after `displayName`).
- Comment updated noting the tradesperson row carries it. No other types touched.

### 2) Service layer (`apps/api/src/services/auth-service.ts`)
- `TradespersonRow` + `findTradespersonByEmail` / `findTradespersonById` / `createTradesperson` / `toAuthUser` now carry `phone_number`.
- Added:
  - `updateTradespersonProfile(id, { displayName?, email?, phoneNumber? })` — builds a dynamic `UPDATE ... SET` from provided columns only (all-or-nothing; throws on empty set), returns the fresh row.
  - `updateTradespersonPassword(id, passwordHash)` — updates `password_hash` only.
- Both use the existing lazy-Pool pattern + `ssl: { rejectUnauthorized: false }` + `TRADESPEOPLE_TABLE ?? 'rl_tradespeople'` override. Reuse `hashPassword` / `verifyPassword` for password change.

### 3) Routes (`apps/api/src/routes/auth.ts`)
- **`PATCH /api/auth/profile`** (requireAuth)
  - Body zod-validated, partial: `displayName` 1..80, `email` valid+lowercased (transform), `phoneNumber` E.164-ish `^\+?[1-9][0-9]{1,14}$` or `''`/`null` (empty string → `null`, clears).
  - Empty body / no valid fields → `400 { error: 'invalid_body' }`.
  - Email uniqueness: another tradesperson holds it → `409 { error: 'email_taken' }`; email belonging to SELF → treated as no-op success.
  - Response `200 { user: AuthUser }` with `phoneNumber`.
- **`POST /api/auth/change-password`** (requireAuth)
  - Body `{ currentPassword, newPassword }` zod-validated (missing → `400 invalid_body`).
  - `verifyPassword` (same as login) against the row's hash; mismatch → `401 { error: 'invalid_credentials' }`.
  - `newPassword` ≥ 8 (matches web `MIN_PASSWORD_LENGTH`); hashed with the same scrypt settings as register; `200 { ok: true }`.
  - Deleted-account token → `404 { error: 'invalid_token' }` (consistent with `/me`).

## Tests

- `apps/api/src/routes/auth.test.ts` — added PATCH + change-password describe blocks following the existing harness (service mocks, `patch()`/`post()` helpers): PATCH happy path per field (displayName / phone set / phone clear via `''` / email change lowercased / same-email no-op), `400` empty body, `409` email_taken (another holder), `401` unauth + deleted-account 404; change-password happy path, `401` wrong current, `400` short new, `400` missing body, `401` unauth.
- `apps/api/src/services/auth-service.test.ts` — added `profile updates` describe (dynamic SQL sets only provided columns, email lowercasing, phone `''`→`null`, empty-set throw; password update).
- **Suite result (warm): 309 passed / 309 (16 files)**. Cold first run shows the 3 known pre-existing flakes (`process-inbound-sms.test.ts`, `google-auth-service.test.ts`) documented in T2-T3 — files untouched by T7, green in isolation and warm.
- `npm run typecheck --workspace=@tradescheduler/api` — clean.

## Live verification (server :3001)

Boot: killed stale PID 39892 (`taskkill //PID 39892 //F`), started fresh `npx tsx src/index.ts` (PID 22232), `GET /api/health` → `200 {"status":"ok"}`.

| # | Step | Status | Notes |
|---|---|---|---|
| 1 | Login (throwaway, original creds) | 200 | token + `{id, email, displayName:"T2T3 Verify", phoneNumber:null}` |
| 2 | PATCH displayName `"T7 Renamed"` | 200 | `user.displayName` updated |
| 3 | PATCH phoneNumber `+14155550123` | 200 | phoneNumber set |
| 4 | PATCH phoneNumber `""` | 200 | phoneNumber → `null` (cleared) |
| 5 | PATCH email → NEW email | 200 | changed to `t7-account-<ts>@example.com` |
| 6 | PATCH same-email (self) | 200 | no-op success, not 409 |
| 7 | Login with NEW email | 200 | proves email persisted |
| 8 | change-password (current correct) | 200 | `{"ok":true}` |
| 9 | Login with NEW password | 200 | proves password persisted |
| 10 | change-password wrong current | 401 | `{"error":"invalid_credentials"}` |
| 11 | change-password short new | 400 | `{"error":"invalid_body"}` |
| 12 | change-password no auth | 401 | `{"error":"missing_token"}` |
| 13 | PATCH empty body `{}` | 400 | `{"error":"invalid_body"}` |
| 14 | PATCH invalid phone `not-a-phone` | 400 | `{"error":"invalid_body"}` |
| 15 | PATCH no auth | 401 | `{"error":"missing_token"}` |
| 16 | Register temp holder, PATCH email → its email | 409 | `{"error":"email_taken"}`; temp holder deleted afterward via scratch pooler SQL (test data only, no DDL) |

Transient: one early login hit `500 server_not_configured` on first pool connect; immediately recovered on retry (pooler cold-start), all subsequent calls stable. Server log shows 0 errors across the whole verification.

## Restored known credentials (for the UI dev)

Throwaway account (only account left in `rl_tradespeople` after T7 cleanup):

- **id** `6e2a135e-7eb3-4221-afd7-ce703e850b0e`
- **email** `t2t3-verify.20260919@example.com` (original T2-T3 email — restored via PATCH)
- **password** `Verify-Pw-2026!` (restored via change-password)
- **displayName** `T2T3 Verify` (restored)
- **phoneNumber** `null` (original state)

Final login with these creds → 200. The T2-T3 org + OWNER membership rows are untouched.

## Deviations

- None from the brief's contract. Notes for Sentinel/Probe:
  - The one `server_not_configured` during pool cold-start is transient pooler latency — retry-safe, no code change.
  - Vitest cold-run flake remains as documented in T2-T3 (unrelated to T7 files).
  - Commits: none — controller handles git per repo convention.

## Files changed
- `packages/shared/src/types.ts` — `AuthUser.phoneNumber`
- `apps/api/src/services/auth-service.ts` — row + update functions
- `apps/api/src/routes/auth.ts` — schemas + PATCH /profile + POST /change-password
- `apps/api/src/routes/auth.test.ts` — route tests
- `apps/api/src/services/auth-service.test.ts` — service tests