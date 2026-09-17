# Solo Sam — Daily Dashboard UI/UX Design Brief

> **Status:** Approved for build · **Owner:** CTO · **Date:** 2026-09-18
> **Applies to:** `apps/web` (Next.js 15.5.25 App Router, React 19.3, Tailwind CSS v4.3.3, TypeScript)
> **UI kit:** Tailwind CSS + shadcn/ui (not yet initialized in repo — init steps in §10)
> **Related docs:** `docs/prd-scheduling-assistant.md`, `docs/build-sequence.md` (Step 9), `packages/shared/src/types.ts` (domain vocabulary used verbatim below)

---

## 1. Product & persona snapshot

**Persona — "Solo Sam"**
- A solo plumber / electrician / HVAC tech. Not tech-savvy by choice — the phone is a tool, not a hobby.
- Uses the app **one-handed, between jobs**: in the van, on a driveway, in low light, sometimes with dirty hands.
- Top tasks, in order: (1) *What am I doing today, and when?* (2) *Who do I call/text right now?* (3) *What's coming up this week?*
- Attention budget: seconds, not minutes. Every screen must answer one question at a glance.
- Trust matters: this app handles their money and their customers. It must feel **solid, predictable, and fast** — a utility, not a toy.

**Design stance**
- **Utility app, not consumer social app.** Flat surfaces, no gradients, no decorative illustration, no shadows on cards. High contrast, dense but calm.
- **Blue/slate primary** = the app's identity and confirmed work. **Orange accent** = *only* urgent/unconfirmed things that need Sam's attention. Orange is a signal, never decoration.
- **System font stack only** — zero webfont overhead, native rendering speed, consistent with the OS the phone already uses.

**Core screens (v1)**
1. **Today** — today's jobs list (primary screen, the app opens here).
2. **Week** — upcoming week view.
3. **Job detail** — one job, with tap-to-call / tap-to-text the customer.

Secondary (roadmap, Step 9): **Escalations** list + **reschedule history** — reuses this brief's component system and tokens; noted where relevant but not designed in full here.

---

## 2. Reference study (directions, not copies)

| Source | Direction we take | What we deliberately reject |
|---|---|---|
| **Jobber** | Job-card clarity: one job = one card with time, customer, service, and a single obvious next action. "Today" is the default landing view. | Their dense multi-action card grids; marketing-y gradients; logo-heavy chrome. |
| **Housecall Pro** | Dispatch/route focus: time-of-day matters more than status labels; big tap targets sized for a thumb in a hurry. | Their cluttered toolbar density; small secondary buttons. |
| **Linear** | Restraint and quiet hierarchy: muted chrome, strong typographic contrast, one accent used sparingly. | Their keyboard-first desktop density (we are touch-first); their dark aesthetic as default. |
| **shadcn `dashboard-01` block** (verified: `ui.shadcn.com/blocks`, `npx shadcn add dashboard-01`) | Desktop scaffold: `SidebarProvider` + `SidebarInset` + `SiteHeader` + `SectionCards` + `DataTable` structure; `--sidebar-width` / `--header-height` CSS-var sizing; container-query layout (`@container/main`). | Charts/analytics content — not relevant to a solo trade's day. |
| **shadcn `sidebar-07` block** (verified) | Collapsible icon sidebar for the desktop shell at `lg+`. | — |
| **shadcn dashboard example** (verified: `ui.shadcn.com/examples/dashboard`) | Stat-card row pattern (value + delta + one-line context) → repurposed as the "today" summary strip; data-table pagination pattern → repurposed for the week list. | The "Acme Inc." corporate content; multi-column document tables. |
| **shadcn `Calendar` component** (verified: `ui.shadcn.com/docs/components/calendar`) | Desktop week view: react-day-picker month grid + adjacent day panel. Note: there is **no calendar block** (`/blocks/calendar` returns 404, verified) — the week view is built from the Calendar component + Card primitives. | The bare month grid alone (useless for dispatch without the day's jobs beside it). |

---

## 3. Screens & user journey

### 3.1 Journey map (happy path + edge states)

| # | Step | Screen | Key components |
|---|---|---|---|
| 1 | Sam opens the app (or taps the icon from the home screen — PWA) | **Today** | Shell: header + bottom nav |
| 2 | At a glance: "3 jobs today, 1 unconfirmed." The unconfirmed one is orange. | **Today** | Summary strip (SectionCards pattern), job cards |
| 3 | Sam taps the orange job first (it's the risk). | **Job detail** | Sheet (mobile) / Dialog (desktop) |
| 4 | Sees customer, service, time window, orange "Unconfirmed" badge, and the two big actions: **Call** and **Text**. | **Job detail** | Sheet body + footer action row |
| 5 | Taps **Call** → native dialer opens with the customer's number (`tel:` link). If the call fails / they hang up, Sam returns and taps **Text** → `sms:` link with a pre-filled context line. | Native dialer / SMS app | `tel:` / `sms:` anchors styled as Buttons |
| 6 | Sam marks the job done → confirm dialog ("Mark done? This moves the job to completed.") → confirm → card updates in place. | **Job detail** → **Today** | Dialog (confirm), job card status change |
| 7 | Peek at the week: tap **Week** in the bottom nav. | **Week** | Day strip (mobile) / Calendar + day panel (desktop) |
| 8 | Tap a day → that day's jobs (same job card). Tap one → same Job detail sheet. | **Week** | Day sections, job cards |
| 9 | Done. Back to Today via bottom nav. | **Today** | Bottom nav |

**Edge states the journey must survive (each spec'd in §5):**
- **Slow network** → skeletons everywhere data loads; no blank flashes.
- **Empty day** → "No jobs today" empty state with a positive, useful tone (this is a *good* thing for Sam — suggest the week view).
- **Load failure** → inline error with a Retry button; never a dead screen.
- **Customer call fails** → nothing in-app breaks (native dialer owns the call); the Text fallback is one tap away.
- **Unconfirmed job past its start time** → card escalates visually (orange, "Needs attention" badge) — this is the Step 9 escalation surface.

### 3.2 Screen inventory

| Screen | Route (proposed) | Purpose |
|---|---|---|
| Today | `/dashboard` | Default landing. Summary strip + today's jobs. |
| Week | `/dashboard/week` | 7-day horizon, day-select + jobs per day. |
| Job detail | `/dashboard/jobs/[jobId]` (mobile: Sheet overlay; desktop: Dialog or route) | One job + call/text + history. |
| Escalations (roadmap, Step 9) | `/dashboard/escalations` | Pending escalations list; reuses job-card/badge/sheet system. |

---

## 4. Layout per screen

### 4.0 App shell (all screens)

- **Mobile (< `lg`):** top header (screen title + date) + content + **bottom tab bar** (Today · Week · Settings). Bottom bar is `h-16`, `border-t`, `bg-background`, with `pb-[env(safe-area-inset-bottom)]` for notched phones. Active tab = primary text + 2px top indicator (or filled icon); inactive = muted.
- **Desktop (`lg+`):** `dashboard-01` scaffold — `SidebarProvider` with `sidebar-07`-style collapsible sidebar (Today / Week / Settings), `SidebarInset` + `SiteHeader` (page title + date), content column `max-w-5xl mx-auto`.
- **Thumb-reach rule:** every primary action lives in the bottom ⅓ of the viewport (bottom nav, Sheet footer action row). Nothing critical sits in the top-right corner on mobile.

### 4.1 Today (`/dashboard`)

```
┌──────────────────────────────┐
│ Header: "Today" · Tue Sep 22 │  h-14, border-b
├──────────────────────────────┤
│ Summary strip (3 mini-cards) │  SectionCards pattern
│  3 jobs · 1 unconfirmed ·    │  grid grid-cols-3 gap-2 px-4
│  2 confirmed                 │
├──────────────────────────────┤
│ Job card                     │  px-4, stack gap-3
│ Job card (orange, unconf.)   │
│ Job card                     │
│ …                            │
├──────────────────────────────┤
│ [Today] [Week] [Settings]    │  bottom nav h-16
└──────────────────────────────┘
```

- **Hierarchy:** time-of-day is the primary axis (morning → evening), not status. Cards sort by `startTime`; the unconfirmed/urgent card is visually flagged but stays in time order (never yanked to the top — Sam's mental model is the clock).
- **Spacing:** page `px-4 py-4`, list `gap-3`, card `p-4`, summary strip `gap-2`. 8pt rhythm throughout (Tailwind v4 spacing scale).
- **Breakpoints:** base 375 full-width; `sm:640` content `max-w-xl mx-auto`; `lg:1024` sidebar shell + `max-w-5xl`.

### 4.2 Week (`/dashboard/week`)

- **Mobile:** horizontal **day strip** (7 chips: weekday + date; today = primary-filled, selected = ring) + below it the selected day's job list (same job cards). Day strip is `sticky top-14` so Sam can switch days without losing the list.
- **Desktop:** two-pane — left: `Calendar` (react-day-picker, `mode="single"`, `disabled` past days); right: selected day's job list. `grid lg:grid-cols-[320px_1fr] gap-6`.
- **Spacing/breakpoints:** same rhythm as Today; day strip `gap-1`, chips `h-12 min-w-12` (≥44px targets).

### 4.3 Job detail (Sheet/Dialog)

- **Mobile:** `Sheet` from the **bottom** (`side="bottom"`), `max-h-[85dvh]`, rounded-t-xl. Header: customer name + status badge. Body: service, time window, phone (masked), reschedule history (roadmap). **Footer action row** (sticky bottom of sheet, `border-t`, `p-4`, `grid grid-cols-2 gap-3`): **Call** (primary, `tel:` anchor) · **Text** (secondary, `sms:` anchor). Both `h-12` (≥44px).
- **Desktop:** same content as a `Dialog` (centered, `max-w-lg`), or a route page at `lg+` — decision in §9. Actions in the dialog footer, same two-button row.
- **Destructive/irreversible actions** ("Mark done", future "Resolve") always go through a confirm `Dialog` — never a bare button.

---

## 5. Component inventory → shadcn mapping

> Every element maps to a shadcn component/block. No hand-rolled primitives. "States" column lists every state that must be implemented (hover/active/focus only apply to pointer/keyboard capable surfaces).

### 5.1 Shell

| UI element | shadcn component | Key props / notes | States |
|---|---|---|---|
| Desktop sidebar shell | `Sidebar` (from `dashboard-01`/`sidebar-07` blocks) | `SidebarProvider`, `SidebarInset`, `SidebarTrigger`, collapsible="icon" at `lg+` | collapsed/expanded, hover on items, focus-visible |
| Header | `SiteHeader` pattern (block) + `Breadcrumb` | page title + date; `h-14` mobile / `--header-height` desktop | — |
| Bottom tab bar (mobile) | `Tabs` (list variant) or `Button` group — **recommend `Tabs`** for ARIA tab semantics | `TabsList` fixed bottom, `TabsTrigger` flex-1, `h-16` | active, inactive, focus-visible, pressed |
| Settings (placeholder) | `DropdownMenu` in header (desktop) / tab (mobile) | v1: business hours, SMS template (from `User.businessHours`, `User.smsSettings`) | open/closed, item hover, keyboard nav |

### 5.2 Today — summary strip

| UI element | shadcn component | Key props / notes | States |
|---|---|---|---|
| Stat mini-card ×3 (jobs today / unconfirmed / confirmed) | `Card` (SectionCards pattern) | `CardHeader`+`CardContent`; value `text-2xl font-semibold tabular-nums`; label `text-xs text-muted-foreground`; unconfirmed card uses `--urgent` value + `--urgent-soft` bg | loading (Skeleton), error (Alert), empty (value 0, muted) |
| Skeleton placeholder | `Skeleton` | `h-16 rounded-xl` per card | animate-pulse |

### 5.3 Job card (Today + Week)

| UI element | shadcn component | Key props / notes | States |
|---|---|---|---|
| Job card container | `Card` | `p-4`, flat (`shadow-none`), `border-border`; left accent: 3px `border-l-4` colored by status | hover (desktop: `border-primary/40`), active (`scale-[0.99]`), focus-visible (ring), pressed |
| Time block | `div` + `Badge` (variant="outline") | `startTime–endTime` in `HH:mm`; `text-sm font-medium tabular-nums` | — |
| Customer name | `CardTitle` | `text-base font-semibold` | — |
| Service description | `CardDescription` | `text-sm text-muted-foreground`, `line-clamp-2` | — |
| Status badge | `Badge` | **Color logic (the core rule):** `confirmed` → `variant="default"` (blue/slate primary); `pending` → custom `--urgent` variant (orange, "Unconfirmed"); `rescheduled` → `variant="secondary"` (muted, "Rescheduled"); *(proposed)* `completed` → `variant="outline"` muted. | — |
| "Needs attention" flag (Step 9 hook) | `Badge` (urgent variant) + `Alert`-style row | Shown when an open escalation exists for the booking; orange dot + "Needs attention"; tap → escalation handling (roadmap) | — |
| Call/text quick actions (compact) | `Button` (icon, `variant="ghost"`) wrapping `tel:`/`sms:` anchors | `size="icon"` `h-10 w-10`; visible on card footer right | hover, active, focus-visible, disabled (no phone) |
| Skeleton card | `Skeleton` | `h-24 rounded-xl` ×3 | animate-pulse |
| Empty state | `Card` + `Button` | "No jobs today — enjoy the day off." + "See the week" link; centered, `py-12` | — |
| Error state | `Alert` (destructive) + `Button` | "Couldn't load today's jobs." + Retry | — |

### 5.4 Week view

| UI element | shadcn component | Key props / notes | States |
|---|---|---|---|
| Day strip (mobile) | `Tabs` (or `Button` group; recommend `Tabs` for semantics) | 7 `TabsTrigger`s, `h-12 min-w-12`, weekday + date; today = primary, selected = ring | active, selected, hover, focus-visible |
| Month grid (desktop) | `Calendar` | `mode="single"`, `disabled={(d) => d < startOfToday}`, `className="rounded-md border"` | day hover, selected, disabled, keyboard nav (react-day-picker built-in) |
| Day's job list | `Card` stack (same job card as §5.3) | grouped under a day heading `text-sm font-medium text-muted-foreground` | loading/empty/error (same as §5.3) |
| Week empty state | `Card` + `Button` | "Nothing booked this week." + "Back to today" | — |

### 5.5 Job detail (Sheet/Dialog)

| UI element | shadcn component | Key props / notes | States |
|---|---|---|---|
| Overlay container | `Sheet` (mobile, `side="bottom"`) / `Dialog` (desktop) | Radix focus trap + Esc close preserved; `max-h-[85dvh]` mobile | open (slide/fade), closed, focus |
| Header row | `SheetHeader`/`DialogHeader` + `SheetTitle`/`DialogTitle` | customer name + status `Badge` | — |
| Info rows (service, time, phone) | `div` rows + `Separator` | phone displayed masked (`(555) 012-3456`), full number only inside `tel:`/`sms:` links | — |
| Reschedule history (roadmap, Step 9) | `ScrollArea` + `Timeline`-style rows | from `Booking.rescheduleLog` (`RescheduleLogEntry[]`): action + timestamp + details | empty ("No reschedules yet"), loading |
| **Call action** | `Button` (default, `h-12`) wrapping `<a href="tel:+1…">` | `w-full`; phone icon (lucide `Phone`) | hover, active, focus-visible, disabled (no phone) |
| **Text action** | `Button` (secondary, `h-12`) wrapping `<a href="sms:+1…?body=…">` | pre-filled body: "Hi {name}, it's {trade} about your {service} on {date}." | hover, active, focus-visible, disabled |
| Mark done (proposed) | `Button` (outline) → confirm `Dialog` | "Mark done?" + Cancel/Confirm (`variant="default"`) | dialog open/closed, confirm loading |
| Sheet footer | `SheetFooter` | `border-t p-4 grid grid-cols-2 gap-3` | — |

### 5.6 Shared

| UI element | shadcn component | Notes |
|---|---|---|
| Toasts (SMS sent, job marked done, errors) | `Sonner` (`sonner` component) | `toast.success/error`; bottom-center on mobile |
| Phone masking / relative time | `lib/format.ts` helpers | `formatPhone`, `formatTime`, `relativeTime` (not UI components — pure utils) |
| Icons | `lucide-react` (ships with shadcn) | `Phone`, `MessageSquare`, `CalendarDays`, `Home`, `Settings`, `AlertTriangle`, `Check` |

---

## 6. Tokens (Tailwind v4 + shadcn)

> Repo is **Tailwind v4.3.3 (CSS-first)** — no `tailwind.config` file. Canonical form below is the v4 `globals.css` (`@theme` + CSS variables). A v3 `tailwind.config` mapping note is included for teams still on v3.

### 6.1 Named token table

| Token | Value | Used for |
|---|---|---|
| `--background` | `oklch(0.984 0.003 247.858)` (slate-50) | App background |
| `--foreground` | `oklch(0.129 0.042 264.695)` (slate-900) | Primary text |
| `--card` | `oklch(1 0 0)` (white) | Cards, sheets, dialogs |
| `--primary` | `oklch(0.546 0.245 262.881)` (≈ blue-600 `#2563eb`) | Buttons, active nav, confirmed accents, links |
| `--primary-foreground` | `oklch(0.985 0 0)` (white) | Text on primary |
| `--secondary` | `oklch(0.968 0.007 247.896)` (slate-100) | Secondary buttons, chips |
| `--muted` / `--muted-foreground` | slate-100 / `oklch(0.554 0.046 257.417)` (slate-500) | Labels, descriptions, inactive nav |
| `--accent` / `--accent-foreground` | slate-100 / slate-900 | Hover fills (keep slate — see note) |
| `--destructive` | `oklch(0.577 0.245 27.325)` (red-600) | Errors, destructive confirms |
| `--border` / `--input` | `oklch(0.929 0.013 255.508)` (slate-200) | Card borders, inputs |
| `--ring` | primary (blue-600) | Focus rings |
| `--urgent` | `oklch(0.646 0.222 41.116)` (orange-600) | **Orange accent — urgent/unconfirmed only** |
| `--urgent-foreground` | white | Text on urgent |
| `--urgent-soft` | `oklch(0.954 0.038 75.164)` (orange-100) | Urgent badge backgrounds |
| `--urgent-soft-foreground` | `oklch(0.553 0.195 38.402)` (orange-800) | Text on urgent-soft |
| `--radius` | `0.625rem` (10px) | Cards, buttons, inputs |
| `--font-sans` | system stack (§6.3) | Everything |

> **Note on `accent`:** shadcn's `accent` token is the *hover* fill (slate). The orange "urgent" semantic is a **separate custom token** (`--urgent*`) so it can never leak into generic hover styling. Orange appears only via the urgent tokens.

### 6.2 `globals.css` (canonical, Tailwind v4)

```css
@import "tailwindcss";
@import "tw-animate-css"; /* shadcn v4 default */

@custom-variant dark (&:is(.dark *)); /* if dark mode ships later */

:root {
  --background: oklch(0.984 0.003 247.858);
  --foreground: oklch(0.129 0.042 264.695);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.129 0.042 264.695);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.129 0.042 264.695);
  --primary: oklch(0.546 0.245 262.881);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.968 0.007 247.896);
  --secondary-foreground: oklch(0.208 0.042 265.755);
  --muted: oklch(0.968 0.007 247.896);
  --muted-foreground: oklch(0.554 0.046 257.417);
  --accent: oklch(0.968 0.007 247.896);
  --accent-foreground: oklch(0.208 0.042 265.755);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.929 0.013 255.508);
  --input: oklch(0.929 0.013 255.508);
  --ring: oklch(0.546 0.245 262.881);
  --radius: 0.625rem;

  /* Solo Sam custom — urgent/unconfirmed (orange) */
  --urgent: oklch(0.646 0.222 41.116);
  --urgent-foreground: oklch(0.985 0 0);
  --urgent-soft: oklch(0.954 0.038 75.164);
  --urgent-soft-foreground: oklch(0.553 0.195 38.402);

  /* dashboard-01 block vars */
  --sidebar: oklch(0.984 0.003 247.858);
  --sidebar-foreground: oklch(0.129 0.042 264.695);
  --sidebar-primary: oklch(0.546 0.245 262.881);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.968 0.007 247.896);
  --sidebar-accent-foreground: oklch(0.208 0.042 265.755);
  --sidebar-border: oklch(0.929 0.013 255.508);
  --sidebar-ring: oklch(0.546 0.245 262.881);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-urgent: var(--urgent);
  --color-urgent-foreground: var(--urgent-foreground);
  --color-urgent-soft: var(--urgent-soft);
  --color-urgent-soft-foreground: var(--urgent-soft-foreground);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --font-sans: var(--font-sans-stack);
}

:root {
  --font-sans-stack: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
}

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground font-sans antialiased; }
}
```

**Usage examples:** `bg-primary text-primary-foreground` (primary buttons) · `bg-urgent text-urgent-foreground` (urgent badge) · `bg-urgent-soft text-urgent-soft-foreground` (soft urgent badge) · `border-l-4 border-urgent` (unconfirmed card accent) · `text-muted-foreground` (labels).

### 6.3 Tailwind v3 mapping note (only if the repo ever drops to v3)

`tailwind.config.ts` → `theme.extend.colors` mapping each name to the CSS var (`background: "hsl(var(--background))"` etc., converting oklch values to hsl), plus `fontFamily.sans: ["var(--font-sans-stack)"]`, `borderRadius` from `--radius`. **Not needed for this repo (v4.3.3).**

---

## 7. Motion

> All motion uses Tailwind transition utilities + shadcn/Radix default animations (`tw-animate-css` classes: `animate-in`, `animate-out`, `fade-in`, `zoom-in-95`, `slide-in-from-bottom-*`, `slide-in-from-right-*`). **No new animation library.**

| Element | Animation | Duration | Easing | Implementation |
|---|---|---|---|---|
| Sheet open (mobile) | slide up from bottom | 200ms | `ease-out` | `data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom` (Radix default) |
| Sheet close | slide down | 150ms | `ease-in` | `data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom` |
| Sheet open (desktop) | slide from right | 200ms | `ease-out` | `slide-in-from-right` / `slide-out-to-right` |
| Dialog open/close | fade + zoom 95% | 150ms | `ease-out` | `data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95` |
| Overlay (Sheet/Dialog) | fade | 150ms | `ease-out` | Radix `Overlay` default |
| Skeleton | pulse | 2s loop | `cubic-bezier(0.4, 0, 0.6, 1)` | `animate-pulse` |
| Buttons / cards (hover, desktop) | color/border transition | 150ms | `ease-out` | `transition-colors` |
| Button press (mobile) | scale down | 100ms | `ease-out` | `active:scale-[0.98]` |
| Tab switch (bottom nav) | none (instant) | — | — | deliberate: no bounce, utility feel |
| List appearance | none in v1 | — | — | deliberate: no stagger; content appears with skeletons → data swap |
| Reduced motion | all of the above → none | — | — | `motion-reduce:animate-none motion-reduce:transition-none` on interactive elements; Radix respects `prefers-reduced-motion` for its defaults |

---

## 8. Accessibility

- **Radix preserves semantics:** `Sheet`, `Dialog`, `DropdownMenu`, `Tabs`, `Tooltip` are Radix primitives — focus trap, Esc-to-close, arrow-key navigation, and ARIA roles (`role="dialog"`, `aria-modal`, `role="tablist"`, `aria-expanded`) are built in. **Do not strip them in custom styling** — no `pointer-events-none` on focusable content, no `outline-none` without a replacement `focus-visible:ring-2 ring-ring ring-offset-2`.
- **`Calendar` is react-day-picker, not Radix** — it ships its own keyboard navigation (arrows, Home/End, PageUp/PageDown) and `aria-selected`/`aria-disabled`. Keep the wrapper's `disabled` prop for past days; do not re-implement.
- **Touch targets ≥ 44px:** bottom nav `h-16`, action buttons `h-12`, day chips `h-12 min-w-12`, icon buttons `h-10 w-10` (40px — acceptable for secondary icon-only per WCAG 2.5.8 minimum 24px, but keep 44px where it's a primary action).
- **Contrast (WCAG 2.1 AA):**
  - Body text: slate-900 on white / slate-50 — passes.
  - Muted labels: slate-500 on white — 4.6:1, passes at normal size.
  - **Orange rule:** orange-600 is used only for large/bold elements and icons (≥18.66px bold or graphical objects). Any orange *text* at normal size uses `--urgent-soft-foreground` (orange-800, ~5.9:1 on orange-100) or orange-700 on white. Orange is never body copy.
  - Urgent badge: `bg-urgent-soft text-urgent-soft-foreground` (orange-800 on orange-100) — passes; solid `bg-urgent text-white` only for large/bold badge text.
- **`tel:` / `sms:` links:** real anchors (`<a href="tel:+1…">`) so native dialer/SMS apps open with full number; the app is backgrounded — nothing in-app breaks. Add `aria-label="Call {customerName}"` / `"Text {customerName}"`. Note in UI copy that the call leaves the app.
- **Focus-visible:** 2px `ring-primary` with 2px offset on all interactive elements; visible on keyboard nav only.
- **`motion-reduce`:** disable all custom transitions/animations (§7).
- **Safe areas:** bottom nav and Sheet footer respect `env(safe-area-inset-bottom)`.
- **Loading/error/empty:** every data region has Skeleton, Alert+Retry, and empty states (§5) — no unlabeled loading, no dead errors.

---

## 9. Open questions for the owner

1. **`completed` status doesn't exist in the domain model** (`BookingStatus = 'pending' | 'confirmed' | 'rescheduled'`). "Mark done" implies adding it — approve a schema addition (`completed`) or drop the action from v1?
2. **Addresses are missing from `Booking`** (only `customerPhone`, `customerName`, `serviceDescription`). Dispatch without an address is weak — add `address` to the type + jobs table, or defer?
3. **Escalation → booking linkage:** `Escalation` has no `bookingId` (only `customerPhone`). Step 9's "Needs attention" on a job card needs that link — approve adding `bookingId` to `Escalation`?
4. **Week start day:** Monday (trade convention) or Sunday (US calendar default)? Recommend Monday.
5. **Dark mode in v1?** Recommend no (utility, daylight usage); tokens are structured so it can be added later.
6. **Numeric badge on the bottom nav** (e.g., unconfirmed count on Today)? Recommend yes at `sm+`, hidden on the smallest screens.
7. **Job detail on desktop:** Sheet/Dialog overlay or a real route (`/dashboard/jobs/[jobId]`)? Recommend route at `lg+` (shareable, back-button friendly), Sheet on mobile.
8. **Time display:** local to the phone or the tradesperson's `BusinessHours.timezone`? Recommend the business timezone, labeled when it differs.

---

## 10. Build checklist

### 10.1 shadcn setup (verified commands)

```bash
cd apps/web
npx shadcn@latest init          # Tailwind v4, new-york style, CSS variables, oklch
npx shadcn@latest add dashboard-01 sidebar-07   # blocks (verified on ui.shadcn.com/blocks)
npx shadcn@latest add card badge button sheet dialog skeleton tabs separator avatar \
  dropdown-menu calendar tooltip table alert sonner input label scroll-area breadcrumb
```

> `dashboard-01` and `sidebar-07` block names verified against `ui.shadcn.com/blocks` (2026-09-18). Component names are the canonical registry names. There is **no calendar block** (`/blocks/calendar` → 404) — the week view uses the `calendar` component + `card`.

### 10.2 File map (proposed)

```
apps/web/src/
  app/layout.tsx                 # shell: SidebarProvider (lg+) + bottom nav (<lg) + Toaster
  app/page.tsx                   # redirect → /dashboard
  app/dashboard/page.tsx         # Today
  app/dashboard/week/page.tsx    # Week
  app/dashboard/jobs/[jobId]/page.tsx   # Job detail (desktop route; mobile uses Sheet)
  components/job-card.tsx        # §5.3
  components/job-detail-sheet.tsx# §5.5
  components/summary-strip.tsx   # §5.2 (SectionCards pattern)
  components/day-strip.tsx       # §5.4 mobile day selector
  components/bottom-nav.tsx      # §5.1 mobile tabs
  components/app-sidebar.tsx     # from dashboard-01 block, trimmed
  components/site-header.tsx     # from dashboard-01 block, trimmed
  lib/format.ts                  # formatPhone, formatTime, relativeTime, maskPhone
  lib/fixtures.ts                # typed mock data (Booking[] per shared types) until APIs land
```

### 10.3 Acceptance criteria (build gate)

1. `npm run build --workspace=apps/web` — no errors; `tsc --noEmit` clean.
2. Today screen renders: summary strip + job cards with correct status colors (pending=orange, confirmed=blue, rescheduled=muted).
3. All data regions have loading (Skeleton), empty, and error (Alert+Retry) states — verified by toggling fixtures.
4. Job detail Sheet opens from card tap; Call/Text are real `tel:`/`sms:` anchors ≥44px; "Mark done" (if approved) confirms via Dialog.
5. Week view: day strip (mobile) + Calendar/day panel (desktop); day switch updates the list.
6. Keyboard: Tab through cards, Esc closes Sheet/Dialog, arrows work in Calendar — no focus traps broken.
7. `motion-reduce` disables animations; no console errors; Lighthouse a11y pass ≥ 95.
8. Visual check at 375 / 640 / 1024 / 1280 — no overflow, thumb-reach rule holds.