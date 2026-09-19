# Brief: RL_ prefix migration (ts_ → rl_) for new shared Supabase project

## Context
The tradescheduler (RidgeLine) stack moves to a NEW shared Supabase project
(ref `wxdykoarmieneynvfz`, URL https://wxdykoarmieneynvfz.supabase.co),
FULL replacement, FRESH START (no data migration). All shared-DB tables must
use the `RL_` prefix (project initials RidgeLine) instead of the old `ts_`
prefix (tradescheduler). Old project jvnlxrgxwhnrunjmvzlv is retired.

## Task
Rename every `ts_<something>` TABLE reference to `rl_<something>` across the
repo, update the local dbctl registry, and create the RL migration mirror.

## Files to edit — table rename

### 1. Migration SQL — apps/api/src/db/migrations/*.sql (all 9 files)
Rename in table definitions, index names, constraint names, FK references,
comment on table, RLS enable/revoke lines, and header comments:
- ts_jobs → rl_jobs (and ts_jobs_status_created_idx)
- ts_escalations → rl_escalations (ts_escalations_status_created_idx)
- ts_conversation_states → rl_conversation_states (idx: phone, state_created)
- ts_tradespeople → rl_tradespeople (ts_tradespeople_email_idx)
- ts_ai_usage → rl_ai_usage
- ts_organizations, ts_organization_members, ts_twilio_numbers → rl_*
- ts_customers (ts_customers_org_phone_key constraint, ts_customers_org_idx),
  ts_customer_addresses, ts_conversations, ts_messages → rl_*
- ts_appointments (idx: org_phone_start, org_user) → rl_appointments
- ts_google_credentials, ts_oauth_states (ts_oauth_states_expires_idx) → rl_*
- FK references `references public.ts_x` → `references public.rl_x`
- Update header comments: "prefix TS" → "prefix RL", and the dbctl mirror
  paths `~/.supabase/migrations/TS/TS_001_000_*.sql` → `~/.supabase/migrations/RL/RL_001_000_*.sql`
  (keep the same 001-009 numbering; filename convention <PREFIX>_NNN_<name>.sql)

### 2. Service default table names (env-overridable) — apps/api/src/services/
- queue-service.ts: `QUEUE_JOBS_TABLE ?? 'ts_jobs'` → `'rl_jobs'` (+ comment)
- auth-service.ts: `TRADESPEOPLE_TABLE ?? 'ts_tradespeople'` → `'rl_tradespeople'`
- escalation-service.ts: ESCALATIONS_TABLE ?? `'ts_escalations'` → `'rl_escalations'` (+ comment)
- organization-service.ts: ORGANIZATIONS_TABLE ?? `'ts_organizations'` → `'rl_organizations'`;
  TWILIO_NUMBERS_TABLE ?? `'ts_twilio_numbers'` → `'rl_twilio_numbers'`
- conversation-service.ts: CONVERSATION_STATES_TABLE ?? `'ts_conversation_states'` → `'rl_conversation_states'`
- google-auth-service.ts: GOOGLE_CREDENTIALS_TABLE ?? `'ts_google_credentials'` → `'rl_google_credentials'`;
  GOOGLE_OAUTH_STATES_TABLE ?? `'ts_oauth_states'` → `'rl_oauth_states'` (+ comments)
- ai-usage-service.ts: AI_USAGE_TABLE ?? `'ts_ai_usage'` → `'rl_ai_usage'` (+ comment)

### 3. Inline SQL — apps/api/src/services/
- booking-service.ts: `from public.ts_appointments`, `update public.ts_appointments`,
  `from public.ts_tradespeople`, `update public.ts_tradespeople` → rl_* (+ comments)
- conversation-domain.ts: `public.ts_organizations`, `public.ts_customers`,
  `on conflict on constraint ts_customers_org_phone_key`, `public.ts_conversations`,
  `public.ts_messages` → rl_* (constraint → rl_customers_org_phone_key)
- booking-service-smoke.ts: ts_organizations, ts_tradespeople, ts_appointments → rl_*
- conversation-domain-e2e.ts: ts_organizations, ts_customers, ts_messages,
  ts_conversations → rl_*

### 4. Tests — apps/api/src/services/*.test.ts
Update string assertions + env-override test table names:
- ai-usage-service.test.ts: 'ts_ai_usage' → 'rl_ai_usage'; AI_USAGE_TABLE =
  'ts_ai_usage_test' → 'rl_ai_usage_test'
- auth-service.test.ts: 'from ts_tradespeople'/'insert into ts_tradespeople'
  → 'rl_tradespeople'; TRADESPEOPLE_TABLE = 'ts_tradespeople_test' → 'rl_tradespeople_test'
- booking-service.test.ts: 'from public.ts_appointments', 'update public.ts_tradespeople' → rl_*
- conversation-domain.test.ts: ts_customers, ts_customers_org_phone_key,
  ts_conversations, ts_messages → rl_*
- google-auth-service.test.ts: 'delete from public.ts_google_credentials' →
  'rl_google_credentials'; test overrides GOOGLE_CREDENTIALS_TABLE='ts_gc_test' →
  'rl_gc_test'; GOOGLE_OAUTH_STATES_TABLE='ts_states_test' → 'rl_states_test'
- queue-service.test.ts: 'insert into ts_jobs'/'update ts_jobs' → 'rl_jobs'

### 5. Shared types comments — packages/shared/src/types.ts
Only the TABLE references in comments: ts_google_credentials → rl_google_credentials,
ts_tradespeople → rl_tradespeople.

## DO NOT RENAME
- `ts_session` — it is the auth COOKIE name (not a table). Keep `ts_session`
  everywhere it appears: apps/api/src/routes/auth.ts, routes/google-oauth.ts
  (comments), apps/web/lib/auth.ts, apps/web/lib/session.tsx, apps/web/middleware.ts,
  packages/shared/src/types.ts comments.
- No table rename in apps/web (it has no direct SQL).

## Registry update — C:/Users/muhai/.supabase/projects.json
- shared_project: ref → `wxdykoarmieneynvfz`, url → `https://wxdykoarmieneynvfz.supabase.co`,
  rest_api → `https://wxdykoarmieneynvfz.supabase.co/rest/v1/`,
  db_host → `db.wxdykoarmieneynvfz.supabase.co`.
  Leave `region` and `pooler_host` values as-is (will be corrected after CLI login
  reveals them) but add a `_note` that region/pooler_host are TBD for this ref.
- apps entry "tradescheduler": prefix `TS` → `RL`, update _note:
  "User-directed 2026-09-19: full replacement on new shared project wxdykoarmieneynvfz (RL prefix)."

## RL migration mirror — C:/Users/muhai/.supabase/migrations/RL/
After the SQL renames, copy ALL NINE migration files (renamed content) into a new
directory `C:/Users/muhai/.supabase/migrations/RL/` named by dbctl convention
`<PREFIX>_NNN_<name>.sql` with the same numbers the repo uses (001-009):
- TS_001_000_jobs_table.sql pattern → RL_001_000_jobs_table.sql  (only 001 exists
  as an example of naming in the TS mirror) — derive names from each file's own
  header comment (e.g. RL_002_000_escalations_table.sql, ...).
Use snake_case names matching each file's purpose.

## Verification (must pass)
1. `npm run test --workspace=apps/api` — full suite green.
2. Grep repo for leftover table refs: run
   `grep -rn "ts_" apps packages --include=*.ts --include=*.sql` and confirm EVERY
   match is `ts_session` only (cookie). No `ts_jobs|ts_customers|ts_...` table refs remain.
   Note: tests use `*_test` override names — verify those are rl_* now too.
3. Confirm projects.json is valid JSON (`node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))"`).

## Report file
Write a short report to docs/tasks/v2/rl-prefix-migration-report.md:
files changed, grep verification output (leftover ts_ matches), test result summary.
DO NOT include secret values anywhere.
