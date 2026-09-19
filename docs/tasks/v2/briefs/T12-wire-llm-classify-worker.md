# T12 — Wire LLM classifyStep + cost ledger into the SMS worker

## Goal
Replace the worker's direct rule-based `parseIntent` call with `classifyStep`
from `@tradescheduler/ai` (LLM-first, rule-fallback, superset guarantee), and
persist one `rl_ai_usage` row per real LLM call via `recordAiUsage`.
Backwards-compatible: with `AI_PROVIDER` unset (default `fallback-only`) the
behavior is IDENTICAL to today (rule parser only, zero LLM calls).

## Files to change
1. `apps/api/src/worker/process-inbound-sms.ts` — the wiring (below).
2. `apps/api/src/worker/process-inbound-sms.test.ts` — retarget mocks + new tests.
3. `apps/api/src/services/ai-usage-service.ts` — update the stale header comment
   ("no production wiring exists yet" — now wired).

## Exact requirements

### A. Replace the classify call (process-inbound-sms.ts:105)
Current: `const { intent, confidence } = parseIntent(body, conversationStateExists);`

New:
```ts
import { randomUUID } from 'node:crypto';  // top of file
import { classifyStep, createProvider } from '@tradescheduler/ai';  // top of file, keep existing local imports
import { recordAiUsage } from '../services/ai-usage-service.js';   // top of file

const requestId = randomUUID();
const provider = createProvider(); // reads AI_PROVIDER env; default fallback-only → rule parser
const result = await classifyStep(
  provider,
  { body, conversationStateExists, suggestedIntent: null },
  // onEscalate — classifyStep passes customerPhone "unknown"; override with the REAL phone
  async (input) => {
    await createEscalation({
      type: input.type,
      customerPhone,
      content: input.content,
    });
  },
  requestId,
);
```
Then use `result.intentResult` for the switch:
- `const { intent, confidence } = result.intentResult;` (keeps the existing switch untouched).

### B. Record usage (still inside processInboundSms, after classifyStep, before/after the switch — before is fine)
```ts
if (result.aiUsage) {
  await recordAiUsage({
    requestId,
    provider: provider.metadata().name, // 'openai' | 'census' | 'ollama'; unknown → cost 0
    model: result.aiUsage.model,
    tokensInput: result.aiUsage.tokensInput,
    tokensOutput: result.aiUsage.tokensOutput,
    source: result.source,              // 'llm' | 'merged' only appear when aiUsage != null
    organizationId,                     // already resolved at line ~60; may be null
  });
}
```
`recordAiUsage` must NOT throw the whole job when the insert fails — wrap in
try/catch, log `[worker] ai-usage record failed`, continue. Classification
result already happened; the ledger is observability, never a kill-switch.

### C. Escape the double-escalation trap
`classifyStep` escalates internally (step 7) for unclassifiable messages and
returns `source: 'escalation'` with intent 'unknown'. The worker switch's
`unknown`/`default` cases ALSO call `escalateAmbiguousIntent` → would create
TWO escalation rows for one message. Fix: in the switch's `unknown` and
`default` cases, only escalate when `result.source !== 'escalation'`:

```ts
case 'unknown': {
  if (result.source !== 'escalation') await escalateAmbiguousIntent(customerPhone, body);
  break;
}
default: {
  if (result.source !== 'escalation') await escalateAmbiguousIntent(customerPhone, body);
}
```

### D. Tests (process-inbound-sms.test.ts)
The test mocks `../services/intent-service.js` parseIntent (line 39). Retarget:
- Add `vi.mock('@tradescheduler/ai', ...)` exposing `classifyStep` + `createProvider`
  vi.fn()s alongside the existing m.hoisted block. `createProvider` → returns a trivial
  stub provider (can be `{} as any` — only `.metadata().name` is used post-classify).
- Add `vi.mock('../services/ai-usage-service.js', ...)` exposing `recordAiUsage`.
- Existing `m.parseIntent.mockReturnValue({intent:'help',confidence:1})` (line 149)
  → `m.classifyStep.mockResolvedValue({ intentResult: { intent: 'help', confidence: 1 }, aiUsage: null, source: 'rule', requestId: 'rid' })`.
- Keep all existing assertions passing (org resolved, customer/conv/message created, dispatch).
- NEW tests (at least 4):
  1. LLM path: classifyStep returns `{ intentResult: { intent: 'reschedule', confidence: 0.95 }, aiUsage: { tokensInput: 100, tokensOutput: 40, model: 'gpt-4o-mini' }, source: 'llm', requestId }` → `recordAiUsage` called with provider 'openai', source 'llm', organizationId 'org-1', matching tokens/model. Verify a reschedule flow kicks off (reschedule-service called).
  2. Rule path: aiUsage null + source 'rule' → `recordAiUsage` NOT called.
  3. Escalation source: classifyStep returns source 'escalation', intent 'unknown' → `createEscalation` called EXACTLY ONCE (no double row), `escalateAmbiguousIntent` NOT called.
  4. recordAiUsage failure: make `recordAiUsage` reject → job still completes without throwing (processInboundSms resolves; the message still dispatches on intent).

### E. Comment fix (ai-usage-service.ts)
Update lines ~5-9: replace "no production wiring exists yet — the worker will
call recordAiUsage() next to classifyStep once Checkpoint 03+ hooks land" with
a note that it IS wired in worker/process-inbound-sms.ts (T12).

## Explicitly out of scope
- No schema change (rl_ai_usage exists, org column added in RL_010).
- No new worker job types; no render.yaml/env changes; no web changes.
- Do NOT update provider rate table (only 'openai' has rates; others cost 0 — acceptable).
- Do NOT touch intent-parser or packages/ai — classifyStep is already complete+tested.

## Verify (required, in order)
1. `cd /h/tradescheduling && npm run typecheck --workspace=apps/api` (or `npx tsc --noEmit -p apps/api` if no typecheck script) — clean except pre-existing known errors (RescheduleLogEntry TS2304, Escalation TS2694 if still present) — report which.
2. `cd /h/tradescheduling && npm test --workspace=apps/api` — full suite green; report tail counts. Pre-existing cold-run flakes (process-inbound-sms timeout, google-auth) may appear; re-run those files in isolation to prove green.
3. `cd /h/tradescheduling && npm run build --workspace=apps/api` — green.
4. Sanity grep: no remaining `import { parseIntent }` in worker files (intent-service no longer used there); `git grep -n "parseIntent" apps/api/src/worker/` → zero.

## Report
Return: (a) the exact diff summary per file, (b) test/build tail output, (c) confirmation of the double-escalation guard and the recordAiUsage try/catch, (d) any surprises. Do NOT commit.
