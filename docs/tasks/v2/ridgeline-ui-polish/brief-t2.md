# T2 - Fixed-height sidebar + functional mobile drawer (Wave A)

Read first: docs/tasks/v2/ridgeline-ui-polish.md sections 2/3/4/5-T2 (current shell evidence, locked decisions 2/4/5, rhythm contract).

Repo: H:\tradescheduling, npm workspaces. Web app: apps/web (Next 14.2.35 App Router, React 18.3, Tailwind 3.4, ESM TS, custom design system - tokens via CSS vars mapped in tailwind.config.ts, e.g. bg-surface, text-ink-muted, border-border, bg-surface-2, rounded-[10px]).

One line of context: dashboard nav currently scrolls away with the page and the mobile hamburger in top-bar.tsx line 38 is a DEAD button (no state, no drawer). You make the desktop rail pinned full-height and the hamburger open a proper a11y-correct drawer.

## Current structure (verified)
- app/dashboard/layout.tsx (server): SessionProvider > div.min-h-screen.flex > NavRail + (div.flex-1.min-w-0.flex.flex-col > TopBar(sticky) + EscalationBanner + main.max-w-[1400px].animate-rise).
- components/dashboard/nav-rail.tsx: NAV_ITEMS + NAV_ITEMS_SECONDARY + NavLink + initialsOf + user identity + sign out (all inside aside.hidden.md:flex.w-60).
- components/dashboard/top-bar.tsx: hamburger button className "md:hidden p-2 -ml-2" aria-label="Menu", currently no handler.
- Parallel wave note: T1 (components/ui/{card,skeleton,eyebrow}.tsx + hooks/use-reduced-motion.ts + hooks/use-lock-body-scroll.ts + globals.css motion tokens) is being built CONCURRENTLY by another agent. Import them where needed; NEVER create them yourself. If they are not yet on disk when you start, write the imports anyway.

## Deliverables

1. NEW apps/web/components/ui/drawer.tsx - reusable left drawer:
   - Props: { open: boolean; onClose: () => void; label: string; children: ReactNode }.
   - Render null when !open.
   - Markup: fixed inset-0 z-40 -> overlay button (absolute inset-0 bg-black/40, onClick=onClose, aria-hidden) + panel (relative, w-[280px] max-w-[85vw], h-full, bg-surface, border-r border-border, shadow, id="mobile-nav", role="dialog", aria-modal="true", aria-label=label, tabIndex={-1} so it can take focus).
   - Enter motion: panel slides in from left (start -translate-x-full -> translate-x-0, ~260ms with a cubic-bezier ease via inline style or arbitrary Tailwind; overlay fades in). If useReducedMotion() is true, skip the slide - render panel in place with no transform, no animation.
   - Behavior: on open - save document.activeElement, focus panel (focus() on it), lock body scroll via useLockBodyScroll(open). On close - restore focus to the saved element. ESC keydown on window -> onClose. Simple focus trap: on Tab/Shift+Tab within the panel, cycle among panel-focusable elements (buttons/links/inputs) - collect querySelectorAll('a[href], button, input, [tabindex]:not([tabindex="-1"])') inside panel.
   - On close, unmount immediately (no exit animation) - acceptable, documented choice.

2. NEW apps/web/components/dashboard/sidebar.tsx - "use client":
   - Move ALL content from nav-rail.tsx here unchanged in look/behavior: NAV_ITEMS, NAV_ITEMS_SECONDARY, NavLink, initialsOf, user identity block, sign out (LogOut -> signOut()). Wrap nav links so each click first calls an optional onNavigate() (for drawer close on route change).
   - Export SidebarNav (the shared inner content, props { onNavigate?: () => void }).
   - Export DesktopSidebar: <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border px-4 py-5 bg-surface sticky top-0 h-screen overflow-hidden self-start"> with SidebarNav.
   - Export MobileSidebar: { open, onClose } -> <Drawer open={open} onClose={onClose} label="Navigation"><SidebarNav onNavigate={onClose} /></Drawer>.

3. NEW apps/web/components/dashboard/dashboard-shell.tsx - "use client":
   - Props { children: ReactNode }. State const [menuOpen, setMenuOpen] = useState(false).
   - Renders exactly the current shell markup: div.min-h-screen.flex > DesktopSidebar + (div.flex-1.min-w-0.flex.flex-col > TopBar(onMenu={() => setMenuOpen(true)}) + EscalationBanner + main.max-w-[1400px].w-full.mx-auto.flex-1.px-5.md:px-8.py-6.md:py-7.animate-rise) + <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} /> (drawer last in DOM).

4. EDIT apps/web/components/dashboard/top-bar.tsx:
   - Add prop { onMenu: () => void }.
   - Hamburger: onClick={onMenu}, add aria-haspopup="dialog" aria-controls="mobile-nav". Keep md:hidden + current classes.

5. DELETE apps/web/components/dashboard/nav-rail.tsx (content moved to sidebar.tsx). Verify nothing else imports NavRail (only dashboard/layout.tsx did).

6. EDIT apps/web/app/dashboard/layout.tsx - becomes a thin server wrapper:
   export default function DashboardLayout({ children }) { return <SessionProvider><DashboardShell>{children}</DashboardShell></SessionProvider>; }
   (SessionProvider stays server-side; shell is the client boundary.)

## Constraints
- No new dependencies. No globals.css edits (T1 owns CSS; you may use inline style / arbitrary Tailwind values for the slide/fade, e.g. transition-[transform] duration-[260ms]).
- "use client" on every interactive file.
- Do NOT run the full app build (parallel wave - T1 files may be mid-flight; a build now can fail for reasons outside your task). If you can type-check without T1 files on disk, fine; otherwise skip and note it.

## Verification (what task-reviewer will check)
- Desktop: rail pinned (sticky top-0 h-screen) while main scrolls; no double scrollbars; nav region scrolls internally only if overflowing.
- Mobile: hamburger visible <=md only; opens drawer; overlay click, ESC, close all close it; focus trapped in panel; focus returns to hamburger; body scroll locked; clicking a nav link closes drawer; role=dialog aria-modal aria-label present; no horizontal scroll.
- Reduced motion: drawer appears without slide.

Write report to docs/tasks/v2/ridgeline-ui-polish/reports/t2.md: files created/edited/deleted, a11y decisions, deviations, any build/type-check notes.
