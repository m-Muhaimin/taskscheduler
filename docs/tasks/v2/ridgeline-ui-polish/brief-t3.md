# T3 - Dashboard motion + skeletons (Wave B)

Read first: docs/tasks/v2/ridgeline-ui-polish.md sections 2/3/5-T3 + section 6. Repo: H:\tradescheduling, apps/web (Next 14 App Router, React 18, Tailwind 3.4 custom tokens, ESM TS, @/* -> apps/web root). Parallel wave: T4 (marketing) and T5 (auth) run concurrently - you own ONLY the files listed; never touch marketing/ or auth/ paths.

One line of context: the dashboard already animates well (CountUp in metric-card.tsx:84, delayMs stagger, metric-card-rise, scroll reveals); this task adds the missing pieces - honest skeleton loading (overview first paint, settings async cards, session-gate identity) and small stagger/live-indicator touches.

## Verified facts (do not re-litigate)
- lib/session.tsx already exposes loading: boolean in SessionContext (line 23). CONSUME it; do not modify session.tsx.
- components/dashboard/metric-card.tsx already uses CountUp + delayMs prop + hover + animation delays. Do NOT rework it; only fix count-up reduced-motion behavior if needed (check components/dashboard/count-up.tsx: under prefers-reduced-motion it must jump straight to the final value - fix inside count-up.tsx if it animates regardless, else leave).

## Deliverables
1. NEW apps/web/hooks/use-demo-load.ts - "use client". Returns loaded: boolean. Starts false; after ~350ms becomes true. Resolves IMMEDIATELY (no delay) when the user prefers reduced motion (use useReducedMotion from @/hooks/use-reduced-motion) - skeleton-first UX must not add artificial delay for reduced-motion users. Cancel timer on unmount.
2. NEW apps/web/components/dashboard/dashboard-overview.tsx - "use client". Props mirror what app/dashboard/page.tsx currently renders (metrics, inbox items, appointments, recovery data - pass them through). Internal: const loaded = useDemoLoad(); When !loaded render a skeleton version matching the real layout: greeting block (skeleton lines), 4 MetricCard-sized Skeleton blocks (h-[~180px]), two column skeletons (7/5 grid: inbox rows = 4 Skeleton rows h-16; timeline = 5 skeleton rows h-14). Use components/ui/skeleton.tsx (className sizing) + Card borders (border-border rounded-[10px]) so it reads as the real page. When loaded render the real components exactly as the current page does.
3. EDIT app/dashboard/page.tsx - becomes a thin server component passing its current props/data into <DashboardOverview .../> (all imports of MetricGrid/AiInboxList/TodayTimeline/RevenueRecoveryBand and fixtures move to the new component or stay - prefer keeping presentational components as-is and importing them in dashboard-overview.tsx; page keeps fetching fixtures and passes props).
4. EDIT app/dashboard/settings/page.tsx - the Google Calendar card and Account card already load async state; replace any loading spinner/text with Skeleton rows inside the Card (use ui/skeleton); if cards render with data immediately (no async), wrap ONLY the section that fetches google status in skeleton-while-fetching. Keep all copy.
5. EDIT components/dashboard/ai-inbox-list.tsx + inbox-row.tsx - stagger entrance: rows get style={{ animationDelay: `${index * 60}ms` }} + className "animate-rise" (class exists in globals.css). Verify it does not conflict with existing row hover/reveal classes. Fill index via map (pass i down or style at list map level).
6. EDIT components/dashboard/escalation-banner.tsx - add a live pulse indicator: reuse the existing .pulse-dot span but tone it danger. APPEND ONE RULE to globals.css (append-only, never modify existing): .pulse-dot[data-tone="danger"] { background: var(--danger); } .pulse-dot[data-tone="danger"]::after { background: var(--danger); } Place <span className="pulse-dot" data-tone="danger" aria-hidden="true" /> next to the AlertTriangle icon (keep the icon too - indicator + icon are complementary).
7. EDIT components/dashboard/dashboard-shell.tsx, components/dashboard/sidebar.tsx, components/dashboard/top-bar.tsx - session-gate skeletons: while useSession().loading is true, render skeleton identity instead of real initials/name/email: sidebar identity block -> Skeleton circle (h-7 w-7 rounded-full) + two Skeleton lines; top-bar avatar -> Skeleton circle h-9 w-9 rounded-full; keep all other chrome real (nav links, banner, title).

## Constraints
- No new deps. globals.css append-only (new rules only). Do not modify count-up.tsx unless reduced-motion check fails. Do not touch marketing/ or auth/.
- Skeleton classes: use ui/skeleton (.skeleton) with explicit className sizing; aria-hidden="true" is built in.
- Reduced motion: overview loads instantly (no skeletons visible longer than one frame), count-up jumps, escalation pulse opacity handled by existing kill-switch.

## Verification
- npm run build --workspace=apps/web green (T4/T5 may be mid-flight - if build fails on files you did not create, do not chase; integration build runs after the wave).
- Report to docs/tasks/v2/ridgeline-ui-polish/reports/t3.md: files, skeleton surface list, reduced-motion behavior, deviations.
