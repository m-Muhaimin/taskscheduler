# T4 - Marketing compact + consistency pass (Wave B)

Read first: docs/tasks/v2/ridgeline-ui-polish.md sections 2/4/5-T4 (current-state evidence + the per-surface rhythm contract table - THIS IS THE SPEC). Repo: H:\tradescheduling, apps/web. Parallel wave: T3 (dashboard) + T5 (auth) run concurrently - you own ONLY components/marketing/**. Never touch dashboard/, auth/, hooks/, components/ui/, globals.css.

One line of context: landing currently reads as a big-spaced one-off compared to the compact dashboard. This task harmonizes the marketing rhythm to the contract table and swaps repetitive eyebrow markup for the new shared ui/eyebrow - no copy changes, no structural redesign, keep the whole look and display type.

## The rhythm contract (verbatim from the plan)
| Surface | Page gutter | Section padding | Head scale | Body |
| Marketing | px-6 md:px-12, max-w-[1200px] (unchanged) | py-24 -> py-16 md:py-20 | hero clamp unchanged; section heads clamp(1.875..2.75rem) unchanged, leading 1.08 | 18px -> 17px, max-w-[56ch] unchanged |

Consistency = shared tokens + shared primitives + documented rhythm. NOT pixel-identical sections.

## Deliverables (all in apps/web/components/marketing/)
1. hero.tsx - section padding: pt-16 pb-24 lg:pt-24 -> pt-16 md:pt-20 pb-16 md:pb-20 (keep lg:pt-24 effect by choosing a clean scheme: pt-16 md:pt-24 pb-16 md:pb-24 reads too tall; contract says sections feel compact - pick pt-16 md:pt-20 pb-16 md:pb-20). Support paragraph text-[18px] -> text-[17px] (keep leading-[1.6], max-w-[52ch]). Hero h1 clamp UNCHANGED. Body "Sample conversation" label keep.
2. how-it-works.tsx, handoff.tsx, controls.tsx, results-band.tsx, faq.tsx, final-cta.tsx - section py-24 -> py-16 md:py-20 (results-band/final-cta are the dark band sections - apply the same tightening there; keep their internal paddings otherwise). Body copy 18px -> 17px where it exists (results-band stat text and handoff/controls bodies); keep all font-head sizes and clamp expressions.
3. Swap repeated eyebrow markup for the shared component: any <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-muted..."> section label becomes <Eyebrow>...</Eyebrow> (import from @/components/ui/eyebrow). Props passthrough keeps any extra classes working.
4. site-header.tsx - keep h-16; CONFIRM nav pills use rounded-[10px] (they do - no change needed); leave everything else.
5. site-footer.tsx - align vertical padding to the new section rhythm (py-16 md:py-20 max) so the page ends on the same beat.

## Constraints
- ZERO copy changes (headlines, body, buttons, aria-labels all untouched). ZERO new deps. No globals.css edits (T1 owns). No layout/structural changes (same section order, same grids, same bands). No class additions beyond spacing/type/value changes in the contract. 320px must not introduce horizontal scroll.
- Two themes must both look right (tokens handle it - just don't add hardcoded colors).

## Verification
- npm run build --workspace=apps/web green (T3/T5 may be mid-flight - if build fails on files you did not create, do not chase; integration build runs after the wave).
- Report to docs/tasks/v2/ridgeline-ui-polish/reports/t4.md: files changed, before->after padding/type values per file, eyebrow swaps, deviations from the contract.
