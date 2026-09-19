# T9 — aiCostByDay org-scoping + automation settings schema

## Why
`rl_ai_usage` has no org column — the analytics `aiCostByDay` series is global
(visible to every org). Fix is cheap now: the DB is empty and NO production
code calls `recordAiUsage()` yet (ai-usage-service.ts exists, zero call sites).
Also: automation toggles need persistence → `rl_organizations.settings jsonb`.

## DB (done by DDL task, RL_010 migration — NOT your dispatch)
- `rl_ai_usage.organization_id uuid references rl_organizations(id) on delete cascade` (nullable) + index `(organization_id, created_at)`.
- `rl_organizations.settings jsonb not null default '{}'::jsonb`.

## Your scope — apps/api/src + packages/shared
1. **ai-usage-service.ts**: `RecordAiUsageInput` gains optional `organizationId?: string | null`; INSERT includes it; `AiUsageRecord` gains `organizationId: string | null`; update its tests.
2. **dashboard-service.ts aiCostByDay (~L850+)**: scope the series to the org —
   `where organization_id = $1` (drop the GLOBAL-series join pattern + caveat);
   update the file-top comment noting rl_ai_usage now carries org. Summary/others untouched.
3. **packages/shared/src/types.ts**: update the `DashboardAnalyticsResponse.aiCostByDay`
   comment (was "GLOBAL series") → now org-scoped.

## Acceptance
- typecheck + full API suite green (309/309 warm baseline; known cold-run flakes are not yours).
- Live (kill stale tsx on :3001, boot fresh, health check; throwaway creds from
  T2/T3 report + T7 final creds): seed 3 `rl_ai_usage` rows — one with the throwaway
  org, one other-org (random uuid), one NULL — verify analytics `aiCostByDay` counts
  ONLY the own-org row (seed past 30d so the series window includes it; match the
  demand series' date-window params). Cleanup the 3 rows after.
- Do NOT commit. Report: docs/tasks/v2/reports/T9-ai-cost-org-scope.md (SQL, matrix, cleanup proof).
