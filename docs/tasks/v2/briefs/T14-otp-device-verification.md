# T14 — OTP device trust (first-contact phone verification)

## Goal
Today any phone number that texts the org's Twilio number is trusted on first
message: `findOrCreateCustomer` creates a row and the worker classifies + replies
immediately. Add a **one-time verification code** gate: a new customer must prove
control of the From number once (reply with a 6-digit code sent to that number)
before the worker runs classify/responds. Verified state persists on the customer
row, so subsequent texts skip the gate.

## Verified facts (controller investigation — do not re-derive)
- `apps/api/src/db/migrations/007` `rl_customers`: id, organization_id, name, phone
  (E.164 check, unique per org), email, created_at, updated_at. **No verified flag,
  no code columns.**
- `apps/api/src/services/conversation-domain.ts:197` `findOrCreateCustomer(orgId, phone)`
  — upsert, returns the (possibly brand-new) row. Called from
  `apps/api/src/worker/process-inbound-sms.ts` AFTER org resolution.
- `apps/api/src/worker/process-inbound-sms.ts:110` `classifyStep(...)` then
  `switch (result.intentResult.intent)` (line 147): reschedule / slot-choice /
  confirm / help / default-escalate cases. `escalateAmbiguousIntent` is guarded by
  `result.source !== 'escalation'`.
- `apps/api/src/services/sms-service.ts` `sendSms({to, from?, body})` →
  `{messageSid, status}`; dev dry-run on `TWILIO_SMS_DRY_RUN=true`. Used by all
  existing SMS flows (help/confirm/offers).
- `apps/api/src/services/queue-service.ts`: job lifecycle enqueue → dequeue →
  handler → complete/fail. Handler map at `worker/index.ts:14`.
- Migrations live at `apps/api/src/db/migrations/NNN-*.sql`, next number 010.
- No existing OTP/code primitive anywhere in the codebase.

## Files to change
1. `apps/api/src/db/migrations/010-customer-verification.sql` — NEW.
2. `apps/api/src/services/verification-service.ts` — NEW (issue/verify codes).
3. `apps/api/src/worker/process-inbound-sms.ts` — add the verification gate.
4. Tests: `apps/api/src/services/verification-service.test.ts` (NEW) + extend
   `apps/api/src/worker/process-inbound-sms.test.ts`.

## Exact requirements

### A. Migration 010 — rl_customers verification columns
```sql
alter table public.rl_customers
  add column if not exists phone_verified_at timestamptz,        -- null = not verified
  add column if not exists verification_code text,               -- pending code (null = none)
  add column if not exists verification_code_expires_at timestamptz,
  add column if not exists verification_attempts int not null default 0;
```
Idempotent (`add column if not exists`), no data backfill needed (all existing
rows start unverified → they'll be asked to verify on next text; acceptable for
this stage, note it in the report).

### B. verification-service.ts (new)
- `issueCode(): string` — crypto-random 6-digit numeric (`crypto` module, NOT
  Math.random). `verifyCode(expected, input)` — constant-time compare
  (`crypto.timingSafeEqual` on same-length strings), returns boolean.
- `UPSERT_COLUMNS` note: the service only generates/compares codes; persistence
  lives in the worker (keeps this service pure + unit-testable).

### C. worker gate (process-inbound-sms.ts)
Insert BETWEEN `findOrCreateCustomer` and the classify block; keep appendMessage
of the inbound as-is (every message is still recorded):
1. If `customer.phone_verified_at` is set → skip gate entirely (zero behavior
   change for verified customers).
2. Else: if `customer.verification_code` is null OR expired → issue a fresh
   code, `update rl_customers set verification_code=$code,
   verification_code_expires_at=now()+interval '10 minutes' where id=$id`,
   `sendSms({to: customerPhone, body: 'Your verification code is <code>. Reply
   with it to continue.'})`, `complete(job)` — NO classify, NO replies.
3. Else (code pending) → compare `body` (trimmed) against stored code:
   - MATCH → `update ... set phone_verified_at=now(), verification_code=null,
     verification_code_expires_at=null, verification_attempts=0`, send a short
     confirm SMS ("Number verified!"), then **fall through to the existing
     classify/dispatch flow for THIS message**.
   - MISMATCH → increment verification_attempts; if attempts < 3 → send
     "That doesn't match — try again." and complete (no classify). If attempts
     >= 3 → reset code to a NEW code + send fresh code SMS (lockout via
     re-issue, not hard block; simplest correct behavior for this stage).
- Escalation: never escalate failed verification to rl_jobs/escalations — the
  SMS re-issue loop IS the retry path (keep it silent and self-contained).

### D. Tests
- verification-service.test.ts: issueCode → 6-digit numeric, distinct across
  calls; verifyCode true/false, constant-time path doesn't throw.
- process-inbound-sms.test.ts (extend, mirror existing harness):
  - unverified + no code → sendSms called with code body, job completed, classify
    NOT called.
  - unverified + expired code → re-issued.
  - unverified + correct code → verified flag persisted, classify called for the
    same message.
  - unverified + wrong code x3 → fresh code re-issued, classify never called.
  - verified customer → gate skipped, classify called normally.

## Out of scope
- No dashboard UI for verification status (customer list shows nothing new yet).
- No Twilio Verify API integration (self-issued codes, server-side compare).
- No rate-limit/backoff beyond the 3-attempt re-issue loop.
- Do NOT touch T15 (confirm-by-code) or T16 (staff-phone) — separate tickets.

## Verify (in order, workdir H:\tradescheduling)
1. `npm test --workspace=apps/api` — full suite green.
2. `npm run typecheck --workspace=apps/api` — no NEW errors.
3. `npm run build --workspace=apps/api` — green.
4. Optional live smoke: TWILIO_SMS_DRY_RUN=true, enqueue an inbound_sms job for
   an unverified phone, run the worker once, assert: code SMS "sent" (dry-run
   log), customer row has verification_code + expires_at. Then enqueue the code
   as the next message → assert verified + classify ran.

## Report
Per-file diff summary; the exact gate placement (line refs); test tails;
how existing unverified customers are treated on first post-migration text.
Do NOT commit.
