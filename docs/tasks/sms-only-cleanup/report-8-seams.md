# Report 8 — Test-seam repairs in `process-inbound-sms`

**Status:** I-1 fixed. I-2 **not applied** — the brief's own reachability guard fired. Details and the
specific call sites that make I-2 a behavior change are in §3. No signature, message body, send
payload, flow, gate, or `sms-service.ts` was altered.

**Files edited (only these two):**
- `apps/api/src/worker/process-inbound-sms.ts` — 856 → 846 lines
- `apps/api/src/worker/process-inbound-sms.test.ts` — 1662 → 1647 lines

Both files carried substantial uncommitted work before this task; every edit below is a single exact-string
replacement. No file was rewritten wholesale; no `git checkout` was used.

---

## 1. What was deleted (Finding I-1)

### 1a. `apps/api/src/worker/process-inbound-sms.ts` — 10 lines removed

The two NEW exports, verbatim, plus their docblocks. They sat between the `SMS helpers` banner and
`replySms`'s docblock:

```ts
/** Real: echo SMS back to the customer — kept for test harness. */
export async function echoSms(customerPhone: string, body: string): Promise<void> {
  await sendSms({ to: customerPhone, body });
}

/** Emit a rule-parser diagnostic SMS. */
export async function emitRuleDiagnosticSms(customerPhone: string, body: string): Promise<void> {
  await sendSms({ to: customerPhone, body });
}
```

The `// SMS helpers (real, via sms-service)` banner (`:499-501`) and `replySms`'s docblock are untouched.
`sendSms` remains imported and still used at `:120` (staff ack) and via `replySms` — no import became dead.

### 1b. `apps/api/src/worker/process-inbound-sms.test.ts` — 15 lines removed

The single `it` that pinned their exemption, at old `:1648-1661`, plus the blank line before it:

```ts
  it('the dev-only echo / rule-diagnostic helpers stay exempt', async () => {
    const worker = await loadWorker();
    const gate = mountConsentGate();

    await worker.echoSms('+15551234567', 'echo');
    await worker.emitRuleDiagnosticSms('+15551234567', 'diagnostic');

    expect(sends()).toHaveLength(2);
    for (const send of sends()) {
      expect(send).not.toHaveProperty('customerId');
      expect(send).not.toHaveProperty('kind');
    }
    expect(gate.refused).toEqual([]);
  });
```

The sibling exemption test above it (`'staff ack stays exempt: no customerId and no kind …'`, now
`:1627-1646`) is preserved verbatim, and the file still closes correctly on `});` (`:1647`).

### 1c. Signatures — before / after

| Symbol | Before | After |
| --- | --- | --- |
| `echoSms` | `export (customerPhone: string, body: string): Promise<void>` → `sendSms({ to, body })` | **deleted** |
| `emitRuleDiagnosticSms` | `export (customerPhone: string, body: string): Promise<void>` → `sendSms({ to, body })` | **deleted** |
| module export surface | `processInboundSms`, `echoSms`, `emitRuleDiagnosticSms`, `sendInvalidChoiceSms`, `sendConfirmFailedSms`, `sendConfirmationSms`, `sendHelpSms`, `sendNoMatchingBookingSms`, `escalateAmbiguousIntent` | same minus the two deleted names |

After this change the module's send surface is exactly the five consent-threaded helpers plus
`escalateAmbiguousIntent` (not a send — it writes an escalation row).

### 1d. Reference search (the STOP check the brief asked for)

`rg -n --no-ignore --hidden -g '!.git/**' -g '!**/node_modules/**' -g '!**/.next/**' "echoSms|emitRuleDiagnosticSms" .`

- **No source reference remains.** The only code hits were the two definitions and the one test call, all
  now removed. `rg … --glob '!apps/api/dist/**' --glob '!docs/**'` returns nothing.
- `apps/api/dist/worker/process-inbound-sms.js:388,392` — **stale build artifact**, gitignored
  (`.gitignore:4`, confirmed via `git check-ignore -v`). It is a compiled copy of the code just deleted, not
  a caller; `tsc` does not prune outputs. This is already filed as audit finding **M-2**; not acted on
  (out of owned files, and audit M-2 already prescribes `rm -rf apps/api/dist` before reusing a local build).
- `docs/tasks/sms-only-cleanup/{task-4…,report-3,report-3-repair,final-consent-audit}.md` — historical prose
  describing what the code *was*. Records, not references. Not rewritten (out of scope; a prior report is
  evidence, not a to-do list).

Nothing referenced either name, so no guessing was required and no STOP was triggered for I-1.

---

## 2. Verification (exact numbers)

| Command | Before | After |
| --- | --- | --- |
| `npm run typecheck --workspace=apps/api` | **exit 0** | **exit 0** |
| `npm run test --workspace=apps/api -- src/worker/process-inbound-sms.test.ts` | 1 file / **58 passed** | 1 file / **57 passed** |
| `npm run test --workspace=apps/api` | **34 files / 535 passed** | **34 files / 534 passed** |

Baseline was measured by me on the pre-edit tree (not taken on trust), same machine, minutes apart.

**Delta accounting: −1 test, fully accounted for.** Exactly one `it` was removed (§1b) and no other test
was edited, added, skipped, or made conditional. File count is unchanged at 34 (no file deleted). The worker
file moves 58 → 57, and the suite 535 → 534. The removed test was the *only* test that exercised the two
deleted exports, so its removal is the whole delta.

**Why typecheck is a real net here (worth recording):** the test does not import the module statically —
`loadWorker()` is `await import('./process-inbound-sms.js')` (`test:97-99`). That dynamic import is still
statically typed under `module: nodenext`, and `apps/api/tsconfig.json` sets `include: ["src"]`, so
`worker.echoSms(...)` was type-checked. Had I left the call behind, `tsc --noEmit` would have failed on the
missing export. `tsc` exit 0 is therefore genuine proof that no other file in `src` — production or test —
referenced either name.

---

## 3. Finding I-2 — NOT applied. Reachability guard fired; here is the analysis.

The brief's REQUIRED was conditioned: *"Before editing, establish which of these exports are genuinely
test-only seams versus reachable from production code: if any is called by production code, do NOT change its
signature — instead report it and stop, because that would be a behavior change beyond this brief."*

I established that first. **There are zero test-only seams.** Every candidate is called by production code
*in this same file*, and `replySms` — named in the REQUIRED — is not an export at all: it is module-private
and has 10 live callers. So the guard's condition is met on every item, and I changed no signature.

### 3a. Reachability table (post-delete line numbers)

| Symbol | Line | Declaration | Production callers | Reachable from `processInboundSms`? | Verdict |
| --- | --- | --- | --- | --- | --- |
| `replySms` | `:513` | **not exported**; `customerPhone, body, organizationId?, customerId?, kind?` | 10 in-file: `:533 :544 :566 :576 :591 :663 :702 :720 :803 :825` | yes — the funnel for all five helpers + both OTP gates | **PRODUCTION** (and not an export) |
| `sendInvalidChoiceSms` | `:532` | `export`; `…, organizationId?, customerId?` | `:378` (in `handleSlotChoiceIntent`) | yes — `:255` `slot-choice` branch | **PRODUCTION** |
| `sendConfirmFailedSms` | `:543` | `export`; `…, organizationId?, customerId?` | `:464` (in `performConfirmation`) | yes — `:261` confirm intent, `:429` | **PRODUCTION** |
| `sendConfirmationSms` | `:557` | `export`; `…, timezone?, organizationId?, customerId?` | `:488` (in `performConfirmation`) | yes — same | **PRODUCTION** |
| `sendHelpSms` | `:575` | `export`; `…, organizationId?, customerId?` | `:266` | yes — `:265` `help` branch | **PRODUCTION** |
| `sendNoMatchingBookingSms` | `:590` | `export`; `…, organizationId?, customerId?` | `:278`, `:320`, `:462` | yes — 3 sites | **PRODUCTION** |

**External importers: none.** `rg` over the whole repo (excluding `dist`/`node_modules`) shows the only
importer of this module is `apps/api/src/worker/index.ts:4`, which imports `processInboundSms` and nothing
else. No test references any of the five helpers by name — the test file calls `worker.processInboundSms`
only. `reschedule-service.ts:270` mentions `sendConfirmationSms` in a comment only.

So the "delete the optional scalars" fix has no surface to land on: the audit's remediation assumed these
were external seams, but they are the internal send funnel of the live inbound flow.

### 3b. Why forcing `ctx: { organizationId: string; customerId: string }` would change behavior

Two independent blockers, both in the *current* code's control flow:

**Blocker 1 — a live production call site omits `customerId`, and that omission is load-bearing.**
`process-inbound-sms.ts:198-203`:

```ts
  if (conversation?.state === 'awaiting_confirmation_code') {
      const outcome = await runConfirmCodeGate(conversation, body, channel, customer.id);

    if (outcome === 'verified') {
      await performConfirmation(organizationId, customerPhone, channel);   // ← no customerId
    }
    return;
  }
```

`customer.id` is in scope on the very same line-block. This is precisely the situation the brief predicted
(*"if typecheck surfaces a production call site that depended on the optionality, STOP … and report it"*) —
it does not surface as a typecheck error today only because the parameter is optional. Making `ctx` required
turns `:201` into a compile error, and the only way to satisfy the compiler is to pass `customer.id`, which
flips three currently-exempt, customer-facing sends from **ungated to consent-gated**:
`sendNoMatchingBookingSms` (`:462`, kind `no_matching_booking`), `sendConfirmFailedSms` (`:464`, kind
`confirm_failed`), `sendConfirmationSms` (`:488`, kind `booking_confirmation`). None of
`no_matching_booking` / `booking_confirmation` is in `sms-service.ts`'s `TRANSACTIONAL_KINDS` allowlist
(`:23-29` = `verification_code`, `confirm_code`, `number_verified`, `code_mismatch`, `confirm_failed`), so
today they are delivered purely on the `customerId == null` exemption at `sms-service.ts:122`; with the id
threaded, a missing consent record would **refuse** them. Same for `statusCallbackUrl` derivation and the
ledger row (`sms-service.ts:161-174`) — passing `organizationId` enrolls them in `rl_outbound_messages`.
That is a change to consent enforcement, send payload, and ledger behavior: three separate things the RULES
forbid, and a real delivery-behavior change (a customer who replies with the right code could stop receiving
their outcome SMS). Not mine to make.

**Blocker 2 — five OTP sends deliberately omit `organizationId`.** `:663`, `:702`, `:720`, `:803`, `:825`
all pass `undefined` for the org (literal, in the source: `replySms(phone, body, undefined, customerId, kind)`).
A required `organizationId: string` cannot be satisfied there without threading the org down through
`runVerificationGate` → `issueAndSendCode` → `replySms` and `runConfirmCodeGate` → `issueFlowCodeAndSend` →
`replySms`, none of which currently receive it. That would add `organizationId` to five live send payloads
and five ledger rows — a payload change, and it would flip those sends from "no ledger row" to "ledger row
+ status callback", which `test:1612-1615` deliberately pins as *absent*
(`expect(list[0].organizationId).toBeUndefined()`). Those sends are admitted by the allowlist
(`verification_code` / `number_verified` / `code_mismatch` / `confirm_code`), so they are gated-by-kind
today and are not the defect; the fix would be a payload change, not a security fix.

Net: applying the REQUIRED verbatim requires a decision (thread the missing id at `:201`? add the org to the
OTP sends? relax `ctx` to `{ organizationId?: string; customerId: string }`?) that changes live behavior.
That is exactly the case the brief told me to report rather than guess.

### 3c. What I did *not* do

- Did not change any of the six signatures in §3a. `replySms` and the five helpers keep their exact
  declarations, their exact `if (organizationId) / if (customerId) / if (kind)` guards, and their exact
  send payloads.
- Did not delete the `if (customerId)` guards in `replySms` (the audit's I-2 remediation). That deletion is
  only sound once every call site is guaranteed to pass both ids — which §3b shows it is not.
- Did not invent a caller, and did not "fix" `:201`.

### 3d. If the controller wants I-2 landed, the smallest safe variant

Ranked, with the behavior each one buys. All three are decisions, not repairs, so they need explicit
authorization:

1. **`ctx: { customerId: string; organizationId?: string }` on the five exported helpers + `replySms`,
   plus `customer.id` at `:201`.** Makes customerId omission a compile error everywhere, which is the actual
   defect class in I-2. Cost: the three `:201` sends become consent-gated (deliverable only with a consent
   record). On the live inbound path a consent record is written at `:168` (`recordSmsOptIn`) before any of
   this, so the practical exposure is narrow — but it is a change, and it needs a product call.
2. **Same as (1), minus the `:201` change**, by leaving `performConfirmation`'s `customerId` optional and
   typing it `ctx?: { customerId: string }` at that one internal boundary. Captures most of the compile-time
   value with zero behavior change; the hole at `:201` remains, documented.
3. **Leave signatures; add the audit's M-1 one-line warning at each of the two sender closures (`:325`,
   `:367`)** — the "compiler will not catch a verbatim-forwarding sender" note. Comment-only, zero risk.

I did not apply any of these.

---

## 4. Scope discipline

Untouched, as instructed: `reschedule-service.ts`, `sms-service.ts`, `consent-service.ts`, every other file
in the working tree, every message body, every send payload, the consent gate, and all flow behavior. No
`git checkout`, no `git add`, no commit, no `npm install`. The 30 other modified files still carry exactly the
uncommitted state they had before this task.

## 5. For Sentinel / Probe

- **Sentinel:** the source of truth for "who may call a send helper" is now the call graph in §3a, not an
  export list. Worth a grep-based check that no *new* `sendSms` call site appears in `worker/` without a
  `kind` or a `customerId`; after this report the only deliberately-ungated sends left in the file are the
  staff ack (`:120`, org-scoped, sanctioned) and the two 5-send OTP groups (allowlisted by kind).
- **Probe (behavior, not just typecheck):** the `:201` `performConfirmation` call is a live path where a
  customer-facing confirmation can go out with no `customerId` in the payload. It is a real gap, it is
  reachable, and it is now the single highest-value follow-up. Test it as: verified customer in
  `awaiting_confirmation_code` → reply the correct flow code → `confirmReschedule` returns a
  `no_matching_booking`/generic error → assert on the exact `sendSms` payload. That test does not exist
  today; the existing confirm-code tests stop before the mutation.
- **Probe:** the two allowlist-exempt OTP groups are pinned as `organizationId: undefined`
  (`test:1612-1615`) and that pin is correct. If I-2 ever lands, that assertion is the canary that will fail
  first — which is the desired outcome, not a regression.
- **Probe (already known, audit M-2):** `rm -rf apps/api/dist` before any deploy that reuses a local build
  directory; the stale artifact still contains the deleted `echoSms`/`emitRuleDiagnosticSms`.
