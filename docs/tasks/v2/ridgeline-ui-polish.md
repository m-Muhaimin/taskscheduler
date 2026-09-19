# RidgeLine UI Polish - Landing/Auth Consistency, Fixed Shell, Motion, Skeletons

Status: **proposed** (awaiting approval)
Scope: `apps/web` only. No API changes. No new runtime dependencies. No copy changes.
Base: commit `2e5d321` (RidgeLine drop-in, wired to API). Dev stack already running (web :3000 / api :3001).

## 1. Goals (user asks)

1. Make **landing + auth pages compact and visually consistent with dashboard pages** - achieved through *shared implementation* (shared primitives + shared tokens), not per-page restyling.
2. Dashboard **sidebar fixed full-viewport height** - pinned, does not scroll with content.
3. **Mobile sidebar toggle functional** - hamburger opens a proper drawer.
4. Dashboard **subtle animation, motion, interactivity, skeleton loading** - built on the motion layer that already exists in `globals.css`.

## 2. Current state (evidence, already read)

- Tokens are **already fully shared** via `tailwind.config.ts` (maps CSS vars: `bg/surface/surface-2/ink-*/border/accent/field/band/success/danger`) - no token work needed, only discipline + primitives.
- `globals.css` already contains: shared `.btn/.field/.link` layer (44px min height, 10px radius), `nav-item`, `ai-switch` spring knob, `pulse-dot`, `rise`, scroll-driven `.reveal` (with `prefers-reduced-motion` fallback + `@supports animation-timeline: view()`), `thread-msg` staggered via `--i`, `resolve-fade`, sparkline draw, metric rise/line-draw/area-fade/dot-pop, `bar-grow`, `bar-tooltip`, `appt-block:hover`, `faq-plus` rotate, global `:focus-visible`, and a global reduced-motion kill-switch.
- Dashboard shell today: `app/dashboard/layout.tsx` = `min-h-screen flex` wrapping `NavRail` (desktop-only, `hidden md:flex w-60`) + right column (`TopBar` sticky, `EscalationBanner`, `main max-w-[1400px] animate-rise`).
  - **Problem A**: whole body scrolls; the rail scrolls away with content (not fixed height).
  - **Problem B**: `top-bar.tsx:38` hamburger (`md:hidden p-2 -ml-2`, `aria-label="Menu"`) is a **dead button** - no state, no drawer.
- Marketing: sections `py-24`, gutters `px-6 md:px-12`, hero display `clamp(2.5rem..4.75rem)`, body `18px`; dashboard uses `py-6/7`, `px-5 md:px-8`, section heads `15px`. Same design language, different rhythms - the compact/consistency pass harmonizes spacing/type to a per-surface rhythm and reuses shared primitives.
- Auth: `auth-shell.tsx` full-screen grid + `auth-aside.tsx` (hidden lg), form `max-w-[400px]`. Compact pass = Card-wrapped form matching dashboard `SectionCard` pattern (settings uses `max-w-xl border rounded bg-surface [&>*+*]:border-t`), header height aligned to site header (`h-16`).
- Components inventory (verified by glob): `count-up.tsx`, `metric-card.tsx` exist; all marketing/auth/dashboard components present.

## 3. Locked decisions

1. **No new runtime dependencies** (no framer-motion, no radix dialog). Drawer = hand-rolled on existing Tailwind + tokens; reduced motion respected. Rationale: RidgeLine drop-in ethos, dependency-light, CSS/IO infra already present.
2. **Shared primitives live in `apps/web/components/ui/`** (`card`, `skeleton`, `eyebrow`, `drawer`) + **`apps/web/hooks/`** (`use-reduced-motion`, `use-lock-body-scroll`). Dashboard/marketing/auth all import from here - this is the "shared implementation" the user asked for.
3. **Motion tokens added to `globals.css`** (`--motion-fast/med/slow`, `--ease-out`, `--ease-spring`) used by *new* CSS; existing hardcoded durations left untouched (no churn commit) - retrofitting them is optional follow-up, not in scope.
4. **Desktop sidebar**: `sticky top-0 h-screen overflow-hidden self-start` on the rail (page keeps native scroll; rail pinned; main column untouched). Rejected the full `h-screen overflow-hidden` app-shell because it changes scroll/subnav behavior everywhere for a demo gain. The rail nav region itself gets `overflow-y-auto` if content ever overflows.
5. **Mobile drawer**: 280px left slide-over + overlay, ESC / overlay-click / close button, focus trap, body scroll lock, focus returns to hamburger on close, closes on route change, `role="dialog"` `aria-modal` + `aria-expanded`/`aria-controls` wiring. Reduced motion -> fade only, no slide.
6. **Skeleton surfaces** (honest ones only): (a) session gate on dashboard shell (identity in rail/topbar while `/api/auth/me` resolves - today it flashes fallback initials/void); (b) settings Google Calendar + Account cards (already async from `GET /api/auth/google/status`); (c) overview first paint (metric grid + inbox) via a short (~350ms) simulated-load hook on the fixture data - demo product, gated to first mount per route, skipped entirely under reduced motion.
7. **Content/copy untouched. Brand looks untouched.** Dark + light themes both verified after every task.

## 4. Per-surface rhythm contract (the consistency spec)

| Surface | Page gutter | Section padding | Head scale | Body |
|---|---|---|---|---|
| Marketing (Persuade) | `px-6 md:px-12`, max-w-[1200px] | `py-24` -> `py-16 md:py-20` | hero clamp keep; section heads `clamp(1.875..2.75rem)` keep | `18px` -> `17px`, `max-w-[56ch]` keep |
| Auth (Operate) | `px-6 md:px-12` keep | form `py-12` -> `py-10`; Card wrap | `32px` -> `28px` title | `16px` keep |
| Dashboard (Operate) | `px-5 md:px-8` keep | `py-6 md:py-7` keep | `15px` section heads keep | `14px` keep |

Consistency = shared tokens + shared primitives + a documented rhythm, **not** pixel-identical sections.

## 5. Task breakdown (ordered; each gated by task-reviewer)

### T1 - Shared primitives + motion tokens (foundation)
Files (new): `apps/web/components/ui/card.tsx` (Card/DividerRow: `border border-border rounded-[10px] bg-surface`, matches settings SectionCard), `ui/skeleton.tsx` (shimmer block, `aria-hidden`, reduced-motion = plain block), `ui/eyebrow.tsx` (mono 12px uppercase tracking label), `apps/web/hooks/use-reduced-motion.ts` (matchMedia listener), `apps/web/hooks/use-lock-body-scroll.ts`; append to `globals.css`: motion tokens + `skeleton-shimmer` keyframe + `.skeleton` class + reduced-motion exclusion for shimmer.
VA: `npm run build --workspace=apps/web` green; primitives render correctly when first consumed; no existing file modified except globals.css append.
Gate: task-reviewer (spec compliance + quality).

### T2 - Fixed sidebar + functional mobile drawer
Files: new `components/dashboard/dashboard-shell.tsx` (`"use client"`, owns `menuOpen` state, renders NavRail + TopBar + EscalationBanner + main - moves shell markup out of the server layout), `components/ui/drawer.tsx` (overlay + panel + ESC + focus trap + lock-body + `use-reduced-motion`), `components/dashboard/sidebar.tsx` (extract current `nav-rail.tsx` content into a shared `SidebarNav` used by both the desktop `<aside className="sticky top-0 h-screen overflow-hidden ...">` and the mobile drawer; delete `nav-rail.tsx` or reduce it to a re-export), edit `components/dashboard/top-bar.tsx` (hamburger -> `onMenu`, `aria-expanded`, `aria-controls="mobile-nav"`), edit `app/dashboard/layout.tsx` (server wrapper: `SessionProvider > DashboardShell`).
VA: desktop - rail pinned while main scrolls (1440px, tall content); no double scrollbars. Mobile (375px) - hamburger opens drawer, overlay click + ESC + close button all close, focus trapped, focus returns to hamburger, body does not scroll behind, route change closes it, keyboard-tab order sane. Reduced-motion: fade-only.
Gate: task-reviewer + brief vision spot-check (375px desktop + mobile states).

### T3 - Dashboard motion + skeletons
Files: `components/dashboard/metric-card.tsx` (count-up wiring on value if not present; stagger via `--i` delay like `thread-msg`), `metric-grid.tsx` (pass `--i`, add `--i` classes), `ai-inbox-list.tsx`/`inbox-row.tsx` (stagger entrance), `escalation-banner.tsx` (attach `pulse-dot` to live indicator), new `hooks/use-demo-load.ts` (~350ms simulated load, skipped under reduced motion), edit `app/dashboard/page.tsx` (skeleton state for metric grid + inbox on first paint, then data), edit `app/dashboard/settings/page.tsx` (skeleton rows while google status/account fetch), `lib/session.tsx` (expose `loading` if missing) + `dashboard-shell.tsx` (skeleton identity in rail/topbar during session load).
VA: overview first paint shows skeletons <=~400ms then stagger-enters data; count-up animates once, jumps to final under reduced motion; settings shows skeletons while status in-flight; no console errors; skeleton contrast uses `--surface-2`/`--ink-faint` tones.
Gate: task-reviewer.

### T4 - Marketing compact + consistency pass
Files: `components/marketing/hero.tsx` (pt-16 pb-24 -> rhythm per contract; body 18->17; keep display), `how-it-works.tsx`, `handoff.tsx`, `controls.tsx`, `results-band.tsx`, `faq.tsx`, `final-cta.tsx` (section `py-24` -> `py-16 md:py-20`; unify eyebrows via `ui/eyebrow`), `site-header.tsx` (keep `h-16`; confirm nav pill radius 10px), `site-footer.tsx` (padding alignment), `app/(marketing)/page.tsx` (unchanged composition).
VA: marketing <> dashboard side-by-side reads as one product; section rhythm consistent; 320px no horizontal scroll; build green.
Gate: task-reviewer (diff against rhythm contract).

### T5 - Auth compact + consistency pass
Files: `components/auth/auth-shell.tsx` (form wrapped in `ui/card` Card, header height -> `h-16` matching site header, title 32->28, `py-12` -> `py-10`), `auth-aside.tsx` (headline 32->28, padding `px-12 xl:px-16` trimmed, rows keep), `text-field.tsx`/`password-field.tsx`/`submit-button.tsx` (no behavior change; confirm interactive states match dashboard fields - already `.field`), `form-alert.tsx` (keep), signup/login/forgot pages (composition unchanged).
VA: auth cards visually consistent with dashboard settings SectionCard; keyboard + focus-visible through forms; both themes; build green.
Gate: task-reviewer.

### T6 - Verification + wrap-up
- `npm run build --workspace=apps/web` and `npm run test --workspace=apps/web` (session-core 11/11) green; smoke the live dev stack (:3000 proxy, login/register/me against :3001).
- Browser matrix via vision: 320/375/768/1024/1440, dark + light, reduced-motion emulation, keyboard-only pass (tab order, ESC paths), focus visibility, 200% zoom no breakage.
- Re-check: hamburger only visible <=md; drawer never opens >=md; desktop rail pinned.
- Docs: update `CLAUDE.md` gotchas if any new quirk appears; conventional commit (`feat(web): side nav drawer + UI polish` style per repo).
- Final: reviewer whole-branch gate before merge.

## 6. Verification summary (global)

- Unit: session-core tests 11/11 (unchanged); web build green (swc lockfile warning cosmetic, ignore).
- Functional: drawer a11y paths (above); count-up reduced-motion jump; skeleton -> data transition.
- Visual: vision screenshots, 5 widths x 2 themes, side-by-side landing/auth/dashboard.
- No API or shared-package changes; `git status` clean end state except intended files.

## 7. Out of scope (explicit non-goals)

- No new deps, no API work, no copy/content changes, no brand/logo redesign, no dark-mode rework, no refactor of existing `globals.css` animation classes (append only), no Paddle/worker work.

## 8. Execution order (waves)

- **Wave A (parallel, file-disjoint):** T1 (globals.css append + `components/ui/*` + `hooks/*`) and T2 (shell/sidebar/drawer/top-bar/layout). Independent files; per-task review gates after each.
- **Wave B (parallel, file-disjoint):** T3 (dashboard), T4 (marketing), T5 (auth) - all depend on T1 primitives + T2 conventions, none overlap each other.
- **Wave C:** T6 verification (probe/vision + reviewer whole-branch gate).
