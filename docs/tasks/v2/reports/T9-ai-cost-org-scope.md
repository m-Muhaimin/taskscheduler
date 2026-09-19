# T9 — Org-scoped aiCostByDay — Report

Date: 2026-09-19 · Agent: wired (backend/API) · Brief: `docs/tasks/v2/briefs/T9-ai-cost-org-scope.md` · API scope only (apps/api + packages/shared; apps/web is forge's)

## What was shipped

- **`rl_ai_usage.organization_id` applied LIVE (RL_010)** — dispatched the `supabase` subagent. The brief's assumption ("already applied") was **wrong for the API's database**: repo `.env` `DATABASE_URL` points at project **`wxdykoarmieneynvnefz`** (pooler `postgres.wxdykoarmieneynvnefz`), which is a *different* project than dbctl's shared project `jvnlxrgxwhnrunjmvzlv` (that one had RL_010 but is empty). The subagent applied the idempotent migration (`~/.supabase/migrations/RL/RL_010_000_ai_usage_org_org_settings.sql`, sha256 `17f59606…a03d`) verbatim to the `.env` project via direct pooler connection. Columns verified: `rl_ai_usage.organization_id uuid NULL REFERENCES rl_organizations ON DELETE CASCADE`, index `rl_ai_usage_org_created_idx`, `rl_organizations.settings jsonb NOT NULL DEFAULT '{}'`. Existing org rows backfilled to `'{}'` with no data (empty tables).
- **`apps/api/src/services/ai-usage-service.ts`**: `RecordAiUsageInput.organizationId?: string | null`, INSERT now writes `organization_id` (param 8, `?? null`), `AiUsageRecord.organizationId: string | null`.
- **`apps/api/src/services/dashboard-service.ts`** `aiCostByDay`: now org-scoped — `where u.organization_id = $3` (params `[start, end, orgId, tz]`), so NULL-org rows and other orgs' rows are excluded. File-top comment updated.
- **`routes/dashboard/analytics.ts`** header comment updated; **`packages/shared/src/types.ts`** `DashboardAnalyticsResponse.aiCostByDay` comment corrected (was "GLOBAL series" → org-scoped).
- `ai-usage-service.test.ts` extended (+1 test: org passthrough + 8-param assertion; all existing tests updated to the 8-wide params).

## Verification

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run typecheck --workspace=@tradescheduler/api` | clean |
| 2 | full suite | **354/356 pass** (21 files); 2 failures = **pre-existing worker flake** (below) |
| 3 | live: seeded 4 `rl_ai_usage` rows → `GET /api/dashboard/analytics?start&end` (30d, org tz) | **pass — sum = 1.00, single nonzero entry** |

### Live matrix (before/after)

| Seeded row | org | cost | created | Expected | Result |
|---|---|---|---|---|---|
| t9-verify-r1 | own org (`a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007`) | 1.00 | 5d ago | counted | **counted (1.00)** |
| t9-verify-r2 | other org (`t9-other-org`) | 5.00 | 12d ago | excluded | excluded ✓ |
| t9-verify-r3 | NULL org | 9.00 | 3d ago | excluded | excluded ✓ |
| t9-verify-r4 | own org | 100.00 | 45d ago | excluded (out of 30d window) | excluded ✓ |

Response: `{"days":30, "nonZeroEntries":[{"date":"2026-09-14","value":1}]}` → exactly the own-org in-window row.

### Cleanup proof
`request_id like 't9-verify-%'` → 0 rows; `t9-other-org` org row deleted (org list back to seed). Full DB proof at the bottom of this report's cleanup section — zero verification rows remain.

## Shared-types changes
`DashboardAnalyticsResponse` comment only (no shape change). No new types for T9.

## Deviations / notes for Sentinel
- **Brief assumed RL_010 already live in the API DB — it wasn't** (it was applied to the *other* shared project). Now applied to both. If any project has clones of these tables, audit them too.
- Repo `supabase/schema.sql` does **not** contain the RL_010 column definitions (its `rl_ai_usage`/`rl_organizations` blocks are pre-RL_010; also currently `M` from other work). Repo-copy sync of RL_010 into `schema.sql` is a DB-doc task for the `supabase` subagent/controller — out of my dispatch scope.
- `organization_id` is nullable: callers that omit it (e.g. `recordAiUsage` internal callers pre-T9 wiring) still insert; such rows are now invisible to `aiCostByDay` (correct per brief).

## Commits
None — controller handles git. Working tree additions for T9: `ai-usage-service.ts`, `dashboard-service.ts`, `analytics.ts`, `ai-usage-service.test.ts`, `packages/shared/src/types.ts`, new `dashboard-service.test.ts` (T10 extraction; also in T10 report).