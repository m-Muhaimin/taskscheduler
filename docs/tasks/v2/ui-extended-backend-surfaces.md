# Plan — Surface T16/T17/T18 backend features in the RidgeLine dashboard

## Goal
Make the backend features shipped in T16 (staff-SMS/`staff_sms` escalations), T17/T18 (outbound message ledger, WhatsApp fallback, consent/verification state) **visible and manageable in the RidgeLine dashboard**. Today:
- `GET /api/dashboard/escalations` serves a hardcoded in-memory mock (`__VG_UUID_*` fixtures in `apps/api/src/routes/dashboard/escalations.ts`) — every real escalation written by `escalation-service.createEscalation` is invisible, and the label map misses `staff_sms` / `customer_escalation`.
- `rl_outbound_messages` (migration 014, populated by T18) has no dashboard route and no UI — delivery failures, WhatsApp retries, and `blocked_optin` outcomes are unobservable.
- Customer consent/verification state (`whatsapp_opted_in`, `phone_verified_at`) exists but the customers read model never surfaces it.
- WhatsApp fallback config is env-only with zero UI visibility.

This plan adds read-only surfaces for all four: a real Escalations page, a Messages (delivery ledger) page, consent chips on Customers, and a WhatsApp-messaging status card in Settings. **No mutating endpoints are added** (see Decisions).

## Scope

### P1 — Visibility of incidents and delivery
- **Escalations**: replace the mock route with a DB-backed read (`escalation-service.getEscalations`), complete label map, new `/dashboard/escalations` page + nav + loader + list UI.
- **Messages**: new `GET /api/dashboard/messages` (org-scoped ledger query, optional channel/status filters + pagination, newest first), new `/dashboard/messages` page + nav + loader + table with channel chip, kind label, status pill, error code.

### P2 — Consent state and config readiness
- **Customers consent column**: extend `CustomerDto` (shared) + `dashboard-service.getCustomers` with `phoneVerifiedAt` / `whatsappOptedIn`; customers list shows small chips. **Read-only** — the worker owns opt-in; no opt-in/opt-out mutation endpoints, explicitly out of scope.
- **Settings messaging status**: new `GET /api/dashboard/settings/messaging` returning **non-secret** env-derived config presence (booleans + country list only — SIDs/secrets are NEVER echoed); read-only "WhatsApp messaging" card in Settings. **No PATCH** — config stays env-managed.

## Decisions (made here — implementers must not re-litigate)
1. **Escalate-resolve action (POST mark-resolved): DEFERRED.** This plan ships the read-only surface only. Rationale: visibility is the defect ("real escalations are invisible"); resolve needs its own optimistic-UI + mutation pattern and can land later touching the same three files. No resolve endpoint, button, or `resolveEscalation` service fn in this plan.
2. **Customers consent fields: keep simple.** `phoneVerifiedAt: IsoString | null` + `whatsappOptedIn: boolean` only. No conversation-derived `channel` field (needs per-customer conversation queries; YAGNI for a consent readout).
3. **`EscalationListResponse.escalations` changes `Escalation[]` → `EscalationDto[]` inside T20** (the task that replaces the mock route — its only consumer) so every intermediate task's typecheck/build stays green. Same rule: `CustomerDto` extension ships inside T25 (with its producer, `dashboard-service.getCustomers`).
4. **Org scoping of escalations** uses a two-arm phone predicate (see T20): customer phones via `rl_customers` **or** staff phones via `rl_tradespeople` ⋈ `rl_organization_members` — so T16 `staff_sms` rows surface. Attribute-less rows (phone `'unknown'`, phones with no customer row in any org) stay invisible on all dashboards — accepted, matches the `dashboard-service.ts` header caveat ("rl_escalations has NO org column … attributed via customer_phone").
5. **`MessagingConfigStatusDto` adds `statusCallbackBaseUrlConfigured`** (presence of `API_BASE_URL` or `TWILIO_MESSAGE_STATUS_CALLBACK_URL`) — without it the Messages page can never show `delivered`; it belongs in the readiness readout. Small, read-only, in scope.
6. **Frontend pagination is display-only.** The API stays paginated (page/pageSize/default 20, max 100) and the header shows "N messages"; the UI loads page 1 and filters client-side (matches the one-fetch-per-page convention). No pager component.
7. **No new skeleton components.** Reuse existing `CustomersSkeleton` (escalations list) and `TableSkeleton` (messages table) from `apps/web/components/dashboard/skeletons.tsx`.

## Task table (execution order)

| id | Phase | Deliverable | Files (create/edit) | API contract summary |
|----|-------|-------------|---------------------|----------------------|
| T19 | P1 (foundation) | Additive shared DTO surface + API re-exports | `packages/shared/src/types.ts` (E), `apps/api/src/types.ts` (E) | No endpoints. New types: `EscalationDto` (extends `Escalation` + label/display fields), `MessageDeliveryStatus`, `MessageRowDto`, `MessagesListResponse`, `MessagingConfigStatusDto`, `DashboardMessagingStatusResponse`. Nothing consumed yet → no compile breakage. |
| T20 | P1 | Escalations read API (wire contract: types + service + route replaced) | `packages/shared/src/types.ts` (E: `EscalationListResponse.escalations` → `EscalationDto[]`), `apps/api/src/services/escalation-service.ts` (E: `getEscalations`), `apps/api/src/routes/dashboard/escalations.ts` (**rewrite, mock deleted**), `apps/api/src/services/escalation-service.test.ts` (N), `apps/api/src/routes/dashboard/escalations.test.ts` (N) | `GET /api/dashboard/escalations?status=&page=&pageSize=` — org-scoped (customers + staff phones), optional `status ∈ {pending,resolved}` else `400 invalid_query`, page≥1, pageSize 1..100 (defaults 1/20), pending-first then `created_at desc`, responds `EscalationListResponse` with `EscalationDto[]` + `total`. |
| T21 | P1 | Outbound ledger read (service + DTO mapping) | `apps/api/src/services/outbound-ledger.ts` (E: `getOutboundMessages` + `formatRelativeDisplay` + label maps), `apps/api/src/services/outbound-ledger.test.ts` (N) | No endpoint. `getOutboundMessages(orgId, {channel?, status?, page?, pageSize?, timezone}) → Promise<{messages: MessageRowDto[]; total: number}>` — org filter, optional channel/status, `created_at desc`, DTO mapped with `kindLabel`/`statusLabel`/`createdAtDisplay`. |
| T22 | P1 | Messages route | `apps/api/src/routes/dashboard/messages.ts` (N), `apps/api/src/routes/dashboard/index.ts` (E: mount + comment), `apps/api/src/routes/dashboard/messages.test.ts` (N) | `GET /api/dashboard/messages?channel=&status=&page=&pageSize=` — org-scoped, `channel ∈ {sms,whatsapp}` else `400 invalid_query`, `status ∈` the 7 `MessageDeliveryStatus` values else `400 invalid_query`, newest first, responds `MessagesListResponse`. |
| T23 | P1 | Web: Escalations page | `apps/web/lib/types.ts` (E: `EscalationItem`), `apps/web/lib/dashboard-api.ts` (E: `getEscalations`), `apps/web/components/dashboard/escalations-list.tsx` (N), `apps/web/app/dashboard/escalations/page.tsx` (N), `apps/web/components/dashboard/nav-rail.tsx` (E: primary nav entry) | Consumes: `GET /api/dashboard/escalations` via `getEscalations()`. Page: PageHeader + `CustomersSkeleton` + `ErrorState(onRetry)` + `EmptyState` + list with type chip (`typeLabel`), status pill (pending→danger live, resolved→success), phone, content, `createdAtDisplay`. |
| T24 | P1 | Web: Messages page | `apps/web/lib/types.ts` (E: `MessageRow`), `apps/web/lib/dashboard-api.ts` (E: `getMessages`), `apps/web/components/dashboard/messages-list.tsx` (N), `apps/web/app/dashboard/messages/page.tsx` (N), `apps/web/components/dashboard/nav-rail.tsx` (E: secondary nav entry) | Consumes: `GET /api/dashboard/messages` via `getMessages()`. Table: To, body (truncated), channel chip (SMS/WhatsApp, muted), `kindLabel`, status pill per tone map, `errorCode` mono for failed/escalated, `createdAtDisplay`. |
| T25 | P2 | Customers consent read model | `packages/shared/src/types.ts` (E: `CustomerDto` + `phoneVerifiedAt`/`whatsappOptedIn`), `apps/api/src/services/dashboard-service.ts` (E: `getCustomers` select + map), `apps/api/src/services/dashboard-service.test.ts` (E: pg-mocked `getCustomers` describe) | `GET /api/dashboard/customers` unchanged shape; each `CustomerDto` gains `phoneVerifiedAt: IsoString | null`, `whatsappOptedIn: boolean`. |
| T26 | P2 | Web: Customers consent chips | `apps/web/lib/types.ts` (E: `Customer` mirror + 2 fields), `apps/web/components/dashboard/customers-list.tsx` (E: chips) | Consumes existing `GET /api/dashboard/customers`. Row shows `Chip success "WhatsApp"` when `whatsappOptedIn`, `Chip muted "Verified"` when `phoneVerifiedAt`. No toggle, no mutation. |
| T27 | P2 | Settings messaging status route | `apps/api/src/routes/dashboard/settings.ts` (E: GET `/messaging`), `apps/api/src/routes/dashboard/settings.test.ts` (E: `/messaging` describe) | `GET /api/dashboard/settings/messaging` → `{messaging: MessagingConfigStatusDto}` — env-derived booleans only (number configured, status-callback base configured, generic template configured, per-13-kind template map), `fallbackCountries` from `WHATSAPP_FALLBACK_COUNTRIES` (default `['+880']`). Never echoes values. |
| T28 | P2 | Web: WhatsApp messaging status card | `apps/web/lib/dashboard-api.ts` (E: `getMessagingStatus`), `apps/web/components/dashboard/whatsapp-messaging-card.tsx` (N), `apps/web/components/dashboard/settings-panel.tsx` (E: render card in Column 1) | Consumes `GET /api/dashboard/settings/messaging`. Read-only card: Configured/Not-configured chips, fallback countries list, "N of 13 kinds", env-config hint. No PATCH anywhere. |

## Verification strategy

**Every API task** (`T19, T20, T21, T22, T25, T27`) — the full gate:
```
npm run typecheck --workspace=apps/api
npx vitest run --testTimeout=60000   # from apps/api (cwd)
npm run build --workspace=apps/api
```
The existing 507 API tests must stay green (baseline; new tests add on top). T19 additionally runs `npm run build --workspace=apps/web` (validates the shared edit under the web tsconfig).
**Every web task** (`T23, T24, T26, T28`) — `npm run build --workspace=apps/web` (Next 14 build type-checks pages). The `⚠ Found lockfile missing swc dependencies` warning is cosmetic (see CLAUDE.md) — ignore.

Each brief's Verify section names its new test file and the exact behaviors the tests must assert.

## Dependencies / ordering
Strict linear execution — **backend routes before their frontend pages**:
- `T19` → `T20` (needs T19 types) → `T21` (needs T19) → `T22` (needs T19 + T21) → `T23` (needs T20 API) → `T24` (needs T22 API) → `T25` (bundles its own `CustomerDto` change; needs T19 untouched elsewhere) → `T26` (needs T25) → `T27` (needs T19) → `T28` (needs T27).
- `T23` must not land before `T20` (the page calls the DB-backed route); `T24` not before `T22`; `T26` not before `T25`; `T28` not before `T27`.
- `T20` must not be split: the `EscalationListResponse` type change, the service, and the mock-route replacement are one wire contract — reordering leaves `npm run typecheck` red.

## Risks / gotchas
1. **Mock route must be REPLACED, not patched.** `apps/api/src/routes/dashboard/escalations.ts` loses its `__VG_UUID_*` fixtures, `StoredEscalation`, `paginate`, and in-memory filtering entirely. No fixture fallback path. Two new fixture-free consumers replace it: the service (SQL) + route (DB reads).
2. **`rl_escalations` has no `organization_id`.** Org scope is a phone predicate: `EXISTS (rl_customers by org+phone) OR EXISTS (rl_tradespeople ⋈ rl_organization_members by org+phone)`. The second arm is what makes `staff_sms` (T16) rows surface. Cross-org phone collisions show an escalation in both orgs; phone `'unknown'` rows (malformed-payload `processing_error`) show in none — both accepted.
3. **Type-change bundling (see Decisions 3).** Do not move the `EscalationListResponse`/`CustomerDto` edits into T19 — they would break the old route / `getCustomers` compile until their producer tasks land. The briefs pin exact placement.
4. **T18 surfaces stay read-only.** `outbound-ledger.ts` gains only `getOutboundMessages`; do not touch `insertOutbound`/`markSent`/`markFailed`/`markStatus`/`getByMessageSid`, `TERMINAL_STATUSES`, `twilio-status.ts`, or `fallback-service.ts`. `OutboundStatus` keeps its name in the ledger; the wire uses the new shared `MessageDeliveryStatus` (identical literal set, cast at the DTO boundary).
5. **No secrets across the wire.** `settings/messaging` emits booleans + country codes only. Never emit `TWILIO_*` values, SIDs, or `API_BASE_URL` itself.
6. **No mutating endpoints in this plan.** No resolve, no opt-in/opt-out PATCH, no messaging PATCH. Implementers seeing "resolve" or "toggle" scope-creep must stop and report.
7. **Conventions that must hold:** DTOs live only in `@tradescheduler/shared`; web mirrors are plain interfaces in `apps/web/lib/types.ts` (structural typing bridges them). No shadcn in `apps/web` (self-contained RidgeLine DS — chips, cards, `field`, `btn`, `metric-card-rise` classes only). No `npm install`. No commits (controller commits after review).
8. **Known adjacent gap (out of scope):** inbox `CHANNEL_LABEL` (`dashboard-service.ts:560`) lacks `whatsapp`, so a WhatsApp conversation renders raw `whatsapp` in the AI Inbox. Cosmetic, pre-existing, not touched here.

## What this unlocks
- **Real escalations are visible** — including the T16 `staff_sms` operator flow and `customer_escalation`, with correct labels and pending-first triage order; the mock is dead.
- **Delivery transparency** — every outbound message with its SMS/WhatsApp channel, kind, and live delivery state; WhatsApp fallback outcomes (`retried`/`escalated`/`blocked_optin`) and Twilio `error_code` become observable, so T18's engine can be audited from the UI.
- **Consent at a glance** — Customers rows show who verified their phone and who opted into WhatsApp, read-only.
- **Phase-A readiness check** — Settings shows whether the WhatsApp number, status-callback base URL, generic template, and each kind's template are configured, without exposing any secret.
- **Follow-on work this makes cheap**: a resolve action (POST mark-resolved) on the same route+service+page, pending-escalation badge in the nav rail (replacing inbox's hardcoded `badge: 3`), opt-in/out management UI, and a settings PATCH once config leaves env.