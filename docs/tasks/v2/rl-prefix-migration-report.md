# RL_ prefix migration — report (ts_ → rl_)

Executed per `docs/tasks/v2/rl-prefix-migration.md` on 2026-09-19. Full replacement
of the tradescheduler shared-DB tables under the new shared project
`wxdykoarmieneynvfz` (RL prefix, RidgeLine). No data migration, fresh start.

## Files changed

### Migration SQL (all 9) — `apps/api/src/db/migrations/`
`ts_` → `rl_` in table definitions (`create table if not exists public.rl_*`),
index names (`rl_jobs_status_created_idx`, `rl_customers_org_idx`,
`rl_oauth_states_expires_idx`, …), constraint names (`rl_customers_org_phone_key`),
FK references (`references public.rl_*`), `comment on table`, RLS
enable/revoke lines. Header comments updated: `(prefix TS)` → `(prefix RL)`,
`(TS prefix)` → `(RL prefix)`, and dbctl mirror paths
`~/.supabase/migrations/TS/TS_NNN_*.sql` → `~/.supabase/migrations/RL/RL_NNN_*.sql`
(same 001–009 numbering) in files 001–007 (008/009 have no mirror-path header).

### Service default table names (env-overridable) — `apps/api/src/services/`
- `queue-service.ts`: `QUEUE_JOBS_TABLE ?? 'rl_jobs'` + comment `(RL)`
- `auth-service.ts`: `TRADESPEOPLE_TABLE ?? 'rl_tradespeople'`
- `escalation-service.ts`: `ESCALATIONS_TABLE ?? 'rl_escalations'` + comment `RL_`
- `organization-service.ts`: `ORGANIZATIONS_TABLE ?? 'rl_organizations'`,
  `TWILIO_NUMBERS_TABLE ?? 'rl_twilio_numbers'`
- `conversation-service.ts`: `CONVERSATION_STATES_TABLE ?? 'rl_conversation_states'`
- `google-auth-service.ts`: `GOOGLE_CREDENTIALS_TABLE ?? 'rl_google_credentials'`,
  `GOOGLE_OAUTH_STATES_TABLE ?? 'rl_oauth_states'` + doc comments
- `ai-usage-service.ts`: `AI_USAGE_TABLE ?? 'rl_ai_usage'` + comment

### Inline SQL — `apps/api/src/services/`
- `booking-service.ts`: `from/update public.rl_appointments`,
  `from/update public.rl_tradespeople`, comments
- `conversation-domain.ts`: `public.rl_organizations`, `public.rl_customers`,
  `on conflict on constraint rl_customers_org_phone_key`, `public.rl_conversations`,
  `public.rl_messages`
- `booking-service-smoke.ts`: `rl_organizations`, `rl_tradespeople`, `rl_appointments`
- `conversation-domain-e2e.ts`: `rl_organizations`, `rl_customers`, `rl_messages`,
  `rl_conversations`

### Tests — `apps/api/src/services/*.test.ts`
String assertions + env-override names updated:
- `ai-usage-service.test.ts`: `insert into rl_ai_usage`; `AI_USAGE_TABLE = 'rl_ai_usage_test'`
- `auth-service.test.ts`: `from/insert into rl_tradespeople`; `TRADESPEOPLE_TABLE = 'rl_tradespeople_test'`
- `booking-service.test.ts`: `from public.rl_appointments`, `update public.rl_tradespeople`
- `conversation-domain.test.ts`: `rl_customers`, `rl_customers_org_phone_key`,
  `rl_conversations`, `rl_messages`
- `google-auth-service.test.ts`: `delete from public.rl_google_credentials`;
  `GOOGLE_CREDENTIALS_TABLE='rl_gc_test'`; `GOOGLE_OAUTH_STATES_TABLE='rl_states_test'`
- `queue-service.test.ts`: `insert into rl_jobs` / `update rl_jobs`

### Shared types comments — `packages/shared/src/types.ts`
`ts_google_credentials` → `rl_google_credentials`, `ts_tradespeople` →
`rl_tradespeople` (2 comment lines + 1 doc comment). `ts_session` cookie
comments left intact.

### Also (flagged, see Concerns)
- `apps/api/scripts/seed-demo-user.mjs`: tracked script with the same
  env-overridable default pattern (`TRADESPEOPLE_TABLE ?? 'rl_tradespeople'`).
  One-line change, consistent with brief §2 intent; not in the enumerated list.

### Untouched (per brief)
- `apps/web/**` — no changes (cookie `ts_session` kept in
  `lib/auth.ts`, `lib/session.tsx`, `middleware.ts`; no direct SQL).
- `apps/api/src/routes/auth.ts`, `routes/google-oauth.ts` — `ts_session` cookie
  comments kept.
- `apps/api/.localdb/*.mjs` (gitignored local artifacts) and `apps/api/dist/**`
  (build output) still contain `ts_` table strings — see Concerns.

## Registry — `C:/Users/muhai/.supabase/projects.json`
- `shared_project`: `ref` → `wxdykoarmieneynvfz`, `url` →
  `https://wxdykoarmieneynvfz.supabase.co`, `rest_api` →
  `https://wxdykoarmieneynvfz.supabase.co/rest/v1/`, `db_host` →
  `db.wxdykoarmieneynvfz.supabase.co`. `region`/`pooler_host` left as-is;
  `_note` updated to state region/pooler_host are TBD for this ref and prefer
  pooler/REST (IPv6 caveat retained).
- apps entry `tradescheduler`: `prefix` `TS` → `RL`, `_note` →
  `User-directed 2026-09-19: full replacement on new shared project wxdykoarmieneynvfz (RL prefix).`
- Validated: `node -e "JSON.parse(...)"` passes.

## RL migration mirror — `C:/Users/muhai/.supabase/migrations/RL/`
All 9 renamed migration files copied (dbctl `<PREFIX>_NNN_<name>.sql` convention):
```
RL_001_000_jobs_table.sql
RL_002_000_escalations_table.sql
RL_003_000_conversation_states_table.sql
RL_004_000_tradespeople_table.sql
RL_005_000_ai_usage_table.sql
RL_006_000_organizations_table.sql
RL_007_000_customer_conversation_tables.sql
RL_008_000_appointments_table.sql
RL_009_000_google_oauth_tables.sql
```

## Test suite
`npm run test --workspace=apps/api` → **16 files, 287 tests, all passed**
(13.82s). stderr lines during the run are expected logs from tests that
exercise failure paths (escalations, Twilio rejections, missing-JWT_SECRET).

## Verification greps
`grep -rn "ts_" apps packages --include=*.ts --include=*.sql` (node_modules excluded):
```
apps/api/src/routes/auth.ts:11: *     7-day expiry. Web stores the token in the `ts_session` cookie.
apps/api/src/routes/google-oauth.ts:10: * The web app calls /start via authedFetch (the JWT lives in the ts_session
apps/web/lib/auth.ts:5: * owns the session cookie `ts_session` (7-day, path=/). The token must be
apps/web/lib/auth.ts:34:export const SESSION_COOKIE = "ts_session";
apps/web/middleware.ts:6: * Presence-checked on the `ts_session` cookie — the JWT issued by
apps/web/middleware.ts:11:export const SESSION_COOKIE = "ts_session";
packages/shared/src/types.ts:232:// the `ts_session` cookie. Auth endpoints live under /api/auth.
packages/shared/src/types.ts:255:  token: string; // signed JWT; web stores it in ts_session cookie
```
Every remaining match is `ts_session` (the auth cookie) — no table refs left.
Test env-override names confirmed `rl_` (`rl_ai_usage_test`, `rl_tradespeople_test`,
`rl_gc_test`, `rl_states_test`). projects.json validated as JSON.

## Concerns
- `apps/api/.localdb/*.mjs` (gitignored, local dev artifact) and
  `apps/api/dist/**` (build output) still contain `ts_` table strings. They were
  outside the brief's file list; both are non-source. The `.localdb` scripts
  will break against a DB built from the renamed migrations — regenerate them
  or rebuild `dist` as part of the project cutover.
- `seed-demo-user.mjs` was edited (1 line) although not in the brief's
  enumerated list — it is a tracked script whose default follows the exact
  §2 env-override pattern. Revert if out of scope.
- No secret values appear anywhere in this report.