# T13 — Deliver queued outbound replies (worker outbound_sms handler)

## Goal
Close the reply-delivery gap: a dashboard reply/approve creates a `queued`
outbound `rl_messages` row but **no SMS is ever sent** — the worker only
handles `inbound_sms`. Build the delivery path with the EXISTING job-queue
pattern (enqueue → dequeue → complete/fail) and the EXISTING `sendSms` primitive.

## Verified facts (controller investigation — do not re-derive)
- `apps/api/src/services/inbox-service.ts:123` `enqueueOutboundReply()` inserts
  `(conversation_id, provider='manual', direction='outbound', body, status='queued')`
  and returns void — no job enqueued, INSERT has no `returning id`.
- `apps/api/src/worker/index.ts:14` handler map = `{ inbound_sms: processInboundSms }` only.
- `apps/api/src/services/sms-service.ts` `sendSms({to, from?, body})` exists,
  env-free boot, `TWILIO_SMS_DRY_RUN=true` dev dry-run, returns `{messageSid, status}`
  (used by reschedule flow).
- `queue-service.ts`: `enqueue({type, payload})` → rl_jobs; worker dequeue →
  handler → `complete(job.id)` / `fail(job.id, err)`; failed jobs keep `attempts`.
- `rl_messages` columns: id, conversation_id (FK rl_conversations), provider
  ('twilio'|'manual'), provider_message_id (nullable — Twilio SID goes here),
  direction, body (nullable), status check ('queued','sent','delivered','failed','received').
- rl_conversations has customer_id FK → rl_customers.phone (the end-user number).

## Files to change
1. `apps/api/src/services/inbox-service.ts` — enqueueOutboundReply also enqueues
   an `outbound_sms` job carrying the message id.
2. `apps/api/src/worker/process-outbound-sms.ts` — NEW handler (register in index.ts).
3. `apps/api/src/worker/index.ts` — add `outbound_sms` to handlers map.
4. Tests: new `apps/api/src/worker/process-outbound-sms.test.ts`; extend
   `apps/api/src/services/inbox-service.test.ts`.

## Exact requirements

### A. inbox-service.enqueueOutboundReply — enqueue the job
Change the INSERT to `returning id`, then `await enqueue({ type: 'outbound_sms', payload: { messageId } })`.
- Import `enqueue` from `./queue-service.js`.
- Keep the org-guard EXISTS. Keep signature + behavior (still returns void).
- If enqueue fails AFTER the row insert: log and swallow is NOT acceptable —
  rethrow is acceptable (route returns 500, no orphan row) — but note the
  pragmatics: a posted reply queued as a row without a job is the current bug;
  prefer a small transaction? KEEP SIMPLE: insert row → enqueue job; on enqueue
  error, rethrow (500; client retries → INSERT again → duplicate row risk is
  pre-existing behavior, not this ticket's scope). Do NOT start a transaction.

### B. worker/process-outbound-sms.ts (new)
```ts
/** Handler for `type = 'outbound_sms'`: deliver a queued manual outbound reply. */
export async function processOutboundSms(job: QueueJob): Promise<void> {
  const { messageId } = job.payload as { messageId?: string };
  if (!messageId) throw new Error('outbound_sms job missing messageId');
  // load message + conversation org + customer phone in ONE query:
  //   m.id, m.body, m.status, cu.phone
  //   from rl_messages m
  //   join rl_conversations c on c.id = m.conversation_id
  //   join rl_customers cu on cu.id = c.customer_id
  //   where m.id = $1 and m.direction='outbound' and m.status='queued'
  // - not found → throw (job fails; visible in rl_jobs)
  // - call sendSms({ to: phone, body })
  // - on success: update rl_messages set status='sent', provider_message_id=$sid
  //   -> if the UPDATE fails, log + rethrow (job fails; message row still queued = retryable)
  // - on sendSms throw: update status='failed' then rethrow (job fails; failed row visible)
}
```
- Table helpers: reuse the env-override helper pattern (`MESSAGES_TABLE` etc.)
  as in inbox-service.ts — OR simpler: hardcode public.rl_messages / rl_conversations /
  rl_customers matching existing migrations. Prefer consistency with inbox-service
  (env-override helpers) — your call, keep minimal.
- Lazy pool singleton, env-free boot (same as every service).

### C. worker/index.ts
`handlers = { inbound_sms: processInboundSms, outbound_sms: processOutboundSms }` + import.

### D. Tests
- `process-outbound-sms.test.ts` (mirror process-inbound-sms.test.ts harness —
  loadWorker pattern, mock sms-service sendSms, mock pg pool):
  1. happy path: queued message → sendSms called with customer phone + body →
     UPDATE to 'sent' with the SID; complete() called.
  2. sendSms rejects → message row updated to 'failed', error rethrown (job fails).
  3. message not found / not queued (e.g. already sent) → throws.
- `inbox-service.test.ts`: extend enqueueOutboundReply test — assert `enqueue`
  ALSO called with `{ type: 'outbound_sms', payload: { messageId: <returned id> } }`.

## Out of scope
- No Twilio provider_message_id webhook/status-callback handling (delivered etc.).
- No retry/backoff policy beyond the queue's existing attempts field.
- No web changes; no route changes; no schema migration.
- Do NOT touch process-inbound-sms.ts, T12 (parked), or render.yaml.

## Verify (in order, workdir H:\tradescheduling)
1. `npm test --workspace=apps/api` — full suite green (re-run flaky files in isolation).
2. `npm run typecheck --workspace=apps/api` — no NEW errors (pre-existing ones ok, list them).
3. `npm run build --workspace=apps/api` — green.
4. Live smoke (optional, needs .env creds): TWILIO_SMS_DRY_RUN=true, enqueue a real
   reply against the local DB, run the worker once, verify row → 'sent' + job completed.
   If env restrictions block this, state exactly what you verified instead.

## Report
Per-file diff summary, test/build tails, confirmation that a failed Twilio send
leaves `status='failed'` (never stuck 'queued' silently), any surprises. Do NOT commit.
