# T24 — Web: Messages page (report)

## Status
DONE (implemented in working tree; nothing committed — controller commits after review).

## What shipped

`/dashboard/messages` is a new secondary-nav page (below the divider, next to
Analytics/Settings) that surfaces the T22 outbound delivery ledger as a
read-only jobs-table-style table: To (mono), truncated body, channel chip,
kind label, delivery status pill with the plan's tone map, error code (when
present), and relative send time — with client-side status filter chips.
Read-only per plan Decision 6: no reply/compose affordance, no pagination
controls (page-1 data; `total` intentionally unused).

### 1. `apps/web/lib/types.ts` (EDIT, +27)
- `MessageRow` interface appended verbatim from brief §1 (id, toPhone, body,
  channel, kindLabel, status, statusLabel, errorCode, messageSid, createdAt,
  createdAtDisplay). Field-for-field mirror of the shared `MessageRowDto`
  (status literal union matches `MessageDeliveryStatus`), so API rows pass
  through without mapping.

### 2. `apps/web/lib/dashboard-api.ts` (EDIT, +5)
- `MessagesListResponse` added to the `@tradescheduler/shared` type-import
  block (alphabetical: after `InboxActionResponse`).
- `getMessages()` added immediately after `getEscalations()`, exact signature
  from the brief (`request<MessagesListResponse>("/api/dashboard/messages")`
  → `Promise<MessagesListResponse | NoOrganization | typeof SESSION_EXPIRED>`).
  Inherits the shared 401/403/5xx contract: 401 clears the cookie and redirects
  to /login; `no_organization` → /onboarding/workspace; 5xx → the page's
  compact error card with retry.

### 3. `apps/web/components/dashboard/messages-list.tsx` (NEW — jobs-table structure)
Client component cloned from the jobs-table/escalations-list patterns:
- `STATUS_TONE: Record<MessageRow["status"], ChipTone>` — queued/sent/
  blocked_optin → `muted`, delivered/retried → `success`, failed/escalated →
  `danger` (verbatim from the plan's tone map; consent refusal is not an
  incident).
- `STATUS_ORDER` (the 7 statuses in plan order) drives the `FilterChips`
  options with live counts; `label="Filter messages by status"`.
- Count line above the table (customers-list style, `aria-live="polite"`):
  `{filtered.length} of {messages.length} messages`.
- `card overflow-hidden` + `overflow-x-auto`, `table className="w-full
  min-w-[700px] text-[13px]"`. Headers use the jobs-table `th` treatment
  (uppercase 11px faint, `border-b`), right-aligned **Sent**.
- Rows in `tbody divided`, `hover:bg-surface-2 transition-colors
  metric-card-rise` with staggered `animationDelay` (jobs-table, 45ms):
  - To: `font-mono text-[12px]`.
  - Body: `text-ink-muted truncate max-w-[280px]` + `title` attr so the full
    body stays reachable on hover despite single-line truncation.
  - Channel: `Chip tone="muted"` with `CHANNEL_LABEL` (SMS / WhatsApp).
  - Kind: `kindLabel ?? "—"` in `text-ink-muted`.
  - Status: `Chip tone={STATUS_TONE[m.status]} live={m.status === "queued"}`
    with the server-formatted `statusLabel`.
  - Error: cell always rendered — mono 11.5px faint code when `errorCode` is
    present, "—" dash when null.
  - Sent: `text-ink-faint text-[11.5px]` right-aligned, `createdAtDisplay`.
- Empty filtered state (jobs-table style): `No messages with this status.`

### 4. `apps/web/app/dashboard/messages/page.tsx` (NEW — customers/page.tsx shape)
Same skeleton/state grammar as jobs & customers pages: `PageHeader
title="Messages"` with the brief's description ("Every SMS and WhatsApp
message the AI sends, with live delivery status."), `TableSkeleton rows={6}`
on loading, `ErrorState label="messages"` on error, `EmptyState` (title "No
messages yet", the brief's confirmations/offers/fallback-retries copy) on
403-empty or zero-length rows, then `MessagesList messages={state.data.messages}`
when ready.

### 5. `apps/web/components/dashboard/nav-rail.tsx` (EDIT, +2)
- `MessageSquareText` added to the lucide-react import.
- `NAV_ITEMS_SECONDARY` entry between Analytics and Settings:
  `{ href: "/dashboard/messages", label: "Messages", icon: MessageSquareText }`.
  Sliding active pill, `aria-current`, and drawer behavior come free from the
  existing `isActive`/`NavLink` machinery.

### Hard rules honored
- Shadcn-free: reuses only `Chip`, `ChipTone`, `FilterChips`, `PageHeader`,
  `TableSkeleton`, `ErrorState`, `EmptyState`. No new skeleton components.
- Read-only table — no reply/compose actions, no pagination controls (grep:
  no mutation helper, no page controls on the page).
- `blocked_optin` renders `chip-muted`; only `failed`/`escalated` are danger.
- Edits are purely additive to the 3 shared files T23 touched — no lines from
  T23's Escalations work were disturbed.
- No `npm install`, no commit.

## Verification

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` (cwd `apps/web`) | PASS — 0 errors (no `typecheck` script exists in apps/web package.json; `tsc --noEmit` is the equivalent) |
| `npm run build --workspace=apps/web` | PASS — `✓ Compiled successfully`, type + lint phase clean, 19/19 static pages generated incl. `○ /dashboard/messages` (1.81 kB, 103 kB first load). The repeated `⚠ Found lockfile missing swc dependencies … Failed to patch lockfile` warnings are the known cosmetic issue per CLAUDE.md — builds succeed regardless |

No test suite covers this work: apps/web's only tests are the session-core
unit tests (`npm test` → `tsx tests/session-core.test.mts`), which exercise
`lib/session-core.ts` — untouched — so nothing regression-relevant to run.

## Decisions / deviations
- **Brief beats controller paraphrase on nav + skeleton (flagged):** the
  task's route summary said "import Send … add after Escalations" and
  "CustomersSkeleton rows={6}"; the brief (source of truth) specifies
  `MessageSquareText` in `NAV_ITEMS_SECONDARY` between Analytics and Settings,
  and `TableSkeleton rows={6}` for the table page. Followed the brief exactly
  on all three points. (`MessageSquareText` also reads more accurately for a
  delivery-ledger nav item than `Send`, which implies compose.)
- **Live-browser check skipped (optional per brief):** `/dashboard` is gated
  by `ts_session` middleware and rendering a real table needs the API up
  against an org with seeded outbound messages (T22's DB read). Build + tsc
  cover the type/route/nav wiring. Recommend a smoke test once a seeded dev DB
  is up: nav item lands on the page, skeleton → rows, queued rows pulse,
  `blocked_optin` renders muted, failed/escalated render danger, errorCode
  shows in the Error column, chip-filter re-counts the aria-live line.
- **Truncated body carries a `title` attribute** so the full message text is
  reachable on hover despite single-line truncation (same choice as T23's
  escalations content line).
- **No changes outside the 5 deliverable files.** The other new/modified paths
  around them (API route/service/tests, T23's web files, briefs T19–T26, the
  plan doc) are pre-existing working-tree context from earlier tasks — left
  as-is.

## Visual notes
- Status pills reuse the Chip component's existing three-tone system, exactly
  as jobs (success/muted) and escalations (danger/success) already do: no new
  color tokens. `queued` gets the `live` pulse-dot ("something is happening
  right now") — the same semantic as Inbox/Jobs live chips; `failed`/
  `escalated` are the only danger cells, so delivery problems pop against the
  otherwise quiet ledger.
- Table keeps the dashboard's jobs-table grammar: faint uppercase headers,
  `divided` row hairlines, mono narrow columns (To, Error) balanced by the
  free-width Body column truncating at 280px, fixed right-aligned time column.
  `min-w-[700px]` inside `overflow-x-auto` means narrow screens scroll the
  table horizontally rather than crushing the Body column.
- Channel and kind chips are both `chip-muted` — secondary metadata, kept
  visually subordinate to the status pill.