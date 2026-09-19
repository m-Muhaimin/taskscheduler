# T5 - Auth compact + consistency pass (Wave B)

Read first: docs/tasks/v2/ridgeline-ui-polish.md sections 2/4/5-T5 + the rhythm contract table. Repo: H:\tradescheduling, apps/web. Parallel wave: T3 (dashboard) + T4 (marketing) run concurrently - you own ONLY components/auth/**. Never touch dashboard/, marketing/, hooks/, components/ui/, globals.css.

One line of context: auth pages should read as a compact extension of the dashboard - the form becomes a Card matching the settings SectionCard pattern, header height aligns to the site header (h-16), type scale tightens one notch. No copy changes, no behavior changes.

## The rhythm contract (verbatim from the plan)
| Surface | Page gutter | Section padding | Head scale | Body |
| Auth | px-6 md:px-12 (unchanged) | form py-12 -> py-10; Card wrap | 32px -> 28px titles | 16px unchanged |

## Deliverables (both in apps/web/components/auth/)
1. auth-shell.tsx
   - Wrap the form column content in the shared Card: import { Card } from @/components/ui/card. The <main> area (max-w-[400px] mx-auto py-12) becomes: outer spacing kept, Card = "border border-border rounded-[10px] bg-surface" with p-6 md:p-8, containing h1 + subtitle + children + the existing footer block (border-t border-border pt-6 mt-8 -> now a DividerRow-like footer INSIDE the card: keep the border-t spacing as today, just inside the Card). USE Card + DividerRow from ui/card so the auth card IS the settings card pattern.
   - Header: current <header className="flex items-center justify-between"> -> h-16 equivalent (add h-16 items-center to match site-header.tsx).
   - Title/h1: text-[32px] -> text-[28px] (keep font-head, leading, tracking).
   - py-12 -> py-10 on the main wrapper.
   - Keep the lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] two-column shell and the aside exactly where it is.
2. auth-aside.tsx
   - Headline: text-[32px] -> text-[28px] (keep font-head leading/tracking).
   - Padding: px-12 xl:px-16 py-12 -> px-10 xl:px-14 py-10 (one notch tighter, same feel).
   - Keep the three overnight log rows, colors, borders, mono labels exactly.
3. Verify (read-only) text-field.tsx, password-field.tsx, submit-button.tsx, form-alert.tsx - all must already match the dashboard look via shared .field/.btn classes; report any mismatch you find but DO NOT change them (a mismatch report goes in your report; fix would be a separate change).

## Constraints
- ZERO copy changes. ZERO new deps. No globals.css edits. No changes to the (auth)/*.tsx page files, forms, or aside content. Both themes must render correctly (no hardcoded colors - tokens only).
- The login/signup/forgot page files and their route group layout must remain untouched.

## Verification
- npm run build --workspace=apps/web green (T3/T4 may be mid-flight - if build fails on files you did not create, do not chase; integration build runs after the wave).
- Report to docs/tasks/v2/ridgeline-ui-polish/reports/t5.md: files changed, before->after values, Card/DividerRow usage, field-component consistency findings, deviations.
