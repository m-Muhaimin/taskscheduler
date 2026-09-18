# CP06 — Real Google OAuth wiring

Status: **shipped on a local branch (not pushed)** — commit `CP06`.

Replaces the interim per-user env refresh token (`GOOGLE_REFRESH_TOKEN_<userId>`)
with the standard Google OAuth auth-code flow: connect from the dashboard
settings, store tokens per tradesperson, and let the whole scheduling pipeline
authenticate against Google Calendar from that store. `defaultAuth` keeps its
`(userId, calendarId) => Promise<{ client, calendarId }>` signature, so the
worker, reschedule-service and scheduling-engine needed **zero changes**.

## What shipped

| Piece | File | Notes |
|---|---|---|
| Migration 009 | `apps/api/src/db/migrations/009-create-google-oauth-tables.sql` | `ts_google_credentials` (PK = user_id → ts_tradespeople, cascade delete; access/refresh token, expiry, scope, calendar_id), `ts_oauth_states` (one-time consent states, 10-min TTL, expiry index), RLS deny-by-default |
| OAuth service | `apps/api/src/services/google-auth-service.ts` | Lazy pool + `GOOGLE_CREDENTIALS_TABLE` / `GOOGLE_OAUTH_STATES_TABLE` overrides (house `X_TABLE` convention). `generateAuthUrl` (offline + consent + `calendar` scope), `exchangeCodeForTokens`, `save/load/deleteCredentials`, `create/consumeOauthState` (atomic single-use delete). Env-free boot |
| Pipeline auth | `apps/api/src/services/calendar-service.ts` | `defaultAuth` now loads stored credentials (google-auth-service.loadCredentials) → OAuth2Client w/ access+refresh+expiry; rejects with a clear “not connected” error when absent |
| Routes | `apps/api/src/routes/google-oauth.ts` | `GET /start` (JWT → `{url}`), `GET /callback` (public; exchange → store → set profile `google_calendar_id='primary'` → 302 to web settings), `GET /status`, `DELETE /` (disconnect). Mounted at `/api/auth/google` **before** `/api/auth` in `app.ts` |
| Profile update | `apps/api/src/services/booking-service.ts` | `setUserGoogleCalendarId(userId, id|null)` |
| Shared types | `packages/shared/src/types.ts` | `GoogleCredentials`, `GoogleConnectionStatus`, `GoogleAuthStartResponse`, `GoogleOAuthError(Response)` |
| Web UI | `apps/web/src/components/google-calendar-card.tsx` + settings page | Status line, Connect (via authedFetch → consent URL → browser), Disconnect, one-shot `?google=connected|denied|error` banner |
| Build fix (pre-existing) | `apps/web/package.json` + lockfile | recharts 3.8.0 imports `react-is` (its peer dep) but it was never installed → `next build` failed on `ui/chart.tsx`. Added `react-is@^19.3.0` |
| Migration registry | `apps/api/scripts/local-db.mjs` | Registered 009 (the list is hardcoded, so the migration would NOT have run without this) |

## Tests

- `google-auth-service.test.ts` — 12: consent URL params, config guard, store CRUD (+ ISO mapping from timestamptz Date, null shapes, table overrides), state create/consume incl. unknown/expired.
- `routes/google-oauth.test.ts` — 12: 401s, consent URL + state creation, 503 on missing config, denied → `?google=denied`, invalid state → 400, exchange+store+primary+redirect happy path, status, disconnect.
- `booking-service.test.ts` — +3 (14 total) for `setUserGoogleCalendarId`.
- Full suite: **283 passed + 1 pre-existing failure** (reschedule-service confirmReschedule, line 427) of 284. The worker cold-transform flake (first vitest run after edits times out at 5s and its abandoned continuation can double-count `createEscalation`) is pre-existing and repeat-runs green.
- `tsc --noEmit`: exactly the 2 pre-existing errors (RescheduleLogEntry TS2304, Escalation TS2694).
- `npm run build --workspace=apps/web`: green (settings route 4.62 kB).
- `npm run db:local`: 009 applied; ran twice → idempotent.

## Config needed to actually use this

API env (read per call, never at boot):

```
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback   # public URL in prod
WEB_BASE_URL=http://localhost:3000                                     # callback redirect target
```

Google Cloud Console: create an OAuth client ID (Web application); add the
redirect URI above; on the consent screen add scope
`https://www.googleapis.com/auth/calendar` and set the app to **Testing**
while developing (the `prompt=consent` flag means every connect re-asks).

`GOOGLE_REFRESH_TOKEN_<userId>` is now dead — existing env tokens can be
removed once a user has re-connected through Settings.

## Decisions worth keeping

- **`/start` returns JSON, not a 302**: the web must attach the JWT as an
  `Authorization` header (it lives in the `ts_session` cookie, which the API
  does not read). `authedFetch` then redirects the browser to the returned URL.
- **State stored in DB with TTL, consumed atomically** (`delete … returning`)
  so replaying a callback cannot mint tokens twice.
- **`calendar_id 'primary'` on connect**: kept in `ts_google_credentials`
  (status) and mirrored onto `ts_tradespeople.google_calendar_id` (pipeline);
  disconnect clears both.
- **`exchangeCodeForTokens` never unit-tested against the network** — routes
  mock it; the service is exercised only for its config guard.

## Follow-ups (out of scope here)

- Store + display the connected Google account email (needs an extra
  `userinfo`-scoped call or id_token decode).
- Reconnect when refresh tokens are revoked (detect `invalid_grant` and
  surface “reconnect in Settings” in the worker escalation content).
- Sweep the `ts_oauth_states` table (a `pg_cron` purge or enforce the TTL in
  a unique partial index — rows are already filtered at consume time).

## Addendum — local env loading (fixed so this actually runs)

The API previously had **no `.env` loader at all** (no dotenv, no
`--env-file`), so the root `.env` with `TWILIO_*`/`SUPABASE_*/DATABASE_URL`
was never read by `npm run dev`/`worker`. Fixed with a zero-dependency
bootstrap, `apps/api/src/env.ts`:

- `process.loadEnvFile()` (Node 22+, we run 24) reads the **repo-root**
  `.env` via `new URL('../../../.env', import.meta.url)` (path is
  CWD-independent; note it's *three* levels up from `src/`).
- Imported first in `src/index.ts` and `src/worker/index.ts`; other modules
  keep the env-free boot rule.
- Missing/unreadable `.env` is swallowed — CI/prod inject their own env.
- Existing `process.env` values win (never overridden).

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` /
`WEB_BASE_URL` were added to the local root `.env` (gitignored, uncommitted).
Verified live: API boots, `/api/health` ok, `/api/auth/google/start` → 401
`missing_token` without a JWT (route mounted, gate working).

Notable local-dev gap: `.env` has **no `JWT_SECRET`**, so JWT-issuing routes
(login/register) and JWT-gated calls (start/status/delete, web) can't fully
run locally until one is added — pre-existing, out of scope here.


---

## Addendum 3 — Live SMS-worker smoke test + the bugs it caught (2026-09-19)

Ran the full reschedule journey through the REAL worker against local Postgres + the
connected Google account, with `TWILIO_SMS_DRY_RUN=true`:

1. `RESCHEDULE` → offer SMS (3 real freebusy-derived slots), conversation `offering_slots`
2. `1` → confirm-ask SMS, conversation `awaiting_slot_choice` + selected slot
3. `CONFIRM` → **real Google Calendar event inserted** (`n1ntt40tv4c4ii1repgoap9c84`),
   booking → `confirmed` + moved to chosen slot, conversation `completed`

All three jobs `completed` with zero errors; the new event is readable via the production
auth path on `primary`, and all three outbound SMS bodies appeared in the dry-run log
(offer, confirm-ask, confirmation with correct local time).

### Bugs found & fixed (unit tests added/updated for each)
1. **`createConversation` (and `updateConversation`) mangled `offered_slots`** — pg's
   `prepareValue` serializes JS *arrays* as Postgres array literals, not JSON, so the
   json column received invalid JSON. Fix: `JSON.stringify` before parameter binding.
2. **`processSlotChoice` / `confirmReschedule` looked conversations up by ID with a
   phone** — defaults were `getConversation` (uuid keyed) but callers pass the phone
   (`invalid input syntax for type uuid`). Fix: defaults now `getConversationByPhone`.
3. **`createCalendarEvent` inserted with `calendarId: ''`** — the reschedule confirm
   path passes `''`; Google rejects it (unit tests mocked the event fn, hiding it).
   Fix: resolve `calendarId || authResult.calendarId || 'primary'` (also makes
   `defaultAuth` return the stored calendar id for `''`).
4. **Stale test mock** — `confirmReschedule`'s success test resolved `{id}` but
   `createCalendarEvent` needs `{data:{id}}` (matches the live Google contract).
5. **Test-pollution flake (pre-existing)** — `afterEach` `restoreAllMocks()` stripped
   the module-level `mockAuthFn` impl after the first test; the late-running success
   test got `undefined` from auth. Fix: re-establish the impl in that test.
6. **Worker env import path** — `src/worker/index.ts` imported `./env.js`
   (nonexistent) instead of `../env.js`; the worker crashed at boot (CP06 env-loader
   wiring landed after the earlier check).

**New `TWILIO_SMS_DRY_RUN` seam** in `sms-service.ts` (`sendSms`): validates `to`/`from`
first, then short-circuits before creds/Twilio with a `dry-run-*` messageSid and logs
the would-be body. Used for the smoke test; no real SMS is ever sent without a consent
record (CLAUDE.md hard rule).

Test state: **all 238 service tests pass** (baseline 1 pre-existing failure fixed).
Remaining baseline items unchanged: 2 tsc errors (RescheduleLogEntry, Escalation).
