# Task 4 brief — Inbound worker: E.164 repair, test restore, opt-in write point

**Where this fits:** the worker is the only place a customer SMS enters the
system. It is where the consent record gets written (Task 3 made
`recordSmsOptIn` the writer, with a timestamp, in one idempotent statement), and
where a real bug is sitting: the E.164 guard rejects every valid phone number.
Its test file was gutted in the working tree, so a large amount of committed
coverage has to be recovered before the new opt-in behavior can be added on top.

**Depends on:** **Task 3** (imports `recordSmsOptIn`; the test mocks it).
May run in parallel with nothing else — Tasks 1, 2, 3 should be finished.

---

## 1. Files you own (edit nothing outside this list)

| Action | Path |
|---|---|
| edit | `apps/api/src/worker/process-inbound-sms.ts` |
| edit | `apps/api/src/worker/process-inbound-sms.test.ts` |

## 2. `apps/api/src/worker/process-inbound-sms.ts`

**2a. Fix the E.164 guard.** Line 33 is over-escaped — it matches a literal
backslash and therefore rejects every real phone number:

```ts
const E164_RE = /^\\+?[1-9][0-9]{1,14}$/;
```

Replace with:

```ts
const E164_RE = /^\+?[1-9][0-9]{1,14}$/;
```

**2b. Add the consent import** to the import block (next to the other service
imports, e.g. after the `conversation-service.js` import):

```ts
import { recordSmsOptIn } from '../services/consent-service.js';
```

**2c. Add the opt-in write point.** It must run for a **valid inbound customer
SMS**, after the customer row exists and **before** classification/dispatch —
so the very first thing this customer does (reply) is what produces the consent
record that later proactive sends are checked against.

Insert it immediately after the `if (!customer) return;` defensive guard and
**before** the `let verifiedNow = false;` line, along with a comment:

```ts
  // Consent hard rule, write point: a customer who has replied to us has
  // demonstrably consented to SMS at this number. Record it here — once, for
  // the inbound message — so sms-service.ts's outbound gate passes for their
  // later proactive sends. Idempotent; the staff flow above already returned.
  await recordSmsOptIn(customer.id);
```

**Placement rationale, which you must not second-guess:** the T14 verification
gate below can `return` early, and the customer may still be unverified. That
is fine — the record is written for the inbound message itself, and the
verification-code SMS that the gate sends is a transactional kind that the
outbound gate exempts anyway.

**A failure of this write must fail the job visibly.** Do **not** wrap it in a
try/catch. If `sms_opted_in` cannot be persisted, the consent hard rule cannot
be honored downstream, so the job must not proceed to classify. This is the
opposite of the AI-usage ledger write further down, which is deliberately
best-effort. The two differ on purpose; leave the AI-usage block's try/catch
exactly as it is.

**2d. Do not change** anything else in the file. Specifically leave alone:
`findOrCreateConversation(customer.id, channel)`, `appendMessage(...)`, the
staff-phone block, the malformed-payload branch, the
`resolveOrganizationIdByTwilioNumber` block, the confirm-code gate, the
`classifyStep` call, the `recordAiUsage` block, the export signatures of
`echoSms` / `emitRuleDiagnosticSms` / `sendInvalidChoiceSms` /
`sendConfirmFailedSms` / `sendConfirmationSms`, and the
`channel: Channel = 'sms'` parameters threaded through them.

**2e. Fix the one stale comment** at line ~495, which still claims a second
channel exists. Replace the whole `/** ... */` block above `replySms` with:

```ts
/**
 * Customer reply: always SMS. Keeps the legacy sendSms shape ({ to, body } —
 * no channel key) so existing unit-test contracts and live behavior are
 * byte-for-byte unchanged.
 */
```

`replySms` itself is unchanged.

**2f.** Leave the file with a trailing newline.

## 3. `apps/api/src/worker/process-inbound-sms.test.ts`

**Restore the committed version first.** The working-tree copy is a partial
rewrite that dropped the CP03, T14, T15, and T16 suites:

```bash
git checkout HEAD -- apps/api/src/worker/process-inbound-sms.test.ts
```

The committed file is ~1270 lines and contains four suites you keep and two you
delete.

### 3a. Fix the consent mock in the `vi.hoisted` object

The committed file has this line, whose name is WhatsApp-specific:

```ts
  recordWhatsAppOptIn: vi.fn(), // T18: whatsapp opt-in write point
```

Replace it with:

```ts
  recordSmsOptIn: vi.fn(), // consent write point (SMS only)
```

### 3b. Fix the `vi.mock('../services/consent-service.js', ...)` block

The committed file has:

```ts
vi.mock('../services/consent-service.js', () => ({
  recordWhatsAppOptIn: m.recordWhatsAppOptIn,
}));
```

Replace with:

```ts
vi.mock('../services/consent-service.js', () => ({
  recordSmsOptIn: m.recordSmsOptIn,
}));
```

### 3c. Leave `beforeEach` alone

The committed `beforeEach` already has
`for (const fn of Object.values(m)) fn.mockReset();`, which resets
`recordSmsOptIn` for free, and its default customer is `VERIFIED`
(`phoneVerifiedAt: '2026-09-01T00:00:00.000Z'`). So in every retained suite the
opt-in write point fires once with `'cust-1'`. Do not add per-test setup for it;
`mockReset()` leaves it returning `undefined`, and `await undefined` is fine.

### 3d. Delete the whole WhatsApp channel suite

Delete the entire block:

```
describe('processInboundSms: T17 WhatsApp fallback channel (phase B plumbing)', () => {
  ...
});
```

It contains four tests: `whatsapp From+To: org lookup on bare To, whatsapp
conversation, same-channel reply`; `whatsapp From + bare-phone To: inconsistent
pair is an SMS fallback, never guessed`; `whatsapp non-E.164 From escalates
(normalized gate still enforced)`; `sms traffic is unchanged: no channel key in
replies (byte-for-byte legacy)`.

The third of these is worth preserving in SMS-only form — the retained
`rejects a non-E.164 From with an escalation and never touches customers` test in
the CP03 suite already covers it. The fourth is subsumed by the retained
CP03 and T16 suites. Delete the block whole.

### 3e. Delete the whole WhatsApp opt-in suite

Delete the entire block:

```
describe('processInboundSms: T18 WhatsApp opt-in write points', () => {
  ...
});
```

It runs to the end of the file. It contains nine tests, all built on
`whatsapp:+8801712345678` addresses and a `'WA'` keyword, none of which exist in
an SMS-only product. It also declares the local `unverifiedCustomer()` helper,
which is used only inside that block.

### 3f. Add the SMS opt-in suite in its place

Append exactly this to the end of the file, replacing 3e:

```ts
describe('processInboundSms: SMS consent write point', () => {
  it('records the opt-in for a valid inbound customer SMS before classifying', async () => {
    const worker = await loadWorker();

    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'need to move my appointment' }),
    );

    expect(m.recordSmsOptIn).toHaveBeenCalledTimes(1);
    expect(m.recordSmsOptIn).toHaveBeenCalledWith('cust-1');
    // The opt-in is written before the intent is classified, so the gate in
    // sms-service.ts can already see it for any send this flow triggers.
    expect(m.classifyStep).toHaveBeenCalled();
  });

  it('is idempotent: a repeat message from the same customer re-records without failing', async () => {
    const worker = await loadWorker();

    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'hello' }),
    );
    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM2', Body: 'hello again' }),
    );

    expect(m.recordSmsOptIn).toHaveBeenCalledTimes(2);
    expect(m.recordSmsOptIn).toHaveBeenNthCalledWith(1, 'cust-1');
    expect(m.recordSmsOptIn).toHaveBeenNthCalledWith(2, 'cust-1');
  });

  it('records the opt-in even while the verification gate is still running', async () => {
    const worker = await loadWorker();
    m.findOrCreateCustomer.mockResolvedValue({
      id: 'cust-1',
      organizationId: 'org-1',
      name: null,
      phone: '+15551234567',
      email: null,
      phoneVerifiedAt: null,
      verificationCode: '246810',
      verificationCodeExpiresAt: '2099-01-01T00:00:00.000Z',
      verificationAttempts: 0,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    });

    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'hello' }),
    );

    // Consent is recorded; classify does not run (the gate owns this message).
    expect(m.recordSmsOptIn).toHaveBeenCalledWith('cust-1');
    expect(m.classifyStep).not.toHaveBeenCalled();
  });

  it('does NOT record the opt-in for a staff phone (operator flow returns first)', async () => {
    const worker = await loadWorker();
    m.resolveStaffByPhone.mockResolvedValue({ tradespersonId: 'trades-1', userId: 'user-1' });

    await worker.processInboundSms(
      job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'on my way' }),
    );

    expect(m.recordSmsOptIn).not.toHaveBeenCalled();
    expect(m.findOrCreateCustomer).not.toHaveBeenCalled();
  });

  it('a consent write failure FAILS VISIBLY: the job rejects and never classifies', async () => {
    const worker = await loadWorker();
    m.recordSmsOptIn.mockRejectedValue(new Error('consent db down'));

    await expect(
      worker.processInboundSms(
        job({ From: '+15551234567', To: '+15559876543', MessageSid: 'SM1', Body: 'hello' }),
      ),
    ).rejects.toThrow('consent db down');

    expect(m.classifyStep).not.toHaveBeenCalled();
  });

  it('does not record the opt-in for a non-E.164 sender (rejected before any customer write)', async () => {
    const worker = await loadWorker();

    await worker.processInboundSms(
      job({ From: '+15551234567:ext1', To: '+15559876543', MessageSid: 'SM1', Body: 'hello' }),
    );

    expect(m.recordSmsOptIn).not.toHaveBeenCalled();
    expect(m.createEscalation).toHaveBeenCalledTimes(1);
  });
});
```

### 3g. Do not change the retained suites

`processInboundSms – CP03 wiring` (with its T14 verification-gate and T15
confirm-code-gate sub-describes) and `processInboundSms: T16 staff-phone
operator flow` stay byte-for-byte as committed. Those are the coverage the
working-tree rewrite destroyed; recovering them is the point of §3's first step.

## 4. Acceptance criteria

- [ ] `E164_RE` in the worker is `/^\+?[1-9][0-9]{1,14}$/` — exactly one
      backslash before `+`.
- [ ] `rg -n "recordSmsOptIn" apps/api/src/worker/process-inbound-sms.ts` shows
      the import and the single call site, both before `classifyStep`.
- [ ] `rg -n -i "whatsapp" apps/api/src/worker` → **no matches** in either file.
- [ ] `rg -n "recordWhatsAppOptIn" apps` → **no matches** anywhere.
- [ ] The test file contains exactly four `describe` blocks: the CP03 wiring
      suite, the T16 staff-phone suite, and the two new SMS-consent tests from
      §3f. The T17 and T18 WhatsApp suites are gone.
- [ ] The test file still has its `vi.mock('pg', ...)` block — the T14 gate
      tests depend on it.

## 5. Verification

```bash
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/api -- src/worker/process-inbound-sms.test.ts
```

Both must pass. The restored file has ~50 tests; if any of the *retained*
committed tests fail, the cause is almost certainly a mock name that Task 1 or
Task 3 changed (`sendSms`, `insertOutbound`, `hasSmsOptIn`). Report the failing
test name and the mock it names — do not edit the other task's file.
