# T24 — Web: Messages page

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; T22 mounted `GET /api/dashboard/messages` — this task surfaces the outbound delivery ledger as `/dashboard/messages` so SMS/WhatsApp delivery state and failures are observable.

## Goal
New secondary-nav page at `/dashboard/messages` rendering the org's outbound messages as a jobs-table-style table: To, body, channel chip, kind label, status pill (with tone map), error code, and relative send time — with client-side status filter chips.

## Deliverables

### 1. `apps/web/lib/types.ts` (EDIT — add at end)
```ts
export interface MessageRow {
  id: string;
  toPhone: string;
  body: string;
  channel: "sms" | "whatsapp";
  kindLabel: string | null;
  status: "queued" | "sent" | "delivered" | "failed" | "retried" | "escalated" | "blocked_optin";
  statusLabel: string;
  errorCode: string | null;
  messageSid: string | null;
  createdAt: string;
  createdAtDisplay: string;
}
```

### 2. `apps/web/lib/dashboard-api.ts` (EDIT)
- Import `MessagesListResponse` type from `@tradescheduler/shared`.
- Add after `getEscalations`:
```ts
export function getMessages(): Promise<MessagesListResponse | NoOrganization | typeof SESSION_EXPIRED> {
  return request<MessagesListResponse>("/api/dashboard/messages");
}
```

### 3. `apps/web/components/dashboard/messages-list.tsx` (NEW — copy `jobs-table.tsx` structure)
- `"use client"`. Props: `{ messages: MessageRow[] }`.
- Tone + order maps:
```ts
const STATUS_TONE: Record<MessageRow["status"], ChipTone> = {
  queued: "muted",
  sent: "muted",
  delivered: "success",
  failed: "danger",
  retried: "success",
  escalated: "danger",
  blocked_optin: "muted",
};
const STATUS_ORDER: MessageRow["status"][] = ["queued", "sent", "delivered", "failed", "retried", "escalated", "blocked_optin"];
const CHANNEL_LABEL: Record<MessageRow["channel"], string> = { sms: "SMS", whatsapp: "WhatsApp" };
```
- `StatusFilter = "all" | MessageRow["status"]`; `FilterChips` options with counts (All + the 7 in STATUS_ORDER), `label="Filter messages by status"`.
- `<table className="w-full min-w-[700px] text-[13px]">` inside `card overflow-hidden` + `overflow-x-auto`. Headers (jobs-table `th` styling): **To**, **Body**, **Channel**, **Kind**, **Status**, **Error**, **Sent** (right-aligned).
- Rows (`divided`, `hover:bg-surface-2 metric-card-rise`, stagger `animationDelay` like jobs-table):
  - To: `font-mono text-[12px]`.
  - Body: `text-ink-muted truncate max-w-[280px]` (add `truncate` with a wrapping `max-w`).
  - Channel: `<Chip tone="muted">{CHANNEL_LABEL[m.channel]}</Chip>`.
  - Kind: `kindLabel ?? "—"` in `text-ink-muted`.
  - Status: `<Chip tone={STATUS_TONE[m.status]} live={m.status === "queued"}>{m.statusLabel}</Chip>`.
  - Error: `m.errorCode ? <span className="font-mono text-[11.5px] text-ink-muted">{m.errorCode}</span> : "—"` (always render the cell; dash when null).
  - Sent: `text-ink-faint text-[11.5px]` right-aligned, `m.createdAtDisplay`.
- `rows.length === 0` → `<p className="text-center text-[13px] text-ink-muted py-8">No messages with this status.</p>` (jobs-table style).
- Count line above table (customers-list style, aria-live): `{filtered.length} of {messages.length} messages`.

### 4. `apps/web/app/dashboard/messages/page.tsx` (NEW — copy `customers/page.tsx` shape)
Use `TableSkeleton rows={6}` for loading, `ErrorState` label `"messages"`, `EmptyState`:
- PageHeader title `"Messages"` description `"Every SMS and WhatsApp message the AI sends, with live delivery status."`
- Empty title `"No messages yet"` description `"Outbound messages — confirmations, offers, and fallback retries — appear here as they're sent."`

### 5. `apps/web/components/dashboard/nav-rail.tsx` (EDIT)
- Import `MessageSquareText` from `lucide-react`.
- Add to `NAV_ITEMS_SECONDARY` between Analytics and Settings: `{ href: "/dashboard/messages", label: "Messages", icon: MessageSquareText }`.

## Hard rules
- No shadcn — reuse `Chip`, `ChipTone`, `FilterChips`, `PageHeader`, `TableSkeleton`, `ErrorState`, `EmptyState`.
- Read-only table: no reply/compose actions, no pagination controls (page-1 data; plan Decision 6).
- `blocked_optin` renders muted (consent refusal is not an incident, matches plan's tone map); `failed`/`escalated` are the danger tones.
- No new skeleton components. No `npm install`. No commit/push.

## Verify
`npm run build --workspace=apps/web`. Optionally boot `npm run dev --workspace=apps/web -p 3100` and open `/dashboard/messages` to confirm nav item, table, filter chips, tones. Report to `docs/tasks/v2/reports/T24-web-messages-page.md` (what shipped, build result, visual check notes).