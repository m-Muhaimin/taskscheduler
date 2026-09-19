# T4 — Adopt the new dashboard UI into apps/web (merge, not copy)

Context: the live `H:\tradescheduling` API now serves real dashboard endpoints (T2/T3 done).
Replace the current `apps/web` UI with the enhanced design from
`H:\ridgeline-dashboard-auth-landing\apps\web` while KEEPING the real wiring this repo already
has (auth, session, proxy, tests). After T4 the app builds green on fixtures; T5 (next task)
swaps fixture imports for real API calls. T4 owns apps/web exclusively.

## Source of truth for the new UI
`H:\ridgeline-dashboard-auth-landing\apps\web` — read its structure first:
- app/**, components/**, lib/{hooks,validation,types,fixtures}.ts, app/globals.css (1088 lines),
  app/layout.tsx (Bricolage Grotesque + IBM Plex via next/font + pre-paint theme script),
  tailwind.config.ts, package.json
- Its lib/auth.ts is a MOCK — you MUST NOT copy it (see Adapter below).

## Copy over (replace current equivalents)
- app/** page + layout files from the new repo EXCEPT anything listed under "Keep".
- components/** (entire new design system: dashboard/*, ui/*, auth/*, layout/*).
- app/globals.css, app/layout.tsx, tailwind.config.ts.
- lib/hooks.ts, lib/validation.ts, lib/fixtures.ts, lib/types.ts (fixture types — id:number stays for now; T5 changes to string).

## Keep from the current repo (do NOT overwrite)
- next.config.mjs (API proxy rewrite /api/:path* -> API_BASE_URL ?? localhost:3001; new repo's config is an EMPTY file — do not copy it)
- middleware.ts (ts_session cookie gate on /dashboard + auth pages)
- lib/auth.ts (REAL implementation: signIn/signUp/signOut/requestPasswordReset, AuthError with field) — verify the new pages' imports match its exports; the new repo's mock lib/auth.ts must NOT end up in apps/web
- lib/session.tsx + lib/session-core.ts (SessionProvider, useSession, setSessionCookie/clearSessionCookie)
- tests/** + package.json test script (npm run test --workspace=apps/web -> tsx tests/session-core.test.mts)
- lib/api-client.ts or wherever the REAL authedFetch lives (the current settings page used it for Google OAuth)
- app/dashboard/settings/page.tsx — merge, don't delete (see Settings seam)

## Seam merges (the actual work)
1. SessionProvider: new dashboard/layout.tsx renders ONLY DashboardShell — wrap it in the CURRENT SessionProvider (from lib/session.tsx) like the existing dashboard/layout.tsx does.
2. Nav-rail user block: new nav-rail.tsx hardcodes "Marcus Jenner" + <Link href="/login"> sign-out. Replace with a small "use client" UserMenu component (new file, e.g. components/layout/user-menu.tsx) that reads useSession() -> displayName ?? "User", and signs out via the real session clear + router.push('/login'). Keep the rail's design.
3. Greeting: dashboard page hardcodes "Good morning, Marcus." — make the greeting name come from useSession (small client component or inline hook usage). Keep the fixture DATA for now.
4. Signup adapter (decision: keep business field in UI, do NOT send to API): the new signup form/component passes {name, business, email, password}; the real lib/auth.ts signUp expects {name, email, password}. Add a thin adapter in lib/auth.ts (or the form's submit handler): accept the form payload, drop `business`, call real signUp. Preserve AuthError.field mapping (email_taken etc.) on the form. Do NOT add business to the register API call.
5. Settings + Google OAuth: the current settings page calls authedFetch on /api/auth/google/status, /api/auth/google/start, DELETE /api/auth/google (see current app/dashboard/settings/page.tsx). The new repo's settings page/panel replaces it visually — port those three real calls (status on mount, start -> window.location = url, delete on disconnect) into the new settings UI. No fixture data for OAuth.
6. Auth pages parity: adopt the new repo's login/signup pages where present. If the new repo has NO reset-password page, KEEP the current app/auth/reset-password (it was fixed in-session).
7. package.json deps: diff the two package.json files; ADD any deps the new UI needs that apps/web lacks (lucide-react@0.427.0, clsx) at the SAME versions as the new repo. Keep @tradescheduler/shared dep + test script + tsx. Do not touch next version (14.2.5 both).

## Rules
- Do not copy the mock lib/auth.ts; do not copy the new next.config.mjs; do not delete tests/.
- The new UI imports @/lib/hooks (useMockLoad with MOCK_LATENCY_MS=600) — leave as-is, T5 replaces data sources.
- TypeScript must compile: tsc --noEmit via web workspace typecheck if present; otherwise the build's own TS check.

## Verification (all three)
1. npm run build --workspace=apps/web  (Next 14.2.5 build; must be green — the real gate)
2. npm run test --workspace=apps/web   (session-core tests green)
3. Boot: npm run dev --workspace=apps/web with API_BASE_URL -> http://localhost:3001 (API tsx instance from T2/T3 may already be running on 3001 — check FIRST: curl http://localhost:3001/api/health; if down, start it from apps/api with tsx src/index.ts in a background terminal). Open http://localhost:3000:
   - / -> landing (check current app/page.tsx redirect target still works, page.tsx comes from new repo or old? Keep whichever redirect behavior exists in the current repo's app/page.tsx unless the new repo has a better landing — decide and note it)
   - /login + /signup render the new design; signup shows business field; submit registers WITHOUT business (verify via the register API call in network tab or API logs — business must not appear in the request)
   - /dashboard requires login (middleware) — after signup/login with the T2/T3 throwaway creds (see report docs/tasks/v2/reports/T2-T3-dashboard-api.md "Test data" for the throwaway email/password + read the report file directly for the real values), dashboard renders with fixtures, greeting shows the right name, nav-rail shows the user + sign-out works, settings page shows Google OAuth connect UI driven by real /api/auth/google/status (unconfigured -> "not connected" is fine; do NOT click connect)
   - /dashboard/schedule + /inbox + /jobs + /customers + /analytics render (fixtures)
3b. Check the console for errors; fix what you find.

## Report
Files copied/merged/kept (concise list), the settings OAuth port summary, signup adapter summary, deps added, verification outputs (build/test/curl health + page checks), any pages where the new repo lacked a counterpart and what you did, deviations, and the current API/UI dev-server state (ports + PIDs) so the controller can hand off to T5.

## Check before you start (files that decide seams)
- H:\tradescheduling\apps\web\next.config.mjs, middleware.ts, package.json, tests/, lib/auth.ts, lib/session.tsx, lib/session-core.ts, lib/ (find api-client/authedFetch), app/dashboard/settings/page.tsx, app/dashboard/layout.tsx, app/page.tsx
- H:\ridgeline-dashboard-auth-landing\apps\web\ — full tree (app/**, components/**, lib/*, globals.css, layout.tsx, tailwind.config.ts, package.json), specifically app/dashboard/settings + its settings component (OAuth port target), components/layout/nav-rail.tsx (user block), app/dashboard/page.tsx (greeting), auth pages (login/signup/reset-password forms)

## Windows notes
- npm may ignore the bash workdir — run npm from H:\tradescheduling (cd H:\tradescheduling && npm ...) and verify pwd if behavior looks off.
- Booting dev servers: use background terminals (start in a separate bash invocation with logs to /tmp/*.log) so the build/verify session isn't blocked. curl http://localhost:3001/api/health to check the API is up before wiring.
