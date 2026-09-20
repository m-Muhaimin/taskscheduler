# T20 — Escalations read API (DB-backed, mock route replaced)

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; today `GET /api/dashboard/escalations` serves a hardcoded `__VG_UUID_*` in-memory array, so every escalation written by `escalation-service.createEscalation` (incl. T16 `staff_sms` rows) is invisible — this task wires the read path end to end.

## Goal
`GET /api/dashboard/escalations` becomes an org-scoped Postgres read: the shared `EscalationListResponse` carries display-ready `EscalationDto` rows, the service gains `getEscalations`, and the mock route is fully replaced (fixtures deleted). Pending escalations sort first, then newest.

## Deliverables

### 1. `packages/shared/src/types.ts` (EDIT — one line)
Change line 259 `escalations: Escalation[];` → `escalations: EscalationDto[];` and update the §2.9 comment: "response body. `escalations` carries display-ready EscalationDto rows."

### 2. `apps/api/src/services/escalation-service.ts` (EDIT — additive exports; keep `createEscalation` untouched)
Add below `createEscalation`:

```ts
/** Human label per escalation type (mock had only 5 — all 7 now covered). */
export const ESCALATION_LABEL: Record<string, string> = {
  ambiguous_intent: 'Ambiguous intent',
  no_availability: 'No availability',
  calendar_api_failure: 'Calendar API failure',
  sms_delivery_failure: 'SMS delivery failure',
  processing_error: 'Processing error',
  customer_escalation: 'Customer escalation',
  staff_sms: 'Staff message',
};

/** Org-tz absolute timestamp "Sep 18, 3:15 PM" (en-US, 12h). */
export function formatAbsoluteDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

export interface GetEscalationsOptions {
  status?: EscalationStatus;
  page?: number;
  pageSize?: number;
  timezone: string;
}

export async function getEscalations(
  orgId: string,
  opts: GetEscalationsOptions,
): Promise<EscalationListResponse>
```

Table helpers to add (file currently has none; mirror dashboard-service.ts conventions):
```ts
function customersTable(): string { return process.env.CUSTOMERS_TABLE ?? 'rl_customers'; }
function tradespeopleTable(): string { return process.env.TRADESPEOPLE_TABLE ?? 'rl_tradespeople'; }
function organizationMembersTable(): string { return process.env.ORGANIZATION_MEMBERS_TABLE ?? 'rl_organization_members'; }
```
(Keep the existing inline `ESCALATIONS_TABLE ?? 'rl_escalations'` from `createEscalation`; reference it again here.)

**Org-scope predicate (the two-arm phone rule — pin literally):**
```sql
(
  exists (select 1 from public.${customersTable()} cu
           where cu.organization_id = $1 and cu.phone = e.customer_phone)
  or exists (select 1 from public.${tradespeopleTable()} tp
             join public.${organizationMembersTable()} om on om.user_id = tp.id
             where om.organization_id = $1 and tp.phone = e.customer_phone)
)
```

**Data query** (params: `[orgId, ...(status ? [status] : []), pageSize, offset]`; `offset = (page - 1) * pageSize`; `page`/`pageSize` default 1/20, guarded against NaN in the route, but also clamp here defensively):
```sql
select e.id, e.type, e.customer_phone, e.content, e.status, e.created_at, e.resolved_at
  from public.${escalationsTable()} e
 where <ORG_SCOPE_PREDICATE>
 [and e.status = $2]
 order by case when e.status = 'pending' then 0 else 1 end, e.created_at desc
 limit $n offset $m
```
**Count query** — same `from`/`where` with `select count(*)::int as total` (params minus limit/offset).

**Row→DTO mapping** (`toEscalationDto(row, tz)`, rows shaped like `createEscalation`'s return type minus `content` cast):
```ts
{
  id: row.id,
  type: row.type,
  customerPhone: row.customer_phone,
  content: row.content,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  resolvedAt: row.resolved_at?.toISOString() ?? null,
  typeLabel: ESCALATION_LABEL[row.type] ?? row.type,
  createdAtDisplay: formatAbsoluteDate(row.created_at.toISOString(), tz),
  resolvedAtDisplay: row.resolved_at ? formatAbsoluteDate(row.resolved_at.toISOString(), tz) : null,
}
```
Import additions: `EscalationDto`, `EscalationListResponse`, `EscalationStatus` from `@tradescheduler/shared` (extend the existing line-8 import).

### 3. `apps/api/src/routes/dashboard/escalations.ts` (REWRITE — delete the mock)
Delete entirely: `StoredEscalation` (line 9), the `escalations` array + ALL three `__VG_UUID_*` fixtures (lines 19–47), `TYPE_LABEL` (51–57), `paginate` (59–62), `toResponse` (64–79), and the old GET handler (83–94). Keep the router/`requireAuth`/exports. New handler (mirror `jobs.ts`/`customers.ts` structure):

```ts
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getEscalations } from '../../services/escalation-service.js';
import type { DashboardApiErrorResponse, EscalationStatus } from '@tradescheduler/shared';

const router = Router();

/** Parse a page/pageSize query value; NaN-safe, clamped (defaults 1 / 20, pageSize max 100). */
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
    const rawStatus = req.query.status;
    let status: EscalationStatus | undefined;
    if (rawStatus !== undefined) {
      if (rawStatus === 'pending' || rawStatus === 'resolved') {
        status = rawStatus;
      } else {
        res.status(400).json({ error: 'invalid_query' } satisfies DashboardApiErrorResponse);
        return;
      }
    }
    const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = clampInt(req.query.pageSize, 20, 1, 100);
    const response = await getEscalations(ctx.organizationId, {
      ...(status ? { status } : {}),
      page,
      pageSize,
      timezone: ctx.timezone,
    });
    res.json(response);
  } catch (err) {
    console.error('[dashboard] escalations error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const escalationsRouter = router;
```
(Twilio `status=undefined` with `?status=` empty string: treat empty string as "no filter" — only reject non-empty invalid values. Guard: `if (rawStatus !== undefined && rawStatus !== '')`.)

### 4. `apps/api/src/services/escalation-service.test.ts` (NEW — pg-mock pattern from `organization-service.test.ts`)
`vi.hoisted` `{ query }`, `vi.mock('pg')` with MockPool, `loadService()` dynamic import, `DATABASE_URL` in `beforeEach`, `vi.resetModules()` in `afterEach`. Tests:
- default call → SQL contains both EXISTS arms (`rl_customers`, `rl_tradespeople`, `rl_organization_members`), `order by case when e.status = 'pending' then 0 else 1 end, e.created_at desc`, params `['org-1', 20, 0]`.
- `status: 'resolved'` → SQL contains `and e.status = $2`, params `['org-1', 'resolved', 20, 0]`.
- custom table env names used (set `ESCALATIONS_TABLE`/`CUSTOMERS_TABLE`/`TRADESPEOPLE_TABLE`/`ORGANIZATION_MEMBERS_TABLE`, assert SQL).
- row mapping → `typeLabel` 'Staff message' for `staff_sms`, 'Customer escalation' for `customer_escalation`; counts `count(*)::int` query; `resolvedAtDisplay` null when `resolved_at` null.
- empty rows → `{ escalations: [], total: 0, page: 1, pageSize: 20 }`.

### 5. `apps/api/src/routes/dashboard/escalations.test.ts` (NEW — HTTP pattern from `settings.test.ts`)
`vi.hoisted` mocks for `getOrgContextByUserId` (organization-service) AND `getEscalations` (escalation-service); `createApp()` + `server.listen(0)`; constants `JWT_SECRET='test_jwt_secret_000_secret_000'`, `USER_ID='__VG_UUID_f4a3b2c1d0e9__'`, `ORG_ID='a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007'`, `TZ='America/New_York'`, `AUTHORIZED` Bearer header (issuer `'tradescheduler'`). Tests:
- 200 default → `getEscalations` called with `(ORG_ID, expect.objectContaining({ page: 1, pageSize: 20, timezone: TZ }))`; body echoes the mocked response.
- 200 `?status=pending` → objectContaining `{ status: 'pending' }`.
- 200 `?status=` (empty) behaves like no filter.
- 400 `invalid_query` for `?status=bogus` and `?status=all`.
- 200 page/pageSize clamps: `?page=0&pageSize=999` → `page: 1, pageSize: 100`; `?page=abc` → `page: 1`.
- 403 `no_organization` when org context null; 401 `missing_token` without bearer; 500 `server_error` when `getEscalations` rejects.

## Hard rules
- Mock is REPLACED, never patched: no fixture fallback path, no `__VG_UUID_*` strings anywhere after this task.
- Org scoping: the two-arm phone predicate verbatim — staff phones make T16 `staff_sms` rows surface; phones with no customer/staff row in an org are invisible (accepted, documented in the plan).
- Do not add POST /resolve or any mutation here (deferred by plan Decision 1).
- No `npm install`. No commit/push.

## Verify
`npm run typecheck --workspace=apps/api` && `npx vitest run --testTimeout=60000` (from apps/api; baseline 507 + new ~14) && `npm run build --workspace=apps/api`. Report to `docs/tasks/v2/reports/T20-escalations-read-api.md` (what shipped, test/typecheck/build results, decisions/deviations).