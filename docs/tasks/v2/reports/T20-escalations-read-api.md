# T20 — Escalations read API (report)

## Status
DONE (implemented in working tree; nothing committed — controller commits after review).

## What shipped

`GET /api/dashboard/escalations` is now a DB-backed, org-scoped read. The
hardcoded `__VG_UUID_*` in-memory mock route is deleted entirely — no fixture
fallback path remains anywhere in the route or service (verified by grep:
zero `__VG_UUID_`, `StoredEscalation`, `TYPE_LABEL`, `paginate`, `toResponse`
in the route; service carries none either).

### 1. `packages/shared/src/types.ts` (2-line change)
- `EscalationListResponse.escalations: Escalation[]` → `EscalationDto[]`.
- §2.9 comment updated: "response body. `escalations` carries display-ready
  EscalationDto rows." (`EscalationDto` itself already existed from T19 — not
  re-added.)

### 2. `apps/api/src/services/escalation-service.ts` (additive; `createEscalation` untouched)
- `ESCALATION_LABEL` — all 7 types (incl. `customer_escalation` → "Customer
  escalation", `staff_sms` → "Staff message"; mock only had 5).
- `formatAbsoluteDate(iso, tz)` — en-US 12h org-tz "Sep 18, 3:15 PM".
- Table helpers `escalationsTable()` / `customersTable()` /
  `tradespeopleTable()` / `organizationMembersTable()` (env override,
  `rl_` default — dashboard-service.ts conventions).
- **Org-scope predicate pinned verbatim from the brief** (two-arm phone rule):
  `exists(… rl_customers cu … cu.organization_id = $1 and cu.phone =
  e.customer_phone) OR exists(… rl_tradespeople tp JOIN rl_organization_members
  om … om.organization_id = $1 and tp.phone = e.customer_phone)`. Implemented as
  a call-time helper `orgScopePredicate()` so table env names resolve at query
  time (same as dashboard-service's inline interpolation).
- `getEscalations(orgId, {status?, page?, pageSize?, timezone})` →
  `EscalationListResponse`. Data query then count query (`count(*)::int`).
  Params `[orgId, …(status ? [status] : []), pageSize, offset]`;
  `order by case when e.status = 'pending' then 0 else 1 end, e.created_at desc`;
  defensive page/pageSize clamp (1/20 defaults, pageSize max 100).
- `toEscalationDto(row, tz)` mapping exactly as briefed (iso strings, labels,
  display timestamps; `resolvedAtDisplay` null when `resolved_at` null).

### 3. `apps/api/src/routes/dashboard/escalations.ts` (rewritten, mock deleted)
- Mirrors jobs.ts/customers.ts: `requireAuth` → `getOrgContextByUserId` → 403
  `no_organization` → optional single-valued `status` filter (`pending` |
  `resolved`, anything else non-empty → 400 `invalid_query`) → clamped
  page/pageSize → `getEscalations(ctx.organizationId, …, timezone)` → 500
  `server_error` catch. No POST /resolve or any mutation (per plan Decision 1).

### 4. Tests (2 new files, 13 tests)
- `apps/api/src/services/escalation-service.test.ts` (5, pg-mock pattern from
  organization-service.test.ts): default call SQL + params `['org-1', 20, 0]`
  with both EXISTS arms and the pending-first order clause; `status:'resolved'`
  adds `and e.status = $2` with params `['org-1','resolved',20,0]` (count query
  too); custom table env names reflected in SQL; row→DTO mapping
  (`staff_sms` → "Staff message", `customer_escalation` → "Customer
  escalation", `count(*)::int`, `resolvedAtDisplay` null); empty rows →
  `{ escalations: [], total: 0, page: 1, pageSize: 20 }`.
- `apps/api/src/routes/dashboard/escalations.test.ts` (8, HTTP pattern from
  settings.test.ts, both services mocked): 200 default (called with
  `(ORG_ID, objectContaining({page:1,pageSize:20,timezone:TZ}))` + echoes body);
  200 `?status=pending`; 200 empty `?status=` = no filter; 400 `invalid_query`
  for `bogus`/`all`; 200 clamps (`page=0&pageSize=999` → 1/100, `page=abc` → 1);
  403 `no_organization`; 401 `missing_token`; 500 `server_error` on service
  reject (console.error silenced via spy).

## Verification

| Command | Result |
| --- | --- |
| `npm run typecheck --workspace=apps/api` | PASS (tsc --noEmit, clean) |
| `npx vitest run --testTimeout=60000` (cwd `apps/api`) | PASS — 35 files, **529/529 tests green** (507 in T19's report + 9 baseline tests added by other working-tree tasks + 13 new here) |
| New files alone | PASS — escalation-service.test.ts 5/5, escalations.test.ts 8/8 |
| `npm run build --workspace=apps/api` | PASS (tsc) |

## Decisions / deviations
- **`?status=` empty-string guard**: the brief's §3 code block checks only
  `rawStatus !== undefined`, but its trailing note mandates treating empty as
  "no filter"; the route uses `rawStatus !== undefined && rawStatus !== ''`
  (required for the "200 `?status=` behaves like no filter" test).
- **Predicate as call-time helper**: `orgScopePredicate()` (not a module-level
  const) so `CUSTOMERS_TABLE`/`TRADESPEOPLE_TABLE`/`ORGANIZATION_MEMBERS_TABLE`
  env overrides resolve at query build time, matching dashboard-service.ts
  conventions and the env-swap service test.
- **Data query runs before count query** so the service tests can assert the
  data SQL/params on `mock.calls[0]`.
- **No `__VG_UUID_*` in new fixtures**: to honor the hard rule, the route
  test's mocked DTO id is a plain string (`esc-staff-001`) — the only
  `__VG_UUID_*` literals in the new test file are `USER_ID`/`ORG_ID`, which the
  brief pins verbatim. Pre-existing `__VG_UUID_*` strings in *other* test files
  (auth-service, inbox-actions, settings) are outside this task's scope.
- **Untouched working-tree files**: `apps/api/src/services/outbound-ledger.ts`,
  `apps/api/src/types.ts`, `outbound-ledger.test.ts` and the T19/T21 briefs +
  T21 report were already modified/untracked before this task (T19/T21 work);
  left as-is. No `npm install`, no commit.
- **Test-count note**: brief estimated ~14 new tests; shipped 13 (5 service +
  8 route) covering every listed case.