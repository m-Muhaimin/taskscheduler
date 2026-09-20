# WhatsApp Channel Fallback (Bangladesh) — Implementation Plan

## Goal
Add WhatsApp as a **fallback** messaging channel on the existing Twilio stack for
countries where SMS delivery is unreliable or restricted — starting with
Bangladesh (+880). WhatsApp is tried only when SMS delivery fails, and customers
can reach the org's WhatsApp number inbound.

## Locked decisions (user-confirmed)
1. **Trigger: SMS first, WhatsApp on delivery failure.** Send SMS as today; when
   Twilio reports `failed`/`undelivered` via StatusCallback, retry the message on
   WhatsApp using an approved template. Non-BD traffic keeps current behavior
   byte-for-byte.
2. **Inbound + outbound in scope.** Customer messages to the org's WhatsApp
   number flow through the same webhook + worker pipeline (normalize
   `whatsapp:+880…` prefixes), which also opens the free-form 24h session window
   for replies.
3. **Sender: Bring Your Own Number (BYON) — a Bangladeshi business number.**
   Meta Business verification + WABA required either way.

## Platform constraints shaping the design (Twilio WhatsApp, current facts)
- **WABA via Meta Business Manager**: one WABA per Twilio Account SID; unverified
  Meta BM caps at 2 senders, verified allows 20; messaging limit 250 unique
  users/day unverified, 2k+ after verification.
- **Business-initiated (out-of-session) messages MUST be Meta-approved
  templates** (`utility` / `marketing` / `authentication`), `{{1}}` placeholder
  variables; approval near-immediate verified, up to 24h otherwise.
- **24-hour customer-service window**: after any user inbound, free-form replies
  are allowed for 24h (reset on each reply). Outside the window: templates only.
- **Address format**: `whatsapp:+8801…` on both `To` and `From`.
- **Delivery receipts**: same `StatusCallback` mechanism as SMS
  (`MessageStatus` = `sent` | `delivered` | `failed` | `undelivered`).
- **Fees**: utility templates carry no Meta fee in-window (Jul 2025 change);
  marketing/authentication bill per conversation.
- **BYON requirement**: the number must be able to receive SMS or voice calls
  (Meta OTP verification) and must not already be registered to WhatsApp.

## Current app state (verified, do not re-derive)
- **Inbound route** `apps/api/src/routes/twilio-webhooks.ts`: signature-first,
  REQUIRED_FIELDS `From/To/Body/MessageSid`, **E.164 gate REJECTS `whatsapp:`
  prefixes (400 INVALID_PHONE)**, enqueues `inbound_sms` job.
- **Worker** `apps/api/src/worker/process-inbound-sms.ts`: E164_RE (line 26),
  org resolution by To-number (line 67), T16 staff branch, `findOrCreateCustomer`,
  T14 OTP gate, T15 confirm-code gate, classify dispatch, ~10 `sendSms` reply
  call sites (104/456/464/480/487/499/568/606/624/705/727).
- **Outbound** `apps/api/src/services/sms-service.ts`: single `sendSms`
  (`client.messages.create({to, from, body})`), `from` defaults to
  `TWILIO_PHONE_NUMBER`, honors `TWILIO_SMS_DRY_RUN`, env-free lazy creds.
  **No StatusCallback URL set today; no delivery-receipt handling.**
- **Ledger-ish**: `apps/api/src/worker/process-outbound-sms.ts` poll-loop
  outbound (missed-call auto-texts); `reschedule-service.ts:69` also sends.
- **Types**: `TwilioStatusCallbackPayload` **already exists** in
  `packages/shared/src/types.ts` (143–154), re-exported via
  `apps/api/src/types.ts` — reuse it.
- **Consent model**: the SMS hard rule (“never send without logged consent”) has
  **no consent table** — enforcement today is the T14 OTP gate
  (`phoneVerifiedAt` on `rl_customers`, migration 010). Meta separately requires
  business opt-in for business-initiated WhatsApp messages. Fallback sends must
  be gated on T14 verification AND a recorded WhatsApp opt-in.
- **Org lookup** `resolveOrganizationIdByTwilioNumber` matches the raw To-number
  against `rl_twilio_numbers.phone` — a `whatsapp:` prefix must be stripped
  before lookup.

## Design

### Channel model
- `type Channel = 'sms' | 'whatsapp'` in shared types. Inbound jobs carry
  `channel` (derived from the From prefix); outbound calls accept an optional
  `channel` override (default `sms`).
- Webhook: accept `whatsapp:`-prefixed From/To, **strip the prefix before the
  E.164 gate**, keep the prefixed raw values for reply routing.
- Worker replies on the **same channel the customer wrote in** (in-window
  free-form on WhatsApp; templates used only for out-of-window sends).

### Delivery-failure fallback (core flow)
1. `sendSms` gains optional `statusCallbackUrl`
   (default `${API_BASE_URL}/api/twilio/webhooks/status`).
2. New route `POST /api/twilio/webhooks/status` (signature-first): updates a new
   **`rl_outbound_messages` ledger** table (migration 014) keyed by MessageSid.
3. On `failed` / `undelivered`:
   - Country gate: customer phone country +880 is in the org's fallback
     allowlist (default `['+880']`).
   - Consent gate: customer T14-verified AND `whatsapp_opted_in`.
   - Retry via `whatsapp-service.ts`:
     `client.messages.create({ to: whatsapp:+…, from: TWILIO_WHATSAPP_NUMBER,
     contentSid: <template SID>, contentVariables })` with dry-run parity.
   - If WhatsApp also fails: `createEscalation({ type: 'sms_delivery_failure',
     … })` (type already exists in migrations/002 CHECK).
4. **Idempotency**: ledger state machine `queued → sent → delivered |
   failed(→ retried) | escalated`; a status callback for an already-retried SID
   is a no-op; max one fallback attempt per logical message.

### Template catalog (initial — one per outbound kind; EN + BN variants)
| Kind | Today's call site | WhatsApp template (utility/auth) |
|---|---|---|
| booking_confirmation | worker 456/464 | appointment_confirmation_date_time |
| reschedule_offer | 480/487 + reschedule-service 69 | reschedule_offer_slots |
| slot_invalid | worker 499 | invalid_slot_choice |
| no_availability | scheduling-engine + worker | no_availability |
| verification_code (T14) | worker 568 | verification_code (authentication) |
| confirm_code (T15) | worker 727 | confirmation_code (authentication) |
| verified / mismatch (T14) | worker 606/624 | number_verified / code_mismatch |
| missed-call auto-text | process-outbound-sms 84 | missed_call_callback |
| staff ack (T16) | worker 104 | **skip WhatsApp** (staff channel stays SMS) |

Template registration is a Twilio Console / Content API step (human), approved
by Meta. SIDs stored in org settings (migration 014 adds
`whatsapp_templates jsonb` to `rl_organizations.settings` or a small table).

### Configuration (env + org settings)
- `.env` additions: `TWILIO_WHATSAPP_NUMBER` (e.g. `whatsapp:+8801…`),
  `API_BASE_URL` (StatusCallback base), optional
  `TWILIO_MESSAGE_STATUS_CALLBACK_URL` override.
- Org settings jsonb (organization-service already supports
  `getOrganizationSettings`): `{ messaging: { whatsappFallback: { enabled,
  countries: ['+880'], optInRequired: true } } }`.
- `src/services/phone-utils.ts` helper: E.164 country-code extraction
  (BD = +880), channel normalization.

### Consent / opt-in (hard-rule + Meta compliance)
- Migration 014 also adds: `rl_customers.whatsapp_opted_in boolean not null
  default false`, `rl_customers.whatsapp_opted_in_at timestamptz`.
- Opt-in write points: (a) explicit keyword (“WA”) sent to the WhatsApp number
  → dedicated intent → set opt-in + reply; (b) first inbound on WhatsApp after
  T14 verification records opt-in with an audit log. Outbound fallback NEVER
  fires without `whatsapp_opted_in`.

## Files to change
1. `apps/api/src/db/migrations/014-whatsapp-fallback.sql` — NEW: outbound ledger
   + customer opt-in columns + org template-sid storage; mirror in
   `supabase/schema.sql`; register in `apps/api/scripts/db-migrate.mjs`
   MIGRATIONS.
2. `apps/api/src/routes/twilio-webhooks.ts` — accept `whatsapp:` prefixes, strip
   for the E.164 gate, add `channel` to the job payload.
3. `apps/api/src/routes/twilio-status.ts` — NEW: StatusCallback route,
   signature-first, ledger update, fallback trigger.
4. `apps/api/src/services/sms-service.ts` — optional `statusCallbackUrl`.
5. `apps/api/src/services/whatsapp-service.ts` — NEW: template send, dry-run
   parity.
6. `apps/api/src/services/phone-utils.ts` — NEW: country-code + channel helpers.
7. `apps/api/src/services/consent-service.ts` — NEW: opt-in record/query.
8. `apps/api/src/worker/process-inbound-sms.ts` — channel-aware reply routing;
   normalize prefixes before org lookup + E.164 gate.
9. `apps/api/src/types.ts` + `packages/shared/src/types.ts` — `Channel` union,
   extend `TwilioInboundSmsPayload` with `channel`; reuse
   `TwilioStatusCallbackPayload`.
10. Tests: twilio-webhooks (whatsapp prefix), whatsapp-service NEW,
    twilio-status NEW (fallback fires / not fires / idempotent),
    process-inbound-sms (channel passthrough), phone-utils NEW.

## Implementation order (verify each phase before the next)
- **Phase A — platform onboarding (human, blocked on Meta/Twilio):** verify Meta
  Business Manager → Twilio Self Sign-up WhatsApp sender → BYON BD number (OTP)
  → set inbound webhook to the same `/inbound-sms` URL → register templates
  (console/Content API). Can run in parallel with the code phases.
- **Phase B — plumbing:** types (`Channel`, payload), phone-utils, webhook
  normalization, worker channel-aware replies, sms-service statusCallbackUrl,
  migration 014 + registry + schema.sql. Tests green; SMS behavior unchanged.
- **Phase C — ledger + status route:** `rl_outbound_messages` writes on every
  send; `/status` route updates the ledger; unit tests with mocked Twilio.
- **Phase D — fallback engine:** whatsapp-service, consent + country gates,
  template map, escalation on double failure; integration tests (mocked
  statusCallback → WhatsApp retry + ledger state).
- **Phase E — live smoke (needs Phase A):** with `TWILIO_SMS_DRY_RUN=true`,
  enqueue inbound from a BD number → assert SMS flow; force a failed status →
  assert WhatsApp template retry + ledger; real BD WhatsApp inbound → free-form
  reply.

## Verify (in order, workdir H:\tradescheduling)
1. `npm run typecheck --workspace=apps/api` — no new errors.
2. `npx vitest run --testTimeout=60000` from `apps/api` — full suite green
   (environment-load flakes clear at 60s).
3. `npm run build --workspace=apps/api`.
4. Phase E smoke as above.

## Out of scope (explicit)
- No dashboard UI for channel state (ledger inspectable via DB).
- No WhatsApp outbound for the T16 staff-ack path (staff channel stays SMS).
- No marketing/campaign templates; only operational (utility/auth) messages.
- No multi-sender-per-org routing (single BYON sender; WABA expansion is a
  follow-up).

## Risks
- Meta template approval latency (mitigate: register early in Phase A).
- BYON number already on personal WhatsApp → must migrate/de-register first.
- 250 unique users/day unverified cap → verify Meta BM before launch.
- `whatsapp_opted_in` gating means fallback silently never fires for
  un-opted-in customers — surface as a ledger `blocked_optin` status, not a
  silent drop.
