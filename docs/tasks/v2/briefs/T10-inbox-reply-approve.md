# T10 — real inbox reply/approve (API + web)

## Why
Inbox "Send reply"/"Approve" buttons only fire a toast (`resolve()` in
apps/web/components/dashboard/inbox-row.tsx). The API GET-only.
Schema: rl_messages supports outbound rows (provider manual/twilio, direction,
body, status incl 'queued'); conversation status 'open'|'closed' → closes make
inbox items 'handled' (dashboard-service ~L601: closed → handled).
DO NOT send real SMS in dev — create the queued outbound row only (worker/SMS
service delivers later; matches queue-service pattern).

## API (wired)
New routes in apps/api/src/routes/dashboard/ (mount in routes/dashboard/index.ts):
1. `POST /api/dashboard/inbox/:conversationId/reply` body `{body: string}`
   - body required, trimmed 1..2000 chars else 400 `invalid_body`
   - requireAuth + orgContext (403 `no_organization`) + conversation must belong to org (404 `conversation_not_found` if missing OR not this org's)
   - insert rl_messages: conversation_id, provider 'manual', direction 'outbound', body, status 'queued'
   - close the conversation: status 'closed', closed_at now() (row becomes 'handled' on next fetch)
   - 200 `{ok: true}` (extend DashboardApiErrorResponse usage — follow dashboard route error style)
2. `POST /api/dashboard/inbox/:conversationId/approve` body `{}`
   - same auth/ownership checks
   - server derives the suggestion body with the SAME logic as getInboxItems (~L600-613):
     last outbound body → else latest state's offered_slots top-2 times
     ("Offer slots: …") → else escalation_reason → else 400 `no_suggestion`
   - same insert+close; 200 `{ok: true}`
- New service helpers (extend conversation-service.ts or a small inbox-service.ts):
  enqueueOutboundReply(conversationId, body, orgId) + closeConversation(id, orgId)
  (org-scoped UPDATE … WHERE id AND organization_id — check via conversation row).
- Tests mirroring route/service test style (see routes/dashboard/analytics tests if
  any exist, else auth.test.ts style): happy, 400 no-body/too-long, 404 unknown/other-org, 403 no-org, 401.
- packages/shared: add `export interface InboxActionResponse { ok: true; }`? ONLY if
  nothing suitable exists (check DashboardApiErrorResponse pattern; reuse if fine).

## Web (forge)
apps/web/components/dashboard/inbox-row.tsx + ai-inbox-list.tsx + lib/dashboard-api.ts:
- lib/dashboard-api.ts: `replyToInboxItem(conversationId, body)` +
  `approveInboxItem(conversationId)` using authedFetch (NO_ORGANIZATION/SESSION_EXPIRED
  sentinels like the rest).
- inbox-row.tsx: "Send reply" → POST reply with textarea value; "Approve" → POST
  approve (no body). Keep `busy` disabling both. On success: toast
  "Reply sent to {name}" / "Approved: {name}" and flip the row to handled locally
  (the component's own state that renders the ✓ Approved phase — do NOT refetch the
  whole list). On error: error toast, row stays editable.
- Since this brief and T11 both touch lib/dashboard-api.ts + settings — YOU OWN
  the full wave's web files in this dispatch (T10+T11 together): dashboard-api.ts,
  inbox-row.tsx, settings-panel.tsx, toggle-list.tsx.

## Acceptance
- API: typecheck + suite green; live: with a seeded conversation in the throwaway
  org (seed org-scoped customer + conversation + inbound message first), POST reply →
  rl_messages row status 'queued' + conv closed; approve → suggestion row; 404/400/401 live.
- Web: build green (npm run build --workspace=apps/web), session tests 11/11,
  dev walk :3000 against :3001: type a reply → send → toast + row handled; approve → same.
- Sandbox note: if :3001 has no conversation seeded (T9/T10 API agent seeded then
  cleaned up), seed one yourself via SQL (same style) for the walk, then clean.
- Do NOT commit. Report: docs/tasks/v2/reports/T10-inbox-reply-approve.md (both API and web verification).
