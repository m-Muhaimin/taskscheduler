# T25 — Customers consent read model (DTO + query)

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; `rl_customers` already stores consent state (`phone_verified_at` migration 010, `whatsapp_opted_in` migration 014) but `GET /api/dashboard/customers` never selects it — this task extends the read model so the UI can show verification + WhatsApp opt-in.

## Goal
`CustomerDto` and `dashboard-service.getCustomers` expose `phoneVerifiedAt` (copy of the verified-phone timestamp; null otherwise) and `whatsappOptedIn` (read-only consent flag), with pg-mocked service tests proving the SELECT + mapping. The web `Customer` mirror absorbs the change in T26.

## Deliverables

### 1. `packages/shared/src/types.ts` (EDIT — `CustomerDto`, lines 457–463)
Replace the interface with:

```ts
export type CustomerDto = {
  id: string;
  name: string;     // fallback "Unknown" when null
  phone: string;
  jobCount: number;
  customerSince: string; // e.g. "2026" (created year)
  /** When the customer's phone passed SMS verification (T14 writes); null otherwise. */
  phoneVerifiedAt: IsoString | null;
  /** Customer opted into WhatsApp fallback delivery. READ-ONLY here — the
   *  WhatsApp worker owns the write (see migration 014); never set from the UI. */
  whatsappOptedIn: boolean;
};
```

### 2. `apps/api/src/services/dashboard-service.ts` (EDIT — `getCustomers`, lines 764–791)
- Widen the query row type: add `phone_verified_at: Date | null;` and `whatsapp_opted_in: boolean;` to the `q<{…}>` shape.
- Change the SELECT (add the two columns to the existing `cu.` list):
```ts
`select cu.id, cu.name, cu.phone,
        cu.phone_verified_at,
        cu.whatsapp_opted_in,
        extract(year from (cu.created_at at time zone $2))::int as created_year,
        (select count(*)::int from public.${appointmentsTable()} a
          where a.organization_id = cu.organization_id and a.customer_phone = cu.phone) as job_count
 from public.${customersTable()} cu
 where cu.organization_id = $1
 order by cu.created_at desc
 limit 100`,
```
- Widen the map (add exactly these two keys to the existing object):
```ts
phoneVerifiedAt: r.phone_verified_at ? r.phone_verified_at.toISOString() : null,
whatsappOptedIn: r.whatsapp_opted_in,
```
Params `[orgId, tz]` and everything else in `getCustomers` unchanged.

### 3. `apps/api/src/services/dashboard-service.test.ts` (EDIT — extend, keep existing suite intact)
The file today imports `deriveInboxSuggestion` statically with no pg mock. Add a pg-mock suite for `getCustomers`:
- At the top, add `import { vi } from 'vitest';` (already imported? verify — the file currently imports only `describe, expect, it`), the hoisted factory:
```ts
const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));
vi.mock('pg', () => {
  const MockPool = vi.fn(() => ({ query, end: vi.fn() }));
  return { Pool: MockPool };
});
```
- The existing `deriveInboxSuggestion` describe stays byte-identical — it calls a pure function and never touches the (lazy) pool, so the mock has zero effect on it (commit as its own test run: that suite must still pass).
- New `describe('getCustomers', …)`: set `process.env.DATABASE_URL = 'postgres://mock'` in `beforeEach`; dynamic import pattern for module state (pool is lazy, so the plain static import is fine, but follow the organization-service.test.ts `loadService()` habit only if needed for env isolation); `afterEach` delete `DATABASE_URL`/`CUSTOMERS_TABLE`/`APPOINTMENTS_TABLE` + `vi.resetModules()`. Tests:
  - rows with `phone_verified_at: new Date('2026-09-10T12:00:00Z')`, `whatsapp_opted_in: true` → DTO has `phoneVerifiedAt: '2026-09-10T12:00:00.000Z'`, `whatsappOptedIn: true`.
  - `null` values → `phoneVerifiedAt: null`, `whatsappOptedIn: false`.
  - SQL text passes `cu.phone_verified_at` and `cu.whatsapp_opted_in` and params `[orgId, tz]`.
  - `limit 100` preserved; empty rows → `{ customers: [] }`.

## Hard rules
- Read-model ONLY: no `UPDATE`, no opt-in endpoint, no worker changes. Consent writes stay owned by T14 verification / the WhatsApp worker (comment in the DTO says so).
- `CustomerDto` is used by `getCustomers` only — this task bundles producer + type change so typecheck stays green (plan Decision 3).
- No web changes here (T26). Do NOT touch the `Customer` web mirror in `apps/web/lib/types.ts` in this task.
- No `npm install`. No commit/push.

## Verify
`npm run typecheck --workspace=apps/api` && `npx vitest run --testTimeout=60000` (from apps/api; existing deriveInboxSuggestion suite + new getCustomers suite green, baseline 507 + new ~4) && `npm run build --workspace=apps/api`. Report to `docs/tasks/v2/reports/T25-customers-consent-read-model.md` (what shipped, test/typecheck/build results, decisions/deviations).