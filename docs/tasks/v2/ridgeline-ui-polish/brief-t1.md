# T1 - Shared UI primitives + motion tokens (Wave A foundation)

Read first: docs/tasks/v2/ridgeline-ui-polish.md sections 2/3/5-T1 (rhythm contract + locked decisions).

Repo: H:\tradescheduling, npm workspaces. Web app: apps/web (Next 14.2.35, React 18.3, Tailwind 3.4 CSS-var design system, ESM TS, NO shadcn, flat structure @/* -> ./*). Custom tokens live in apps/web/app/globals.css (--bg, --surface, --surface-2, --ink-*, --border, --accent*) and are mapped in apps/web/tailwind.config.ts (bg-surface, text-ink-muted, border-border, ...).

One line of context: this wave's foundation - shared primitives + hooks + motion tokens that T2/T3/T4/T5 (drawer, skeletons, marketing/auth pass) all consume. You create NEW files only; do not edit any existing component or page. The ONLY existing file you touch is globals.css, and ONLY by appending.

## Deliverables (create exactly these)

1. apps/web/components/ui/card.tsx
   - Card: presentational-only, className passthrough: <div className={"border border-border rounded-[10px] bg-surface " + (className ?? "")}>.
   - DividerRow: row inside a Card with top divider except first child: className "px-5 py-4 border-t border-border first:border-t-0". This mirrors app/dashboard/settings SectionCard (max-w-xl border rounded bg-surface [&>*+*]:border-t).

2. apps/web/components/ui/skeleton.tsx
   - Skeleton: <div aria-hidden="true" className={"skeleton " + (className ?? "")} />. Callers size it via className (e.g. "h-12 w-full", "h-4 w-24 rounded-[10px]").

3. apps/web/components/ui/eyebrow.tsx
   - Eyebrow: <p className={"font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted " + (className ?? "")}>.

4. apps/web/hooks/use-reduced-motion.ts  -> add "use client" at top.
   - useReducedMotion(): boolean. SSR-safe (typeof window === "undefined" -> false). Uses window.matchMedia("(prefers-reduced-motion: reduce)"); subscribes to "change" events so it flips live; cleans up listener on unmount.

5. apps/web/hooks/use-lock-body-scroll.ts -> add "use client" at top.
   - useLockBodyScroll(locked: boolean): when locked becomes true -> document.body.style.overflow = "hidden"; on false -> restore the previous value that was set before locking; restore on unmount too.

6. apps/web/app/globals.css -> APPEND ONLY at end of file (never modify an existing rule):
   :root {
     --motion-fast: 160ms;
     --motion-med: 260ms;
     --motion-slow: 420ms;
     --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
     --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
   }
   .skeleton {
     position: relative;
     overflow: hidden;
     background: var(--surface-2);
     border-radius: 6px;
   }
   .skeleton::after {
     content: "";
     position: absolute;
     inset: 0;
     transform: translateX(-100%);
     background: linear-gradient(90deg, transparent 0%, var(--surface) 50%, transparent 100%);
     animation: skeleton-shimmer 1.4s var(--ease-out) infinite;
   }
   @keyframes skeleton-shimmer { to { transform: translateX(100%); } }
   @media (prefers-reduced-motion: reduce) {
     .skeleton::after { animation: none; opacity: 0; }
   }
   (A subtle sweep using existing tokens so it reads fine in light AND dark. No new colors.)

## Constraints
- No new dependencies. No package.json changes. Do not touch tailwind.config.ts.
- Do not import anything from tasks T2/T3/T4/T5 (those files may not exist yet - this task must compile standalone).
- Pure presentational components: no "use client" needed on card/skeleton/eyebrow.

## Verification
- Run: npm run build --workspace=apps/web (standalone-safe for this task).
- If the build fails on files you did NOT create (concurrent wave edits), do not chase them; note it in your report.
- Write report to docs/tasks/v2/ridgeline-ui-polish/reports/t1.md: files created, build result, deviations.
