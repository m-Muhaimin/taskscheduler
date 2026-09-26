# Task 5 — Final implementer report (extended scope)

**Date:** 2026-09-26
**Scope:** the last repairs for the SMS-only cleanup. Tasks 1–4 are done and
reviewed; this pass closed the two unowned files the plan never assigned plus
the review findings. No commit made (per instruction).

---

## 1. `twilio-webhooks.ts` — live regression: 500 instead of 400 INVALID_PHONE

**Diagnosis confirmed.** `normalizeChannelAddress` rejects by *throwing*
(`apps/api/src/services/phone-utils.ts:16-23` — empty-after-trim and
not-E.164 both `throw new Error(...)`). The route called it at
`twilio-webhooks.ts:33`, **outside** the `try` that starts at line 39, so the
throw escaped the async handler and Express 5 turned a client-supplied bad
number into a 500. The `INVALID_PHONE` 400 gate below it was unreachable.

**Fix** (`apps/api/src/routes/twilio-webhooks.ts:29-49`): the throw *is* the
gate, so it is now translated into the 400 at the point of the call.

```ts
let fromE164: string;
try {
  ({ e164: fromE164 } = normalizeChannelAddress(body.From as string));
} catch {
  res.status(400).json({ error: 'INVALID_PHONE' });
  return;
}
// Defense in depth: mirror of normalizeChannelAddress's own E.164 check, so a
// future leniency there can never let a malformed From reach the queue.
if (!/^\+?[1-9][0-9]{1,14}$/.test(fromE164)) { ... 400 ... }
```

- The E.164 regex gate is **kept**, now documented as a deliberate mirror
  rather than left as invisible dead code. It is provably redundant today
  (`normalizeChannelAddress` applies the identical pattern), so this is
  defence-in-depth, not a behaviour change.
- The C7 contract comment is **kept and strengthened** — it now says *why* the
  throw has to be caught here ("otherwise it escapes the async handler and the
  caller sees a 500 for what is a client-supplied bad number"). The "no
  customer row for a malformed phone number" guarantee is unchanged: every
  malformed `From` still returns before `enqueue` is reached.
- A well-formed `From` is unaffected: `twilio-webhooks.ts:59` still enqueues
  with `Channel: 'sms'`.

**Test** (`apps/api/src/routes/twilio-webhooks.test.ts`): the working tree had
**two byte-identical** `rejects a non-E.164 From with 400 INVALID_PHONE (before
enqueue)` tests (line 104 and line 155) — the second was a mechanical edit of
the deleted `whatsapp:not-a-phone` case, and both failed with
`expected 500 to be 400`. Rather than delete coverage, the duplicate at
**line 157** is now a *distinct* case: a whitespace-only `From` (`'   '`),
which clears the `REQUIRED_FIELDS` gate (length 3 > 0) and is rejected by the
*other* branch inside the normalizer (empty after trim, not not-E.164). Line
104's test gained the C7 rationale comment. The over-long 16-digit case is
untouched. Net: 3 malformed-`From` 400 tests, one per rejection reason, no
duplicates.

| case | `From` | rejection reason |
|---|---|---|
| line 104 | `not-a-phone` | not E.164 |
| line 157 | `'   '` (3 spaces) | empty after trim |
| line 168 | `+1555123456789012` | 16 digits > E.164 max 15 |

## 2. `conversation-domain.ts` — verified correct, **no change made**

The file was modified in the working tree by an unassigned hand, so I audited it
against the brief. It is already correct and complete:

- `Conversation.channel` is `'sms' | 'voice' | 'web'` — **not narrowed**
  (`conversation-domain.ts:68`). Matches 007's DB CHECK
  `('sms','voice','web')` (`supabase/schema.sql:411`) and the domain spec's
  voice/web requirement.
- `findOrCreateConversation`'s parameter is `'sms' | 'voice' | 'web'`
  (`:264`) and its runtime guard is
  `['sms', 'voice', 'web'].includes(channel)` (`:277`).
- **Zero** WhatsApp identifiers, handlers, prefixes, or references remain
  (`rg -i whatsapp apps/api/src/services/conversation-domain.ts` → no match).
  `appendMessage`'s non-voice body rule (`:355`) is channel-generic and
  untouched.

Nothing needed fixing; I changed nothing. Note this means the production
signature stayed `'sms' | 'voice' | 'web'` — which is what test repair #3 below
had to match.

## 3. `conversation-domain.test.ts` — four repairs

1. **TS2345 (the typecheck blocker).** Line 164 passed the literal `"carrier"`
   to a parameter typed `'sms' | 'voice' | 'web'`. Fixed with a **boundary cast
   on the argument only** (`conversation-domain.test.ts:165`):
   ```ts
   domain.findOrCreateConversation('cust-1', 'carrier' as unknown as 'sms' | 'voice' | 'web')
   ```
   The production signature was **not** widened.

   *Deviation from the brief, deliberate:* the brief suggested
   `import type { Channel }` and cast to `Channel`. `Channel` in
   `packages/shared/src/types.ts:13` is the **outbound** channel — literally
   `'sms'` — and `apps/api/src/types.ts:8` merely re-exports it. Casting to it
   would have produced a *different, misleading* type than the actual parameter.
   The inline `'sms' | 'voice' | 'web'` union matches the real signature
   exactly, which is what the prompt asked for ("cast the argument to the
   parameter type"). Typecheck is green.

2. **Tuple/params assertion.** `mocks.query.mock.calls[2]` is the `[sql, params]`
   tuple, so comparing it to the params array could never pass. Now
   `mocks.query.mock.calls[2][1]` (`conversation-domain.test.ts:154`).

3. **Unmocked DB in the invalid-channel test.** The test's leftover "valid call"
   (`findOrCreateConversation('cust-1', 'sms')`) ran with no query mock and
   dereferenced `undefined.rows` → wrapped as `DB_ERROR`, not `INVALID_CHANNEL`.
   The redundant valid call is **removed**; the one customer lookup the guard
   actually needs is mocked (`:160`). The `findOrCreateConversation` happy paths
   are already covered by the two tests above it, so no coverage was lost.

4. **WhatsApp test deleted.** `requires a body for whatsapp inbound ...` (old
   lines 207–214) is gone. Its SMS counterpart
   `rejects a missing body for SMS (non-voice) inbound (MISSING_BODY)` remains and
   covers the same `MISSING_BODY` path.

## 4. `dashboard/messages.test.ts:73` — residual `whatsapp` literal

Changed only that one line: `channel: 'whatsapp'` → `channel: 'sms'`, matching
the `?channel=sms` the test actually requests (the `it` title and the request
URL were already converted in the working tree). No other test touched; the
`vi.mock` block and the `400 invalid_query` probe of `channel=voice` are
unchanged.

## 5. `twilio-status.ts:3` — dead type import removed

`type OutboundLedgerRow` had no reference anywhere in the file (verified: the
only other identifier on the import line is `TERMINAL_STATUSES`, used at :49).
Removed. Import line is now
`import { getByMessageSid, markStatus, TERMINAL_STATUSES } from '../services/outbound-ledger.js';`

## 6. `twilio-status.test.ts:177` — the one missing behaviour lock

Added: **`a failed row is NOT terminal — a later genuine delivered report still
marks it delivered`**. It seeds `getByMessageSid` with
`ledgerRow({ status: 'failed', errorCode: '30007' })`, fires a signed
`delivered` callback, and asserts 200 plus exactly one
`markStatus('ledger-1', 'delivered')`.

This is the behaviour Task 1 had to preserve: `TERMINAL_STATUSES` is
`['delivered','retried','escalated']` (`outbound-ledger.ts:39-43`) — `failed`
is deliberately absent, so a genuine late `delivered` report must still land.
Nothing tested it before. The mirror case (`failed` **is** written, then stops)
is already covered by the `failed / undelivered → marks the ledger failed once
and stops` test at :154.

## 7. `supabase/schema.sql:601-602` — stale phase label

The `comment on table public.rl_outbound_messages` string carried
`(T17 Phase B + D: ...)` while the block header at :571 now says
`T17 Phase C`. Now reads
`'Ledger of outbound SMS messages (T17 Phase C: the Twilio StatusCallback reports on this table)'`.

**Comment-only.** No `create`/`alter`/`drop`/CHECK statement was touched; the
`channel in ('sms')` and the 7-value `status` CHECK at :604-612 are byte-identical
to before my edit. (The other `schema.sql` changes visible in `git diff` are
Task 2's, not mine.)

---

## Verification

```
$ npm run typecheck --workspace=apps/api
> tsc --noEmit
EXITCODE=0
```

No output, exit 0. *(First run reported one transient error —
`src/worker/process-inbound-sms.ts(528,10): Cannot find name 'MessagingKind'` —
captured while the concurrent owner of that file was mid-edit. On re-run it is
gone: the type is imported at `process-inbound-sms.ts:14`. I did not touch that
file.)*

```
$ npm run test --workspace=apps/api -- src/services/conversation-domain.test.ts \
    src/routes/twilio-webhooks.test.ts src/routes/twilio-status.test.ts \
    src/routes/dashboard/messages.test.ts

 ✓ src/services/conversation-domain.test.ts (11 tests) 122ms
 ✓ src/routes/dashboard/messages.test.ts (8 tests) 131ms
 ✓ src/routes/twilio-status.test.ts (11 tests) 732ms
 ✓ src/routes/twilio-webhooks.test.ts (9 tests) 756ms

 Test Files  4 passed (4)
      Tests  39 passed (39)
```

```
$ rg -i whatsapp apps packages supabase render.yaml .env.example
packages\shared\src\types.ts: *  SMS only — WhatsApp inbound has been removed. */
packages\shared\src\types.ts:  /** E.164 country codes (SMS only — no WhatsApp fallback). */
apps\api\src\services\phone-utils.test.ts:    expect(countryCodeFromE164('whatsapp:+8801712345678')).toBeNull();
apps\api\src\db\migrations\014-whatsapp-fallback.sql:-- ⚠ The filename still says "whatsapp" for historical reasons. It is kept so
apps\api\src\db\migrations\014-whatsapp-fallback.sql:--   supabase/schema.sql resolve. Nothing in this file is WhatsApp-related.
apps\api\scripts\db-migrate.mjs:  "014-whatsapp-fallback.sql",
supabase\schema.sql:--          migrations/014-whatsapp-fallback.sql. That file's name is historical
supabase\schema.sql:-- apps/api/src/db/migrations/014-whatsapp-fallback.sql)
```

All 8 hits are accounted for:

| hit | classification |
|---|---|
| `db-migrate.mjs:35`, `014-whatsapp-fallback.sql` ×2, `schema.sql` ×2 | the historical migration **filename / path references** (explicitly allowed) |
| `phone-utils.test.ts` | a **deliberate negative assertion** — a prefixed address must no longer resolve to a country code (Task 1's file; kept on purpose) |
| `packages/shared/src/types.ts` ×2 | see "reported, not fixed" below |

No identifier, env var, type member, SQL literal, or UI string survives.

---

## Reported, not fixed

1. **`packages/shared/src/types.ts` — 2 comment lines mention WhatsApp**
   (the file's header comment and a `countryCodeFromE164` doc comment). Both are
   *documentation of the removal* ("SMS only — WhatsApp inbound has been
   removed", "SMS only — no WhatsApp fallback"), not active plumbing, and the
   file is outside my edit whitelist (Task 2 owned it, and that task is closed).
   If the final gate wants a literal zero beyond the migration filename, these
   two comments are the only thing left to reword. **My call: leave them** — they
   explain *why* the code is SMS-only, and deleting the word would make the
   comments less informative. Flagging for the controller to rule on.

2. **Full API suite and web build not run.** Per instruction — the concurrent
   owner is mid-edit on `sms-service.ts` and `process-inbound-sms.ts`, so
   whole-suite output right now would be noise. The controller runs the final
   gate once everyone lands.

3. **Follow-ups F1–F9 in `PLAN.md` §5 remain open.** This change did not
   address any of them. F6 (SMS delivery-failure retry) in particular is the
   follow-up that the `failed`-is-not-terminal behaviour in §6 is protecting.

## For Sentinel / Probe

- **Probe:** the malformed-`From` 400 path. Three negative cases
  (`not-a-phone`, whitespace-only, 16-digit) all return 400 `INVALID_PHONE`
  with `enqueue` never called; the positive case still enqueues with
  `Channel: 'sms'`. Worth one manual `curl` with a bad `From` to confirm the
  status is 400 and not 500 in a live boot.
- **Sentinel:** audit that the `catch` at `twilio-webhooks.ts:38` swallows
  **only** the normalizer's throw. It is a bare `catch {}` with no logging and
  no re-throw — correct here (the 400 is the complete, intended response and
  the value is client-supplied, so there is nothing to log that is not already
  in the signature-verified request), but it is a bare catch in a hot public
  route; flag it if a future edit widens its scope.
- **Sentinel:** the `Defense in depth` regex at `twilio-webhooks.ts:45` is
  provably redundant today. It is intentional. If anyone "cleans it up" as dead
  code, the 400 gate silently becomes throw-dependent again.
- **Probe:** `findOrCreateConversation` — confirm `'carrier'` is still rejected
  at runtime after the cast, and that the guard order (customer lookup *before*
  channel validation) is what you want; a bad channel on a nonexistent customer
  currently reports `CUSTOMER_NOT_FOUND`, not `INVALID_CHANNEL`.
