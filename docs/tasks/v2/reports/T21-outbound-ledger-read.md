# T21 — Outbound ledger read (service + DTO mapping) (report)

## Status
DONE (implemented in working tree; nothing committed — controller commits after review).

## What shipped

Strictly additive to `apps/api/src/services/outbound-ledger.ts`. The only touch
to pre-existing code is the sanctioned import extension on line 24
(`MessageDeliveryStatus`, `MessageRowDto` added to the `../types.js` import).
`insertOutbound` / `markSent` / `markFailed` / `markStatus` / `getByMessageSid`,
`TERMINAL_STATUSES`, `TERMINAL_GUARD`, `toRow`, and the `OutboundStatus` name are
byte-identical (verified via `git diff` — pre-existing hunk touches only the
import line; the trailing `+}` in the diff is a no-trailing-newline display
artifact, the file ends with `}` exactly as before). No routes, no `npm
install`, no commit.

### 1. `apps/api/src/services/outbound-ledger.ts` — read path appended below `getByMessageSid`

- `MESSAGE_KIND_LABEL` — all 13 `MessagingKind` values → human labels (brief
  verbatim).
- `MESSAGE_STATUS_LABEL` — all 7 delivery-status literals → human labels
  (`blocked_optin: 'Blocked (no opt-in)'`).
- `formatRelativeDisplay(iso, tz, nowMs)` — seconds/minutes/hours buckets,
  `'Yesterday'` inside 48 h, else org-tz short date via
  `Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric' })`
  (brief verbatim).
- `toMessageRowDto(row, tz, nowMs)` — ledger row → wire `MessageRowDto`;
  `status` cast `OutboundStatus → MessageDeliveryStatus` at the DTO boundary
  only (identical 7 literals); unknown kind/status falls back to the raw value.
- `GetOutboundMessagesOptions` + `getOutboundMessages(orgId, opts)`:
  - `params: unknown[] = [orgId]`, then `channel`, then `status` in that order
    when present; `where` built from `organization_id = $1` + `channel = $n` +
    `status = $n` so the numbered refs stay correct with any filter subset.
  - Count query `select count(*)::int as total …` (same params minus
    limit/offset) and the `SELECT_BY` page query (`order by created_at desc`,
    `limit $n offset $m`) run in parallel via `Promise.all([count, rows])` —
    count is `mock.calls[0]`, rows `mock.calls[1]`.
  - `page = max(1, floor(opts.page ?? 1))`, `pageSize = clamp(1..100,
    floor(opts.pageSize ?? 20))`, `offset = (page - 1) * pageSize` (route clamps
    again in T22 — defensive floor matches the route's `clampInt`).
  - `nowMs = Date.now()` inside the service; rows mapped `toRow` →
    `toMessageRowDto(row, opts.timezone, nowMs)`; `total = count.rows[0]?.total ?? 0`.
  - Returns `{ messages: MessageRowDto[]; total: number }` (page/pageSize live
    in `MessagesListResponse` at the T22 route layer).

### 2. `apps/api/src/services/outbound-ledger.test.ts` (NEW — 9 tests, no HTTP)

pg-mock pattern from organization-service.test.ts (`vi.hoisted` + `vi.mock('pg')`
+ `loadService()` dynamic import; `DATABASE_URL` set in `beforeEach`,
`OUTBOUND_MESSAGES_TABLE` + modules reset in `afterEach`). Cases:

- default → select SQL contains `where organization_id = $1` +
  `order by created_at desc`, params `['org-1', 20, 0]`; count SQL contains
  `count(*)::int` with params `['org-1']`.
- `channel: 'whatsapp'` + `status: 'failed'` → both SQLs contain `and channel = $2`
  and `and status = $3`; select params `['org-1', 'whatsapp', 'failed', 20, 0]`.
- `{ page: 2, pageSize: 5 }` → params `['org-1', 5, 5]`.
- clamp: `{ page: 0, pageSize: 999 }` → params `['org-1', 100, 0]`.
- row mapping: `kind: null` → `kindLabel: null`; `kind: 'staff_ack'` →
  `'Staff ack'`; `status: 'blocked_optin'` → `statusLabel: 'Blocked (no opt-in)'`;
  `errorCode` / `messageSid` passthrough; `createdAt` preserved; both channels
  mapped.
- `OUTBOUND_MESSAGES_TABLE='x_outbound'` → both SQLs contain `public.x_outbound`.
- `formatRelativeDisplay` (fixed `nowMs = 2026-09-20T12:00:00Z`): 5s → `'5s ago'`;
  5m → `'5m ago'`; 5h → `'5h ago'`; 26h → `'Yesterday'`; 10d → matches
  `/^[A-Z][a-z]{2} \d{1,2}$/` with tz `'America/New_York'`.

## Verification

| Command | Result |
| --- | --- |
| `npm run typecheck --workspace=apps/api` | PASS (tsc --noEmit, clean) |
| `npx vitest run --testTimeout=60000` (cwd `apps/api`) | PASS — 35 files, **529/529 tests green** (507 T18 baseline + T19/T20 working-tree additions + 9 new) |
| `npm run build --workspace=apps/api` | PASS (tsc) |
| new file alone: `npx vitest run src/services/outbound-ledger.test.ts` | PASS — 9/9 |

## Decisions / deviations

- **Query order**: count query first, then the page query (`Promise.all`
  array order ⇒ `mock.calls[0]` = count). The brief leaves the order open; the
  test suite asserts both consistently.
- **Floor in clamps**: `page`/`pageSize` floors before bounding so a fractional
  value behaves like the route's `clampInt` (which also floors). No behavior
  difference for the validated route path.
- **`total` fallback** `?? 0`: `count(*)` always returns exactly one row in
  Postgres, so the fallback is unreachable in production; it keeps the mock
  path from surfacing `undefined` if a test omits the count row.
- **Clamp test added** beyond the brief's bullet list — the clamp behavior is a
  specified deliverable, so it gets a deterministic test (`[5 ─> 100, 0]`).
- No other deviations; the brief's code blocks (`MESSAGE_KIND_LABEL`,
  `MESSAGE_STATUS_LABEL`, `formatRelativeDisplay`, `toMessageRowDto`,
  `GetOutboundMessagesOptions` signature) shipped verbatim.
- Pre-existing working-tree changes in `escalation-service.ts` /
  `src/routes/dashboard/escalations.test.ts` (T20) and the T19 type surface were
  not touched by this task.