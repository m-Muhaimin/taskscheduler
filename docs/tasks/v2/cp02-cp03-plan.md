# CP02 → CP03 Implementation Plan (2026-09-19)

Scope decision: user approved "Start CP02 → CP03 chain". In-session build (subagents blocked).

## Convention ruling (controller decision)

- Repo hard rule (every migration header): **all tables are `public.<PREFIX>_<name>`** in the
  muhai-shared Supabase project. The CP03 spec + draft code use UNPREFIXED names
  (`customers`, `conversations`, `messages`). Unprefixed public tables in a shared project risk
  collisions → follow repo convention: `ts_organizations`, `ts_organization_members`,
  `ts_twilio_numbers`, `ts_customers`, `ts_customer_addresses`, `ts_conversations`, `ts_messages`.
  Draft `conversation-domain.ts` + `conversation-domain-e2e.ts` updated accordingly.
- Migration numbering: spec assumed 005/006, but 005=ai-usage is taken → CP02 = **006**,
  CP03 tables = **007**. Also add `conversation_id` FK on `ts_conversation_states` (spec D3)
  in 007, and register 006+007 in `scripts/local-db.mjs` MIGRATIONS list.

## Task list

### T1 — Migration 006: `ts_organizations`, `ts_organization_members`, `ts_twilio_numbers`
- `ts_organizations`: id uuid pk default gen_random_uuid(), name text not null check len 1..120,
  slug text not null unique, timezone text not null default 'America/New_York', status text not null
  default 'active' check in ('active','suspended'), created_at/updated_at timestamptz default now().
  (E2E inserts `(id, name, slug, timezone, status)` — columns must match.)
- `ts_organization_members`: id pk, organization_id uuid not null fk → ts_organizations(id)
  on delete cascade, user_id uuid not null fk → ts_tradespeople(id) on delete cascade,
  role text not null check in ('OWNER','STAFF','TECHNICIAN'), created_at default now();
  UNIQUE(organization_id, user_id).
- `ts_twilio_numbers`: id pk, organization_id uuid not null fk → ts_organizations(id) cascade,
  phone text not null unique check E.164-ish, created_at default now().
- Indexes, RLS enable + revoke anon/authenticated (same pattern as 001-005).
- NO backfill of tradespeople→org in migration (existing local DB has rows but org assignment
  is app-level setup; keep migration pure schema).

### T2 — Migration 007: CP03 tables + FK on ts_conversation_states
- `ts_customers`: id pk, organization_id fk→ts_organizations cascade, name text nullable,
  phone text not null check e164, email text nullable check email, created_at/updated_at;
  UNIQUE(organization_id, phone) named `ts_customers_org_phone_key`; indexes org_phone, org.
- `ts_customer_addresses`: id pk, customer_id fk→ts_customers cascade, label text not null
  check len 1..120, line1 not null, line2/city/state/postal_code nullable, country default 'US',
  is_primary bool default false, created_at/updated_at; UNIQUE(customer_id, label).
- `ts_conversations`: id pk, organization_id fk cascade, customer_id fk cascade, channel text
  check in ('sms','voice','web'), status text default 'open' check in ('open','closed','escalated'),
  intent text nullable, current_state text not null default 'new', assigned_user_id uuid nullable,
  missing_information jsonb not null default '[]', created_at/updated_at, closed_at nullable;
  indexes org_status_updated, customer.
- `ts_messages`: id pk, conversation_id fk cascade, provider text check in ('twilio','manual'),
  provider_message_id nullable, direction text check in ('inbound','outbound'), body text NULLABLE,
  status text default 'received' check in ('queued','sent','delivered','failed','received'),
  metadata jsonb default '{}', created_at; indexes conv_created, provider_message.
- `ALTER TABLE ts_conversation_states ADD COLUMN IF NOT EXISTS conversation_id uuid
  REFERENCES ts_conversations(id) ON DELETE SET NULL;` (spec D3)
- RLS deny-by-default on all 4 + comments.

### T3 — `conversation-domain.ts`: rename tables to `ts_` prefix
- public.organizations → public.ts_organizations
- public.customers → public.ts_customers, public.conversations → public.ts_conversations,
  public.messages → public.ts_messages
- Org active check stays. No behavior change otherwise.

### T4 — `conversation-domain-e2e.ts` fix + org lookup helper
- Rename table refs to ts_ prefix (organizations/customers/conversations/messages).
- Fix 2 pre-existing tsc errors (generic T constraint): use `pg.QueryResultRow`-compatible
  constraint or non-generic helper signatures.
- New `organization-service.ts`: `resolveOrganizationIdByTwilioNumber(phone)` → uuid | null
  (lookup ts_twilio_numbers by phone). Also used by worker wiring.

### T5 — Worker wiring (`process-inbound-sms.ts`) + webhook E.164
- Per spec H: 1) E.164 validate From (reject 400 INVALID_PHONE in webhook route BEFORE enqueue,
  worker double-guard escalate if invalid); 2) resolve org via ts_twilio_numbers(To);
  3) findOrCreateCustomer(orgId, From); 4) findOrCreateConversation(customer.id, 'sms');
  5) appendMessage(conv.id, 'inbound', Body, MessageSid, {From, To, MessageSid});
  6) existing intent dispatch unchanged (stubs stay — CP04).
- twilio-webhooks.ts: add E.164 check on From after required-fields → 400 { error: 'INVALID_PHONE' }.
- Worker failures in domain steps → createEscalation('processing_error') like existing pattern.

### T6 — Tests
- `conversation-domain.test.ts` (unit, mocked pg Pool like queue-service.test.ts):
  findOrCreateCustomer happy/org-not-found/invalid-phone/upsert-race; findOrCreateConversation
  open-reuse vs new-create vs invalid channel; appendMessage voice-null-body vs sms-missing-body
  vs closed conversation.
- Worker wiring test (`process-inbound-sms.test.ts`): mocked conversation-domain +
  es/queue; happy path creates customer+conversation+message then dispatches intent.
- E.164 webhook: extend existing route test if present, else add small test.

### T7 — Verify + register migrations + commit
- Add 006/007 to `scripts/local-db.mjs` MIGRATIONS array.
- `npx tsc --noEmit` → expect exactly 3 pre-existing errors LEFT (reschedule-service.test.ts
  RescheduleLogEntry, reschedule-service.ts Escalation type, defaultAuth ×2 stays = 4? count at end).
- `npx vitest run` full suite green (196 → new tests).
- Real DB: `node scripts/local-db.mjs` then `DATABASE_URL=... npx tsx src/services/conversation-domain-e2e.ts` green.
- Commit.

## Expected DB schema (final)

ts_jobs, ts_escalations, ts_conversation_states(+conversation_id), ts_tradespeople, ts_ai_usage,
ts_organizations, ts_organization_members, ts_twilio_numbers, ts_customers, ts_customer_addresses,
ts_conversations, ts_messages.
