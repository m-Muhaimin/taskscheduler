# T11 — Automation settings GET/PATCH — Report

Date: 2026-09-19 · Agent: wired (backend/API) · Brief: `docs/tasks/v2/briefs/T11-automation-settings.md` · API scope only (apps/api + packages/shared; apps/web is forge's)

## What was shipped

- **`apps/api/src/services/organization-service.ts`** — two new functions:
  - `getOrganizationSettings(orgId)` → returns stored `settings` jsonb (`coalesce(settings, '{}')`).
  - `updateOrganizationSettings(orgId, automation)` → `update … set settings = jsonb_set(settings, '{automation}', coalesce(settings->'automation', '{}'::jsonb) || $2::jsonb) where id = $1 returning settings` — **top-level unknown keys (e.g. `brand`) preserved**, `automation` sub-object merged key-by-key.
- **NEW `apps/api/src/routes/dashboard/settings.ts`**, mounted at `/api/dashboard/settings`:
  - **`GET /api/dashboard/settings/automation`** → 200 `{ automation: {...defaults merged} }`; DEFAULTS `{aiFrontDesk:true, reviewRequests:true, depositRequired:false}` merged over stored booleans (stored wins, defaults fill missing/`null`); non-boolean stored values floored to defaults (defensive vs. bad payloads). 401/403 as usual.
  - **`PATCH /api/dashboard/settings/automation`** → body must be a JSON object with ONLY the 3 known keys, all values boolean → else `400 {"error":"invalid_body"}`; applies merge (below); returns merged result.
  - Mounted in `routes/dashboard/index.ts` (`router.use('/settings', settingsRouter)`).
- **Shared types**: `AutomationSettings` interface (3 booleans), `DashboardAutomationResponse { automation: AutomationSettings }` (G and P share the shape).
- **Tests**: NEW `settings.test.ts` (15: GET defaults on empty `{}` / `{"automation":null}`; stored-win merge; non-boolean floor; PATCH partial merge preserves other keys + foreign top-level key; full known-key set; empty body 400; unknown key 400; all 3 non-boolean values 400; non-object 400; missing row 403; no/wrong token 401) and `organization-service.test.ts` (5: both fns + merge semantics + `public.`-qualified assertions, whitespace-tolerant `jsonb_set` matching).

## Verification

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run typecheck --workspace=@tradescheduler/api` | clean |
| 2 | full suite | **354/356 pass** (21 files); 2 failures = pre-existing worker flake (same pair as T2-T3 report; reproduced at clean HEAD — see T10 report) |
| 3 | live matrix (real Bearer token, verify org `a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007`) | **12/12 checks PASS** |

### Live matrix (before/after)

| Step | Before | After | Assert |
|---|---|---|---|
| GET (settings `{"brand":"x-before"}` seeded) | foreign key only | `{automation:{aiFrontDesk:true,reviewRequests:true,depositRequired:false}}` | defaults merged, brand not surfaced ✓ |
| PATCH `{aiFrontDesk:false}` | defaults | `{automation:{aiFrontDesk:false,…}}`; DB `brand` preserved | merge + foreign-key preservation ✓ |
| PATCH `{depositRequired:true}` | prior | `{automation:{aiFrontDesk:false,reviewRequests:true,depositRequired:true}}` | key-by-key merge ✓ |
| PATCH `{aiFrontDesk:"yes"}` / `{unknown:1}` / `"str"` | any | all `400 invalid_body`; **DB settings untouched** | gate ✓ |
| GET w/o token | — | `401 missing_token` | ✓ |
| cleanup | — | settings reset to `{}` on the verify org | ✓ |

`T11 PASS: GET defaults/merge, PATCH merge, foreign-key preservation, 400 gates, cleanup`.

### Cleanup proof
Verify org settings → `{}`; org list back to seed (`T2T3 Verify Org (test data)` + one exogenous `T10T11 Walk Org …` — see note); zero `t9-verify-*` usage rows and zero `+1555010*` customer rows remain (T9/T10 trunk cleanup re-confirmed).

## Shared-types changes
`AutomationSettings`, `DashboardAutomationResponse`, `DashboardApiErrorResponse` gains nothing new (reuses `invalid_body`).

## Deviations / notes
- **Merge vs overwrite**: brief said "returns merged settings"; PATCH writes `automation` as a JSON-merge (not full replacement) so future automation keys survive partial patches. Top-level foreign keys (e.g. `brand`) are never touched.
- **Exogenous row observed** during verification: org `T10T11 Walk Org 1789830316168` exists in the API DB with `settings.automation = {reviewRequests:false, depositRequired:true}`. NOT created or modified by any of T9/T10/T11 verification (my writes only ever targeted the T2T3 org). Likely the web-side walkthrough — flagging so its origin can be confirmed (or it can be deleted if it was scratch data). The shared project `jvnlxrgxwhnrunjmvzlv` (dbctl) is unrelated to the API DB.
- Repo `supabase/schema.sql` lacks `settings` column + RL_010 (see T9 report) — repo-copy DB-doc sync remains a `supabase`/controller task.

## For Sentinel / Probe
- Audit: PATCH accepts ONLY the 3 known keys (unknown-key rejection is a test case); future keys must be added in both route validation and `AutomationSettings` + `DEFAULTS`.
- Probe: UI toggle flows against these routes (forge) and a worker that actually consumes automation flags.

## Commits
None — controller handles git.