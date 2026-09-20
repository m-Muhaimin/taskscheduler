# T18 — WhatsApp fallback engine (report)

## Status
DONE (implemented in working tree; nothing committed).

## Files changed
- `packages/shared/src/types.ts` — `MessagingKind` union added (13 kinds:
  booking_confirmation, reschedule_offer, slot_invalid, no_availability,
  no_matching_booking, verification_code, confirm_code, number_verified,
  code_mismatch, confirm_failed, help, missed_call_callback, staff_ack).
- `apps/api/src/types.ts` — re-exports `MessagingKind`.
- `apps/api/src/services/outbound-ledger.ts` — NEW. Lazy-pool client (same
  pattern as queue-service), `OUTBOUND_MESSAGES_TABLE ?? 'rl_outbound_messages'`.
  Functions: `insertOutbound`, `markSent(messageSid, id)`, `markFailed(sid|id,
  errorCode)`, `markStatus(id, status, errorCode)`, `getByMessageSid(sid)`.
  `TERMINAL_STATUSES = ['delivered','retried','escalated']`; every update carries
  a terminal guard (`status <> 'delivered' and status <> 'retried' and status
  <> 'escalated'`) so a status webhook can never clobber a terminal row.
- `apps/api/src/services/sms-service.ts` — REWRITTEN for T18: `organizationId`
  / `kind` / `customerId` optional inputs. When `organizationId` is present one
  ledger row is written BEFORE the Twilio create (status `queued`); on success
  `markSent(message.sid, row.id)`; on throw `markFailed(null, row.id, null)` +
  rethrow. Default `statusCallbackUrl` (only with org) =
  `TWILIO_MESSAGE_STATUS_CALLBACK_URL` ?? `API_BASE_URL` (trailing slash
  stripped) + `/api/twilio/webhooks/status`. No org → byte-identical legacy
  behavior (zero ledger/db). Dry run with org still writes the ledger row and
  marks it `sent` with a `dry-run-…` sid.
- `apps/api/src/services/whatsapp-service.ts` — NEW. `sendWhatsAppTemplate({to,
  from, contentSid, contentVariables})`: `from` defaults to
  `TWILIO_WHATSAPP_NUMBER` with a clear error when unset; `to` routed through
  `toChannelAddress(to,'whatsapp')` (idempotent); dry-run parity
  (`dry-run-…` sid when `TWILIO_SMS_DRY_RUN=true`). Mirrors sms-service shape.
- `apps/api/src/services/consent-service.ts` — NEW. `getCustomerByPhone` (read-
  only, `CUSTOMERS_TABLE ?? 'rl_customers'`), `recordWhatsAppOptIn`
  (idempotent upsert of consent_at/whatsapp_opt_in + consent updated_at),
  `hasWhatsAppOptIn`.
- `apps/api/src/services/fallback-service.ts` — NEW. `handleFailedSms(row)`:
  1) country gate `countryCodeFromE164(to_phone)` ∈ `WHATSAPP_FALLBACK_COUNTRIES`
  (comma-separated, default `'+880'`) → miss: no fallback, outcome
  `no_fallback`, row stays `failed`; 2) consent gate (idempotent re-read by
  message_sid): missing/unverified/not-opted-in → `markStatus(id,
  'blocked_optin')`, outcome `blocked_optin`; 3) template gate
  `WHATSAPP_TEMPLATE_<KIND_UPPER_SNAKE>` → `WHATSAPP_TEMPLATE_GENERIC` → null:
  null → `createEscalation({type:'sms_delivery_failure', customerPhone,
  content:'template-not-configured: '+kind})` + `markStatus(id,'failed',
  'template-not-configured')` (row stays failed), outcome `no_template`;
  4) send via `sendWhatsAppTemplate` (body as `{1}`), success → `markStatus(id,
  'retried')`, outcome `retried`; throw → `createEscalation` (content
  `whatsapp-fallback-send-failed`) + rethrow, outcome `escalated`.
  `resolveTemplateSid(kind, env)` exported.
- `apps/api/src/routes/twilio-status.ts` — NEW. POST `/api/twilio/webhooks/
  status`. Signature-first via `verifyTwilioSignature` (401 on bad signature —
  no fallback work before auth); form payload parsed through
  `TwilioStatusCallbackPayload`; ALWAYS responds 200 once authorized. Unknown
  MessageSid no-op; terminal row no-op; queued no-op; whatsapp-channel rows
  never fall back (they ARE the fallback). `failed` → `handleFailedSms` → row
  re-marked only for outcomes `retried|escalated|blocked_optin`. Mounted in
  `apps/api/src/app.ts` beside the existing webhooks router.
- `apps/api/src/worker/process-inbound-sms.ts` — T18 branches: exact `WA`
  keyword → `recordWhatsAppOptIn` (fail-visible on error); automatic opt-in for
  already-whatsapp-verified traffic after the T14 gate is best-effort
  try/catch (verbose log). New `verifiedNow` capture flag for the timing
  hand-off. Reply copy: `WhatsApp updates on. Reply STOP any time.`
- `.env.example` — WhatsApp fallback block: `API_BASE_URL=`,
  `TWILIO_MESSAGE_STATUS_CALLBACK_URL=`, `TWILIO_WHATSAPP_NUMBER=`,
  `WHATSAPP_FALLBACK_COUNTRIES=+880`, `WHATSAPP_TEMPLATE_GENERIC=` + one
  `WHATSAPP_TEMPLATE_<KIND_UPPER_SNAKE>` per MessagingKind.
- Tests NEW: `services/whatsapp-service.test.ts` (7), `services/consent-
  service.test.ts`, `services/fallback-service.test.ts`, `routes/twilio-status
  .test.ts`. Tests UPDATED: `services/sms-service.test.ts` (+11 T18 ledger/
  callback/channel cases), `worker/process-inbound-sms.test.ts` (+8 T18 opt-in
  cases).

## How the fallback runs
`Twilio StatusCallback (failed)` → `POST /api/twilio/webhooks/status`
(signature verified) → `handleFailedSms` (4 gates) → WhatsApp template send +
ledger `retried`, or escalation + `blocked_optin`/`no_template`/stay-`failed`.
The engine is idempotent by construction: any re-delivered webhook for a row
already in `retried|escalated|delivered` is a no-op.

## Deviations / decisions (read before merge)
- `contentVariables` is `JSON.stringify`'d at the wire boundary — the Twilio
  SDK types it as `string`. Function signature stays `Record<string,string>`
  per brief.
- Ledger updates are keyed by row `id` (PK), exactly as the brief's own
  `markSent(messageSid, ledgerRow.id)` signature requires; `getByMessageSid`
  is the SID→row lookup. Both the route and worker read via SID, then update
  via id.
- `'blocked_optin'` is deliberately NOT in `TERMINAL_STATUSES` — a later
  verified opt-in may retry the same row.
- The no-template path also sets `error_code='template-not-configured'` on the
  ledger row (row stays `failed`); the bridge/`no_fallback` path leaves the
  row `failed` untouched.
- Dry-run (`TWILIO_SMS_DRY_RUN`) with an organizationId still writes the
  ledger row and marks it sent — the ledger always reflects the attempted
  message, even in dev.
- Worker: the explicit `WA` opt-in branch fails visibly if the ledger write
  throws; the automatic opt-in for already-verified whatsapp traffic stays
  best-effort (try/catch + verbose log) — an opt-in-record hiccup must never
  take down processing of an otherwise-verified message.
- No live smoke run: status-callback traffic needs a reachable public API URL
  (env-wired at deploy time, controller-owned). Signature flow, gate
  branches, and ledger transitions are covered by route/service assertions
  end-to-end.

## Test/build tails
- `npx vitest run --testTimeout=60000` from `apps/api`: 507/507 passed, 32
  files (was 448/28 — +59 tests, +4 files). T18 suites: whatsapp-service (7),
  consent-service, fallback-service, twilio-status route, sms-service +11,
  worker +8 — all green.
- `npm run typecheck --workspace=apps/api`: clean. `npm run build
  --workspace=apps/api`: clean.
- Known flake, NOT introduced here: `process-inbound-sms.test.ts` has a
  pre-existing mock-leak sensitivity (documented in the T13/T14/T15 threads);
  re-run is green.

## Do NOT commit
Changes are left in the working tree for the controller to commit.