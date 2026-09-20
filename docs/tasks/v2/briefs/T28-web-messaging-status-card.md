# T28 — Web: WhatsApp messaging status card (Settings)

## Context (1 line)
Plan `docs/tasks/v2/ui-extended-backend-surfaces.md`; T27 mounted `GET /api/dashboard/settings/messaging` — this task surfaces the presence readout in Settings so the trade can see at a glance whether WhatsApp fallback is configured.

## Goal
A self-contained "Messaging" card in the Settings panel's Column 1 (under Calendar) showing which WhatsApp-fallback env inputs are configured (booleans only), with loading/error/ready states, a configured-count, and hint copy pointing at the phase-A checklist.

## Deliverables

### 1. `apps/web/lib/dashboard-api.ts` (EDIT)
- Import `DashboardMessagingStatusResponse` type from `@tradescheduler/shared` (extend the existing type import block).
- Add after `getAutomationSettings`/`updateAutomationSettings`:
```ts
export function getMessagingStatus(): Promise<DashboardMessagingStatusResponse | NoOrganization | typeof SESSION_EXPIRED> {
  return request<DashboardMessagingStatusResponse>("/api/dashboard/settings/messaging");
}
```
(Confirm `request<T>` exists in this file with that exact shape — it is used by `getAutomationSettings`; match it.)

### 2. `apps/web/components/dashboard/whatsapp-messaging-card.tsx` (NEW — self-contained client card)
- `"use client"`. Load-once `useEffect` pattern copied from `settings-panel.tsx`'s automation load (lines 402–418: `cancelled` flag, `SESSION_EXPIRED`/`NO_ORGANIZATION` early return, `.catch` → error state).
- State: `status: "loading" | "error" | "ready"`, `config: MessagingConfigStatusDto | null`, `retry()` that re-runs the load.
- Rendering:
  - loading: rows of `<Skeleton className="h-3.5 w-40" />` (from `@/components/ui/skeleton`).
  - error: `ErrorState label="messaging status"` with retry (import from `@/components/dashboard/error-state`; match its props — `message`, `onRetry`, `label`).
  - ready: inside `card divided overflow-hidden`:
    - Row 1 "WhatsApp number": `Chip tone={config.whatsappNumberConfigured ? "success" : "muted"}>{config.whatsappNumberConfigured ? "Configured" : "Not configured"}</Chip>`
    - Row 2 "Status callback URL": same chip pattern with `statusCallbackBaseUrlConfigured`.
    - Row 3 "Fallback countries": `config.fallbackCountries.length ? config.fallbackCountries.join(", ") : "—"` (mono, `text-[12px] text-ink-muted`).
    - Row 4 "Generic template": chip pattern with `genericTemplateConfigured`.
    - Row 5 "Per-kind templates": `const n = Object.values(config.templateConfigured).filter(Boolean).length;` → text `${n} of 13 kinds configured` + `Chip tone={n === 13 ? "success" : n > 0 ? "muted" : "muted"}` `{n === 13 ? "Complete" : n > 0 ? "Partial" : "None"}`.
    - Row layout mirrors settings-panel rows: `flex items-center justify-between gap-4 p-4` with `text-[13.5px] font-medium` label left, chip right. Rows separated by `divided` (the card's `.divided` class puts dividers between `.p-4` blocks — verify the existing usage in settings-panel and match).
  - Footer hint (only when `n < 13` or any not-configured — simplest: always render): `text-[12px] text-ink-muted mt-3`:
    `"WhatsApp fallback needs TWILIO_WHATSAPP_NUMBER, WHATSAPP_FALLBACK_COUNTRIES, WHATSAPP_TEMPLATE_GENERIC, and the per-kind WHATSAPP_TEMPLATE_* keys in your server env. See the Phase A checklist in docs/tasks/v2/whatsapp-channel-fallback.md."`
    (No env values are ever rendered.)

### 3. `apps/web/components/dashboard/settings-panel.tsx` (EDIT)
- Import `WhatsAppMessagingCard` from `@/components/dashboard/whatsapp-messaging-card`.
- Inside the Column 1 `<div className="flex flex-col gap-6 min-w-0">` (line 489), directly AFTER the Calendar `</section>` (line 549) and BEFORE the column-1 closing `</div>` (line 550), add:
```tsx
<section className="max-w-xl">
  <h2 className="font-head font-semibold text-[15px] mb-3">Messaging</h2>
  <WhatsAppMessagingCard />
</section>
```
- Nothing else in settings-panel changes (no new deps; the card owns its data fetch + states).

## Hard rules
- No shadcn — `Chip`, `Skeleton`, `ErrorState` from the RidgeLine DS only.
- Read-only card: never renders env values, phone numbers, or SIDs (booleans + the fallback-countries string list only).
- No changes to the automation toggles, Google card, or profile column.
- No `npm install`. No commit/push.

## Verify
`npm run build --workspace=apps/web`. Optionally boot `npm run dev --workspace=apps/web -p 3100`, open `/dashboard/settings`, and confirm: card sits under Calendar in Column 1; truthy env in the API process flips chips to "Configured"; count updates; error state retries. Report to `docs/tasks/v2/reports/T28-web-messaging-status-card.md` (what shipped, build result, visual check notes).