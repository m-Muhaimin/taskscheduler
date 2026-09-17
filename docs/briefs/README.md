# Build briefs — index & decisions

Project: tradescheduler (reschedule-by-text flow). Source of truth for each step:

| Step | Brief | Status |
|---|---|---|
| 0 | [step0-bootstrap.md](step0-bootstrap.md) | ✅ DONE (see ledger) |
| 1 | [step1-shared-types.md](step1-shared-types.md) | pending |
| 2 | (to be written — Twilio webhook signature) | pending |
| 3+ | per build-sequence.md | pending |
| UI | [../design/dashboard-design-brief.md](../design/dashboard-design-brief.md) | ✅ DONE (Solo Sam daily dashboard, see ledger) |

## Decisions (record)

| Topic | Decision | Reasoning / status |
|---|---|---|
| Shared package name | `@tradescheduler/shared` (build-sequence said `@repo/shared`) | Consistency with `@tradescheduler/api` / `@tradescheduler/web` |
| Ports | API 3001 (`process.env.PORT ?? 3001`), web 3000 | Per build-sequence verify steps |
| TypeScript | pinned **5.9.3** in all three workspaces (fallback rule applied) | TS 7.0.2 is the Go-native compiler with no stable programmatic API; Next 15.5.25's type-checker cannot `require('typescript')` → its own checker fails. 5.9.3 is newest 5.x. |
| Next.js | **15.5.25** (was 15.3.5) | 15.3.5 deprecated: CVE-2025-66478 security vulnerability. Stays on Next 15 line per approved stack. |
| jsonwebtoken | **9.0.3** (was 9.0.10) | 9.0.10 does not exist on npm. |
| pg | **8.23.0** (was 8.23.1) | 8.23.1 does not exist on npm. |
| DB client for Step 4 queue | deferred | pg and @supabase/supabase-js both present; `.env.example` carries `DATABASE_URL` + `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` |
| tsconfig strategy | root = solution-style (`files: []` + references, compiler opts base); api/shared = `nodenext` ESM; web = Next shape (`bundler`) | Per step0 brief. `tsc -b` from root intentionally not used (no `composite`). |
| Env-free boot | hard rule: no `process.env` reads at module scope except `PORT` in index.ts; clients constructed lazily | Server must boot with no `.env`. |
| shadcn init style | style **`radix-nova`** (Radix, not Base UI) | CLI presets (`-p nova -b radix`) resolve; Base UI swap would change every component source — not worth it vs brief, which dictates tokens/layout, not base-library. Recorded as drift from the assumed `style: base-ui`. |
| UI kit deps | pruned recharts, @tanstack/react-table, @dnd-kit/* from apps/web | Block-demo leftovers; charts/tables/drag-drop are out of scope for the dashboard brief; re-add per later steps. `date-fns` kept (react-day-picker v10 uses it). |
| Product data | `apps/web/src/lib/fixtures.ts` — deterministic fixture store (today's + this week's jobs, user, business hours) behind a subscribe/publish singleton | Brief §4.1/§5 fixtures; a later step swaps the store for the API. SSR-safe via `getServerSnapshot` = loading. |
| maskPhone interpretation | masked = national display `(555) 012-3456`; digits visible, never dialable; full E.164 only inside `tel:`/`sms:` hrefs | Brief §5.4 says "masked phone"; privacy intent is "not shown in a form the customer sees" — the trade sees numbers to call. Full number in hrefs keeps taps working. |
| Rescheduled accent | `border-l-muted-foreground/30` on job cards | Slate `--secondary` is invisible on white; 30% muted keeps the "quiet" hierarchy while still visible. (§9 Q5 style) |
| Mark done | web-local only; `DashboardBooking` status extended `'completed'` in web, no shared type change | Q1 ruling: no API/subscription claim until the flow exists. |
| SERVER-DATA pages | dashboard pages are client-data: SSR = loading skeletons, hydration swaps in fixtures | Date labels / calendar selection are client-computed; this kills hydration mismatches and is the standard client-store pattern. |
| Detail sheet vs route | mobile = bottom Sheet `JobDetailSheet`; desktop = route `/dashboard/jobs/[jobId]` (same body/footer components) | Q7 ruling; deep links work, mobile gets the thumb-first pattern. |
| Bottom nav badge | unconfirmed-count pill on Today tab, `sm+` only | Q6 ruling (match brief mock). |
| Weeks | Monday-start everywhere (DayStrip + Calendar `weekStartsOn={1}`) | Q4 ruling. |
| tz label | business-tz shown in header only when it differs from device tz | Q8 ruling; all times render in business tz (America/New_York fixture). |
| Dev fixture toggles | `?state=loading|error`, `?empty=1` on dashboard routes (URL override, cleared by retry) | AC3 ("toggling fixtures") verifiable without rebuilds; remove with the fixture swap step. |

## Errata (brief bugs found during execution)

- `step0-bootstrap.md` §5 `apps/api/tsconfig.json` used `"extends": "../tsconfig.json"` — wrong from `apps/api/` (resolves to `apps/tsconfig.json`). Corrected to `"../../tsconfig.json"`.
- `step0-bootstrap.md` §7 specified a single `index.ts`; implementation splits `app.ts` (createApp factory) + `index.ts` (bootstrap) so Step 2 tests can import the app. Same behavior.
