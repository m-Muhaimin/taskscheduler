# T27 — Settings messaging-status route (GET /api/dashboard/settings/messaging)

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; the WhatsApp fallback phase-A env config (`.env.example`: `TWILIO_WHATSAPP_NUMBER`, `API_BASE_URL`, `TWILIO_MESSAGE_STATUS_CALLBACK_URL`, `WHATSAPP_FALLBACK_COUNTRIES=+880`, `WHATSAPP_TEMPLATE_GENERIC`, 13 per-kind `WHATSAPP_TEMPLATE_<KIND>` keys) exists but nothing tells the dashboard what's configured — this route reports PRESENCE ONLY, never values.

## Goal
`GET /api/dashboard/settings/messaging` → `DashboardMessagingStatusResponse` (`{ messaging: MessagingConfigStatusDto }`), org-gated like the automation routes, computed purely from environment variable presence (no secrets, no SIDs, no values echoed).

## Deliverables

### 1. `apps/api/src/routes/dashboard/settings.ts` (EDIT)
- Extend the import from `@tradescheduler/shared` (line 8–12 block) with `MessagingKind`, `MessagingConfigStatusDto`, `DashboardMessagingStatusResponse`.
- Add after `AUTOMATION_KEYS` (line 33):

```ts
/** All 13 outbound kinds (the README hard rule list + staff_ack). */
const MESSAGING_KINDS: MessagingKind[] = [
  'booking_confirmation',
  'reschedule_offer',
  'slot_invalid',
  'no_availability',
  'no_matching_booking',
  'verification_code',
  'confirm_code',
  'number_verified',
  'code_mismatch',
  'confirm_failed',
  'help',
  'missed_call_callback',
  'staff_ack',
];

/** READ-ONLY presence readout for WhatsApp fallback config — booleans only.
 *  NEVER echo env values, phone numbers, or Twilio SIDs. */
function messagingStatus(): MessagingConfigStatusDto {
  const fallbackCountries = (process.env.WHATSAPP_FALLBACK_COUNTRIES ?? '+880')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const templateConfigured = {} as Record<MessagingKind, boolean>;
  for (const kind of MESSAGING_KINDS) {
    templateConfigured[kind] = Boolean(process.env[`WHATSAPP_TEMPLATE_${kind.toUpperCase()}`]);
  }
  return {
    whatsappNumberConfigured: Boolean(process.env.TWILIO_WHATSAPP_NUMBER),
    statusCallbackBaseUrlConfigured: Boolean(
      process.env.API_BASE_URL || process.env.TWILIO_MESSAGE_STATUS_CALLBACK_URL,
    ),
    fallbackCountries,
    genericTemplateConfigured: Boolean(process.env.WHATSAPP_TEMPLATE_GENERIC),
    templateConfigured,
  };
}
```
- Add the route (mirroring the `/automation` GET shape exactly, incl. the shared `resolveOrg` helper and the same `console.error` prefix):

```ts
router.get('/messaging', requireAuth, async (req, res) => {
  try {
    const org = await resolveOrg(req, res);
    if (!org) return;
    const body: DashboardMessagingStatusResponse = { messaging: messagingStatus() };
    res.json(body);
  } catch (err) {
    console.error('[dashboard] settings error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});
```
- Update the file-header comment block (lines 14–23) to add: `- GET   /api/dashboard/settings/messaging — WhatsApp fallback config PRESENCE readout (booleans; never echoes values)`.

### 2. `apps/api/src/routes/dashboard/settings.test.ts` (EDIT — extend; keep the automation describe intact)
Add a `describe('GET /api/dashboard/settings/messaging', …)` using the file's existing `createApp`/constants (`JWT_SECRET='test_jwt_secret_000_secret_000'`, `USER_ID='__VG_UUID_f4a3b2c1d0e9__'`, `ORG_ID='a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007'`, `AUTHORIZED`). Determinism: in `beforeEach` delete ALL five inputs (`TWILIO_WHATSAPP_NUMBER`, `API_BASE_URL`, `TWILIO_MESSAGE_STATUS_CALLBACK_URL`, `WHATSAPP_FALLBACK_COUNTRIES`, `WHATSAPP_TEMPLATE_GENERIC`, plus every `WHATSAPP_TEMPLATE_*` key) and in `afterEach` delete them again — a developer .env may carry real values, so tests must control the full surface each run. If the file lacks `vi`, add the import. Tests:
- no env set → 200; `whatsappNumberConfigured: false`; `statusCallbackBaseUrlConfigured: false`; `fallbackCountries` deep-equals `['+880']`; `genericTemplateConfigured: false`; `templateConfigured` has exactly 13 keys, all `false`.
- set `TWILIO_WHATSAPP_NUMBER='whatsapp:+15551234567'` → `whatsappNumberConfigured: true` AND the raw value never appears in the response body (assert `!JSON.stringify(body).includes('+15551234567')`).
- set `API_BASE_URL='https://x.example'` only → `statusCallbackBaseUrlConfigured: true`; set `TWILIO_MESSAGE_STATUS_CALLBACK_URL` only (delete `API_BASE_URL`) → still `true`.
- set `WHATSAPP_TEMPLATE_GENERIC` + `WHATSAPP_TEMPLATE_BOOKING_CONFIRMATION` → `genericTemplateConfigured: true`, `templateConfigured['booking_confirmation'] === true`, `templateConfigured['staff_ack'] === false`.
- `WHATSAPP_FALLBACK_COUNTRIES='+880, +1, +44 '` → `['+880', '+1', '+44']`; `WHATSAPP_FALLBACK_COUNTRIES=''` → `[]`.
- 401 without bearer; 403 `no_organization` when the org mock returns null; 500 `server_error` when `getOrgContextByUserId` rejects.

## Hard rules
- Booleans and derived data ONLY from `process.env` presence — this route must never serialize an env value/phone/SID (test asserts it).
- No secret logging; reuse the existing `[dashboard] settings error:` prefix.
- No DB reads beyond the existing `resolveOrg`; `MessagingConfigStatusDto` stays a PRESENCE type (T19).
- No web changes here (T28). No `npm install`. No commit/push.

## Verify
`npm run typecheck --workspace=apps/api` && `npx vitest run --testTimeout=60000` (from apps/api; automation describe + new messaging describe green, baseline 507 + new ~7) && `npm run build --workspace=apps/api`. Report to `docs/tasks/v2/reports/T27-settings-messaging-status-route.md` (what shipped, test/typecheck/build results, decisions/deviations).