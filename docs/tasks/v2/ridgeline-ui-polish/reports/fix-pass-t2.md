# Fix pass T2 report — small batched a11y fixes (Wave A follow-up)

**Task:** Small batched fix pass on the RidgeLine web drawer (3 minor a11y findings from the T2 gate review)
**Date:** 2026-09-19
**Status:** complete (type-check green)

## Files edited

| File | Change |
|---|---|
| `apps/web/components/ui/drawer.tsx` | 1) Close button touch target h-8 w-8 → **h-11 w-11** (44×44px), X icon stays centered. 2) Focus trap hardened: Tab while focus is **outside** the panel pulls focus back to the first focusable (or the panel itself when nothing is focusable). |
| `apps/web/components/dashboard/top-bar.tsx` | New prop `menuOpen: boolean`; hamburger button gains `aria-expanded={menuOpen}` alongside the existing `aria-haspopup="dialog"` + `aria-controls="mobile-nav"`. |
| `apps/web/components/dashboard/dashboard-shell.tsx` | Passes state down: `<TopBar onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />`. |

## Implementation details

### 1. Close button ≥44px touch target (drawer.tsx)
- Class change only: `h-8 w-8` → `h-11 w-11` (44×44px, the brief's "simpler" option — button itself becomes the hit area, X icon centered). The X icon stays inside so the visible control barely changes; the larger hit region is invisible until hover.
- `aria-label="Close navigation"` untouched; hover/focus styling untouched (`rounded-[10px] text-ink-muted transition-colors duration-[160ms] hover:bg-surface-2 hover:text-ink`); position stayed `absolute right-3 top-3`.
- **Padding clearance** (verified by geometry on the 280px / `max-w-[85vw]` panel, `px-4 py-5`): the 44px button spans x 224→268 (right-3 = 12px, width 44) and y 12→56 (top-3 = 12px, height 44). Panel top padding is 20px, so the box pokes 36px into content — but that region is the top-right corner of the brand row (SidebarNav header). The brand row's visible content (logo + left-aligned wordmark) ends around x≈170, and the nav links below start at y≈80 (32px brand row + `mb-7`), below the button's bottom edge (56px). The extra 12px vs the old 32px button grows into empty space — no collision with any visible content. (Not browser-verified this session; flagged for the controller's browser pass.)

### 2. aria-expanded on the hamburger (top-bar.tsx + dashboard-shell.tsx)
- Shell already owns `menuOpen`; `TopBar` now receives it (`menuOpen: boolean`) and sets `aria-expanded={menuOpen}` on the hamburger next to the existing `aria-haspopup="dialog"` / `aria-controls="mobile-nav"`. Everything else in both files is byte-identical to the prior state. This reverts the deliberate T2 decision (documented in reports/t2.md) to omit `aria-expanded` because the trigger didn't own the state — the state is now plumbed, so the attribute is truthful.

### 3. Focus trap hardening for outside-panel focus (drawer.tsx)
- In `handlePanelKeyDown`, after collecting the focusables list: if `document.activeElement` is neither the panel nor inside it (`!panel.contains(active)`), `preventDefault()` and `focus()` the **first focusable**, or the panel itself when the list is empty — covering the overlay/`aria-hidden` backdrop click and any programmatic focus loss while open.
- The existing wrap logic is untouched: Shift+Tab from the first focusable (or the panel) wraps to the last; Tab from the last wraps to the first; empty focusables still `preventDefault` (that branch is now only reachable when focus is already inside the panel).
- Note: `document.activeElement` was hoisted above the empty-list branch so both branches share it; behavior for the in-panel paths is unchanged.

## Constraints check

- No new dependencies; no `package.json`/config changes.
- No copy changes (all labels/strings untouched).
- No changes to any file other than the three above (+ this report).
- `"use client"` placement unchanged in all three files.
- Repo style kept: 2-space indent, double quotes, class joins as previously written.

## Verification

- Command: `npx tsc --noEmit -p .` **run in `apps/web`** → **exit 0, 0 errors**.
  - Note on the literal brief command: the brief says `npx tsc --noEmit -p apps/web ... run it IN apps/web` — but `-p` paths resolve relative to the CWD, so from inside `apps/web` that literal path points at the non-existent `apps/web/apps/web` (`error TS5058`). The in-`apps/web` equivalent is `-p .` (its `tsconfig.json` lives there), which is what passed. This uses `apps/web`'s TS 5.9.3 (satisfying `^5.5.4`) — the root-hoisted `^7.0.2` (incompatible) pin is avoided, which is the point of running inside `apps/web`.
- Full build **not run**, per brief (controller runs it after).
- `git status` note: `apps/web/components/ui/drawer.tsx` and `apps/web/components/dashboard/dashboard-shell.tsx` are untracked from the T2 wave (as documented in reports/t2.md); my delta to `top-bar.tsx` (modified vs HEAD) is only the `menuOpen` prop + `aria-expanded` line — the rest of that file's diff vs HEAD is prior wave work.

## Self-check against the brief

1. Close button h-11 w-11, X centered, hit area 44px, aria-label/hover/focus kept, absolute right-3 top-3, clears panel padding — **done**
2. `menuOpen` prop wired shell → TopBar → `aria-expanded={menuOpen}`; aria-haspopup/aria-controls kept; rest identical — **done**
3. Focus trap: outside-panel Tab → preventDefault + focus first focusable (or panel); existing wrap logic intact — **done**