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
| `API_BASE_URL` (web) | `http://localhost:3001` | next.config.ts rewrite target — **read at BUILD time, not runtime** |

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

## Running it locally

Auth needs Postgres. See `docs/local-dev.md` for the no-Docker database
(`npm run db:local --workspace=apps/api`) and the two env vars the API reads.

## Build-time gotcha: `API_BASE_URL` is baked in

Next.js compiles `rewrites()` into `.next/routes-manifest.json` during `next build`.
Setting `API_BASE_URL` only for `next start` does **nothing** — the shipped build keeps
whatever destination it was compiled with. Point the proxy at a different API by
setting the variable for the **build**:

    API_BASE_URL=https://api.example.com npm run build

Confirmed by inspecting `routes-manifest.json` after each build (see the E2E script
header for how it is used to aim the app at a stub).

## Session wiring (dashboard)

`lib/session.tsx` resolves identity once per dashboard mount; `lib/session-core.ts`
holds the branch logic and is deliberately React-free and `document`-free so it can
be tested headlessly.

| `resolveSession` sees | Status | Dashboard |
| --- | --- | --- |
| no token | `unauthenticated` | provider redirects to `/login` |
| `200` + valid user | `authenticated` | shell renders with the real name/email |
| `401` / `404` | `expired` | cookie cleared, redirect to `/login` |
| `503` / `500` | `error` (retryable) | "Can't load your schedule" + Try again |
| `400` / network failure | `error` | same, no retry on 4xx |

Because the middleware gate checks **presence only**, a stale or forged cookie still
reaches the shell — `SessionGate` is what turns that into a bounce. It also holds the
shell back until the session is verified, so fixture content never flashes for a
visitor whose token just expired (asserted server-side: `/dashboard` with a cookie
returns 200 containing no fixture data).

`useDashboardData()` now exposes `sessionUser` (live) and sources `tradeLabel` from
`session.displayName` — the sidebar footer and SMS previews show the signed-in
tradesperson. `user` (phone, hours, SMS template) is still `userFixture`: **sample
data**, labelled as such in Settings, until a profile API exists. Schedule data
(bookings, escalations) likewise remains fixtures.

API calls must attach the token themselves — `authedFetch()` in `lib/auth-client.ts`
does this; the API reads `Authorization`, not the cookie.

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

## Verified — session wiring

| Gate | Result |
| --- | --- |
| `npm run test --workspace=apps/web` | **11/11** session-core assertions (every branch, injected fetch) |
| Browser E2E (`tests/e2e/session-wiring.e2e.mjs`) | **12/12** in headless Chrome over CDP |
| SSR `/dashboard` with a cookie | 200, contains no fixture data or identity |
| Gate | no cookie → `307 /login`; `/login` → 200 |

The E2E drives a real browser against a stub API keyed by token value, covering:
login form → `/dashboard` with the real `displayName`; Settings showing the live
email; `stub.expired` → bounce to `/login` **with the cookie cleared**;
`stub.serverdown` → the error state **with no fixture schedule leaking**; sign-out
→ `/login` with the cookie cleared.

## Limitations / next

1. **Session cookie is JS-readable** (non-httpOnly), so XSS can exfiltrate it.
   Bearer-in-localStorage-equivalent risk. Upgrade path: have the API set an
   httpOnly `SameSite=Lax` cookie and add CSRF protection — requires the API to
   own cookie issuance and the web to send credentials cross-origin or stay proxied.
2. **No live-DB run yet.** No Postgres/Docker on this machine; migration 004 is
   unapplied. Happy path (register→login→me) is covered by mocked-pg HTTP tests
   but has never run against a real database. First Supabase run is unproven.
3. **Schedule data is still fixtures.** Identity is now live (`/api/auth/me`), but
   bookings/escalations and the profile fields (phone, hours, SMS template) are
   fixture-backed — no jobs/profile API exists. `authedFetch()` is in place for when
   one lands.
4. Password reset, email verification, rate limiting on login, and account
   lockout are not implemented.
