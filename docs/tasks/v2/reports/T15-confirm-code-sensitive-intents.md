# T15 — Confirm-by-code for sensitive intents (report)

## Status
DONE (implemented in working tree together with T14; nothing committed).

## Files changed
- `apps/api/src/db/migrations/011-confirmation-codes.sql` — NEW (untracked).
- `packages/shared/src/types.ts` — +1 state value `awaiting_confirmation_code` +
  3 conversation-state fields (confirmationCodeHash, confirmationCodeExpiresAt,
  confirmationAttempts).
- `apps/api/src/services/conversation-service.ts` — added the 3 confirmation
  columns to ConversationRow, toState mapping, and the RETURNING/select columns
  of createConversation, getConversation, getConversationByPhone,
  updateConversation (same pattern as T14's conversation-domain fix; without it
  the code columns would read as undefined at runtime).
- `apps/api/src/services/verification-service.ts` — extended (not forked):
  `issueFlowCode()` (6-digit code + sha256 hash), `verifyFlowCode()` (constant-time
  hash compare), `sha256Hex()`.
- `apps/api/src/worker/process-inbound-sms.ts` — T15 handshake added:
  - Pre-classify branch (`:135`): while conversation state is
    `awaiting_confirmation_code`, the next message IS the code; verified →
    `performConfirmation`; every other outcome completes with SMS (re-ask /
    fresh code). A 6-digit code reply is NEVER routed through classify or
    escalated as an intent.
  - `handleConfirmIntent` (`:312`) re-routes via `runConfirmCodeGate`; outcomes
    'code-issued' | 'retry' | 'reissued' → stop (no mutation); 'not-applicable'
    (conversation not at a confirmation step) → pre-T15 dead-end preserved.
  - `runConfirmCodeGate` (`:619`): pending check on hash+TTL; mismatch counter
    with 3-attempt cap → re-issue fresh code (same lockout semantics as T14).
  - `issueFlowCodeAndSend` (`:679`): persists ONLY the sha256 hash — plaintext
    code exists only in the outbound SMS.
- `apps/api/src/services/reschedule-service.ts` — defensive fail-closed guard
  (`:294`): conversation still `awaiting_confirmation_code` OR carrying a pending
  `confirmationCodeHash` → `{ success: false, error: 'confirmation_required' }`;
  the calendar mutation can never run without a verified code.
- `apps/api/scripts/local-db.mjs` — 011 wired into MIGRATIONS.
- Tests: `process-inbound-sms.test.ts` (+T15 gate describe block,
  incl. mid-navigation regression at :896), `reschedule-service.test.ts`
  (+2 fail-closed cases), `verification-service.test.ts` (+3 flow-code cases).

## Gate placement relative to confirmReschedule
- Worker: handshake verifies + `clearFlowCode()` restores state to
  `awaiting_slot_choice` + clears hash/TTL/attempts, THEN calls
  `performConfirmation` → `confirmReschedule` (`process-inbound-sms.ts:135-143`,
  `:766` test asserts mutation exactly once).
- Service guard: `reschedule-service.ts:294` — defense-in-depth if any path
  reaches the mutation with the handshake still pending.

## State-machine transitions
- `awaiting_slot_choice` + CONFIRM text → `awaiting_confirmation_code`
  (code hash + 10-min TTL persisted, code SMS sent). NO mutation.
- `awaiting_confirmation_code` + correct code → back to `awaiting_slot_choice`
  (fields cleared) → mutation runs once → `completed` (existing flow).
- `awaiting_confirmation_code` + wrong code (<3) → stays, re-ask SMS.
- `awaiting_confirmation_code` + wrong code (3rd) → fresh code re-issued
  (hash replaced, attempts reset to 0).
- Mid-navigation (`offering_slots`, no pending) → 'not-applicable': no code
  issued, pre-T15 dead-end preserved (regression test at :896).
- CHECK widened in migration 011; existing rows unaffected (values still valid
  under the widened constraint, no backfill needed).

## Test/build tails
- `npm test --workspace=apps/api`: 391/391 passed, 23 files — green (one
  transient cold-load flake observed once on a pre-existing test, re-run green;
  same flake class reproduced by T14 work on pristine files — NOT introduced by
  this ticket).
- T15-specific: worker gate tests (6 scenarios incl. mid-navigation regression),
  reschedule fail-closed (2), verification flow-code service (3) — all pass.
- `npm run typecheck --workspace=apps/api`: clean. `npm run build
  --workspace=apps/api`: clean.
- Live smoke NOT run (migration application to the live Supabase pooler DB is
  controller-owned and happens at commit/deploy time); control-flow + SQL
  assertions cover the handshake end-to-end.

## Notes / surprises
- The brief's `confirmation_code text` column is written by migration 011 but
  never used by the worker (hash-only is the security rule); the column exists
  per brief for potential debugging/escape hatch and is cleared by
  `clearFlowCode`.
- T14's gate and T15's handshake coexist: T14 verifies the DEVICE (customer
  row), T15 verifies the ACTION (conversation state). A verified device flowing
  through the confirm path is subject only to the flow handshake.

## Do NOT commit
Changes are left in the working tree for the controller to commit with T14.
