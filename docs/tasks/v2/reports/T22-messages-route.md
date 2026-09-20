# T22 — Messages route (GET /api/dashboard/messages) (report)

## Status
DONE (implemented in working tree; nothing committed — controller commits after review).

## What shipped

Strictly additive: one new route file, one new mount + comment line in the
dashboard index, one new HTTP test file. No `npm install`, no commit. T18 write
paths and T21's service are untouched (route only reads via
`getOutboundMessages`).

### 1. `apps/api/src/routes/dashboard/messages.ts` (NEW)
Mirrors `jobs.ts` structure; handler is the brief's code verbatim:

- `VALID_CHANNELS = { 'sms', 'whatsapp' }`; `VALID_STATUSES` = the 7
  `MessageDeliveryStatus` literals (`queued`, `sent`, `delivered`, `failed`,
  `retried`, `escalated`, `blocked_optin`).
- `clampInt(raw, fallback, min, max)` — NaN-safe parse, `Number.isFinite` gate,
  floor, min/max bound. `page` → defaults 1, min 1, no max cap;
  `pageSize` → defaults 20, clamped 1..100.
- `router.get('/', requireAuth, …)` — org-scope first (403 `no_organization`
  before any query validation), then channel (else 400 `invalid_query`), then
  status (else 400 `invalid_query`). `''` treated as absent for both filters
  (spread only emits `channel`/`status` keys when non-empty). **Validate-then-
  call**: any invalid filter returns 400 before `getOutboundMessages` is
  reached.
- Service call: `getOutboundMessages(ctx.organizationId, { channel?, status?,
  page, pageSize, timezone: ctx.timezone })` → `res.json({ messages, total,
  page, pageSize })` (`MessagesListResponse`). Uncaught errors →
  `console.error('[dashboard] messages error:', err)` + 500 `server_error`.

### 2. `apps/api/src/routes/dashboard/index.ts` (EDIT, 3 hunks)
- `import { messagesRouter } from './messages.js';` after the escalations import.
- `- GET  /api/dashboard/messages` added to the route comment block after the
  escalations line.
- `app.use('/api/dashboard/messages', messagesRouter);` after the escalations
  mount (line 34).

### 3. `apps/api/src/routes/dashboard/messages.test.ts` (NEW — 8 tests, HTTP)
Pattern byte-for-byte from the T20 `escalations.test.ts` (and `settings.test.ts`):
`vi.hoisted` mocks for `getOrgContextByUserId` (organization-service) AND
`getOutboundMessages` (outbound-ledger), each `vi.mock`'d to the same `mocks`
object; constants `JWT_SECRET='test_jwt_secret_000_secret_000'`,
`USER_ID='__VG_UUID_f4a3b2c1d0e9__'`, `ORG_ID='a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007'`,
`TZ='America/New_York'`; `AUTHORIZED` bearer from `jwt.sign({ sub: USER_ID },
JWT_SECRET, { issuer: 'tradescheduler' })`; `createApp()` on an ephemeral port.
`beforeEach` resets both mocks, org context resolves `{ organizationId: ORG_ID,
timezone: TZ }`, `getOutboundMessages` resolves `{ messages: [], total: 0 }`.

Cases (8):
1. 200 default → called with `(ORG_ID, expect.objectContaining({ page: 1,
   pageSize: 20, timezone: TZ }))`; body `{ messages: [], total: 0, page: 1,
   pageSize: 20 }`.
2. 200 `?channel=whatsapp&status=failed&page=2&pageSize=5` → objectContaining
   `{ channel: 'whatsapp', status: 'failed', page: 2, pageSize: 5 }`.
3. 200 `?channel=&status=` → opts `toEqual({ page: 1, pageSize: 20,
   timezone: TZ })` (no channel/status keys).
4. 400 `invalid_query` for `?channel=voice`, `?status=deliverd` (typo),
   `?status=all` → body `{ error: 'invalid_query' }` and
   `getOutboundMessages` **not called**.
5. 200 clamps: `?page=0&pageSize=999` → `{ page: 1, pageSize: 100 }`;
   `?page=abc` → `{ page: 1 }`.
6. 403 `no_organization` when org context is null (service not called).
7. 401 `missing_token` with no bearer.
8. 500 `server_error` when `getOutboundMessages` rejects (console.error spied).

## Verification

| Command | Result |
| --- | --- |
| `npm run typecheck --workspace=apps/api` | PASS (`tsc --noEmit`, clean) |
| `npx vitest run --testTimeout=60000` (cwd `apps/api`) | PASS — 36 files, **537/537 tests green** (529 baseline + 8 new) |
| `npm run build --workspace=apps/api` | PASS (`tsc`) |
| new file alone: `src/routes/dashboard/messages.test.ts` | PASS — 8/8 (reported within the full run) |

## Decisions / deviations

- **Test count 8, brief said "~10 new"**: the brief's bullet list enumerates
  exactly eight scenarios (defaults / filters / empty-filters / 400x3 / clamps
  / 403 / 401 / 500); the clamp test covers both `page=0&pageSize=999` and
  `page=abc` in one `it`, matching the T20 escalations.test.ts structure
  exactly. 537 − 529 = 8 new, consistent with the controller's
  "529 baseline + ~10 new" (other working-tree tasks added T19/T20/T21 tests to
  the baseline).
- **Empty-filter assertion**: instead of `objectContaining` (which would pass
  even if the route emitted the keys), the empty case asserts
  `toEqual({ page: 1, pageSize: 20, timezone: TZ })` — mirrors the
  escalations.test.ts empty-`status` check, stronger and exactly the brief's
  "behaves like no filter".
- **400 grouping**: the three invalid queries iterate in one `it` with
  `getOutboundMessages` not-called asserted after the loop (per the brief's
  "assert not called in the 400 tests"), same shape as escalations.test.ts.
- Handler code, constants, mock setup, mount position (after escalations, line
  34→36/37 after edits), and comment line all shipped per the brief; no
  deviations from the verbatim handler.
- Pre-existing working-tree changes (T19 types, T20 escalations route/tests,
  T21 outbound-ledger read) were not touched by this task.

## Notes for Sentinel / Probe
- Route is read-only GET; no body parsing; only server-side reads via
  `getOutboundMessages` (org-scoped, filters parameterized, user timezone from
  org context).
- Sentinel can audit that 400 paths never reach the ledger (validate-then-call
  ordering: org → channel → status → service) and that `MessagesListResponse`
  field names match the T19 DTO.
- Probe: exercise `?channel=&status=` (absent-filter behavior), `?page=1.9`
  (floor → 1), and `?channel=sms&channel=whatsapp` (Express string-or-array —
  handler 400s non-string arrays, which the suite doesn't cover explicitly).