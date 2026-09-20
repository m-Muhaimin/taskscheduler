# T19 — Shared extended DTOs (additive surface)

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; the escalations route is still an in-memory mock and the outbound ledger / consent / WhatsApp-config state have no dashboard read surface — this task lands every new shape in `@tradescheduler/shared` (plus API re-exports) **additively**, so nothing consuming the DTOs compiles until their producer tasks land.

## Goal
Add the shared DTO types the dashboard surfaces need (escalation display fields, outbound message rows, settings messaging status) with zero edits to existing exported types, keeping every existing consumer and all 507 baseline API tests green.

## Deliverables

### 1. `packages/shared/src/types.ts` (EDIT — additive only)
Add these five exported types (place `EscalationDto` immediately after the `EscalationListResponse` block at line 263; place `MessageDeliveryStatus`/`MessageRowDto`/`MessagesListResponse` after the `DashboardCustomersResponse` block at line 467; place `MessagingConfigStatusDto`/`DashboardMessagingStatusResponse` directly after `DashboardAutomationResponse` — the nearest `Dashboard*Response` block):

```ts
/** §2.9 + surface tasks — an escalation row with display-ready fields. */
export type EscalationDto = Escalation & {
  /** Human label for the escalation type (server-formatted, e.g. "Staff message"). */
  typeLabel: string;
  /** Org-timezone absolute timestamp, e.g. "Sep 18, 3:15 PM". */
  createdAtDisplay: string;
  /** Org-timezone absolute timestamp; null until resolved. */
  resolvedAtDisplay: string | null;
};

/** Delivery state of one outbound message (mirrors the rl_outbound_messages status CHECK). */
export type MessageDeliveryStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'retried'
  | 'escalated'
  | 'blocked_optin';

/** One row of the dashboard Messages (delivery-ledger) table. */
export type MessageRowDto = {
  id: string;
  toPhone: string;
  body: string;
  channel: Channel;
  /** Human label for the outbound kind; null when the kind is unset. */
  kindLabel: string | null;
  status: MessageDeliveryStatus;
  statusLabel: string;
  errorCode: string | null;
  messageSid: string | null;
  createdAt: IsoString;
  createdAtDisplay: string;
};

/** §GET /api/dashboard/messages response body. */
export type MessagesListResponse = {
  messages: MessageRowDto[];
  total: number;
  page: number;
  pageSize: number;
};

/** READ-ONLY presence readout for WhatsApp fallback config (never carries values). */
export type MessagingConfigStatusDto = {
  whatsappNumberConfigured: boolean;
  statusCallbackBaseUrlConfigured: boolean;
  /** E.164 country codes from WHATSAPP_FALLBACK_COUNTRIES (default ['+880']). */
  fallbackCountries: string[];
  genericTemplateConfigured: boolean;
  /** Per-kind WHATSAPP_TEMPLATE_<KIND_UPPER_SNAKE> presence. */
  templateConfigured: Record<MessagingKind, boolean>;
};

/** §GET /api/dashboard/settings/messaging response body. */
export type DashboardMessagingStatusResponse = {
  messaging: MessagingConfigStatusDto;
};
```

**Do NOT modify** `Escalation`, `EscalationListResponse`, `CustomerDto`, or any other existing export in this task — `EscalationListResponse.escalations` becomes `EscalationDto[]` in T20 and `CustomerDto` gains consent fields in T25, so each task's typecheck stays green locally.

### 2. `apps/api/src/types.ts` (EDIT — additive re-exports)
Add these six names to the existing `export type { … } from '@tradescheduler/shared'` list (alphabetical placement):
`DashboardMessagingStatusResponse`, `EscalationDto`, `MessageDeliveryStatus`, `MessageRowDto`, `MessagesListResponse`, `MessagingConfigStatusDto`.

## Hard rules
- Additive ONLY. No edits to existing exported types, no route/service/db changes, no test changes.
- Do not import these types on the web yet (T23/T24/T26/T28 do that).
- No `npm install`. No commit/push (controller does that after review).

## Verify
`npm run typecheck --workspace=apps/api` && `npx vitest run --testTimeout=60000` (from apps/api; all 507 baseline tests stay green) && `npm run build --workspace=apps/api` && `npm run build --workspace=apps/web`. Report to `docs/tasks/v2/reports/T19-shared-extended-dtos.md` (what shipped, typecheck/test/build results).