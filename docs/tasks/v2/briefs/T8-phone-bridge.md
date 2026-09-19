# T8 — conversation-states phone-bridge fix (dashboard queries)

## Why
`rl_conversation_states.conversation_id` is a nullable FK added in migration 007 but
**never populated** — the writer (`apps/api/src/services/conversation-service.ts:86`)
inserts only `phone, user_id, booking_id, state, offered_slots, escalation_reason`.
Every dashboard query bridges states→conversations on `s.conversation_id = c.id`,
so they match nothing: booking-rate/outcomes/aiBookingRateByDay return 0/empty and
inbox never shows `offered_slots`/state. On a fresh bootstrap DB the column exists
but stays NULL forever — the join must not depend on it.

## Fix (all in apps/api/src/services/dashboard-service.ts)
Bridge by the two real keys: `phone` (display/suggestion semantics) and membership
(aggregate scoping — org owns the state through `rl_organization_members`).

1. **Aggregate states scoping (org)** — booking-rate total/completed (summary metric
   4, ~L276-296) and aiBookingRateByDay (~L839-848): replace the
   `join conversations c on c.id = s.conversation_id where c.organization_id = $1`
   pattern with org-membership scoping on `s.user_id`:
   `where s.user_id in (select user_id from public.rl_organization_members where organization_id = $1)`
   — same params, same row shape, no conversation join.

2. **Outcomes booked/escalated (~L786-791)** — same membership scoping as #1.

3. **Outcomes dropped (~L792-796)** — currently `not exists (select 1 from states s
   where s.conversation_id = c.id and s.state = 'completed')`. Bridge by phone:
   `not exists (select 1 from ...states s join ...customers cu on cu.phone = s.phone and cu.id = c.customer_id where s.state = 'completed')`
   (outer query already has conversation `c`; its customer is `c.customer_id`).

4. **Inbox `st` lateral (~L582-587)** — currently `where s.conversation_id = c.id`.
   Bridge by phone: `where s.phone = cu.phone` (`cu` is the conversation's customer,
   already joined in the outer query). Keep `order by s.created_at desc limit 1`.

Rules: schema-portable (no dependence on `conversation_id`), keep the
`${conversationStatesTable()}/${customersTable()}/${conversationsTable()}/...`
table-name helpers, org-scoping on every read, no behavior change to row shapes.

## Acceptance
- `npm run typecheck --workspace=@tradescheduler/api` clean; full API test suite
  green (baseline 309/309 warm; pre-existing cold-run flakes in
  process-inbound-sms/google-auth are known and not yours).
- No new service unit test required IF none exists for dashboard-service today
  (confirmed: no dashboard-service.test.ts); the LIVE matrix below is the gate.
- **Live verification** against :3001 (kill stale tsx on 3001 first, boot fresh
  `npx tsx src/index.ts`, GET /api/health; throwaway creds in
  docs/tasks/v2/reports/T2-T3-dashboard-api.md "Test data" + T7 report final creds):
  a. Record baseline: before seeding, `summary` + `analytics` + `inbox` responses
     for the throwaway org (expect all-zero/empty as today).
  b. Seed (SQL via repo `.env` pooler connection, same style as T2/T3 report):
     one `rl_conversation_states` row `state='completed'` with a phone matching an
     existing org customer (or create the customer first, org-scoped) + `user_id`
     = a member of the throwaway org; a second row `state='escalated'` same phone;
     a third row with a phone NOT in any org customer (isolation probe).
  c. Assert: summary aiBookingRate counts 1 completed / 2 total; analytics
     outcomes booked=1 escalated=1 dropped=0; aiBookingRateByDay > 0 for today;
     inbox row for that customer carries `offered_slots`/`state` from the latest
     state; the third row is NOT counted anywhere (org isolation via membership).
  d. Cleanup: delete the seeded states (+ any customer/conversation rows you
     created); re-run a-e to confirm back to baseline.
- Do NOT commit (controller handles git). Report:
  docs/tasks/v2/reports/T8-phone-bridge.md with the full matrix + exact SQL used.

Optional (low priority, skip if pattern is unclear): a unit test mirroring
conversation-domain.test.ts mocking to lock the membership-scoping SQL shape.
