# Checkpoint 03 — Customer + Conversation Domain: Spec

## Context

- `organizations` + `organization_members` exist (Checkpoint 02).
- `ts_conversation_states` (migration 003) is the only existing conversation storage: phone-keyed, 4-state enum (`offering_slots`/`awaiting_slot_choice`/`completed`/`escalated`), tied to a tradesperson's `user_id` + `booking_id`. It exists to manage the **reschedule flow** only.
- `process-inbound-sms.ts` dispatches inbound SMS to intent handlers using only `phone` — no persistent customer or conversation record is created or matched.
- No customer entity exists anywhere today.

## B. Behavior spec (given / when / then)

### C1 — New phone number texts in → create customer + conversation + message
- Given: inbound SMS from `+155****4567`, no `customers` row for that phone in the org.
- When: `processInboundSms` processes the job.
- Then:
  - A `customers` row is created (name=null, phone, org_id from resolved Twilio number, email=null).
  - A `conversations` row is created (status=open, channel=sms, current_state='new', intent=null).
  - A `messages` row is created (direction=inbound, body, status=received, provider=twilio).
  - The existing `ts_conversation_states` row (if any) for this phone is **not** touched by this layer — the reschedule flow creates or finds it separately downstream.

### C2 — Known phone, new topic → match existing customer, create a new conversation
- Given: `+155****4567` has an existing customer and conversations (one open from a prior job, one closed).
- When: inbound SMS arrives whose intent would be `new_booking` (or any non-reschedule intent).
- Then:
  - The existing customer is matched by phone (not recreated).
  - A **new** `conversations` row is created — the old open conversation is **not** reused.
  - The old open conversation remains open; it is not closed and not repurposed.

### C3 — Known phone, conversation already open → append to it
- Given: `+155****4567` has an open conversation (status=open, channel=sms).
- When: inbound SMS arrives.
- Then:
  - The message is appended to the existing open conversation (`messages` row created, `conversations.updated_at` refreshed).
  - No new `conversations` row is created.

**"Already open" definition:**
- `status = 'open'`
- AND `updated_at >= NOW() - INTERVAL '48 hours'`

The 48-hour window is chosen because SMS conversations with tradespeople typically resolve within 1-2 days. Beyond 48h of silence, a new inbound message is treated as the start of a new topic (new conversation), not a continuation. This window is configurable later per org via `CONVERSATION_OPEN_WINDOW_HOURS` — for Checkpoint 03 it's a constant.

**Edge case:** If status=open but `updated_at` is older than 48h, the conversation is **not** considered "already open" — a new conversation is created instead (C2 path). The stale conversation is not retroactively closed.

### C4 — Customer with multiple service addresses, message doesn't specify which
- Given: a customer with 2+ `customer_addresses` rows (e.g. "Home", "Rental").
- When: an inbound message references an address implicitly without specifying which.
- Then: the message is appended normally. The conversation's `missing_information` jsonb array gets `"address"` pushed into it. This is flagged for later resolution (Checkpoint 06 agent or Checkpoint 08 AI Inbox) — it is **not** resolved at this layer.

### C5 — Two inbound messages arriving near-simultaneously for same new phone number (race condition)
- Given: no `customers` row for `+155****6543` in the org.
- When: two inbound SMS for that phone arrive within milliseconds of each other.
- Then: exactly one `customers` row is created. The second `findOrCreateCustomer` call returns the same customer row. Both callers get the same id.
- **Uniqueness constraint that prevents the race:** `UNIQUE(organization_id, phone)` on `customers` with an upsert (`INSERT ... ON CONFLICT (organization_id, phone) DO NOTHING` + re-read, or `DO UPDATE SET updated_at = now()`). The upsert is the mechanism — the second insert hits the conflict and returns the existing row.

### C6 — Conversation on channel=voice with no transcript yet available
- Given: a conversation with `channel = 'voice'` (e.g. from a missed-call detection in Checkpoint 10) before any transcript is available.
- Then:
  - The `messages` table can be empty for this conversation (no SMS-shaped data).
  - `messages.body` is **nullable** — it must not assume SMS-shaped data.
  - `messages.provider_message_id` can be a Twilio CallSid for voice calls.
  - This is why `messages.body` must be nullable: a voice conversation before transcript has no body text yet.

### C7 — Malformed/empty phone number on inbound webhook → reject before touching the customer table
- Given: inbound SMS webhook with `From` that is empty, not a string, or not a valid E.164 number.
- When: the webhook handler processes it.
- Then:
  - The request is rejected with HTTP 400 **before** any `customers` row is created.
  - No garbage customer row is created.
  - The existing `typeof raw.From !== 'string'` guard in `processInboundSms` is extended with an E.164 format check (`phone.matches(/^\+?[1-9]\d{1,14}$/)`) — if it fails, the webhook returns 400 with `{ error: 'INVALID_PHONE' }`.

## C. Schema spec

### customers
| Column | Type | Constraint | Notes |
|---|---|---|---|
| id | UUID | PK, default gen_random_uuid() | |
| organization_id | UUID | NOT NULL, FK → organizations(id) ON DELETE CASCADE | resolves via twilio_numbers.phone → org |
| name | TEXT | nullable | often unknown at first contact |
| phone | TEXT | NOT NULL, CHECK phone ~ `^\+?[1-9]\d{1,14}$` | E.164 validated at DB layer |
| email | TEXT | nullable, CHECK email ~ `^[^\s@]+@[^\s@]+\.[^\s@]+$` OR NULL | only validated if present |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() | |

- **UNIQUE constraint:** `UNIQUE(organization_id, phone)` — phone is unique **per organization**, not globally. Two orgs may share a customer phone. Named `customers_org_phone_key`.
- Indexes: `customers_org_phone_idx` on (organization_id, phone), `customers_org_idx` on (organization_id).

### customer_addresses
| Column | Type | Constraint | Notes |
|---|---|---|---|
| id | UUID | PK, default gen_random_uuid() | |
| customer_id | UUID | NOT NULL, FK → customers(id) ON DELETE CASCADE | |
| label | TEXT | NOT NULL, CHECK length between 1 and 120 | e.g. "Home", "Rental", "Office" |
| line1 | TEXT | NOT NULL | |
| line2 | TEXT | nullable | |
| city | TEXT | nullable | |
| state | TEXT | nullable | |
| postal_code | TEXT | nullable | |
| country | TEXT | NOT NULL, default 'US' | |
| is_primary | BOOLEAN | NOT NULL, default FALSE | one of the addresses is the default for dispatch |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() | |

- **UNIQUE constraint:** `UNIQUE(customer_id, label)` — named `customer_addresses_customer_label_key`. Prevents duplicate labels for the same customer.
- `is_primary` is a flag, not a singleton constraint — only one should be primary at a time, enforced at the service layer (or a partial unique index `WHERE is_primary = true` if we want DB enforcement; for Checkpoint 03 it's a service-level check since a customer can have multiple addresses and we only designate one as primary on creation).

### conversations
| Column | Type | Constraint | Notes |
|---|---|---|---|
| id | UUID | PK, default gen_random_uuid() | |
| organization_id | UUID | NOT NULL, FK → organizations(id) ON DELETE CASCADE | |
| customer_id | UUID | NOT NULL, FK → customers(id) ON DELETE CASCADE | |
| channel | TEXT | NOT NULL, CHECK in ('sms', 'voice', 'web') | |
| status | TEXT | NOT NULL, default 'open', CHECK in ('open', 'closed', 'escalated') | |
| intent | TEXT | nullable | set once the AI/classifier knows it; nullable until then |
| current_state | TEXT | NOT NULL, default 'new', CHECK in (the agent state machine values) | for Checkpoint 03, just store and return; the state machine transitions are Checkpoint 06 |
| assigned_user_id | UUID | nullable | resolved in Checkpoint 09 |
| missing_information | JSONB | NOT NULL, default '[]' | e.g. `["address"]` when C4 triggers |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, default now() | |
| closed_at | TIMESTAMPTZ | nullable | set when status → 'closed' |

- Indexes: `conversations_org_status_updated_idx` on (organization_id, status, updated_at) — powers the "find open conversation" query and the AI Inbox view in Checkpoint 08. `conversations_customer_idx` on (customer_id).

### messages
| Column | Type | Constraint | Notes |
|---|---|---|---|
| id | UUID | PK, default gen_random_uuid() | |
| conversation_id | UUID | NOT NULL, FK → conversations(id) ON DELETE CASCADE | |
| provider | TEXT | NOT NULL, CHECK in ('twilio', 'manual') | |
| provider_message_id | TEXT | nullable | Twilio MessageSid / CallSid; nullable for outbound-not-yet-sent |
| direction | TEXT | NOT NULL, CHECK in ('inbound', 'outbound') | |
| body | TEXT | **nullable** | nullable because voice-before-transcript has no body (C6) |
| status | TEXT | NOT NULL, default 'received', CHECK in ('queued', 'sent', 'delivered', 'failed', 'received') | |
| metadata | JSONB | NOT NULL, default '{}' | Twilio fields: From, To, MessageSid, CallSid, etc. |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |

- Indexes: `messages_conversation_created_idx` on (conversation_id, created_at) — powers chronological message display. `messages_provider_message_idx` on (provider, provider_message_id) — powers idempotency dedup (Checkpoint 07).

## D. Data: how `ts_conversation_states` relates to `conversations`

**D1 — `ts_conversation_states` stays as a separate, reschedule-specific table.**
It is **not** folded into the `conversations` table. The two coexist, linked by a 1:1 relationship where `ts_conversation_states.conversation_id` (new nullable FK column added in migration 005) references `conversations.id`.

**D2 — Justification against `conversation-service.ts`:**
`conversation-service.ts` currently does CRUD on `ts_conversation_states` as a free-standing table keyed by phone + user_id, with its own state machine (`offering_slots` → `awaiting_slot_choice` → `completed` | `escalated`). Its columns (`offered_slots` jsonb, `selected_slot` jsonb, `booking_id`, `escalation_reason`, `completed_at`) are reschedule-specific and don't fit the general `conversations` table's shape.

If we folded `ts_conversation_states` into `conversations`, we'd either:
- (a) bloat the `conversations` table with reschedule-specific columns that are null for 95% of conversations, or
- (b) push those into a jsonb blob on `conversations`, losing type safety and making the reschedule state machine harder to query.

Keeping `ts_conversation_states` as a separate table linked by `conversation_id` preserves the existing reschedule flow untouched (all existing `conversation-service.ts` tests still pass), while the new `conversations` table handles the broader conversation domain. The reschedule flow, when it creates a `ts_conversation_states` row, also creates or finds the corresponding `conversations` row and writes the FK back — so the two are always linkable.

**D3 — Migration 005 adds `conversation_id` to `ts_conversation_states`:**
```sql
ALTER TABLE public.ts_conversation_states
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL;
```
- Nullable — existing rows don't have a conversation yet.
- Backfill in migration 006: for each existing `ts_conversation_states` row, find or create a `conversations` row by phone + org, set `conversation_id`.
- New reschedule flows (post-migration) write both the `conversations` row and the `ts_conversation_states` row in the same transaction, linking them.

## E. API contract spec

### `findOrCreateCustomer(organizationId, phone) → Customer`
- **Given:** valid `organizationId` UUID, valid E.164 `phone` string.
- **When:** called.
- **Then:**
  - If a `customers` row exists for `(organizationId, phone)`: return it.
  - Otherwise: `INSERT INTO customers (organization_id, phone) VALUES (?, ?)` (name=null, email=null) and return the created row.
  - **Race condition tie-breaking:** use an upsert — `INSERT ... ON CONFLICT (organization_id, phone) DO UPDATE SET updated_at = now() RETURNING *`. The second concurrent caller hits the conflict and gets the existing row back. Both callers receive the same customer id. This is the `ON CONFLICT DO UPDATE` form, not `DO NOTHING`, so the returning row is always populated.
- **Error shapes:**
  - `organizationId` not found or org not active: `{ type: 'not_found', message: 'Organization not found', code: 'ORG_NOT_FOUND' }`
  - `phone` not valid E.164: `{ type: 'bad_request', message: 'Invalid phone format', code: 'INVALID_PHONE' }`
  - DB error: `{ type: 'server_error', message: '...', code: 'DB_ERROR' }`

### `findOrCreateConversation(customerId, channel) → Conversation`
- **Given:** valid `customerId` UUID, valid `channel` ('sms' | 'voice' | 'web').
- **When:** called.
- **Then:**
  - Find an open conversation for this customer where `status = 'open'` AND `updated_at >= NOW() - INTERVAL '48 hours'` AND `channel = $channel`.
  - If found: return it (with `updated_at` refreshed to now).
  - If not found: `INSERT INTO conversations (organization_id, customer_id, channel) VALUES (?, ?, ?)` (status='open', current_state='new', intent=null, missing_information='[]') and return the created row.
  - The organization_id comes from the customer's `organization_id` (trusted FK).
- **Error shapes:**
  - `customerId` not found: `{ type: 'not_found', message: 'Customer not found', code: 'CUSTOMER_NOT_FOUND' }`
  - `channel` not in allowed set: `{ type: 'bad_request', message: 'Invalid channel', code: 'INVALID_CHANNEL' }`
  - DB error: `{ type: 'server_error', message: '...', code: 'DB_ERROR' }`

### `appendMessage(conversationId, direction, body?, providerMessageId?, metadata?) → Message`
- **Given:** valid `conversationId` UUID, valid `direction` ('inbound' | 'outbound'), optional `body` (nullable), optional `providerMessageId` (nullable), optional `metadata` (jsonb, default `{}`).
- **When:** called.
- **Then:**
  - If `direction = 'inbound'` and `channel != 'voice'` and `body` is null/empty: return error (inbound non-voice messages must have a body).
  - If `direction = 'inbound'` and `channel = 'voice'` and `body` is null: allowed (voice before transcript — C6).
  - Insert the message row and refresh `conversations.updated_at`.
  - Return the created message.
- **Error shapes:**
  - `conversationId` not found: `{ type: 'not_found', message: 'Conversation not found', code: 'CONVERSATION_NOT_FOUND' }`
  - Conversation is closed: `{ type: 'bad_request', message: 'Conversation is closed', code: 'CONVERSATION_CLOSED' }`
  - `direction` not in allowed set: `{ type: 'bad_request', message: 'Invalid direction', code: 'INVALID_DIRECTION' }`
  - Inbound non-voice message missing body: `{ type: 'bad_request', message: 'Inbound message body is required for non-voice channels', code: 'MISSING_BODY' }`
  - DB error: `{ type: 'server_error', message: '...', code: 'DB_ERROR' }`

## F. Non-goals (explicitly out of scope for Checkpoint 03)
- **No customer-facing profile UI** — that's Checkpoint 08.
- **No merging of duplicate customers** (two different phone numbers, same person) — that's a manual/future admin action, not in scope.
- **No conversation state machine transitions** — the `current_state` column exists and is settable, but the agent state machine transitions are Checkpoint 06. Checkpoint 03 creates the table and the `missing_information` field but doesn't yet drive state transitions.
- **No address validation** beyond the schema CHECK constraints.
- **`ts_conversation_states` reschedule flow is untouched** — existing `conversation-service.ts` and its tests continue to work as-is. The new tables don't break it.

## G. Acceptance checklist (verify line by line)

1. **New phone → customer + conversation + message:** an inbound SMS from a previously-unseen number creates a `customers` row, a `conversations` row, and a `messages` row in Postgres. Verified by integration test hitting the real worker function — **not** a unit test on isolated functions.
2. **Same phone, new topic → new conversation:** a second SMS from the same number on a new topic creates a second `conversations` row, not reusing the old open one. Verified by integration test.
3. **Same phone, conversation open → append:** a second SMS from the same number while a conversation is open appends to the existing conversation (new `messages` row, `updated_at` refreshed), not a new `conversations` row. Verified by integration test.
4. **Conversation closed → new conversation:** a second SMS after the conversation is closed opens a new `conversations` row. Verified by integration test.
5. **Concurrent inbound race passes:** two concurrent `findOrCreateCustomer` calls for the same new phone return the same customer id, and exactly one `customers` row exists. Verified by concurrency test (two parallel calls, assert single row + same id).
6. **Voice channel, no transcript:** a voice conversation before transcript has no messages (or messages with null body), and the schema allows null body. Verified by unit test.
7. **Malformed phone rejected:** an inbound webhook with a non-E.164 `From` returns 400 and does **not** create a customer row. Verified by integration test on the webhook handler.
8. **E.164 uniqueness per org:** two different orgs can each have a customer with the same phone; within one org, a duplicate phone insert is rejected. Verified by unit test.
9. **Migration + rollback for each table:** migration 005 creates all 4 tables; a rollback migration drops them in reverse order. Both run clean against a test DB.
10. **Integration test hits real worker function:** all of the above are covered by an integration test that calls `processInboundSms` (or a test harness that calls the same codepath) against a real Postgres, not unit tests on isolated functions in mock isolation.
11. **Existing reschedule flow still works:** the existing `conversation-service.ts` tests still pass after migration 005 adds `conversation_id` to `ts_conversation_states`.

## H. Worker wiring (`process-inbound-sms.ts`)

After Checkpoint 03, `processInboundSms` does, in order:

1. Validate `From` as E.164 — if invalid, reject (400 or escalate, no customer created).
2. Resolve `organization_id` from `To` via `twilio_numbers` lookup.
3. `findOrCreateCustomer(organizationId, From)` → customer.
4. `findOrCreateConversation(customer.id, 'sms')` → conversation (with the "already open" rule).
5. `appendMessage(conversation.id, 'inbound', Body, MessageSid?)` → message.
6. Then the existing intent classification + reschedule flow continues, but now operating against a known `conversation.id` instead of phone-only.

The existing `Promise.resolve(null)` / `'TODO-from-store'` stubs in `handleRescheduleIntent` remain as-is for now — that's Checkpoint 04 (Booking domain). Checkpoint 03 wires the customer/conversation/message layer in front of the existing dispatch.

## I. Non-goals recap ( Checkpoint 03 )
- No AI classification yet — that's Checkpoint 06. The `intent` column on `conversations` is nullable and settable but not driven by any classifier in this checkpoint.
- No calendar/availability integration yet — that's Checkpoint 05.
- No dashboard UI yet — that's Checkpoint 08.
- No RLS policies for the new tables yet — those are added in Checkpoint 02's migration (RLS deny-by-default) and refined in Checkpoint 08. For now, the migration adds `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL FROM anon, authenticated` (same pattern as existing migrations), and API access is via the server-side pool (same as existing services).

## J. Sizing

| Piece | Size | Notes |
|---|---|---|
| Migration 005: create `customers`, `customer_addresses`, `conversations`, `messages` (+ `conversation_id` on `ts_conversation_states`) | S | 4 tables + 1 ALTER + indexes + RLS. |
| Migration 005 rollback: drop all 4 tables + drop `conversation_id` column | S | Reverse order, CASCADE. |
| `findOrCreateCustomer` service + upsert + race test | S | One function, one upsert query, one concurrency test. |
| `findOrCreateConversation` service + "already open" test | S | One function, one query with the 48h window, tests for open/closed/expired. |
| `appendMessage` service + voice-null-body test | S | One function, one insert, one validation test. |
| Updated `processInboundSms` wiring | S | 5 new calls inserted before the existing dispatch switch. |
| Integration test: real DB, real worker, 5 scenarios | M | Hits real Postgres, not mocks. Covers C1-C7. |
| E.164 validation in webhook handler | S | One regex check, one 400 response. |

Approx 3-4 days total, parallelizable: migration + services in one stream, integration tests in another.

---

*End of spec. Approved → implement exactly this.*
