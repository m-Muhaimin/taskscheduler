# T6 — Settings page: two-column layout + account editing + icons

Context: settings page (apps/web/app/dashboard/settings/page.tsx -> components/dashboard/settings-panel.tsx)
was merged in T4 and OAuth-wired in T5. User request: refine into a TWO-COLUMN layout —
column 1: automation settings + calendar OAuth connection button; column 2: profile/account
settings (change name, update email/password/number, sign out). Also: use app/icon.png and a
favicon.ico as the site favicon.

Facts verified:
- settings-panel.tsx currently: Calendar section (REAL OAuth via authedFetch — status on mount,
  connect -> /api/auth/google/start redirect, disconnect -> DELETE /api/auth/google/), Automation
  section (3 client-local toggles via ToggleList/useToast), Account section (displayName+email
  display-only + Sign out via useSession().signOut()).
- lib/auth.ts has authedFetch. lib/validation.ts has validateEmail, validatePassword (min 8),
  validateRequired. lib/session.tsx: useSession gives { user: AuthUser, loading, signOut }.
- The API (T7, parallel task) is ADDING: PATCH /api/auth/profile (partial { displayName?, email?,
  phoneNumber? } -> 200 { user: AuthUser } with NEW field phoneNumber: string | null; 409
  email_taken; 400 invalid_body) and POST /api/auth/change-password ({ currentPassword,
  newPassword } -> 200 { ok: true }; 401 invalid_credentials; 400 invalid_body). AuthUser is
  gaining phoneNumber: string | null in @tradescheduler/shared (not yet built — build against the
  contract; if the shared build isn't in yet when you verify, the types will error — coordinate:
  check npm run typecheck result; if AuthUser.phoneNumber isn't there yet, run a workspace
  install/build of @tradescheduler/shared first (npm run build --workspace=@tradescheduler/shared)
  — it's types-only; wired is adding it in parallel).
- app/icon.png + app/icon-dark.png EXIST (Next.js auto-registers app/icon.png). NO favicon.ico
  ANYWHERE (apps/web, source repo, public/) — must be generated from icon.png.

## 1) Two-column layout (components/dashboard/settings-panel.tsx)
Container: grid grid-cols-1 xl:grid-cols-2 gap-6 (responsive: stacked on small, 2 columns xl+ —
match the app's breakpoint convention; the shell sidebar is 240px so xl is the 2-col point, same
as revenue-recovery-band).

COLUMN 1 — "Automation & calendar":
- Automation section: existing 3-toggle ToggleList (keep client-local behavior + toasts).
- Calendar section: existing REAL Google Calendar OAuth card (status/connect/disconnect, banner
  handling) — moved up here, visually grouped under automation ("calendar oauth connection
  button").

COLUMN 2 — "Profile & account":
A single card (card divided overflow-hidden) with stacked edit rows:
- Display name row: label + text input (defaultValue user.displayName) + Save button — PATCH
  /api/auth/profile { displayName }; on 200 update local user state (useSession refresh — check
  session.tsx: if it exposes a refresh()/setUser, use it; else refetch GET /api/auth/me and
  update via whatever session API exists — read session.tsx first) + success toast; on 409/400
  show inline field error.
- Email row: input (defaultValue user.email) + Save — PATCH { email } using validateEmail;
  inline error + 409 email_taken message "That email is already in use."
- Phone number row: input placeholder "+15551234567" (defaultValue user.phoneNumber ?? "") +
  Save — PATCH { phoneNumber: value.trim() || null } (validate with the same E.164-ish regex:
  /^\+?[1-9][0-9]{1,14}$/).
- Change password block: current password + new password + confirm inputs (type=password,
  show/hide toggle optional), Submit — POST /api/auth/change-password; client-side validate:
  new >= 8 chars (validatePassword), new === confirm; on 401 show "Current password is wrong.";
  clear fields on success + success toast.
- Sign out button (danger-styled? check existing btn styles — btn btn-ghost is fine; or add a
  subtle danger variant using var(--danger) if trivially consistent) — useSession().signOut(),
  then router.push('/login').
Design: match the panel exactly — "use client", card/section styles (card divided, p-4 rows,
text-[13.5px] font-medium labels, text-[12px] text-ink-muted hints, btn btn-primary btn-sm
saves, field className for inputs), toast confirmations, font-mono for inputs where the current
panel does. Keep the sub-row layout clean at 1-col and 2-col widths. Add aria-labels for
inputs/buttons.

## 2) Icons (favicon.ico)
- Keep app/icon.png (auto-registered). Confirm app/layout.tsx doesn't override icons metadata in
  a way that hides it (check metadata export; if it sets nothing, app/icon.png auto-wins; if it
  sets icons, add both).
- GENERATE app/favicon.ico from app/icon.png, dependency-free: if ImageMagick (magick) or
  ffmpeg is available on PATH use it; otherwise write a small node script that wraps the PNG
  bytes into a minimal ICO container (plain Node, no deps): 6-byte ICO header (0,1,1,0) +
  16-byte directory entry (w=0,h=0,colors=0,res=0,planes=1,bpp=32,size=PNG length,offset=22) +
  PNG bytes. PNG-in-ICO is valid and supported by all modern browsers. Name it favicon.ico at
  apps/web/app/favicon.ico. Delete the script after.
- Verify: build + dev — the HTML head links app/icon.png (Next auto) and /favicon.ico resolves
  (browser or curl http://localhost:3000/favicon.ico -> 200).

## 3) Verification (ALL)
1. If @tradescheduler/shared needs the new AuthUser first: cd /h/tradescheduling && npm run
   build --workspace=@tradescheduler/shared (types-only package; produces nothing runtime).
2. npm run build --workspace=apps/web
3. npm run test --workspace=apps/web (session-core — session user shape change? AuthUser gains a
   field; tests may need a touch if they construct AuthUser literals — if so, update minimally
   to include phoneNumber: null).
4. Dev: web :3000 (npm run dev -w apps/web background, /tmp/ts-web.log). API :3001 — curl
   /api/health; the API process from T7 may be mid-restart; if profile routes 404, the parallel
   T7 task hasn't finished — verify layout + icons + form client validation first, then RETRY the
   save flows at the end (check again, restart API if needed) so the final report includes at
   least one successful real PATCH + change-password + one 409/401 error path from the UI. If
   the API is genuinely not up, mark those flows as pending-integration.
5. Login with the throwaway account (docs/tasks/v2/reports/T2-T3-dashboard-api.md "Test data" —
   read the file for real creds; note T7 may change them — reconcile by checking the report file
   T7 writes: docs/tasks/v2/reports/T7-account-api.md; prefer its final known creds).
6. Walk the settings page: 2 columns at xl, stacked at md; automation toggles still toast; OAuth
   card shows real status (not connected); profile rows prefill from session; save flows per
   above; sign out bounces to /login; console clean.
7. Icons: curl favicon.ico 200; head link presence.

## Rules
- Don't touch other dashboard pages, next.config.mjs, middleware, lib/auth.ts internals, tests/
  beyond the AuthUser-literal touch, or marketing.
- The three automation toggles stay client-local (no API exists) — keep, don't invent persistence.
- No schema changes.

## Report
Column layout summary, form/per-endpoint wiring details (including how you updated session state),
icon generation approach (magick/ffmpeg/node script) + verification, all verification command
results, which save flows were verified live vs pending-integration, deviations, follow-ups.
