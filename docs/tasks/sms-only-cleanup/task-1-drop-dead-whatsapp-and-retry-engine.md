# Task 1 brief — Drop the dead WhatsApp + fallback-retry surface

**Where this fits:** the repo is mid-refactor to SMS-only. The WhatsApp sender,
the SMS retry engine, and the `toChannelAddress` helper are all dead or unsound.
This task removes them and reduces the Twilio status callback to "record the
delivery report and stop".

**Depends on:** nothing. May run in parallel with Tasks 2 and 3.
**Blocks:** Task 5 (the green gate).

---

## 1. Files you own (edit nothing outside this list)

| Action | Path |
|---|---|
| delete | `apps/api/src/services/whatsapp-service.ts` |
| delete | `apps/api/src/services/whatsapp-service.test.ts` |
| delete | `apps/api/src/services/fallback-service.ts` |
| delete | `apps/api/src/services/fallback-service.test.ts` |
| edit | `apps/api/src/routes/twilio-status.ts` |
| edit | `apps/api/src/routes/twilio-status.test.ts` |
| edit | `apps/api/src/services/phone-utils.ts` |
| edit | `apps/api/src/services/phone-utils.test.ts` |
| edit | `apps/api/src/services/outbound-ledger.ts` |
| edit | `apps/api/src/services/outbound-ledger.test.ts` |

Use `git rm` for the deletions so git records them.

## 2. Deletions

Delete all four files. Before deleting, confirm nothing else imports them:

```bash
rg -n "whatsapp-service|fallback-service|handleFailedSms|processFailedSms|sendWhatsAppTemplate|toChannelAddress" apps packages
```

`processFailedSms` must appear **only** in `twilio-status.ts` and
`twilio-status.test.ts`, both of which you are editing below. If it appears
anywhere else, stop and report.

## 3. `apps/api/src/routes/twilio-status.ts`

**3a. Remove the import** (currently line 4):

```ts
import { processFailedSms } from '../services/fallback-service.js';
```

**3b. Replace the `failed` / `undelivered` case** with:

```ts
      case 'failed':
      case 'undelivered': {
        // Record the failure and stop. There is no retry engine this round —
        // see docs/tasks/sms-only-cleanup/DECISION.md. The row stays 'failed'
        // until a human acts; a later real delivery report is still recorded.
        await markStatus(row.id, 'failed', errorCode);
        break;
      }
```

**3c. Rewrite the header doc comment.** Replace the bullet that begins
`- failed/undelivered on an sms-channel row → handleFailedSms` (and the two
lines that follow it) with a single bullet:

```
 * - failed|undelivered → failed. No retry, no fallback, no new status: the
 *   row is recorded as 'failed' and the callback ends there.
```

Leave the other bullets (`Signature FIRST`, the form-encoded payload bullet, the
terminal-rows bullet, the "ALWAYS responds 200" bullet) untouched.

**3d. Do not change** the `queued`, `sent`, `delivered`, `default`, or terminal
branches, the `TERMINAL_STATUSES` check, or the signature-verification order.

## 4. `apps/api/src/routes/twilio-status.test.ts`

**4a.** Delete the `processFailedSms: vi.fn(),` line from the `vi.hoisted`
object and delete the whole block:

```ts
vi.mock('../services/fallback-service.js', () => ({
  processFailedSms: mocks.processFailedSms,
}));
```

**4b.** In `beforeEach`, delete the two lines
`mocks.processFailedSms.mockReset();` and
`mocks.processFailedSms.mockResolvedValue({ outcome: 'no_fallback', detail: 'mock' });`.

**4c.** Delete the two whole test cases:

- `failed (sms) → marks failed, runs the fallback engine, and re-marks retried | escalated | blocked_optin outcomes`
- `failed (sms) with no_fallback | no_template outcome → row stays failed (no re-mark)`

**4d.** Delete the whole test case
`failed on an sms-channel row → NO fallback re-try (this is the only channel)`.
Its replacement is the new test below, which is strictly stronger.

**4e.** In their place, add exactly one test case inside
`describe('POST /api/twilio/webhooks/status — T18 delivery reports', ...)`,
placed where the deleted cases were:

```ts
  it('failed / undelivered → marks the ledger failed once and stops (no retry engine)', async () => {
    const res = await callback('failed', { ErrorCode: '30007' });

    expect(res.status).toBe(200);
    // Exactly one ledger write: the failure. No retried/escalated/blocked_optin.
    expect(mocks.markStatus).toHaveBeenCalledTimes(1);
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'failed', '30007');

    const res2 = await callback('undelivered');
    expect(res2.status).toBe(200);
    expect(mocks.markStatus).toHaveBeenCalledTimes(2);
    expect(mocks.markStatus).toHaveBeenLastCalledWith('ledger-1', 'failed', null);
  });
```

**4f.** Remove the now-unresolvable assertion
`expect(mocks.processFailedSms).not.toHaveBeenCalled();` from the
`delivered → marks the ledger delivered (terminal)` test and from the
`terminal row (already delivered/retried/escalated) → 200 idempotent no-op` test.
Leave every other assertion in those two tests intact.

**4g.** Keep the `vi.mock('../services/outbound-ledger.js', ...)` block
unchanged, including `TERMINAL_STATUSES: ['delivered', 'retried', 'escalated']`.

## 5. `apps/api/src/services/phone-utils.ts`

Delete the whole `toChannelAddress` function **and** its preceding JSDoc block
(the one that starts `/** Build a channel address string from a bare E.164 phone
and channel.` and ends at the closing `}`). Nothing else in the repo calls it.

Leave `normalizeChannelAddress` and `countryCodeFromE164` as they are.

## 6. `apps/api/src/services/phone-utils.test.ts`

**6a. Restore the committed version first**, then edit:

```bash
git checkout HEAD -- apps/api/src/services/phone-utils.test.ts
```

**6b.** In the import on line 2, remove `toChannelAddress` from the named import
so it reads:

```ts
import { countryCodeFromE164, normalizeChannelAddress } from './phone-utils.js';
```

**6c.** Inside `describe('normalizeChannelAddress', ...)`:

- **Delete** `strips a whatsapp: prefix and reports the whatsapp channel`.
- **Replace** `is case-insensitive on the prefix and tolerant of surrounding whitespace` with:

```ts
  it('trims surrounding whitespace', () => {
    expect(normalizeChannelAddress('  +15551234567 ')).toEqual({
      channel: 'sms',
      e164: '+15551234567',
    });
  });
```

- **Delete** `preserves the bare E.164 for the worker gates (a whatsapp: address still normalizes E.164-shaped)`.
- **Keep** `returns sms + the address verbatim when there is no prefix` — but
  rename it to `returns the sms channel and the address verbatim when there is no prefix`.

**6d.** Delete the entire `describe('toChannelAddress', ...)` block (both its
tests).

**6e.** Inside `describe('countryCodeFromE164', ...)`, **replace** the test named
`accepts a whatsapp:-prefixed address (idempotent with normalize)` with:

```ts
  it('returns null for an address that is not bare E.164', () => {
    expect(countryCodeFromE164('whatsapp:+8801712345678')).toBeNull();
  });
```

Leave the other three `countryCodeFromE164` tests exactly as committed
(including their `// BD — longest prefix wins` style trailing comments).

**6f.** Make sure the file ends with a trailing newline.

## 7. `apps/api/src/services/outbound-ledger.ts`

**7a.** Delete the whole `markRetried` function and the whole
`hasSmsOptIn` function (both currently sit between the `OutboundRow` type and
`let pool: Pool | null = null;`). The ledger owns no consent.

**7b.** Change `export type OutboundRow = {` back to `interface OutboundRow {`
(only `toRow` and the internal `query<OutboundRow>` generics use it, both in this
file).

**7c.** Replace the `Status lifecycle (migration 014 CHECK):` comment block in
the module header with:

```
 * Status lifecycle (migration 014 CHECK):
 *   queued --insert--> queued (message_sid NULL)
 *   queued --markSent--> sent (+message_sid)
 *   sent  --status callback--> delivered | failed
 *
 * Terminal states — 'delivered' | 'retried' | 'escalated' — are write-once:
 * every UPDATE carries a `status <> all terminal states` guard, so a late or
 * duplicated Twilio callback is a no-op. 'blocked_optin' is intentionally NOT
 * terminal: it is a pre-delivery consent refusal, and a subsequent real
 * delivery report for the same SID is still recorded.
 *
 * No component writes 'retried' | 'escalated' | 'blocked_optin' today. The
 * values stay in the migration CHECK, in OutboundStatus and in the label maps
 * so historical rows keep rendering, but the SMS delivery-failure retry is
 * out of scope — see docs/tasks/sms-only-cleanup/DECISION.md.
```

Also change the first line of the header from
`tracked outbound SMS message, updated by the Twilio StatusCallback` — it is
already correct in the working tree; leave it.

**7d. Do not change** `TERMINAL_STATUSES`, `TERMINAL_GUARD`, `insertOutbound`,
`markSent`, `markFailed`, `markStatus`, `getByMessageSid`,
`getOutboundMessages`, `toMessageRowDto`, `formatRelativeDisplay`,
`MESSAGE_KIND_LABEL`, `MESSAGE_STATUS_LABEL`, `tableName()`, or `getPool()`.

## 8. `apps/api/src/services/outbound-ledger.test.ts`

The working-tree version mocks the module under test — it asserts nothing real.
Restore the committed version and apply exactly three edits.

**8a.**

```bash
git checkout HEAD -- apps/api/src/services/outbound-ledger.test.ts
```

**8b.** In the test `appends channel then status params when both filters are
present`, replace every `'whatsapp'` with `'sms'`. That means three places:
the `getOutboundMessages('org-1', { channel: 'whatsapp', ... })` argument, and
the two expected param arrays
`['org-1', 'whatsapp', 'failed']` and `['org-1', 'whatsapp', 'failed', 20, 0]`.

**8c.** In the test `maps rows to MessageRowDto: kind/status labels, errorCode/messageSid passthrough, createdAt preserved`:

- delete the entire `const waRow = { ... };` declaration;
- change the second `mockResolvedValueOnce` to return `rows: [smsRow]` only;
- change `expect(total).toBe(2);` → `expect(total).toBe(1);`
- change `expect(messages).toHaveLength(2);` → `expect(messages).toHaveLength(1);`
- delete the entire `expect(messages[1]).toMatchObject({ ... });` block;
- keep the `expect(messages[0]).toMatchObject({ ... });` block unchanged.

**8d. Do not change** any other test in the file, and do not change the
`vi.mock('pg', ...)` block — it is what makes these tests real.

## 9. Acceptance criteria

- [ ] `git status` shows 4 deletions and 6 modifications, all from the table in §1.
- [ ] `rg -n "whatsapp" apps/api/src --glob '!node_modules' -i` returns **no**
      matches in any `.ts` file. (`process-inbound-sms.ts` may still have one
      comment mention — that is Task 4's file, not yours. If
      `rg -i whatsapp` still shows it, ignore; do not edit that file.)
- [ ] `rg -n "fallback-service|whatsapp-service" apps` returns nothing.
- [ ] `apps/api/src/services/phone-utils.ts` exports exactly
      `normalizeChannelAddress` and `countryCodeFromE164`.
- [ ] `apps/api/src/services/outbound-ledger.ts` exports no `hasSmsOptIn` and no
      `markRetried`.

## 10. Verification

```bash
npm run typecheck --workspace=apps/api
npm run test --workspace=apps/api -- src/routes/twilio-status.test.ts src/services/phone-utils.test.ts src/services/outbound-ledger.test.ts
```

Both must pass. (`twilio-status.test.ts` uses `createApp()`, which mounts every
route — if the app fails to boot because of a module you did not touch, report
it rather than editing a file you do not own.)
