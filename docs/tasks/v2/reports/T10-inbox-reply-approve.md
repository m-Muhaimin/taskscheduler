# T10 — Inbox reply + approve: real API endpoints — Report

Date: 2026-09-19 · Agent: wired (backend/API) · Brief: `docs/tasks/v2/briefs/T10-inbox-reply-approve.md` · API scope only (apps/api + packages/shared; apps/web is forge's)

## What was shipped

- **NEW `apps/api/src/services/inbox-service.ts`** (service layer):
  - `getInboxConversation(orgId, conversationId)` — one SELECT with lateral subqueries: latest inbound message, latest outbound message (ordered by `created_at`, ties broken by `id`), offer slots + selected slot from `rl_conversation_states` (bridged through `customers.phone`, per the T2-T3 bridge note), escalation reason. Returns `EligibleInboxConversation | RuleEngineMessage | null`.
  - `deriveInboxSuggestion(conv)` → **moved here from dashboard-service? NO — exported from `dashboard-service.ts`** and used by both (see deviation #1): resolve outbound body → offered slots (`"Offer slots: Mon 9:00, Tue 1:30"`) → escalation reason; `''` when nothing derivable.
  - `enqueueOutboundReply(orgId, conversationId, body)` — **no real SMS (dev rule)**: inserts into `rl_messages` (`provider='manual'`, `direction='outbound'`, `status='queued'`, `sent_at=null`) guarded by `where exists (… org match)`. Returns `{ok: true} | null`.
  - `closeConversation(orgId, conversationId)` — `status='closed'`, `closed_at=now()`, `updated_at=now()`, org-guarded.
- **`routes/dashboard/inbox.ts`** — two POST handlers on the existing conversation id param: **`POST /api/dashboard/inbox/:conversationId/reply`** (`{body}` required string, trimmed, 1..2000 chars → else `400 invalid_body`) and **`POST /api/dashboard/inbox/:conversationId/approve`** (no body; derives suggestion). Both: 401 `missing_token` / `invalid_token` (shared `requireAuth`), 403 `no_organization`, 404 `conversation_not_found` (missing **or other org** — no row leakage across orgs), 400 `no_suggestion` (approve with empty derivation), 500 `server_error`. `resolveOrg` refactored into a local org-ctx helper (404 path needs orgId+userId). Express 5 `req.params` narrowing: `typeof conversationId !== 'string' || length === 0` → 400 (matches bookings route pattern).
- **`dashboard-service.ts`**: `deriveInboxSuggestion` exported as a pure function; `getInboxItems` keeps its existing suggestion fallback (same derivation) — one implementation, two call sites.
- **Tests**: NEW `inbox-actions.test.ts` (13: trimmed reply 200; missing/empty/whitespace body 400; 2000-char ok; 2001-char 400; approve 200; approve-no-derivation 400; other-org 404s; missing conv 404; 401/403; DB row assertions — exactly 2 queued manual outbound rows; conversation closed), NEW `inbox-service.test.ts` (7: eligible w/ outbound → suggestion, offered slots suggestion, escalation-reason fallback, empty derivation, enqueue row shape + org guard, closeConversation org guard + row effect), NEW `dashboard-service.test.ts` (6 pure `deriveInboxSuggestion` unit tests incl. `2026-09-14T13:00Z → 'Mon 9:00'`, `2026-09-15T17:30Z → 'Tue 1:30'`, fallbacks, empty).

## Verification

| # | Command | Result |
|---|---------|--------|
| 1 | `npm run typecheck --workspace=@tradescheduler/api` | clean |
| 2 | full suite | **354/356 pass** (21 files); 2 failures = **pre-existing worker flake** (see note) |
| 3 | live matrix (4 conversations, own/other org, real Bearer token) | **19/19 checks PASS** |

### Live matrix (before/after)

| Conv | State | Action | Before | After |
|---|---|---|---|---|
| K1 | own org, seeded outbound body | `approve` → `reply` | open | 200 both; **2 queued manual outbound rows** (approve-derived suggestion `We can fit you in Tuesday — reply Y to confirm.` + trimmed `Sure, Tuesday works.`); **status closed** |
| K1 (invalid bodies) | — | missing / empty / whitespace / 2001-char | — | all `400 {"error":"invalid_body"}` |
| K2 | **other org** | `reply` / `approve` | open | both `404 conversation_not_found`; other org got **0** queued rows; still open |
| K3 | own org, state `offering_slots` + 3 slots | `approve` | open | 200; exactly **1 queued row body `Offer slots: Mon 9:00, Tue 1:30`**; closed |
| K4 | own org, nothing derivable | `approve` | open | `400 no_suggestion`; 0 rows; still open |
| — | no token | any | — | `401 missing_token` |

Full output: `T10 PASS: all matrix cases + DB effects verified` (19 asserts).

### Cleanup proof
`rl_customers.phone like '+1555010%'` → 0 (customers, conversations, states, messages all 0). `t10-other-org` deleted. Settings resets on the verify org. Zero verification rows remain.

## Shared-types changes
`InboxActionResponse = { ok: true }`; `DashboardApiErrorResponse` code union extended with `'conversation_not_found' | 'no_suggestion'` (already had `invalid_body`).

## Deviations from the brief
1. **Suggestion derivation lives in `dashboard-service.ts`, not the new `inbox-service.ts`** — `getInboxItems` already had the identical fallback for the inbox list. Duplicating it in a second module would fork behavior. `inbox-service.ts` imports `deriveInboxSuggestion` from dashboard-service. Flag for review if cross-service import is unwanted; tests cover both call sites.
2. **`approve` derives from the LATEST outbound row** (`getInboxConversation` returns most recent). If a manual `reply` ran first, approve confirms *that* reply's body. Verified live; deliberate and consistent with "approve = confirm what the last outbound said".
3. **No SMS send** — dev rule honored; rows are `queued`/`manual`. Twilio dispatch remains a future worker job.
4. **`closeConversation` is called by approve only** — after a manual reply, the conversation stays open until approve (matches brief shape; flagged in case the brief expected reply to close).

## For Sentinel / Probe
- Security: org-guarded writes (`where exists`) + shared `requireAuth` on both new handlers; envelope-only error bodies.
- Flake note (matches T2-T3 report precedent): `process-inbound-sms.test.ts` fails 2 tests under full parallel load ("rejects a non-E.164 From" — 5s vitest timeout; "escalates when the Twilio number is not registered" — `createEscalation` called 2×). **Reproduced identically at clean HEAD** (`git stash push -u` → full suite 307/309, same 2). Isolated: 12/12 pass. Pre-existing, unrelated to T10.
- Probe: real Twilio dispatch and the `reply`-then-`approve` sequence on a *live-phone* conversation end-to-end (queued message consumed by a future worker).

## Commits
None — controller handles git.