# RidgeLine Web Replacement - Plan

**Status:** Approved for planning | **Branch:** main (commits local) | **Date:** 2026-09-19

## Goal

Replace `H:\tradescheduling\apps\web` with the branded frontend from
`H:\ridgeline-dashboard-auth-landing\apps\web`, keep it **as-is**
(Next 14.2.5 / React 18 / Tailwind 3.4 - user decision), and wire it to the
existing `apps/api` so the RidgeLine UI runs on the real auth, session, proxy,
and Google Calendar stack.

## Decisions (locked)

1. **Drop-in replace as-is.** No framework upgrade. RidgeLine's design is the
   product; stack parity with the API repo is not required for a standalone web
   workspace.
2. **Accepted tradeoffs (documented, not silent):**
   - Next 14.2.5 reintroduces known CVEs previously documented for removal in
     `nextjs-upgrade.md`. Mitigation: pin exact versions already in the
     RidgeLine lockfile; `npm audit` tracked as known follow-up.
   - CLAUDE.md hard rule "UI: Use shadcn/ui primitives" is **superseded for
     apps/web** by this decision; RidgeLine components are hand-rolled but
     high-quality and consistent. Hard rules for SMS consent, reschedule
     safety, and Twilio signature verification are API-side and **unaffected**.
   - Existing `apps/web` tests are deleted with the old app; the session-core
     regression test is ported for the new cookie layer (Task 7).
3. **Package name** stays `@tradescheduler/web` (root scripts address the
   workspace by folder `apps/web`). `npm install` at root refreshes the
   lockfile for the new dep tree.
4. **"Business name" field is dropped** from signup: the API has no business
   column; sending it would be a lie.
5. **Forgot-password stays a mock success** (no auth email infra exists).
   A real `POST /api/auth/forgot-password` is an OPTIONAL follow-up.
6. **Dashboard data stays fixtures** (RidgeLine `lib/fixtures.ts`), matching
   current state - bookings/schedule were never API-backed except escalations.
   Wiring the RidgeLine escalation banner to the existing
   `GET /api/dashboard/escalations` is an OPTIONAL stretch task.
## API contract the new web must satisfy (verified against api source)

| Endpoint | Method | Body -> Response | Errors |
|---|---|---|---|
| /api/auth/register | POST | {displayName, email, password} -> 201 {token, user} | 400 invalid_body, 409 email_taken, 503 server_not_configured |
| /api/auth/login | POST | {email, password} -> 200 {token, user} | 400, 401 invalid_credentials, 503 |
| /api/auth/me | GET | Bearer -> 200 {user} | 401/404 invalid_token |
| /api/auth/google/start | GET | Bearer -> 200 {url} | 401 |
| /api/auth/google/status | GET | Bearer -> 200 {connected, calendarId} | 401 |
| /api/auth/google | DELETE | Bearer -> 200 {ok} | 401 |
| /api/health | GET | - -> 200 {status:ok} | - |

- register: password min 8, displayName 1-80 chars. RidgeLine validation
  (MIN_PASSWORD_LENGTH = 8) already matches the API.
- Token: 7-day JWT carried in the `ts_session` cookie; the API reads it from
  the `Authorization: Bearer` header - the web must attach it on every call.
- `/api/*` must be proxied through the web origin (web :3000 -> API :3001) so
  the cookie stays first-party and no CORS config is needed (API has none).

## Tasks

### Task 1 - Replace directory + workspace refresh
- Files: `apps/web` (delete old, copy RidgeLine apps/web), root package-lock.
- Exclude from copy: node_modules/, .next/, tsconfig.tsbuildinfo,
  next-env.d.ts (regenerates), any .git*.
- apps/web/package.json: add `"@tradescheduler/shared": "0.1.0"` to
  dependencies (needed for the GoogleConnectionStatus type import); keep name
  @tradescheduler/web; keep dev script (defaults to :3000).
- Run `npm install` at root. Verify `npm run dev --workspace=apps/web` boots
  on :3000 and `npm run build --workspace=apps/web` succeeds.
- Keep the RidgeLine next.config.mjs shell; Task 4 adds rewrites.

### Task 2 - Real auth in lib/auth.ts (keep the exported signature)
- File: apps/web/lib/auth.ts - replace mock bodies, KEEP the exported API
  (Session, AuthField, AuthError with field, signIn, signUp,
  requestPasswordReset) so forms/components are untouched.
- Add to the same file (or sibling lib/session.ts):
  - SESSION_COOKIE = "ts_session", SESSION_MAX_AGE_SECONDS = 604800
  - setSessionCookie / clearSessionCookie / getSessionToken (document.cookie,
    samesite=lax, secure only on https) - port from old src/lib/auth-client.ts
  - authedFetch(path, init) - fetch with Authorization: Bearer from the cookie
  - authErrorMessage(status, error) mapper - port verbatim from old code
- signIn: POST /api/auth/login -> {token,user}; setSessionCookie(token) on
  success; return {name: user.displayName, email: user.email}. Error mapping:
  401 -> AuthError("Email or password is incorrect."), 400 -> email field
  error, 503 -> generic server-not-configured copy.
- signUp: POST /api/auth/register with {displayName: values.name, email,
  password} (business dropped - decision 4). Success -> setSessionCookie ->
  {name, email}. 409 -> AuthError("An account with this email already
  exists. Sign in instead.", "email").
- requestPasswordReset: keep mock resolve (decision 5), comment why.
### Task 3 - Drop "Business name" from signup
- File: apps/web/components/auth/signup-form.tsx
- Remove the business TextField, values.business, its validation; FieldName
  drops "business"; field order becomes name -> email -> password.

### Task 4 - API proxy + auth guard middleware
- File: apps/web/next.config.mjs - add async rewrites() with
  source /api/:path* -> destination ${API_BASE_URL}/api/:path*,
  API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001"
  (port the old next.config.ts body into the .mjs shell).
- File: apps/web/middleware.ts (project root - Next 14 convention; no src/):
  presence-gate on ts_session cookie; redirect /dashboard/* -> /login when no
  cookie; redirect signed-in users off /login, /signup, /forgot-password ->
  /dashboard. Matcher: ["/dashboard/:path*", "/login", "/signup",
  "/forgot-password"]. Port from old src/middleware.ts with the RidgeLine
  route set.

### Task 5 - Session provider + real identity in the chrome
- New file: apps/web/lib/session.tsx (use client) - provider checks
  getSessionToken(); on mount authedFetch("/api/auth/me") -> {user} in
  context; useSession() -> {user, signOut}; signOut clears cookie + pushes
  /login. Port semantics from old src/lib/session.tsx.
- Wrap only the dashboard group: apps/web/app/dashboard/layout.tsx becomes a
  client boundary rendering SessionProvider around NavRail/TopBar (marketing
  and auth pages don't need it).
- apps/web/components/dashboard/top-bar.tsx: replace hard-coded "Marcus
  Jenner" with useSession().user.displayName (fixture fallback while
  loading). Check remaining mock-name references per page.

### Task 6 - Settings: Google Calendar card + Account section
- File: apps/web/app/dashboard/settings/page.tsx - keep the three product
  toggles (mock, local state); ADD in RidgeLine design:
  - Google Calendar section (port logic from old
    src/components/google-calendar-card.tsx: status fetch on mount, Connect
    -> authedFetch /api/auth/google/start -> window.location.assign(url),
    Disconnect -> DELETE, one-shot ?google= banner with history.replaceState
    strip, GoogleConnectionStatus from @tradescheduler/shared). Style as a
    bordered row panel matching the toggles list.
  - Account section: sessionUser.name + email, RidgeLine-styled Sign out
    button calling signOut().

### Task 7 (stretch) - Port regression tests
- File: apps/web/tests/session-core.test.mts (runs under tsx,
  npm run test --workspace=apps/web): unit-test the cookie round-trip
  (get/set/clear) + authErrorMessage mapping, porting the old session-core
  test's jsdom-free style.

### Task 8 - Docs + repo hygiene
- CLAUDE.md: update Tech Stack (web now Next 14 / React 18 / Tailwind 3.4;
  note the shadcn-rule exception); commands unchanged (folder-based); add the
  audit caveat; note RidgeLine as the web's source lineage.
- This file stays as the ADR record.
- Commit locally: "web: replace with RidgeLine branded UI + wire real auth".
  Do not push unless asked.
## Verification (live smoke, matches prior smoke-test rigor)

1. npm install (root), npm run build --workspace=apps/web clean, dev boots
   :3000, /api/health proxied OK.
2. Auth guard: /dashboard with no cookie -> redirect /login.
3. Sign up a fresh user via the RidgeLine signup form (name/email/password)
   -> lands on /dashboard, ts_session cookie present; /api/auth/me via
   authedFetch returns the same user. Sign out -> cookie cleared -> guard
   trips on /dashboard.
4. Sign in with the existing test user -> dashboard shows real display name.
5. Settings -> Google Calendar: Connect -> consent -> callback
   ?google=connected banner -> status connected:true (primary); Disconnect ->
   connected:false. (Real Google account; no SMS involved.)
6. Regression: npm run test --workspace=apps/api (238 tests) still green -
   API untouched by this change.

## Risks

- Next 14 CVEs (accepted; audit follow-up tracked). No --force installs.
- next/font/google at build time requires network.
- Tailwind 3.4 config-based classes are self-contained in RidgeLine; each
  workspace owns its own postcss/tailwind config - no cross-app collisions.
- Old web deleted: /dashboard/jobs/[jobId] detail and the reschedule-history
  list are lost unless ported (fixture-driven; not in RidgeLine's IA) -
  accepted, flag in the commit message.
