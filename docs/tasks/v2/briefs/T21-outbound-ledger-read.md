# T21 — Outbound ledger read (service + DTO mapping)

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; T18 wrote the `rl_outbound_messages` ledger (insert/markSent/markFailed/markStatus/getByMessageSid) but there is no read path — this task adds the org-scoped list query plus the display label/format mapping for the Messages surface.

## Goal
`getOutboundMessages(orgId, opts)` returns the newest-to-oldest page of the org's ledger rows as `MessageRowDto[]` (with `kindLabel`, `statusLabel`, relative `createdAtDisplay`) and a matching `total`, with deterministic unit tests.

## Deliverables

### 1. `apps/api/src/services/outbound-ledger.ts` (EDIT — additive only; touch nothing that exists)
Import additions (extend line 24): `MessageDeliveryStatus`, `MessageRowDto` from `../types.js` (re-exported by T19). Add below `getByMessageSid`:

```ts
/** Human label per outbound kind (all 13 MessagingKind values). */
export const MESSAGE_KIND_LABEL: Record<import('../types.js').MessagingKind, string> = {
  booking_confirmation: 'Booking confirmation',
  reschedule_offer: 'Reschedule offer',
  slot_invalid: 'Slot invalid',
  no_availability: 'No availability',
  no_matching_booking: 'No matching booking',
  verification_code: 'Verification code',
  confirm_code: 'Confirm code',
  number_verified: 'Number verified',
  code_mismatch: 'Code mismatch',
  confirm_failed: 'Confirmation failed',
  help: 'Help',
  missed_call_callback: 'Missed call callback',
  staff_ack: 'Staff ack',
};

/** Human label per delivery status (all 7). */
export const MESSAGE_STATUS_LABEL: Record<MessageDeliveryStatus, string> = {
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
  retried: 'Retried',
  escalated: 'Escalated',
  blocked_optin: 'Blocked (no opt-in)',
};

/** Relative time: "Xs ago" < 60s, "Xm ago" < 60m, "Xh ago" < 24h, "Yesterday" < 48h, else org-tz "Sep 12". */
export function formatRelativeDisplay(iso: string, tz: string, nowMs: number): string {
  const diffSec = Math.floor((nowMs - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffHr < 48) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(new Date(iso));
}

/** Map a ledger row to the wire MessageRowDto. Status cast: OutboundStatus and
 *  MessageDeliveryStatus share the same 7 literals. */
export function toMessageRowDto(row: OutboundLedgerRow, tz: string, nowMs: number): MessageRowDto {
  return {
    id: row.id,
    toPhone: row.toPhone,
    body: row.body,
    channel: row.channel,
    kindLabel: row.kind ? (MESSAGE_KIND_LABEL[row.kind] ?? row.kind) : null,
    status: row.status as MessageDeliveryStatus,
    statusLabel: MESSAGE_STATUS_LABEL[row.status as MessageDeliveryStatus] ?? row.status,
    errorCode: row.errorCode,
    messageSid: row.messageSid,
    createdAt: row.createdAt,
    createdAtDisplay: formatRelativeDisplay(row.createdAt, tz, nowMs),
  };
}

export interface GetOutboundMessagesOptions {
  channel?: Channel;
  status?: MessageDeliveryStatus;
  page?: number;
  pageSize?: number;
  timezone: string;
}

export async function getOutboundMessages(
  orgId: string,
  opts: GetOutboundMessagesOptions,
): Promise<{ messages: MessageRowDto[]; total: number }>
```

**SQL** (build params array `params: unknown[] = [orgId]`, appending `channel`, then `status` in that order when present):
```sql
<SELECT_BY>
  from public.${tableName()}
 where organization_id = $1
 [and channel = $2]
 [and status = $3]           -- note: $n depends on which filters are present
 order by created_at desc
 limit $n offset $m          -- params.push(pageSize, offset); offset = (page - 1) * pageSize
```
Count query: `select count(*)::int as total from public.${tableName()} where organization_id = $1 [and channel = $2] [and status = $3]` (same params minus limit/offset). Defaults: `page = 1`, `pageSize = 20`; clamp `pageSize` to 1..100 and `page` ≥ 1 defensively (route also clamps). `nowMs = Date.now()` inside the service. Return rows mapped via `toRow` then `toMessageRowDto(row, opts.timezone, nowMs)`.

### 2. `apps/api/src/services/outbound-ledger.test.ts` (NEW — pg-mock pattern, no HTTP)
Same vi.hoisted/`vi.mock('pg')`/loadService pattern as `organization-service.test.ts`; set `DATABASE_URL`; reset env `OUTBOUND_MESSAGES_TABLE` after each. Tests:
- `getOutboundMessages` default → SQL contains `where organization_id = $1`, `order by created_at desc`, params `['org-1', 20, 0]`; count SQL has `count(*)::int`.
- with `channel: 'whatsapp'` + `status: 'failed'` → SQL contains `and channel = $2` and `and status = $3`, params `['org-1', 'whatsapp', 'failed', 20, 0]`.
- page/pageSize: `{ page: 2, pageSize: 5 }` → params end `[5, 5]`.
- row mapping: `kind: null` → `kindLabel: null`; `kind: 'staff_ack'` → `'Staff ack'`; `status: 'blocked_optin'` → `statusLabel: 'Blocked (no opt-in)'`; `errorCode`/`messageSid` passthrough; `createdAt` preserved.
- `formatRelativeDisplay`: `(iso, tz, nowMs)` with fixed `nowMs = new Date('2026-09-20T12:00:00Z').getTime()` → 5s → `'5s ago'`; 5m → `'5m ago'`; 5h → `'5h ago'`; 26h → `'Yesterday'`; 10d → matches `/^[A-Z][a-z]{2} \d{1,2}$/` with tz `'America/New_York'`.
- table env override: set `OUTBOUND_MESSAGES_TABLE='x_outbound'`, assert SQL contains `public.x_outbound`.

## Hard rules
- Additive ONLY: `insertOutbound`/`markSent`/`markFailed`/`markStatus`/`getByMessageSid`, `TERMINAL_STATUSES`, `TERMINAL_GUARD`, `toRow` stay byte-identical. `OutboundStatus` keeps its name — wire uses `MessageDeliveryStatus` (identical literals; cast at the DTO boundary only).
- No route/endpoint changes here (T22 consumes this).
- No `npm install`. No commit/push.

## Verify
`npm run typecheck --workspace=apps/api` && `npx vitest run --testTimeout=60000` (from apps/api; baseline 507 + new ~9) && `npm run build --workspace=apps/api`. Report to `docs/tasks/v2/reports/T21-outbound-ledger-read.md` (what shipped, test/typecheck/build results, decisions/deviations).