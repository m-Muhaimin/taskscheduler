# T19 — Shared extended DTOs (report)

## Status
DONE (implemented in working tree; nothing committed — controller commits after review).

## What shipped

Strictly additive type surface per the brief. No routes, services, db, tests, or
web changes; no `npm install`; no existing export modified.

### 1. `packages/shared/src/types.ts` — five new exported types

- `EscalationDto` — inserted immediately after the `EscalationListResponse`
  block (was line 263): `Escalation & { typeLabel, createdAtDisplay,
  resolvedAtDisplay }`, a display-ready escalation row. `EscalationListResponse`
  itself untouched (`escalations` stays `Escalation[]` — T20 flips it).
- `MessageDeliveryStatus` + `MessageRowDto` + `MessagesListResponse` — inserted
  immediately after the `DashboardCustomersResponse` block (was line 467):
  delivery-status union mirroring the `rl_outbound_messages` status CHECK
  (`queued | sent | delivered | failed | retried | escalated | blocked_optin`);
  ledger-row DTO (`id, toPhone, body, channel, kindLabel, status, statusLabel,
  errorCode, messageSid, createdAt, createdAtDisplay`); paginated
  `GET /api/dashboard/messages` response body (`messages, total, page,
  pageSize`).
- `MessagingConfigStatusDto` + `DashboardMessagingStatusResponse` — directly
  after `DashboardAutomationResponse` (end of file): read-only WhatsApp
  fallback-config presence readout (`whatsappNumberConfigured,
  statusCallbackBaseUrlConfigured, fallbackCountries, genericTemplateConfigured,
  templateConfigured: Record<MessagingKind, boolean>`) and its
  `GET /api/dashboard/settings/messaging` response wrapper.

### 2. `apps/api/src/types.ts` — six re-exports added (alphabetical)

`DashboardMessagingStatusResponse`, `EscalationDto`, `MessageDeliveryStatus`,
`MessageRowDto`, `MessagesListResponse`, `MessagingConfigStatusDto` added to the
existing `export type { … } from '@tradescheduler/shared'` list. Placement:
`DashboardMessagingStatusResponse` between `ConversationStateValue` and
`Escalation`; `EscalationDto` between `Escalation` and `EscalationListResponse`;
`MessageDeliveryStatus` / `MessageRowDto` / `MessagesListResponse` /
`MessagingConfigStatusDto` between `Lead` and `MessagingKind`.

## Verification

| Command | Result |
| --- | --- |
| `npm run typecheck --workspace=apps/api` | PASS (tsc --noEmit, clean) |
| `npx vitest run --testTimeout=60000` (cwd `apps/api`) | PASS — 32 files, **507/507 tests green** (baseline unchanged) |
| `npm run build --workspace=apps/api` | PASS (tsc) |
| `npm run build --workspace=apps/web` | PASS (Next.js compiled; 17 static pages) — only the pre-existing cosmetic lockfile-patch warning (see CLAUDE.md), build succeeds |

No deviations from the brief. The new DTOs are intentionally unconsumed —
producer tasks (escalations route, outbound messages, messaging settings) and
the web consumers (T23/T24/T26/T28) land later.