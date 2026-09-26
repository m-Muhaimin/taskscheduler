# Task 3 brief — Consent authority + the `sendSms` choke point

**Where this fits:** the project hard rule is "never send an SMS without a
logged consent record." Today nothing enforces it: consent is spread across
`consent-service` and `outbound-ledger` (which Task 1 strips), and `sendSms`
happily sends to anyone. This task makes `sendSms` the single gate, makes
`consent-service` the single authority, and restores the test coverage for
both.

**Depends on:** nothing. May run in parallel with Tasks 1 and 2.
**Blocks:** Task 4 (the worker imports `recordSmsOptIn` and its test mocks it).

---

## 1. Files you own (edit nothing outside this list)

| Action | Path |
|---|---|
| edit | `apps/api/src/services/consent-service.ts` |
| edit | `apps/api/src/services/consent-service.test.ts` |
| edit | `apps/api/src/services/sms-service.ts` |
| edit | `apps/api/src/services/sms-service.test.ts` |

If a test you own needs a helper that lives in a file you do not own, report it
rather than editing it.

## 2. `apps/api/src/services/consent-service.ts`

**2a. Add a table-name helper** after `getPool()`:

```ts
/**
 * Customers table name — honors the CUSTOMERS_TABLE override used by local
 * prefixes, defaulting to the production table.
 */
function tableName(): string {
  return process.env.CUSTOMERS_TABLE || 'public.rl_customers';
}
```

**2b. Make `hasSmsOptIn` use it.** Replace the query in `hasSmsOptIn` with:

```ts
  const { rows } = await getPool().query(
    `select sms_opted_in from ${tableName()} where id = $1`,
    [customerId],
  );
```

Keep the `rows.length === 0 → false` guard and the `Boolean(...)` coercion
exactly as they are.

**2c. Make `recordSmsOptIn` set the timestamp too.** Replace its whole body with:

```ts
  await getPool().query(
    `update ${tableName()}
        set sms_opted_in = true,
            sms_opted_in_at = now()
      where id = $1`,
    [customerId],
  );
```

The statement is idempotent by construction: a second call re-sets the same
values. It is an `update` (not an upsert) because the customer row always
exists by the time consent is recorded.

**2d.** Update the module doc comment. Replace:

```
 * Rule: never send an SMS without a logged consent record.
```

with:

```
 * Rule: never send an SMS without a logged consent record.
 *
 * This module is the ONLY authority for the rl_customers.sms_opted_in /
 * sms_opted_in_at pair. Nothing else in the codebase reads or writes those
 * columns. The outbound gate lives in sms-service.ts (sendSms); the write
 * point lives in worker/process-inbound-sms.ts.
```

**2e. Do not change** `getPool()`, the `DATABASE_URL` guard, the pool options
(`max: 5`, `connectionTimeoutMillis: 5000`,
`ssl: { rejectUnauthorized: false }`), or the exported function names.

## 3. `apps/api/src/services/sms-service.ts`

**3a. Add the import** on line 2, right after the ledger import:

```ts
import { hasSmsOptIn } from './consent-service.js';
```

**3b. Add the transactional-kind allowlist** immediately after the imports:

```ts
/**
 * Kinds that are part of a transaction the customer initiated and are
 * therefore not marketing messages: an OTP is the customer proving they can
 * receive at this number, and a slot-choice prompt is a reply to a booking we
 * already agreed with them. Every other kind is a proactive send and needs a
 * logged consent record.
 *
 * Refusal of these is deliberately NOT enforced here: failing to deliver an
 * OTP deadlocks the verification gate, and the gate is what produces consent.
 */
const TRANSACTIONAL_KINDS: ReadonlySet<MessagingKind> = new Set<MessagingKind>([
  'verification_code',
  'confirm_code',
  'number_verified',
  'code_mismatch',
  'confirm_failed',
]);
```

**3c. Add the gate function** below `sendSms` (or above it — placement is
yours, but keep it adjacent):

```ts
/**
 * The consent hard rule. A send that names a customer must be backed by a
 * logged consent record unless the kind is transactional.
 *
 * Sends with no customerId are out of scope by construction: staff
 * acknowledgements (worker/process-inbound-sms.ts) and manual dashboard
 * replies (routes/dashboard/messages.ts) address a person the tradesperson is
 * already in conversation with and never pass one.
 *
 * Throws rather than silently dropping: the caller decides whether to
 * escalate, and a silent drop looks identical to a Twilio outage.
 */
async function assertSmsConsent(input: SendSmsInput): Promise<void> {
  const customerId = input.customerId;
  if (!customerId) return;

  const kind = input.kind;
  if (kind && TRANSACTIONAL_KINDS.has(kind)) return;

  if (await hasSmsOptIn(customerId)) return;

  console.warn(
    '[sms] refused: no SMS consent record',
    JSON.stringify({ customerId, kind: kind ?? null, to: input.to }),
  );
  throw new Error(
    'sendSms: blocked — no SMS consent record for this customer (consent is recorded on their first inbound SMS)',
  );
}
```

**3d. Call it from `sendSms`, before the ledger insert.** Insert this as the
first statement of the `try` that wraps the Twilio call — i.e. **after** the
`from` and `to` validation and **after** the `ledgerRow` assignment is computed
but **before** any Twilio call:

```ts
  await assertSmsConsent(input);
```

The `ledgerRow` is intentionally still created. A refused send is a real
outcome the tradesperson must be able to see on the Messages page: it records
as `queued`, then the throw marks it `failed` through the existing
`catch`/`markFailed` path, exactly like a Twilio API error. Nothing is
silently absent from the ledger.

The important ordering invariant, which you must preserve: **no Twilio call
happens before `assertSmsConsent` returns.** The gate is the last thing before
the dry-run/credential block.

**3e. Update the module doc comment.** Add this bullet after the `T18 ledger:`
bullet:

```
 * - Consent hard rule: a send that names a `customerId` is refused unless
 *   the customer has a logged SMS consent record or the kind is a
 *   transactional OTP. See assertSmsConsent below.
```

**3f. Do not change** `SendSmsInput`, `SmsRecord`, `SentSms`, the
`TWILIO_SMS_DRY_RUN` branch, the credential guard, `createParams`, the
`[sms] sent` / `[sms] send failed` log lines, the `markFailed` catch, or the
rethrow.

**3g. Do not remove** the `channel` field from `SendSmsInput` or the
`channel` local. Task 1 keeps them; changing signatures is out of scope.

## 4. `apps/api/src/services/consent-service.test.ts`

The `SMS_CONSENT_ROW` const at the top of the file is unused — remove it.

**4a. Replace the `honors the CUSTOMERS_TABLE env override` test** with a test
that proves the override is now actually honored:

```ts
  it('honors the CUSTOMERS_TABLE env override in both functions', async () => {
    process.env.CUSTOMERS_TABLE = 'other_prefix_customers';
    mocks.query.mockResolvedValue({ rows: [{ sms_opted_in: true }] });

    const svc = await loadService();
    await svc.hasSmsOptIn('cust-1');
    await svc.recordSmsOptIn('cust-1');

    const [readSql] = mocks.query.mock.calls[0] as [string];
    const [writeSql, writeParams] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(readSql).toContain('from other_prefix_customers');
    expect(writeSql).toContain('update other_prefix_customers');
    expect(writeParams).toEqual(['cust-1']);
  });
```

**4b. Replace the `recordSmsOptIn is an idempotent update setting the flag true`
test** with one that also asserts the timestamp:

```ts
  it('recordSmsOptIn is one idempotent update setting the flag AND the timestamp', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await (await loadService()).recordSmsOptIn('cust-1');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('update public.rl_customers');
    expect(sql).toContain('sms_opted_in = true');
    expect(sql).toContain('sms_opted_in_at = now()');
    expect(sql).toContain('where id = $1');
    // Exactly one statement — no read-then-write, no upsert, no second query.
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(params).toEqual(['cust-1']);
  });
```

**4c.** Leave the other three tests (`hasSmsOptIn returns true/false`,
`hasSmsOptIn returns false when no customer row exists`, `throws when
DATABASE_URL is missing`) exactly as they are. Leave the `vi.mock('pg', ...)`
block, the `loadService()` helper, and both `beforeEach`/`afterEach` hooks
(`afterEach` already deletes `CUSTOMERS_TABLE`).

## 5. `apps/api/src/services/sms-service.test.ts`

**Restore the committed version first.** The working-tree copy is a stub that
mocks the module under test and asserts nothing:

```bash
git checkout HEAD -- apps/api/src/services/sms-service.test.ts
```

Then apply exactly these edits.

**5a.** In the `vi.hoisted` mock object, add the two consent mocks next to the
existing ledger mocks (`hasSmsOptIn`, `recordSmsOptIn`):

```ts
  hasSmsOptIn: vi.fn(),
  recordSmsOptIn: vi.fn(),
```

**5b.** Add the module mock, directly after the
`vi.mock('./outbound-ledger.js', ...)` block:

```ts
vi.mock('./consent-service.js', () => ({
  hasSmsOptIn: m.hasSmsOptIn,
  recordSmsOptIn: m.recordSmsOptIn,
}));
```

**5c.** In `beforeEach`, the loop `for (const fn of Object.values(m)) fn.mockReset();`
already covers the new mocks. Add one default so the pre-existing committed
tests keep passing without edits:

```ts
  m.hasSmsOptIn.mockResolvedValue(true);
```

**5d.** Add this new `describe` block at the end of the file. It is the proof
that the hard rule is enforced:

```ts
describe('sendSms — SMS consent hard rule', () => {
  const base = {
    to: '+15551234567',
    from: '+15559876543',
    body: 'your appointment is confirmed',
    organizationId: 'org-1',
  };

  it('refuses a proactive send to a customer with no consent record', async () => {
    m.hasSmsOptIn.mockResolvedValue(false);

    await expect(sendSms({ ...base, customerId: 'cust-1', kind: 'booking_confirmation' })).rejects.toThrow(
      /no SMS consent record/,
    );

    // No Twilio call, and the refusal is still visible in the ledger.
    expect(m.insertOutbound).toHaveBeenCalled();
    expect(m.markFailed).toHaveBeenCalled();
  });

  it('allows the send when the customer has a logged consent record', async () => {
    m.hasSmsOptIn.mockResolvedValue(true);

    await sendSms({ ...base, customerId: 'cust-1', kind: 'booking_confirmation' });

    expect(m.insertOutbound).toHaveBeenCalled();
    expect(m.markSent).toHaveBeenCalled();
  });

  it('allows each transactional OTP kind without consulting consent', async () => {
    const kinds = [
      'verification_code',
      'confirm_code',
      'number_verified',
      'code_mismatch',
      'confirm_failed',
    ] as const;

    for (const kind of kinds) {
      m.insertOutbound.mockClear();
      m.markSent.mockClear();
      m.hasSmsOptIn.mockClear();
      m.hasSmsOptIn.mockResolvedValue(false);

      await sendSms({ ...base, customerId: 'cust-1', kind });

      expect(m.hasSmsOptIn).not.toHaveBeenCalled();
      expect(m.markSent).toHaveBeenCalled();
    }
  });

  it('does not consult consent for a send with no customerId (staff ack, manual reply)', async () => {
    m.hasSmsOptIn.mockClear();

    await sendSms({ ...base, kind: 'staff_ack' });

    expect(m.hasSmsOptIn).not.toHaveBeenCalled();
    expect(m.markSent).toHaveBeenCalled();
  });

  it('checks consent for a customer send with no kind at all', async () => {
    m.hasSmsOptIn.mockResolvedValue(false);

    await expect(sendSms({ ...base, customerId: 'cust-1' })).rejects.toThrow(/no SMS consent record/);
  });
});
```

**5e.** If the restored file's helper for invoking `sendSms` is named
something other than `sendSms` (e.g. it imports the module dynamically as
`loadService()`), adapt the block in §5d to that helper's shape. Do **not**
change the helper itself.

**5f. Do not change** any other restored test in the file, and do not change
the `vi.mock('twilio', ...)` block or the dry-run tests.

## 6. Acceptance criteria

- [ ] `apps/api/src/services/consent-service.ts` has no literal
      `public.rl_customers` outside `tableName()`.
- [ ] `rg -n "hasSmsOptIn" apps/api/src` shows the definition in
      `consent-service.ts` and the import in `sms-service.ts` — and nothing in
      `outbound-ledger.ts` (Task 1 removed it there; if it is still there, Task 1
      has not run — report it).
- [ ] `rg -n "assertSmsConsent" apps/api/src/services/sms-service.ts` shows the
      call site **above** the `TWILIO_SMS_DRY_RUN` branch and **below** the
      `insertOutbound` call.
- [ ] `TRANSACTIONAL_KINDS` contains exactly the five named kinds.
- [ ] `apps/api/src/services/sms-service.test.ts` is the committed file plus
      only the §5 edits — `git diff` on it must show additions, not deletions of
      the committed tests.

## 7. Verification

```bash
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/api -- src/services/consent-service.test.ts src/services/sms-service.test.ts
```

Both must pass. Note that `sms-service.test.ts` may also be affected by Task 1
(its `vi.mock('./outbound-ledger.js', ...)` block may need to drop
`markRetried`). If it fails only on a `markRetried` reference, that is Task 1's
edit — report it, do not fix it here.
