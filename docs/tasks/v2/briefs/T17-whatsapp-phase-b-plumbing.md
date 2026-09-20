# T17 — WhatsApp channel: Phase B plumbing

## Goal
Prepare the app for a WhatsApp channel WITHOUT changing SMS behavior
(byte-for-byte parity for existing SMS traffic). WhatsApp = fallback channel
(Bangladesh +880): SMS first, retry via approved template on delivery
failure — the fallback ENGINE is Phase D. This task builds the FOUNDATION:
Channel type + payload field, `whatsapp:` prefix normalization, channel-aware
replies, migration 014 (ledger table + opt-in columns + conversation channel
CHECK widen), phone-utils helpers.

Plan doc: `docs/tasks/v2/whatsapp-channel-fallback.md` (decisions: SMS-first;
inbound+outbound in scope; BYON BD number).

## Verified facts (controller — do not re-derive)
- `packages/shared/src/types.ts:133` `TwilioInboundSmsPayload` = {From, To,
  Body, MessageSid, AccountSid, [key: string]: ...}. `:144`
  `TwilioStatusCallbackPayload` already exists (reused in Phase C, NOT here).
- `apps/api/src/routes/twilio-webhooks.ts`: REQUIRED_FIELDS then
  `/^\+?[1-9][0-9]{1,14}$/.test(body.From)` → 400 INVALID_PHONE (REJECTS
  `whatsapp:`). Enqueues job {From, To, Body, MessageSid, AccountSid}.
- `apps/api/src/worker/process-inbound-sms.ts`: E164_RE gate (line 26) on
  customerPhone = raw.From; `toNumber = raw.To` → resolveOrganizationIdByTwilioNumber
  (needs bare E.164); staff flow (T16); findOrCreateCustomer(orgId, customerPhone);
  findOrCreateConversation(customer.id, 'sms') — channel hardcoded 'sms'.
- `apps/api/src/services/conversation-domain.ts:264-278`: channel union is
  'sms'|'voice'|'web', validation `['sms','voice','web'].includes(channel)`
  → throws INVALID_CHANNEL. Line 68/134 `channel: 'sms' | 'voice' | 'web'`.
- `rl_conversations.channel` CHECK in migrations/007 AND supabase/schema.sql:404:
  `check (channel in ('sms', 'voice', 'web'))` — must widen to include 'whatsapp'.
- `apps/api/src/services/sms-service.ts`: sendSms({to, from?, body});
  from defaults TWILIO_PHONE_NUMBER; TWILIO_SMS_DRY_RUN logs + fake SID;
  credentials per call; throws on failure. NO statusCallback anywhere.
- Migrations 001-013 exist; registry in `apps/api/scripts/db-migrate.mjs`;
  mirror in `supabase/schema.sql`.

## Files to change
1. `packages/shared/src/types.ts` — add `export type Channel = 'sms' | 'whatsapp'`;
   add `Channel?: Channel` to TwilioInboundSmsPayload (optional, backward
   compat with old queued jobs).
2. `apps/api/src/services/phone-utils.ts` — NEW. Exports:
   - `normalizeChannelAddress(addr) => { channel: Channel; e164: string }` —
     strip `whatsapp:` prefix, return channel + bare E.164; no prefix → sms.
   - `toChannelAddress(e164, channel)` → `whatsapp:+880…` or bare E.164.
   - `countryCodeFromE164(e164) => string | null` — leading-dialing-code
     extraction; implement pragmatically (match against a small known-code
     table covering BD +880, US +1, UK +44, IN +91 + generic 1-3 digit rule
     via ITU prefix boundaries; document the approach). Tests cover +880/+1/+44.
3. `apps/api/src/routes/twilio-webhooks.ts` — normalize `body.From` via
   phone-utils BEFORE the E.164 gate (stripped value); keep raw values in job
   payload; add `Channel` to the enqueued payload.
4. `apps/api/src/worker/process-inbound-sms.ts` —
   - At top: `const { channel, e164 } = normalizeChannelAddress(raw.From)`;
     customerPhone = e164; E164 gate uses e164 (unchanged semantics for SMS).
   - `toNumber`: normalize (strip `whatsapp:`) before org lookup; if channel
     is whatsapp and To has no whatsapp: prefix, treat as sms fallback.
   - `findOrCreateConversation(customer.id, channel)` — pass channel.
   - Reply routing helper: introduce a local `replySms(customerPhone, body)`
     that sends on the SAME channel (sendSms with `whatsapp:+` address when
     channel is whatsapp; from = TWILIO_WHATSAPP_NUMBER when set). Use it at
     the ~10 reply call sites. Staff ack (line 104) stays SMS-only (plan:
     staff channel out of scope).
5. `apps/api/src/services/sms-service.ts` — extend `SendSmsInput` with
   `channel?: Channel` and optional `statusCallbackUrl?: string` (default
   none — behavior unchanged when omitted). When channel='whatsapp': to =
   `whatsapp:` prefix, from = TWILIO_WHATSAPP_NUMBER ?? throw clear error
   before API call. Dry-run logs channel.
6. `apps/api/src/db/migrations/014-whatsapp-fallback.sql` — NEW:
   - `rl_outbound_messages` (messageSid TEXT UNIQUE, org FK, toPhone TEXT,
     channel TEXT NOT NULL DEFAULT 'sms' CHECK in ('sms','whatsapp'), kind
     TEXT, body TEXT, status TEXT NOT NULL DEFAULT 'queued' CHECK in
     ('queued','sent','delivered','failed','retried','escalated',
     'blocked_optin'), errorCode TEXT, timestamps).
   - `rl_customers ADD COLUMN whatsapp_opted_in boolean NOT NULL DEFAULT
     false` + `whatsapp_opted_in_at timestamptz`.
   - Widen `rl_conversations.channel` CHECK: drop constraint
     `rl_conversations_channel_check` (named in 007? verify — if unnamed,
     name it in this migration), re-add with 'whatsapp'.
7. `apps/api/src/scripts/../scripts/db-migrate.mjs` — add 014 to MIGRATIONS.
8. `supabase/schema.sql` — mirror all 014 changes + conversation CHECK widen.
9. `apps/api/src/services/conversation-domain.ts` — channel union
   + validation + Conversation type gain 'whatsapp' (lines 68/134/264/277).
10. Tests:
    - NEW `apps/api/src/services/phone-utils.test.ts` (channel normalize,
      toChannelAddress, country code).
    - `apps/api/src/routes/twilio-webhooks.test.ts` + whatsapp-prefix case
      (200 + job payload Channel='whatsapp'; malformed still 400).
    - `apps/api/src/worker/process-inbound-sms.test.ts` + whatsapp-inbound
      case (conversation channel='whatsapp', reply to whatsapp:+ address,
      customer created with bare E.164); + regression: sms path unchanged.
    - `apps/api/src/services/conversation-domain.test.ts` + whatsapp open.

## Constraints (hard rules)
- SMS behavior byte-for-byte unchanged when channel is absent/'sms'. No
  statusCallback sent unless caller passes the URL.
- No template logic here (Phase D). Channel-aware replies use free-form
  messages.create — acceptable in-window per platform rules; Phase D adds
  template enforcement for out-of-window/fallback.
- Never send without consent: unchanged (T14 gate). Do NOT auto-opt-in anyone
  in this task (opt-in columns are storage only; write points are Phase D).
- E.164 remains enforced for EVERY outbound/customer lookup — normalization
  strips the prefix, never skips validation.
- Migration style: match 013-staff-phone.sql conventions (idempotent,
  IF NOT EXISTS, schema.sql mirror byte-consistent).
- Do NOT run npm install (dependency-hijack risk noted). Use existing deps.
- Do NOT commit (controller commits after review).

## Verify (workdir H:\tradescheduling, in order)
1. `npm run typecheck --workspace=apps/api` — clean.
2. From `apps/api`: `npx vitest run --testTimeout=60000` — full suite green
   (environment-load flakes clear at 60s; sms/old tests must still pass).
3. `npm run build --workspace=apps/api` — clean.
Report: file path + changed-files list + test counts + any deviations.
