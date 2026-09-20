# T18 — WhatsApp Fallback Engine (plan Phases C + D + E-automated)

## Context (1 line)
Plan `docs/tasks/v2/whatsapp-channel-fallback.md`; Phase B (T17, `540f7de`) shipped Channel type, phone-utils, twilio-webhooks normalization, worker same-channel replies, sms-service `channel`+`statusCallbackUrl` params, migration 014 (`rl_outbound_messages`, `whatsapp_opted_in` cols, channel CHECK +whatsapp). This task delivers Phases C (ledger + status route) and D (fallback engine), plus Phase E's deterministic test coverage. **Real-traffic Phase E smoke needs Phase A (user console work: Twilio number + WABA + templates) — out of scope here.**

## Goal
SMS-first, WhatsApp-fallback-on-delivery-failure, per plan: every tracked SMS write a `rl_outbound_messages` ledger row, a signature-first `/api/twilio/webhooks/status` Twilio StatusCallback route updates it, and a failed/undelivered SMS on a +880 to-phone with consent triggers one WhatsApp template retry; double failure escalates `sms_delivery_failure`; un-opted customers surface as `blocked_optin`, never silent drop.

## Deliverables

### 1. Shared: `MessagingKind` union (packages/shared/src/types.ts)
`export type MessagingKind = 'booking_confirmation' | 'reschedule_offer' | 'slot_invalid' | 'no_availability' | 'no_matching_booking' | 'verification_code' | 'confirm_code' | 'number_verified' | 'code_mismatch' | 'confirm_failed' | 'help' | 'missed_call_callback' | 'staff_ack';`

### 2. `services/outbound-ledger.ts` (NEW)
Lazy pg Pool like escalation-service. `insertOutbound({organizationId, customerId|null, toPhone, body, channel, kind})` → returns row (status 'queued', message_sid null). `markSent(sid, id)` / `markFailed(sid, id, errorCode|null)` / `markStatus(sid, status, errorCode|null)` (status must satisfy CHECK: queued|sent|delivered|failed|retried|escalated|blocked_optin). `getByMessageSid(sid)`. Wrap updates `WHERE message_sid=$1 AND status <> 'delivered' AND status <> 'retried' AND status <> 'escalated'` (terminal no-op). Table `rl_outbound_messages`.

### 3. `services/sms-service.ts` — ledger + statusCallbackUrl default
- `SendSmsInput` gains OPTIONAL `organizationId?: string; kind?: MessagingKind; customerId?: string;` (all optional → all existing callers/tests byte-identical when absent).
- When `organizationId` provided: write ledger row BEFORE the create; on success `markSent`; on throw `markFailed` + rethrow; default `statusCallbackUrl` (if not given) = `process.env.TWILIO_MESSAGE_STATUS_CALLBACK_URL ?? (API_BASE_URL ? API_BASE_URL + '/api/twilio/webhooks/status' : undefined)`. When no organizationId: zero ledger/Db behavior (current behavior unchanged).
- Dry-run (`TWILIO_SMS_DRY_RUN=true`): still write ledger row (status 'sent', sid `dry-run-…`), channels/from logic already in place.

### 4. `routes/twilio-status.ts` (NEW) + mount in app.ts
- `twilioStatusRouter` POST `/status`, **signature-first** via existing `verifyTwilioSignature` middleware (same as twilio-webhooks). Mounted: `app.use('/api/twilio/webhooks', twilioStatusRouter)` next to line 21 (path `/api/twilio/webhooks/status`).
- Body: form-encoded `TwilioStatusCallbackPayload` (types.ts:143–154). Flow: getByMessageSid → unknown sid: 200 no-op; map `MessageStatus`: queued→queued (no-op), sent→sent, delivered→delivered (terminal), failed|undelivered→failed, others→ignore; terminal states (delivered/retried/escalated) → 200 no-op (idempotent; Twilio retries non-2xx).
- Failed + channel='sms' → `fallback-service.handleFailedSms(row)` (below) → `markStatus(row.id, outcome)` where outcome ∈ retried|escalated|blocked_optin, or leave 'failed' when no_fallback/no_template. Always respond 200.

### 5. `services/whatsapp-service.ts` (NEW)
`sendWhatsAppTemplate({to, from, contentSid, contentVariables: Record<string,string>})` → `twilioClient.messages.create({ to: 'whatsapp:'+to, from: from ?? TWILIO_WHATSAPP_NUMBER (throw clear error if unset), contentSid, contentVariables })`. Dry-run parity (returns `dry-run-…` sid when TWILIO_SMS_DRY_RUN). Shape mirrors sms-service.

### 6. `services/consent-service.ts` (NEW)
- `getCustomerByPhone(orgId, phone)` read-only select `id, phone_verified_at, whatsapp_opted_in` from rl_customers (no insert/create).
- `recordWhatsAppOptIn(customerId)` idempotent `update rl_customers set whatsapp_opted_in=true, whatsapp_opted_in_at=now() where id=$1`.
- `hasWhatsAppOptIn(customerId)`.

### 7. `services/fallback-service.ts` (NEW) — `handleFailedSms(row) → {outcome, detail}`
Idempotent (re-read row; terminal → no-op). Decisions in order:
1. Country gate: countryCodeFromE164(to_phone) must be in allowlist env `WHATSAPP_FALLBACK_COUNTRIES` (comma-separated, default `'+880'`). Miss → outcome `no_fallback` (row stays 'failed').
2. Consent gate: `getCustomerByPhone(orgId, to_phone)` must exist AND phone_verified_at NOT NULL AND whatsapp_opted_in. Else `markStatus(…,'blocked_optin')`, outcome `blocked_optin`, no send.
3. Template SID: env `WHATSAPP_TEMPLATE_<KIND_UPPER_SNAKE>` (e.g. WHATSAPP_TEMPLATE_BOOKING_CONFIRMATION) → else env `WHATSAPP_TEMPLATE_GENERIC` → else null. Null → createEscalation({type:'sms_delivery_failure', customerPhone, content: 'template-not-configured: '+kind}) + outcome `no_template` (row stays 'failed', set error_code='template-not-configured').
4. Send `sendWhatsAppTemplate` with contentVariables `{1: originalBody}`. Success → `markStatus(…,'retried')`, outcome `retried`. Throw → `markStatus(…,'escalated')` + createEscalation({type:'sms_delivery_failure', customerPhone, content: originalBody}) + outcome `escalated`.

### 8. Worker opt-in write points (process-inbound-sms.ts)
- import recordWhatsAppOptIn from consent-service.
- (a) WA keyword: after T14 gate passes (verified path) and before classify: if `channel === 'whatsapp' && body.trim().toUpperCase() === 'WA'` → `recordWhatsAppOptIn(customer.id)`, `replySms(customerPhone, 'WhatsApp updates on. Reply STOP any time.', channel)`, return (job completes; NOT classified).
- (b) auto opt-in: when `channel === 'whatsapp'` and customer is verified (outcome 'verified-now' OR already phoneVerifiedAt) → `recordWhatsAppOptIn(customer.id)` (idempotent) before classify. Non-whatsapp channels untouched.

### 9. `.env.example`
Add: `TWILIO_WHATSAPP_NUMBER=`, `API_BASE_URL=` (public base for status callback), `TWILIO_MESSAGE_STATUS_CALLBACK_URL=`, `WHATSAPP_FALLBACK_COUNTRIES=+880`, `WHATSAPP_TEMPLATE_GENERIC=`, `WHATSAPP_TEMPLATE_BOOKING_CONFIRMATION=` (comment block: one per MessagingKind).

### 10. Tests (NEW/updated; follow process-inbound-sms.test.ts vi.mock pattern)
- `twilio-status.test.ts` NEW: invalid signature rejected; unknown sid → 200; sent→delivered; failed→fallback called (mocked) → ledger transitioned; duplicate callback idempotent.
- `fallback-service.test.ts` NEW: non-BD → no_fallback; unverified/not-opted → blocked_optin (+no send); missing template → escalate + no_template; template success → retried (mock whatsapp send); whatsapp throw → escalated + createEscalation.
- `whatsapp-service.test.ts` NEW: dry-run sid; from=TWILIO_WHATSAPP_NUMBER; variables passed.
- `consent-service.test.ts` NEW: getCustomerByPhone read-only; opt-in idempotent.
- `sms-service.test.ts` UPDATE: no-org sends unchanged (no ledger); with organizationId → ledger queued→sent; throw → failed; dry-run writes ledger.
- `process-inbound-sms.test.ts` UPDATE: add consent-service mocks (vi.hoisted); +WA keyword opt-in (whatsapp only); verified-now on whatsapp records opt-in; sms channel unaffected.

## Hard rules
- No migration (014 has all columns; ledger `kind` is text).
- No `npm install` ever. No commit/push (controller does that after review).
- Do not touch twilio-webhooks.ts route shapes, phone-utils, or reschedule-service.
- Backward compat: all new SendSmsInput fields optional.

## Verify
`npm run typecheck --workspace=apps/api` && `npx vitest run --testTimeout=60000` (from apps/api; baseline 448 + new) && `npm run build --workspace=apps/api`. Report to `docs/tasks/v2/reports/T18-whatsapp-fallback-engine.md` (what shipped, test/ty
pecheck/build results, decisions, deviations).
