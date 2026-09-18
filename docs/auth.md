# Auth (JWT) — verified 2026-09-18

The tradesperson dashboard auth stack: Postgres-backed accounts, scrypt password
hashing, JWT sessions, and a cookie gate in front of `/dashboard`.

## Shape

    browser ──fetch /api/auth/*──▶ Next.js (web :3100)
                                     │ rewrite (next.config.ts)
                                     ▼
                          Express API (:3001, API_BASE_URL)
                                     │
                                     ▼
                          Postgres (ts_tradespeople)

The browser only ever talks to the web origin. `/api/*` is rewritten to the API
by `next.config.ts`, so the session cookie is first-party (no CORS, no
cross-site cookie handling) and no API URL is baked into client code.

## Env (API)

| Var | Default | Behaviour when unset |
| --- | --- | --- |
| `JWT_SECRET` | — | `500 server_not_configured` on any token issue/verify |
| `JWT_ISSUER` | `tradescheduler` | — |
| `DATABASE_URL` | — | `503 server_not_configured` on any query |
| `TRADESPEOPLE_TABLE` | `ts_tradespeople` | — (test seam) |

| Var | Default | Used by |
| --- | --- | --- |
| `API_BASE_URL` (web) | `http://localhost:3001` | next.config.ts rewrite target |

The API boots cleanly with zero env — it degrades to explicit 5xx, never a crash.

## Endpoints

| Route | Success | Failures |
| --- | --- | --- |
| `POST /api/auth/register` | `201 {token, user}` | `400 invalid_body`, `409 email_taken`, `503` (no DB), `500` (no secret) |
| `POST /api/auth/login` | `200 {token, user}` | `400 invalid_body`, `401 invalid_credentials`, `503`, `500` |
| `GET /api/auth/me` | `200 {user}` | `401 missing_token`, `401 invalid_token`, `404 invalid_token` (deleted account), `500` |

`user` is `AuthUser = { id, email, displayName }`. `password_hash` is never returned.
Login answers unknown-email and wrong-password with the same 401 body — no account
enumeration.

## Passwords

`node:crypto` scrypt — no native dependency, no build step on Windows.
Stored form: `scrypt$N$r$p$saltB64$hashB64` (self-describing, so params can be
raised later without invalidating existing hashes).

- `N=16384`, `r=8`, `p=1`, 64-byte key, 16-byte random salt per hash.
- **N=32768 fails**: it exceeds OpenSSL's default 32 MiB `maxmem`
  (`ERR_CRYPTO_INVALID_SCRYPT_PARAMS`). Raise `maxmem` too if bumping N — see the
  comment in `services/auth-service.ts`.
- Verification is `timingSafeEqual` on equal-length buffers; malformed stored
  strings return `false` instead of throwing.
- Register does a cheap duplicate check before hashing, but the unique index is
  the real guard — a race still lands on `409` via the constraint.

## Sessions

- JWT, `HS256`, `sub` = tradesperson id, issuer `tradescheduler`, 7-day TTL.
- `middleware/auth.ts#requireAuth` reads `Authorization: Bearer <jwt>` and sets
  `req.auth = { userId }`. Semantics intentionally mirror the pre-existing inline
  guard in `routes/dashboard/escalations.ts`; that route was left untouched.
- The web stores the token in a **non-httpOnly** `ts_session` cookie
  (`lib/auth-client.ts`) — see Limitations.

## Web gate

`src/middleware.ts` (matcher `/dashboard/:path*`, `/login`, `/register`):

| Cookie | Path | Result |
| --- | --- | --- |
| absent | `/dashboard/*` | `307 → /login` |
| present | `/login`, `/register` | `307 → /dashboard` |
| absent | `/login`, `/register` | `200` |
| present | `/dashboard/*` | `200` |

The gate checks **presence only** — the JWT signature is verified by the API on
every data request. A forged cookie gets you a dashboard shell, not data.

`app/layout.tsx` is now bare; the sidebar/header/bottom-nav shell moved to
`app/dashboard/layout.tsx` so auth pages render standalone.

## Files

- `apps/api/src/db/migrations/004-create-tradespeople-table.sql` — `ts_tradespeople`
  (uuid pk, unique lowercased email, `display_name` 1–80, `password_hash`),
  RLS enabled + `anon`/`authenticated` revoked: server-side access only.
- `apps/api/src/services/auth-service.ts` — hashing + the three queries.
- `apps/api/src/middleware/auth.ts` — `requireAuth`.
- `apps/api/src/routes/auth.ts` — the three endpoints.
- `apps/web/src/middleware.ts`, `apps/web/src/lib/auth-client.ts`,
  `apps/web/src/app/login/page.tsx`, `apps/web/src/app/register/page.tsx`.
- `packages/shared/src/types.ts` — `AuthUser`, `AuthResponse`, `AuthError`.
- Sign-out: `app/dashboard/settings/page.tsx` (clears the cookie, returns to `/login`).

## Verified

- API: 26 auth tests green — `services/auth-service.test.ts` (9) and
  `routes/auth.test.ts` (17, real HTTP server + mocked `pg`), covering the full
  error taxonomy including tampered tokens, wrong-secret tokens, and
  no-enumeration login.
- Prod web :3100 — gate matrix above (307/200 table), `/login` + `/register` 200.
- Proxy — every contract path through the web origin returns the right
  status/body: login/register `503 server_not_configured` (no env),
  malformed body `400 invalid_body`, short password `400`, `/me` no token
  `401 missing_token`, bogus token `500 server_not_configured`.
- API typechecks clean for all auth files.

## Limitations / next

1. **Session cookie is JS-readable** (non-httpOnly), so XSS can exfiltrate it.
   Bearer-in-localStorage-equivalent risk. Upgrade path: have the API set an
   httpOnly `SameSite=Lax` cookie and add CSRF protection — requires the API to
   own cookie issuance and the web to send credentials cross-origin or stay proxied.
2. **No live-DB run yet.** No Postgres/Docker on this machine; migration 004 is
   unapplied. Happy path (register→login→me) is covered by mocked-pg HTTP tests
   but has never run against a real database. First Supabase run is unproven.
3. **Dashboard data is still fixtures.** Nothing attaches the token to dashboard
   fetches yet, and `/api/auth/me` isn't consumed — no signed-in identity in the UI.
4. Password reset, email verification, rate limiting on login, and account
   lockout are not implemented.
