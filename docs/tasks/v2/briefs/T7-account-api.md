# T7 — Account profile API: PATCH /api/auth/profile + POST /api/auth/change-password

Context: the new settings page (T5) needs real account editing — change display name, email,
phone number, password. The schema supports it (rl_tradespeople: display_name, email unique
lower, password_hash, phone_number nullable). NO update endpoints exist today (auth has only
register/login/me + Google OAuth).

## Repo conventions (apps/api — verified)
- ESM + NodeNext: relative imports use .js suffix.
- Lazy Pool pattern + ssl rejectUnauthorized false (copy from services/auth-service.ts or organization-service.ts).
- Auth routes: apps/api/src/routes/auth.ts (authRouter) — reads existing register/login/me for error shapes; use them.
- Auth service: apps/api/src/services/auth-service.ts — add functions there; scrypt hash/verify helpers live in this file (reuse for password change — do NOT reimplement).
- Env: repo-root H:\tradescheduling\.env (src/env.ts loads ../../../.env).
- Tests: vitest; existing tests in apps/api/src/routes/auth.test.ts + services/auth-service.test.ts — add cases matching their style.
- Run: npm run typecheck --workspace=@tradescheduler/api && npm run test --workspace=@tradescheduler/api.

## 1) Shared type (packages/shared/src/types.ts — TYPES-ONLY)
Extend AuthUser: add `phoneNumber: string | null;` (after displayName). Update the comment noting the tradesperson row carries it. Do not touch other types. (Register/login/me responses now include phoneNumber — populated from the row.)

## 2) PATCH /api/auth/profile  (requireAuth — middleware/auth.js)
Body (JSON, partial, zod-validated; empty body -> 400 invalid_body):
- displayName?: string, 1..80 chars (match db check)
- email?: string, valid + lowercase (match db check email = lower(email)); must be UNIQUE — 409 { error: 'email_taken' } when another tradesperson holds it
- phoneNumber?: string | null — E.164-ish ^\+?[1-9][0-9]{1,14}$ (match db check); null/empty string clears it
At least one field required. Update ONLY provided fields. All-or-nothing: build the UPDATE with provided columns.
Response 200: { user: AuthUser } (with phoneNumber). 401 via middleware; 409 email_taken; 400 invalid_body (also when email already belongs to SELF — treat as no-op success, not a conflict).
Table env override: TRADESPEOPLE_TABLE ?? 'rl_tradespeople' (auth-service already uses this — follow it).
Row-level: update by id = req.auth.userId; then SELECT the row and return the fresh AuthUser (id, email, displayName, phoneNumber).

## 3) POST /api/auth/change-password  (requireAuth)
Body { currentPassword: string, newPassword: string } (zod; missing -> 400 invalid_body).
- Verify currentPassword against the row's password_hash with the SAME verify used by login (auth-service) — mismatch -> 401 { error: 'invalid_credentials' }.
- newPassword length >= 8 (match MIN_PASSWORD_LENGTH in the web's validation.ts = 8; state it in the error? keep 400 invalid_body with a friendly letter: respond 400 { error: 'invalid_body' } — the UI validates length client-side first).
- Hash with the same scrypt settings as register; update row. 200 { ok: true }.

## 4) Tests
Add vitest cases in the existing files' style: PATCH happy path (each field), 409 email_taken, 400 empty body, 401 unauth; change-password happy path, 401 wrong current, 400 short new password, 401 unauth. Follow the existing test harness (look at auth.test.ts — it mocks the service or the pool? replicate its approach exactly).

## 5) Live verification (full)
1. typecheck + full test suite green.
2. Boot: API must be up on :3001 (curl http://localhost:3001/api/health — note: health route is GET /api/health). If a previous tsx instance is running, it has the OLD code — kill it (taskkill //PID <pid> //F or find the port: netstat -ano | grep 3001) and start fresh: cd /h/tradescheduling/apps/api && nohup npx tsx src/index.ts > /tmp/ts-api.log 2>&1 &. Wait for health.
3. Use the throwaway account (real creds in docs/tasks/v2/reports/T2-T3-dashboard-api.md "Test data"; read the file for actual values). Login -> token. For each new endpoint: happy path (PATCH displayName -> 200 with updated user; PATCH phoneNumber -> 200; PATCH email -> 200 (change to a NEW email, note it); same-email no-op -> 200; change-password -> 200 {ok:true}; then login with the NEW password -> 200), error paths (PATCH duplicate email -> 409; PATCH empty body -> 400; change-password wrong current -> 401; change-password short -> 400). Record all.
4. IMPORTANT: at the end, put the throwaway account back to a known state (restore original email/password/displayName via the new endpoints — or via direct SQL through a scratch script) and note the final known creds in your report so the UI dev can log in.

## Report
Per-verification-step results (commands + status + body snippets), tests added (count, green), the restored known credentials, deviations.
