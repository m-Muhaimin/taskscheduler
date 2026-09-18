# Solo Sam — Design System Reference

> **Status:** Live — mirrors the implemented UI in `apps/web` (2026-09-18).
> **Source of truth:** `docs/design/dashboard-design-brief.md` (approved). This file
> documents the *working* conventions the code follows — tokens, components,
> variants, states, motion, and rules. Fix-forward: when a component diverges from
> this reference, update the code (one source), not this doc.

---

## 1. Principles (from the brief)

1. **Utility app, not consumer social app.** Flat surfaces — no gradients, no
   decorative illustration, no card shadows. High contrast, dense but calm.
2. **Blue/slate is identity; orange is a signal.** `primary` = app identity and
   confirmed work. `urgent` (orange) = *only* things that need Sam's attention.
   Orange never decorates.
3. **System font stack only.** Zero webfont overhead; native rendering speed.
4. **Time-of-day is the primary axis.** Jobs sort by start time, never re-ordered
   by status.
5. **Thumb-reach rule.** Every primary action lives in the bottom third of the
   viewport (bottom nav, sheet footer action row).

## 2. Tokens

Defined in `apps/web/src/app/globals.css` (`:root` + `@theme inline`), Tailwind v4
CSS-first (no `tailwind.config`).

### Colors (oklch)

| Token | Value | Used for |
|---|---|---|
| `--background` | `oklch(0.984 0.003 247.858)` | App bg |
| `--foreground` | `oklch(0.129 0.042 264.695)` | Primary text |
| `--card` | `oklch(1 0 0)` | Cards, sheets, dialogs |
| `--primary` | `oklch(0.546 0.245 262.881)` | Buttons, active nav, confirmed |
| `--secondary` | `oklch(0.968 0.007 247.896)` | Secondary buttons, chips |
| `--muted` / `--muted-foreground` | slate-100 / slate-500 | Labels, descriptions |
| `--destructive` | `oklch(0.577 0.245 27.325)` | Errors, destructive confirms |
| `--border` / `--input` | `oklch(0.929 0.013 255.508)` | Card borders, inputs |
| `--ring` | `var(--primary)` | Focus rings |
| `--urgent` | `oklch(0.646 0.222 41.116)` | **Orange — urgent/unconfirmed ONLY** |
| `--urgent-foreground` | white | Text on solid urgent |
| `--urgent-soft` | `oklch(0.954 0.038 75.164)` | Urgent badge backgrounds |
| `--urgent-soft-foreground` | `oklch(0.553 0.195 38.402)` | Text on urgent-soft |

Theme tokens exposed via `@theme inline`: `--color-*` for every color above,
`--radius-sm/md/lg/xl` derived from `--radius: 0.625rem`, `--font-sans`.

### Other core tokens

| Token | Value | Notes |
|---|---|---|
| `--radius` | `0.625rem` (10px) | Base radius for cards/buttons/inputs |
| `--header-height` | `3.5rem` | Desktop site header (ISO shell var) |
| `--sidebar` / `--sidebar-*` | slate variants | dashboard-01 block vars |
| `--font-sans-stack` | system stack | `-apple-system, BlinkMacSystemFont, "Segoe UI", …` |

## 3. Components

All primitives live in `apps/web/src/components/ui/` (shadcn/radix-nova registry).
No hand-rolled UI primitives outside that folder.

### Card — flat by default

The `Card` base is **flat**: `rounded-xl border border-border bg-card shadow-none
ring-0` with `--card-spacing` padding (default `--spacing(4)`, `size="sm"` →
`--spacing(3)`). Consumers add **only their deltas**:

| Use | Call-site classes |
|---|---|
| Job list card | `gap-0 p-0` + status accent (`border-l-4 border-l-<color>`) |
| Empty states | `py-12 text-center` |
| Standard panels | (none needed) |

> Never re-add `border border-border shadow-none ring-0` — the base owns it.

### Badge

Variants:

| Variant | When |
|---|---|
| `default` | Confirmed status |
| `secondary` | Rescheduled status |
| `outline` | Completed (add `text-muted-foreground`) |
| `urgent` | Pending/needs-attention (soft orange) |
| `urgent-solid` | Unconfirmed count pills in nav |
| `destructive`, `ghost`, `link` | registry defaults |

### Button

Sizes: `default h-8`, `sm h-7`, `lg h-9`, `icon size-8` (+`xs`/`sm`/`lg`).
Primary actions ≥ `h-11`/`h-12` (`className` override) for thumb reach.
Always confirm irreversible actions via a Dialog — never a bare button.

### Job card (`components/job-card.tsx`)

- Left 4px accent: `pending → border-l-urgent`, `confirmed → border-l-primary`,
  `rescheduled → border-l-muted-foreground/30`, `completed → border-l-border`.
- Desktop hover raises border (`hover:border-primary/40`); press scales
  `active:scale-[0.99]`; keyboard `focus-visible` ring (built-in).
- Status badge via `statusBadgeVariant(status)` from `lib/status.ts`; label from
  `STATUS_LABEL` (single source).

### Summary strip (`components/summary-strip.tsx`)

3 mini-cards; the **Unconfirmed** card switches to urgent: `border-urgent/30
bg-urgent-soft` + value `text-urgent`. Loading → 3 skeletons; error → muted zeros.

## 4. States

All interactive surfaces: hover (pointer), active/pressed, `focus-visible`
2px ring + offset (never `outline-none` alone), disabled (`opacity-50
pointer-events-none`), loading (Skeleton), error (destructive Alert + Retry),
empty (positive, actionable copy).

| Data region | Loading | Error | Empty |
|---|---|---|---|
| Today list | 3× `Skeleton h-24` | Alert + Retry | "No jobs today — enjoy the day off." + See the week |
| Week | 3× skeleton | Alert + Retry | "Nothing booked this week." + Back to today |
| Escalations | 3× `Skeleton h-24` | Alert + Retry | "No pending escalations — everything's under control." |
| Summary strip | 3× `Skeleton h-16` | muted zeros | value 0 + muted |

## 5. Motion

| Surface | Behavior |
|---|---|
| Sheet (mobile) | slide up 200ms / down 150ms (Radix default) |
| Dialog | fade + zoom-95 150ms (Radix default) |
| Buttons | `transition-all`, press `translate-y-px` (or `active:scale` on cards) 100–150ms |
| Skeleton | `animate-pulse` 2s |
| Bottom nav / day strip | instant — deliberate, utility feel |

`motion-reduce` respected (Radix/tw-animate defaults; `motion-reduce:transition-none`
where custom transitions are added).

## 6. Accessibility (brief §8, in force)

- Contrast AA: body slate-900/white ✓; muted slate-500/white 4.6:1 ✓; orange text
  only via `urgent-soft-foreground` (orange-800 on orange-100) — never orange body
  copy at normal size.
- Touch targets: bottom nav `h-16`, action buttons `h-11`/`h-12`, day chips
  `h-12 min-w-12`, icon buttons `h-10 w-10` min.
- `tel:`/`sms:` are real anchors with `aria-label="Call/Text {name}"`.
- Focus trap + Esc preserved (Radix); Calendar keeps react-day-picker keyboard nav.
- Safe areas: bottom nav + sheet footer use `env(safe-area-inset-bottom)`.

## 7. Rules / anti-patterns

- **Orange is a signal, never decoration.** Only urgent/unconfirmed surfaces
  (badges, count pills, needs-attention banner, pending card accent) use `urgent*`.
- **No gradients, no card shadows, no decorative illustration, no webfonts.**
- **`cn()` over long class strings is fine; duplicating the same string in 6
  places is not** — centralize in `lib/status.ts` / Badge variants / Card base.
- Keep the Card `border border-border shadow-none ring-0` only in the base.
- Status labels/variants come from `lib/status.ts` — never re-declare
  `STATUS_LABEL` locally.

## 8. Status mapping (lib/status.ts — single source)

| Status | Badge variant | Accent | Notes |
|---|---|---|---|
| `pending` | `urgent` | `border-l-urgent` | "Unconfirmed"; needs-attention when start < now |
| `confirmed` | `default` | `border-l-primary` | |
| `rescheduled` | `secondary` | `border-l-muted-foreground/30` | |
| `completed` | `outline` + muted | `border-l-border` | |
