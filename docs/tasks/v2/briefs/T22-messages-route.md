# T22 — Messages route (GET /api/dashboard/messages)

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; T21 added `getOutboundMessages` — this task mounts the org-scoped read route the Messages page will call.

## Goal
`GET /api/dashboard/messages` responds `MessagesListResponse` (org-scoped ledger, optional `channel`/`status` filters, page/pageSize clamps, newest first) with the established dashboard route conventions (403 no org / 400 invalid_query / 500 server_error / 401 via requireAuth).

## Deliverables

### 1. `apps/api/src/routes/dashboard/messages.ts` (NEW)
Mirror `jobs.ts` structure exactly. Constants + handler:

```ts
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getOutboundMessages } from '../../services/outbound-ledger.js';
import type { DashboardApiErrorResponse, MessageDeliveryStatus } from '@tradescheduler/shared';

const router = Router();

const VALID_CHANNELS = new Set(['sms', 'whatsapp']);
const VALID_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'sent', 'delivered', 'failed', 'retried', 'escalated', 'blocked_optin',
]);

/** NaN-safe page/pageSize parse; defaults 1/20, pageSize clamped 1..100. */
function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const ctx = await getOrgContextByUserId(req.auth!.userId);
    if (!ctx) {
      res.status(403).json({ error: 'no_organization' } satisfies DashboardApiErrorResponse);
      return;
    }
    // channel: optional; empty string treated as absent; anything else invalid.
    const rawChannel = req.query.channel;
    if (rawChannel !== undefined && rawChannel !== '' && typeof rawChannel === 'string' && !VALID_CHANNELS.has(rawChannel)) {
      res.status(400).json({ error: 'invalid_query' } satisfies DashboardApiErrorResponse);
      return;
    }
    // status: optional; empty string treated as absent; anything else invalid.
    const rawStatus = req.query.status;
    if (rawStatus !== undefined && rawStatus !== '' && typeof rawStatus === 'string' && !VALID_STATUSES.has(rawStatus)) {
      res.status(400).json({ error: 'invalid_query' } satisfies DashboardApiErrorResponse);
      return;
    }
    const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = clampInt(req.query.pageSize, 20, 1, 100);
    const { messages, total } = await getOutboundMessages(ctx.organizationId, {
      ...(rawChannel && rawChannel !== '' ? { channel: rawChannel as 'sms' | 'whatsapp' } : {}),
      ...(rawStatus && rawStatus !== '' ? { status: rawStatus as MessageDeliveryStatus } : {}),
      page,
      pageSize,
      timezone: ctx.timezone,
    });
    res.json({ messages, total, page, pageSize });
  } catch (err) {
    console.error('[dashboard] messages error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const messagesRouter = router;
```

### 2. `apps/api/src/routes/dashboard/index.ts` (EDIT)
- Add `import { messagesRouter } from './messages.js';`
- Add `app.use('/api/dashboard/messages', messagesRouter);` after the escalations mount (line 34).
- Add `- GET  /api/dashboard/messages` to the route comment block (after the escalations line).

### 3. `apps/api/src/routes/dashboard/messages.test.ts` (NEW — HTTP pattern from `settings.test.ts`)
`vi.hoisted` mocks: `getOrgContextByUserId` (organization-service) and `getOutboundMessages` (outbound-ledger). Constants identical to T20 (`JWT_SECRET='test_jwt_secret_000_secret_000'`, `USER_ID='__VG_UUID_f4a3b2c1d0e9__'`, `ORG_ID='a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007'`, `TZ='America/New_York'`, `AUTHORIZED`). Mock `getOutboundMessages` to resolve `{ messages: [], total: 0 }`. Tests:
- 200 default → called with `(ORG_ID, expect.objectContaining({ page: 1, pageSize: 20, timezone: TZ }))`; body `{ messages: [], total: 0, page: 1, pageSize: 20 }`.
- 200 `?channel=whatsapp&status=failed&page=2&pageSize=5` → objectContaining `{ channel: 'whatsapp', status: 'failed', page: 2, pageSize: 5 }`.
- 200 `?channel=&status=` behaves like no filter (objectContaining without channel/status keys).
- 400 `invalid_query` for `?channel=voice`, `?status=deliverd` (typo), `?status=all`.
- 200 clamps: `?page=0&pageSize=999` → `page: 1, pageSize: 100`; `?page=abc` → `page: 1`.
- 403 no org; 401 missing token; 500 `server_error` when `getOutboundMessages` rejects.

## Hard rules
- Read-only GET; no mutation, no body parsing.
- T18 write paths untouched (this route only reads via `getOutboundMessages`).
- Validate-then-call: the service must never be invoked with an invalid filter (assert `getOutboundMessages` not called in the 400 tests).
- No `npm install`. No commit/push.

## Verify
`npm run typecheck --workspace=apps/api` && `npx vitest run --testTimeout=60000` (from apps/api; baseline 507 + new ~10) && `npm run build --workspace=apps/api`. Report to `docs/tasks/v2/reports/T22-messages-route.md` (what shipped, test/typecheck/build results, decisions/deviations).