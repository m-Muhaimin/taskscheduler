# T6 — Settings page refine (two-column layout + profile/account editing + favicon)

**Status:** COMPLETE — all gates green, all save flows verified live.
**Commits:** none — working tree only, matching the current wave convention (104 files across T2–T7 are uncommitted on top of `2e648bb`; controller/shipwright commits the wave after review).
**Tests:** web `npm run test --workspace=apps/web` → 11/11 pass (unchanged suite; `tests/session-core.test.mts` is not typechecked by tsc — `.mts` excluded — and its runtime asserts still pass).

> Note: the brief file `docs/tasks/v2/briefs/T6-settings-refine.md` and the reports dir `docs/tasks/v2/reports/` are not present on disk at report time (that workspace area appears rotated). Implementation follows the brief contract + verbatim design values captured at intake.

## What shipped

### `apps/web/components/dashboard/settings-panel.tsx` (rewritten)
Two-column layout per brief:
- `grid grid-cols-1 xl:grid-cols-2 gap-6`; post-OAuth banner `max-w-xl xl:col-span-2`.
- **Col 1** — Automation (`ToggleList`, 3 rows, client-side only, defaultOn per brief — persistence is a future task, kept as-is) + Calendar (OAuth card: `GET /api/auth/google/status` → Connect/Disconnect, `google=` banner via `replaceState`, skeletons while loading).
- **Col 2** — Profile & account single card: `NameRow`, `EmailRow`, `PhoneRow` (shared `FieldRow` helper: `useId`, pending state "Saving…", Enter-to-save, `aria-invalid`/`aria-describedby`, `aria-label` Save buttons, hint + inline error `text-[12.5px]` `var(--danger)`), `PasswordBlock` (current/new/confirm + client validation), `SignOutRow` (`btn-danger` + LogOut icon), `AccountCardSkeleton` while session loads, "Not signed in" fallback.
- Form wiring: saves via `authedFetch` → `PATCH /api/auth/profile` (`{displayName?}`, `{email?}` with `validateEmail`, `{phoneNumber: value || null}` with `PHONE_RE /^\+?[1-9][0-9]{1,14}$/`) and `POST /api/auth/change-password`. Error mapping: `email_taken` → "That email is already in use.", `invalid_body`, 401, ≥500, and `401+invalid_credentials` → "Current password is wrong.".
- Session-state update: after each successful profile PATCH the row calls `refresh()`.

### `apps/web/lib/session.tsx`
Added `phoneNumber: string | null` to `SessionUser`; added `refresh()` to `SessionContextValue` (silent re-fetch of `GET /api/auth/me`, 401/404 → `clearSessionCookie()` + `setUser(null)`; default context value + `useMemo` deps updated).

### `packages/shared/src/types.ts`
`AuthUser` gains `phoneNumber: string | null` (T7's contract; authored here so web could compile before T7 landed — types-only, matches the API exactly).

### `apps/web/app/favicon.ico` (generated)
Multi-size (16/32/48/64/256) PNG-in-ICO built from `app/icon.png` with ffmpeg (no ImageMagick on the box). Header + image signatures verified with xxd.

## Verification (all live)

| Item | Result |
|---|---|
| `npm run typecheck --workspace=@tradescheduler/shared` | clean |
| `apps/web/node_modules/.bin/tsc --noEmit` (TS 5.5) | exit 0 (root `npx tsc` → TS 7, `baseUrl` removed — use the local binary) |
| `npm run test --workspace=apps/web` | 11/11 pass |
| `npm run build --workspace=apps/web` | pass; `/dashboard/settings` 4.01 kB |
| Built HTML head (11 pages) | both `<link rel="icon">` — `/favicon.ico` and `/icon.png?<hash>` — present |
| Dev server `/favicon.ico` | 200 (117,743 B) |
| Dev server `/icon.png` | 200 |
| Two-column layout | live at viewport 1422px: `grid-template-columns: 539.5px 539.5px`, gap 24px; cols: Automation+Calendar stacked (col 1), Profile & account (col 2) |
| md single-column | `.grid-cols-1` base rule compiled + present in class; xl media query proven firing at ≥1280px (`matchMedia` true). True sub-xl viewport emulation not possible via the CDP plugin (`window.resizeTo` blocked) — recommend a Probe/playwright screenshot at 1024px |
| Display name PATCH | live: UI → API; `/api/auth/me` returns new name; sidebar/name updated after `refresh()` |
| Email 409 path | live: saving a second account's email → inline row error "That email is already in use." (`mt-1.5 text-[12.5px]`, `var(--danger)` = rgb(224,114,114)) |
| Phone save + remove | `+15551234567` saved and displayed after refresh; clearing the field → `phoneNumber: null` |
| Change password, wrong current | inline "Current password is wrong." (401 `invalid_credentials`) |
| Change password, success | toast "Password updated", fields cleared; old pw → 401, new pw → 200 on re-login |
| Sign out | Profile-card button → `/login`, `ts_session` cookie cleared |
| Toggles | 3 automation switches render + flip (`aria-checked`/`data-on`) + success toast (client-side only, per brief) |
| Console | clean — no errors/unhandled rejections across all flows and after reload |
| Web dev log | only Google-Fonts download flakes (fallback fonts, pre-existing on this box) + Next's lockfile-patch boot warning — no app errors |

## Deviations / notes

1. **Throwaway account** — the T2–T3 report creds were unreadable (their email is redacted by the output scrubber: `__VG_EMAIL_…` placeholders) and the T7 report did not exist when needed, so I registered a fresh throwaway via `POST /api/auth/register`. Stored email/password are literal placeholder-style values (`__VG_EMAIL_…`-looking string + `T6Verify-2026!` → changed during testing to `T6Verify-2027!`); no real PII involved.
2. **API was mid-deploy during the session** — the first register attempts returned `500 server_not_configured`, then T7's `tsx watch` instance settled and everything worked (register 201 with `phoneNumber: null`, both new routes live). This drift is expected; final verification ran against the working API.
3. **`icon-dark.png` is not registered by Next 14.2.35** — present at `app/icon-dark.png` (untracked, part of the wave) but absent from `app-paths-manifest.json` and never emitted in the built head. Pre-existing/wave-level quirk; the brief only requires `app/icon.png` + `favicon.ico` (both verified). Recommend Vision/Architect decide: remove the file or file a follow-up for dark-mode icon support.
4. **No report dir / brief file on disk** — `docs/tasks/v2/…` (briefs + reports) is not present at report time; this report is written to `%LOCALAPPDATA%\Temp\opencode\reports\T6-settings-refine.md`.
5. **Shared package has no build script** (consumed as raw TS) — its gate is `npm run typecheck --workspace=@tradescheduler/shared`, used instead of a build.
6. **Web tsc** must run via `apps/web/node_modules/.bin/tsc` (TS 5.5); the root-managed tsc is TypeScript 7 which errors `TS5102` on the removed `baseUrl`.

## Environment left running for the next agent

- API `:3001` (T7's `tsx watch`, log: `%LOCALAPPDATA%\Temp\opencode\ts-api-dev.log`) — untouched.
- Web dev `:3000` (this task's instance, log: `/tmp/ts-web.log`) — serves the T6 code; two stray `next dev` processes on :3000/:3003 were conflicts with this repo's own `.next` and were terminated (the instance on :3002 belongs to an unrelated project in `C:\Users\muhai\Downloads\…` — left alone).
- Browser tab on `http://localhost:3000/dashboard/settings` via CDP `:9222` (signed in as the throwaway).

## Touched files (git, working tree)

- `M apps/web/lib/session.tsx`
- `M packages/shared/src/types.ts`
- `M apps/web/app/dashboard/settings/page.tsx` (pre-existing wave edit, not mine)
- `?? apps/web/components/dashboard/settings-panel.tsx` (untracked — original was never committed)
- `?? apps/web/app/favicon.ico` (new)
- `?? apps/web/app/icon.png`, `?? apps/web/app/icon-dark.png` (untracked, wave-provided sources)

## Follow-ups

- Re-run the live walk once the wave is committed for a final gate.
- Probe: screenshots at 1024px (md) and 1280px (xl); a11y pass on the new rows (labels/aria already in place).
- Vision: icon-dark.png decision (see note 3); confirm Google-Fonts fallback is acceptable on this box.