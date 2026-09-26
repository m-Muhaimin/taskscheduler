# Final consent audit — SMS hard rule gate

**Date:** 2026-09-26
**Scope:** the uncommitted `sms-only-cleanup` change set (30 modified + 2 deleted source files).
**Rule under audit (CLAUDE.md):** *never send an SMS without a logged consent record.*
**Method:** read-only. Source was not edited. Read commands, `npx tsc --noEmit` on two
throwaway probe files written **outside** the repo
(`%LOCALAPPDATA%\Temp\opencode\consent-probe\`), and the test suite.
One new file written: this report.

**Verdict: RULE-HOLDS.** No Critical or Important *live* violation. Two Important
*latent* findings, both new code from this change, neither reachable from any route,
webhook, worker dispatch, or script today. Details in section 4.

---

## 1. The choke point is real, and this change made it real

Twilio reachability, derived from scratch rather than from any prior report:

| Probe | Result |
|---|---|
| `rg "from 'twilio'\|require('twilio')"` (whole repo, excl. node_modules/dist) | **2 hits**: `apps/api/src/middleware/twilio-signature.ts:1` and `apps/api/src/services/sms-service.ts:1` |
| `rg "messages\.create\|api\.twilio\.com"` | **1 hit in source**: `apps/api/src/services/sms-service.ts:213` |
| `twilio` in any `package.json` | `apps/api` only (not root, not `apps/web`, not `packages/*`) |
| `rg "sms-service"` importers, value form | **2**: `worker/process-inbound-sms.ts:13`, `worker/process-outbound-sms.ts:16` |
| Dynamic / aliased / computed send refs | none (`rg "import\("`, `require\(`, bracket-access - no hits against a send target) |
| `twilio`/send refs in `apps/api/scripts/*.mjs` | none |

`twilio-signature.ts` uses the SDK for `validateRequest` only - it never sends.

### 1a. The change deleted a second, entirely ungated send primitive

This is the single most important fact in the audit and it is **not** in any prior report.

At `HEAD` (before this change) there were **two** Twilio send primitives:

| Primitive | Gated? |
|---|---|
| `sendSms` (`sms-service.ts`) | yes - this is the one that got the gate |
| `sendWhatsAppTemplate` (`whatsapp-service.ts:34`) | **no** |

`git show HEAD:apps/api/src/services/whatsapp-service.ts` has `client.messages.create`
at line 72 and **no** `customerId` parameter, **no** `hasSmsOptIn` call, **no** ledger
write, and does not import `sendSms` at all. It was reachable in production:

- `apps/api/src/routes/twilio-status.ts` at `HEAD:4` imported
  `handleFailedSms` from `../services/fallback-service.js`;
- `fallback-service.ts:68` resolved the customer with
  `getCustomerByPhone(current.organizationId, current.toPhone)`;
- `fallback-service.ts:95` called `sendWhatsAppTemplate({ to: <that customer's phone>, ... })`.

So at `HEAD` any **failed/undelivered** SMS delivery report (a signed Twilio callback to a
public, signature-guarded but publicly-reachable route) automatically re-sent the
customer's message body as a WhatsApp template to a customer **with no consent check at
all** - a complete bypass of the choke point, not a gap in it.

This change deletes both files (staged `D` in `git status`, absent from the working tree)
and drops the `handleFailedSms` import. Post-change, the "exactly one place" claim is
true; pre-change it was false.

---

## 2. Every send path, with the customerId it carries

`sendSms` call sites: 7 (all in `worker/`). `replySms` logical sends: 10.
Total **17** send paths. Nothing else in the repo reaches Twilio.

### 2a. Direct `sendSms` call sites

| # | Site | Carries | Verdict |
|---|---|---|---|
| 1 | `process-inbound-sms.ts:120` - staff ack | **no `customerId` key**; `organizationId` only | **exempt-by-design** (operator, no customer row; the flow returns at `:132` before `findOrCreateCustomer`). Pinned: test `:1627` asserts the key is *absent*, not present-and-undefined |
| 2 | `process-inbound-sms.ts:326` - `flowSmsSender` to `initiateRescheduleFlow` 3-slot offer (`reschedule-service.ts:187` builds `{to, body}`) | `customerId` = `customer.id`, from `handleRescheduleIntent(..., customer.id)` at `:247` | **consented** - no `kind`, so `hasSmsOptIn` runs. Pinned: test `:1112` (asserts `customerId=cust-1`, `kind` undefined), `:1158` |
| 3 | `process-inbound-sms.ts:368` - `choiceSmsSender` to `processSlotChoice` in-flow "Reply YES to confirm" prompt (`reschedule-service.ts:247` builds `{to, body}`) | `customerId` = `customer.id`, from `handleSlotChoiceIntent(..., customer.id)` at `:255` | **consented** - no `kind`, gate runs. Pinned: test `:1369` |
| 4 | `process-inbound-sms.ts:505` - `echoSms(customerPhone, body)` | none | **exempt-by-design / dev-only - NOT LIVE** (see I-1) |
| 5 | `process-inbound-sms.ts:510` - `emitRuleDiagnosticSms(customerPhone, body)` | none | **exempt-by-design / dev-only - NOT LIVE** (see I-1) |
| 6 | `process-inbound-sms.ts:537` - `replySms` (the funnel for rows 7-16) | conditional, see 2b | - |
| 7 | `process-outbound-sms.ts:84` - manual dashboard reply | none; `to` = `cu.phone` via the join at `:67-71` | **exempt-by-design** (sanctioned). `requireAuth` to `getInboxConversation(id, orgId)` to `enqueueOutboundReply`'s org-guarded `INSERT ... where exists (c.organization_id = $3)`. The phone therefore belongs to the authenticated tenant's own conversation. Also carries no `organizationId`, so it writes no ledger row - F12, deferred, unchanged by this change |

### 2b. `replySms` logical sends (`process-inbound-sms.ts`)

| # | Site | `kind` | `customerId` provenance | Verdict |
|---|---|---|---|---|
| 8 | `:543` `sendInvalidChoiceSms` | `slot_invalid` | `:378` from `handleSlotChoiceIntent(:361)` from `:255` `customer.id` | **consented** (not on the allowlist, so `hasSmsOptIn` runs). Pinned: `:1357` |
| 9 | `:554` `sendConfirmFailedSms` | `confirm_failed` - **allowlisted** | `:464` from `performConfirmation(:449)` from `:429` from `:261` `customer.id`; also `:201` from `:198` `customer.id` | **exempt-by-design** (allowlist). `customerId` is threaded anyway, so it is double-safe. Pinned: test `:1391` |
| 10 | `:576` `sendConfirmationSms` | `booking_confirmation` | `:488` from `performConfirmation` as above | **consented**. Pinned: `:1409` (pass) and `:1422` (refused when no consent) |
| 11 | `:586` `sendHelpSms` | `help` | `:266` `customer.id` (direct, not via a handler) | **consented**. Pinned: `:1320` |
| 12 | `:601` `sendNoMatchingBookingSms` | `no_matching_booking` | three callers: `:278` `customer.id`; `:320` from `:247` `customer.id`; `:462` from `:429`/`:201` | **consented**. Pinned: `:1331`, `:1344`, `:1446` |
| 13 | `:673` `issueAndSendCode` (T14) | `verification_code` - **allowlisted** | `customer.id`, a **required** `string` param (`:663`) | **exempt-by-design** (allowlist). Pinned: `:1486` |
| 14 | `:712` `number_verified` | `number_verified` - **allowlisted** | `customer.id` | **exempt-by-design**. Pinned: `:1503` |
| 15 | `:730` `code_mismatch` (T14) | `code_mismatch` - **allowlisted** | `customer.id` | **exempt-by-design**. Pinned: `:1526` |
| 16 | `:813` `code_mismatch` (T15) | `code_mismatch` - **allowlisted** | `runConfirmCodeGate(:765 customerId?)` from `:414 customerId` from `:261 customer.id`; and `:198 customer.id` | **exempt-by-design**. Pinned: `:1564` |
| 17 | `:835` `issueFlowCodeAndSend` (T15) | `confirm_code` - **allowlisted** | `runConfirmCodeGate` as above, then `:784` / `:809` | **exempt-by-design**. Pinned: `:1547` (first CONFIRM) and `:1586` (lockout re-issue) |

**Tally: 0 violations. 5 exempt-by-allowlist, 2 exempt-by-no-customer, 8 fully
consent-gated, 2 not-live dev helpers.**

### 2c. customerId provenance - every id, traced

There are exactly **two** producers of a `customerId` in the entire repo:

1. **`customer.id` from `findOrCreateCustomer(organizationId, customerPhone)`**
   (`conversation-domain.ts:212`), called once, at `process-inbound-sms.ts:138`.
   - `organizationId` comes from `resolveOrganizationIdByTwilioNumber(raw.To)` (`:78`) -
     the number Twilio signed, so it is the org that actually received the SMS.
   - `customerPhone` comes from `raw.From.trim()` (`:58`), E.164-validated at `:63`.
   - The upsert is `on conflict on constraint rl_customers_org_phone_key`
     (`conversation-domain.ts:237`), so the row is provably the `(org, sender)` pair.
   - This is the only `customer.id` used anywhere; every row in 2b derives from it, and
     rows 2/3 derive from the handler params that `:247`/`:255` fill with it.
2. **`conversation.id`** (rows 16/17) - used only for the flow-code DB write, never as a
   `customerId`.

**No route, webhook, request body, query parameter, or job payload supplies a
`customerId` to any send.** `rg customerId` over non-test source returns hits only in
`consent-service`, `conversation-domain`, `outbound-ledger`, `sms-service`,
`reschedule-service` (prose), and `process-inbound-sms`. Both dashboard customer-facing
routes (`messages.ts:21`, `customers.ts:14`) are `GET` + `requireAuth` and touch no send.
The queue is only ever written by `twilio-webhooks.ts:51` (signature-verified) and
`inbox-service.ts:145` (org-guarded); the worker dispatch table has exactly two entries.

### 2d. Allowlist breadth

`TRANSACTIONAL_KINDS` (`sms-service.ts:23-29`) = 5 of the 13 `MessagingKind` values:
`verification_code`, `confirm_code`, `number_verified`, `code_mismatch`, `confirm_failed`.

Correctly **excluded**, despite being transactional in spirit:
`reschedule_offer` (rows 2, 3 - gated on consent), `slot_invalid` (row 8 - gated).

`confirm_failed` (row 9) is the one debatable entry: a courtesy notice after a failed
calendar mutation. It is narrow - it is reachable only from `performConfirmation`
immediately after `confirmReschedule` returned `success: false` in the same inbound turn
from an already-consented customer (consent is written at `:168` before any dispatch), so
the allowlist buys nothing an attacker could use. Not a finding.

---

## 3. Ordering, refusal atomicity, and the reschedule remediation

### 3a. Gate ordering - proven

`sendSms` statement order (`sms-service.ts`):

| Line | Statement |
|---|---|
| 140 | `const customerId = scopedCustomerId(input)` - one normalization, shared by gate and ledger |
| **147** | **`await assertSmsConsent(input, customerId)`** - first side-effecting statement |
| 149-156 | `channel` / `from` / `to` guards |
| **161-170** | `insertOutbound(...)` - the ledger write |
| **190-198** | the `TWILIO_SMS_DRY_RUN === 'true'` branch |
| **213** | `client.messages.create(createParams)` |

The throw at `:133` precedes all three. A refusal therefore leaves **no
`rl_outbound_messages` row, no `markSent`, no `markFailed`, no dry-run log, and no Twilio
request** on every path including dry-run. A `hasSmsOptIn` DB error propagates identically
(`consent-service.ts:58-65` is not wrapped), so the gate fails **closed** on error too.

Pinned by `sms-service.test.ts`:
- `:326` refusal: `insertOutbound`/`create`/`markFailed` all not called
- `:340` consent-read error: same, and the original DB error surfaces
- **`:351` `TWILIO_SMS_DRY_RUN=true` does not bypass the gate**: `insertOutbound`,
  `markSent`, `create` all not called
- `:428` a gated send with **no** `organizationId` is still refused
- `:461` blank `'   '` customerId is treated as absent **and** written to the ledger as
  `null` (gate and ledger can never disagree)
- `:422` a `customerId` with **no** `kind` is still gated
- `:403` the no-customerId exemption is proven non-vacuous in the same test body

### 3b. Reschedule remediation - the armed trap is closed, and omission now fails to compile

Verified against the diff, not the comments:

| Claim | Evidence |
|---|---|
| `defaultSendSms` deleted | diff removes the whole block; `rg defaultSendSms` gives 0 hits repo-wide |
| `smsSendFn` required at `initiateRescheduleFlow` | `reschedule-service.ts:100` - `smsSendFn: SmsSendFn,` (no initializer) |
| `smsSendFn` required at `processSlotChoice` | `reschedule-service.ts:219` - same |
| dead binding removed from `confirmReschedule` | signature is now `(phone, authFn, createEventFn, bookingLookupFn, conversationLookupFn = ..., conversationUpdateFn = ..., createEscalationFn = ...)`; body contains no send |
| service no longer imports `sendSms` as a value | `reschedule-service.ts:15` is `import type { SendSmsInput }`. Every remaining `sendSms` occurrence in the file is comment prose (`:46`, `:47`, `:52`, `:270`) |
| omitting the argument **fails to compile** | **proved.** A probe outside the repo importing the real module and calling both functions with the sender omitted produced `probe.ts(13,6): error TS2554: Expected 8-13 arguments, but got 7.` and `probe.ts(22,6): error TS2554: Expected 5 arguments, but got 4.` |

The worker's live send sites both supply the sender: `:338` (`flowSmsSender` as arg 8) and
`:374` (`choiceSmsSender` as arg 5, with `undefined, undefined` for the two defaulted
conversation deps, which is required now that arg 5 is mandatory).

**No new bypass was introduced.** The change replaced a silent fail-open default with a
compile error and added no compensating `kind` allowlist entry and no second sender.

### 3c. Test re-arg did not shift a mock into a real slot

`confirmReschedule` lost slot 7 (`smsSendFn`), shifting `createEscalationFn` from slot 8
to slot 7. All nine call sites dropped `mockSmsSend` and kept `mockCreateEscalation` as the
last argument, so `mockCreateEscalation` now lands in the `createEscalationFn` slot - the
same semantic position it held before. Verified by reading
`reschedule-service.test.ts:437-445` and the eight sibling sites: no real DB-backed
default was displaced by a mock, and no mock was displaced by a real default. Slot 3 is
still asserted as `createEventFn` via
`createEventFn as Parameters<typeof confirmReschedule>[2]`, so a future slot shift there
would be a compile error, not a silent swap.

---

## 4. Findings

### Critical

None.

### Important

**I-1 - Two new, exported, entirely ungated send primitives were added by this change.**
`apps/api/src/worker/process-inbound-sms.ts:504-511`. `echoSms(customerPhone, body)` and
`emitRuleDiagnosticSms(customerPhone, body)` both call `sendSms({ to, body })` with no
`customerId` and no `kind`, so `assertSmsConsent` returns at `:122` and the send is
exempt. They are **new** - `git diff` shows both as `+` lines and `git show HEAD:` has
neither.

*Not live.* The only importer of `process-inbound-sms.js` is `worker/index.ts:4`, which
imports only `processInboundSms`. No route, script, or dispatch entry reaches them. The
sole caller is the test at `process-inbound-sms.test.ts:1652-1653`.

*Why it still matters.* Both take an arbitrary phone and arbitrary body with **no
`organizationId` and no org scoping whatsoever** - strictly weaker than the two sanctioned
exemptions, which are each anchored to a resolved organization. They are exported from a
production module and, worse, `process-inbound-sms.test.ts:1648` ("the dev-only echo /
rule-diagnostic helpers stay exempt") now **pins** that exemption, so a future importer
lands on a green test. This is the exact shape of the trap that was just remediated in
`reschedule-service.ts`, in a different file.

*Remediation.* Delete both exports and the test at `:1648-1661`. They have no production
caller, so nothing loses a capability; a test that needs a bare `sendSms` shape can call
`m.sendSms` directly. If a real harness need exists, move them out of
`process-inbound-sms.ts` into the test tree so the ungated primitive never ships.

**I-2 - The same fail-open pattern that was remediated in `reschedule-service.ts` still
exists one file over, in the reply funnel.**
`process-inbound-sms.ts:523-538`. `replySms` takes `customerId?: string` and writes the
key only when truthy (`if (customerId) input.customerId = customerId;`), so calling any of
the five exported helpers without the id produces a **silently exempt** customer-facing
send rather than a compile error. The five exported helpers (`:542`, `:553`, `:567`,
`:585`, `:600`) all declare `customerId?: string`.

*Not live.* All seven in-file callers pass `customer.id` (a `string`) and there are no
external importers; the four non-exported handlers that take `customerId?: string`
(`:301`, `:361`, `:403`, `:449`) are module-private, so their only callers are the
complete ones at `:247`, `:255`, `:261`, `:429`, `:201`. Every live path is therefore
correctly threaded, as 2b shows.

*Remediation.* Make the context a required parameter on the five exported helpers so the
compiler enforces what the runtime silently forgives. Concretely: replace the trailing
`organizationId?: string, customerId?: string` pairs with a single required
`ctx: { organizationId: string; customerId: string }`, update the seven call sites to pass
it (they all have both values in scope today), and delete the `if (customerId)` /
`if (kind)` guards in `replySms` so the object is always fully populated. This is the same
one-line-of-defence the reschedule fix just installed, applied to the other file that
builds the same payload.

### Minor

- **M-1 - The required-parameter fix catches omission, not a wrong sender.** Probe C
  (`(input) => sendSms(input)` as the 8th arg to `initiateRescheduleFlow`) compiles with
  exit 0. Enforcement against a *bad* sender remains caller discipline, exactly as
  `sms-service.ts:107` states. The audit's own reads are what close this: the only
  production senders are the two closures at `:325-326` and `:367-368`, both threading
  `customerId`. Worth a one-line comment at each closure saying the compiler will not
  catch a verbatim-forwarding sender.
- **M-2 - Stale build artifact still contains the deleted ungated path.**
  `apps/api/dist/services/whatsapp-service.js` and `fallback-service.js` are present on
  disk; `tsc` does not prune outputs for deleted sources. `dist/` is gitignored
  (`.gitignore:4`) and untracked, so this is not a code finding and cannot reach Render
  (fresh checkout, fresh build). But a stale `twilio-status.js` from `HEAD` would still
  `import handleFailedSms` and drive the ungated WhatsApp re-send. Fix:
  `rm -rf apps/api/dist` before any deploy that reuses a local build directory.
- **M-3 - No rate limiting anywhere in the API** (no `express-rate-limit`, no helmet, no
  CORS middleware - `rg -i "rate-limit|helmet|cors"` over `apps/api/src` returns nothing).
  Pre-existing and out of scope for this rule, but the sanctioned manual-reply exemption
  (`POST /api/dashboard/inbox/:conversationId/reply`, `inbox.ts:60`) is a metered-SMS-spend
  endpoint: one authenticated tenant can iterate their conversation list and send 2000
  arbitrary-character messages. Org-scoped and behind `requireAuth`, so it is not a
  consent-rule violation - a spend/abuse gap.
- **M-4 - Full-suite green is reproducible but not deterministic on this box.** First
  `npm run test --workspace=apps/api` run: **3 failed / 525 passed** -
  `google-auth-service.test.ts > builds a consent URL...`, and in
  `process-inbound-sms.test.ts` a 5 s timeout in *"rejects a non-E.164 From..."* (`:171`)
  which then leaked a second `createEscalation` call into the next test (`:190`,
  `expected 1, got 2`). Second run: **34 files / 528 passed**. Both files pass in
  isolation. This is load-induced flakiness (the run reported `collect 266.99s`), not a
  product defect - the two failures are in the `CP03 wiring` block, upstream of any send,
  and neither touches the consent path. Noted only so the "528 green" claim is not read as
  deterministic.

### Accepted items - verified, not taken on trust

- **M6, org-scoping of the consent lookup - LATENT, as characterized.**
  `consent-service.ts:60` is `select sms_opted_in from ... where id = $1`, with no
  `organization_id` predicate. I independently derived the same conclusion: a
  cross-tenant read requires a foreign `customerId` to reach a send, and 2c shows the
  only producer is `findOrCreateCustomer(organizationId, customerPhone)`, bound to the org
  that received the signed inbound SMS. PLAN.md:175 says "No route accepts a `customerId`
  from a request body and the only producer (`findOrCreateCustomer`) is org-scoped" -
  that is accurate. Not live; correctly deferred. Note the write is equally unscoped
  (`consent-service.ts:70-78`, `where id = $1` at `:75`), which is the same latent item viewed from the other side.
- **Manual dashboard reply exemption - sanctioned and correctly bounded.** Traced end to
  end: `inbox.ts:60` `requireAuth` to `resolveOrg` (403 without an org) to
  `getInboxConversation(id, orgId)` (404 cross-tenant) to `enqueueOutboundReply`'s
  `INSERT ... where exists (select 1 ... where c.id = $1 and c.organization_id = $3)`
  (`inbox-service.ts:127-135`, silent no-op on a cross-tenant race) to the single `queued`
  outbound row producer in the repo to `process-outbound-sms.ts:84`. The phone comes from
  the join `cu.id = c.customer_id` on that same org-owned conversation, so the recipient is
  always the authenticated tenant's own customer. The un-ledgered aspect is unchanged
  F12.
- **The two gate-blind worker tests - characterized correctly, and the new coverage is
  real.** `process-inbound-sms.test.ts:358` (*"confirm dead-end (no conversation)"*) and
  `:920` (*"CONFIRM while still offering slots"*) both assert only
  `expect.objectContaining({ to | body })` on the `sendSms` mock, so they would pass
  whether or not a `customerId` is threaded - genuinely gate-blind. The compensating
  coverage is not nominal: the `describe` at `:1216` mounts an exact mirror of
  `assertSmsConsent` (`:1227-1243`, with the five allowlist kinds restated verbatim at
  `:1194-200`) and then pins each send's `customerId`, `kind`, and `organizationId`,
  including two non-vacuity tests that assert the send is actually **refused** when no
  consent record exists (`:1422` booking_confirmation, `:1461` no_matching_booking) and
  one that asserts a dropped argument is caught (`:1586`, the T15 lockout re-issue). These
  are the tests that make the threading verifiable.
- **Consent write path - single-writer, and correctly ordered.** `recordSmsOptIn` has
  exactly one production caller, `process-inbound-sms.ts:168`. It appears in no route, no
  webhook, and no other service. Its position is after the staff-flow `return` (`:132`),
  after org resolution (`:83-90`), after E.164 rejection (`:63-70`), and after the
  customer upsert (`:138`). It is **not** wrapped in a try/catch, so a write failure
  rejects the job before `classifyStep` (`:208`) - fail-closed, pinned at `:1081`.
  Wrong-org pairing is impossible: the org comes from the signed `To` and the customer
  from the signed `From`, and the unique constraint `rl_customers_org_phone_key` binds
  them. The only inbound writer is `twilio-webhooks.ts:16` behind `verifyTwilioSignature`,
  which fails closed on a missing token (`:17`), a missing header (`:23`), an invalid
  signature (`:34`, via `twilio.validateRequest` at `:32`) **and** a throw (`:39`) - no
  env-gated bypass.
- **`sms_opted_in` defaults closed.** `supabase/schema.sql` adds
  `sms_opted_in boolean not null default false`; `hasSmsOptIn` returns `false` for a
  missing row (`consent-service.ts:63`). There is no path that pre-consents a customer.
- **Cross-tenant escalation injection, missing RLS, the duplicate pre-existing ledger:**
  pre-existing, out of scope, not re-litigated here.

### New vectors introduced by this change - summary

Checked all six categories the brief named:

| Category | Result |
|---|---|
| New send call | 2 (`echoSms`, `emitRuleDiagnosticSms`) - **not reachable**, see I-1 |
| New exemption | 1 (the no-`customerId` exemption itself) - unchanged and unchanged in kind |
| Over-broad allowlist entry | none; 5 of 13 kinds, and the two most "transactional-looking" candidates (`reschedule_offer`, `slot_invalid`) are correctly outside it |
| `customerId` defaulted or inferred | not live; the `if (customerId)` pattern in `replySms` and the optional params on the five exported helpers are the residual shape - I-2 |
| Second send primitive | **removed**, not added (see 1a) |
| New Twilio credential reach | none; `twilio` remains an `apps/api`-only dep, `TWILIO_WHATSAPP_*` dropped from `.env.example` and `render.yaml` |

---

## 5. Verdict

**RULE-HOLDS.** The single strongest piece of evidence is not the gate itself but the
dependency sweep: exactly one `client.messages.create` exists in the tree, and this change
**deleted the second one** - `sendWhatsAppTemplate` was an ungated primitive that the
signed Twilio status-callback route drove at a real customer on every failed SMS - so the
"exactly one place" claim is true for the first time. Behind that, the gate is the first
statement of `sendSms` (`:147`), above the ledger insert (`:161`) and above the dry-run
branch (`:190`), and the previously armed `reschedule-service` default is now a `TS2554`
compile error rather than a silent fail-open.

Highest-value follow-up (non-blocking): **I-1** - delete `echoSms` /
`emitRuleDiagnosticSms` and their exemption-pinning test, so no new ungated, un-org-scoped
send primitive ships from this change.

**Blocking before release: nothing.**
