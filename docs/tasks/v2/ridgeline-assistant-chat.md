# RidgeLine Assistant — implementation plan

Chat widget ("RidgeLine Assistant") for the tradesperson: POST /api/assistant, backed by
@tradescheduler/ai `runSupportAssistant`, with escalation + AI-cost ledger side effects.
6 tasks. Dependency chain: T1 → T2 → T3 → T4 → T6; T5 is independent (parallel with T2–T4).

## Global constraints

- ESM throughout. Tests colocated `*.test.ts` (Vitest; apps/api has no config → default
  `src/**/*.test.ts` include; packages/ai has `vitest.config.ts`). Route tests use
  `createApp() + app.listen(0) + fetch` (no supertest). Services that touch pg are tested
  via `vi.hoisted` + `vi.mock('pg', ...)` or by mocking the service module directly
  (`vi.mock('../services/x.js', () => ({...}))`).
- `@tradescheduler/shared` is types-only: `import type` / `export type` only; flat files,
  exported through `src/index.ts` as `export * from './<file>.js'`. Worker-independent.
- `createProvider()` (packages/ai/src/compose.ts) reads `AI_PROVIDER` env, default
  `fallback-only`. `RuleBasedFallbackProvider.generateText()` returns `{ text: "", usage:
  { tokensInput: 0, tokensOutput: 0, model: "builtin/parseIntent" } }` — treat empty text as
  "provider unavailable" and answer with a canned, grounded reply.
- Ledger writes only for real LLM calls: skip `recordAiUsage` when
  `usage.tokensInput + usage.tokensOutput === 0`. `recordAiUsage.source` union is
  `'llm' | 'merged'` → always pass `'llm'`; omit `estimatedCostUsd` (service auto-computes).
- `createEscalation({ type, customerPhone, content })` requires `customerPhone` —
  default to `'unknown'` (precedent: classifyStep). New escalation type
  `'customer_escalation'` is a CHECK-widening only (no data backfill).
- API error contract for /api/assistant: `400 { error: 'invalid_body' }`,
  `401 { error: 'missing_token' } / { error: 'invalid_token' }` (from `requireAuth`),
  `500 { error: 'server_error' }`. Web auth: `middleware.ts` gates /dashboard on
  `ts_session` cookie; `authedFetch` (apps/web/lib/auth.ts) attaches Bearer from that
  cookie. Widget lives in `app/layout.tsx` (globally mounted), so it must handle 401
  gracefully on marketing pages.

---

## T1 — shared assistant types + EscalationType extension

Files:
- CREATE `packages/shared/src/assistant-types.ts` — exact content:

  ```ts
  // RidgeLine Assistant chat contract (tradesperson ↔ assistant widget, POST /api/assistant).
  export type AssistantRole = 'user' | 'assistant';

  export type AssistantMessage = {
    role: AssistantRole;
    content: string;
  };

  export type AssistantAction = 'none' | 'reschedule' | 'billing' | 'emergency';

  export type AssistantChatRequest = {
    /** Chat history; the LAST message must have role 'user'. */
    messages: AssistantMessage[];
    /** Optional server-provided context (e.g. today's appointments summary). */
    contextSnippet?: string;
    /** Display name of the tradesperson the assistant fronts for. */
    tradespersonName?: string;
    /** Customer phone (E.164-ish) when the thread concerns one customer; used for escalations. */
    customerPhone?: string;
  };

  export type AssistantChatResponse = {
    reply: string;
    action: AssistantAction;
    /** True when an escalation row was created for this turn (billing / emergency). */
    escalated: boolean;
  };
  ```

- EDIT `packages/shared/src/types.ts` — widen `EscalationType` (line ~202): append
  `| 'customer_escalation'` to the union (6 values now).
- EDIT `packages/shared/src/index.ts` — add `export * from './assistant-types.js';`

Verify: `npm run typecheck --workspace=packages/shared`

## T2 — packages/ai: runSupportAssistant + grounded fallback

Files:
- CREATE `packages/ai/src/support-assistant.ts`
- EDIT `packages/ai/src/index.ts` (append exports block)
- CREATE `packages/ai/src/support-assistant.test.ts`

Key implementation:
- `export const RIDGELINE_SUPPORT_SYSTEM_PROMPT = "You are RidgeLine Assistant, the front-desk\nsupport agent for a solo tradesperson (plumbing / HVAC / electrical). Rules:\n- Reply in plain text, 1-4 short sentences. Friendly and professional.\n- NEVER invent bookings, dates, prices, deposits, or availability that are not in the context.\n- If you do not know the answer, say you will flag it for the tradesperson to confirm.\n- If the customer reports an emergency, tell them to call the tradesperson's business line directly.\n"`
- `export function buildSupportSystemPrompt(opts: { contextSnippet?: string; tradespersonName?: string; history: AssistantMessage[] }): string` — returns the system prompt = `RIDGELINE_SUPPORT_SYSTEM_PROMPT` + `\n\nContext:\n${contextSnippet ?? '(none provided)'}` + `\n\nTradesperson: ${tradespersonName ?? 'your tradesperson'}` + `\n\nChat history:\n` + history flattened as one line each: `'Customer: ' + content` for role 'user', `'RidgeLine: ' + content` for role 'assistant'.
- `export function supportFallbackReply(tradespersonName?: string): string` — returns
  `` `Thanks for your message. I can't reach my scheduling system right now, so I've noted your question and will have ${tradespersonName ?? 'your tradesperson'} follow up with you shortly.` ``
- `export interface SupportAssistantInput { provider: AIProvider; messages: AssistantMessage[]; contextSnippet?: string; tradespersonName?: string; }`
- `export interface SupportAssistantResult { reply: string; usage: AiUsage; }`
- `export async function runSupportAssistant(input: SupportAssistantInput): Promise<SupportAssistantResult>`:
  1. Guard: `messages` non-empty AND last `role === 'user'`; else `throw new Error('support-assistant: last message must have role "user"')`.
  2. `history = messages.slice(0, -1)`; compose system via `buildSupportSystemPrompt`.
  3. `try { const { text, usage } = await provider.generateText({ prompt: lastMessage.content, system, maxTokens: 512 }); }` — if `text.trim() === ''` return `{ reply: supportFallbackReply(input.tradespersonName), usage }` (this is the fallback-provider path). Otherwise `{ reply: text, usage }`.
  4. `catch` → return `{ reply: supportFallbackReply(input.tradespersonName), usage: { tokensInput: 0, tokensOutput: 0, model: provider.metadata().model } }`.
- index.ts exports:
  `export { runSupportAssistant, RIDGELINE_SUPPORT_SYSTEM_PROMPT, buildSupportSystemPrompt, supportFallbackReply } from './support-assistant.js';`
  `export type { SupportAssistantInput, SupportAssistantResult } from './support-assistant.js';`

Tests (TDD — write tests first, see them fail on missing module): FakeProvider implementing
`AIProvider` with `metadata()` → `{ name: 'fake', model: 'fake/model', supportsStructured: false }`,
`generateStructured` → throws, `generateText` → configurable per test. Cases:
1. non-empty reply passes through; `generateText` called with `prompt === last user content`, `system` containing flattened `Customer: …` / `RidgeLine: …` lines, the context snippet, and the tradesperson name.
2. empty-string reply → `supportFallbackReply(name)`, usage preserved from provider.
3. whitespace-only reply → fallback reply.
4. `generateText` throws → fallback reply + zero usage.
5. empty messages / last role 'assistant' → promise rejects.

Verify: `npm run test --workspace=packages/ai` && `npm run typecheck --workspace=packages/ai`

## T3 — apps/api: assistant.service.ts

Files:
- CREATE `apps/api/src/services/assistant.service.ts`
- CREATE `apps/api/src/services/assistant.service.test.ts`

Key implementation:
- Imports: `randomUUID` from `node:crypto`; `runSupportAssistant` from `@tradescheduler/ai`; `createEscalation` from `./escalation-service.js`; `recordAiUsage` from `./ai-usage-service.js`; types `AssistantChatRequest, AssistantChatResponse, AssistantAction` from `@tradescheduler/shared`; `type AIProvider` from `@tradescheduler/ai`.
- Keyword regex constants (tested values, lowercase):
  `const EMERGENCY_RE = /emergency|burst|flood|gas leak|carbon monoxide|fire/i;`
  `const BILLING_RE = /bill|invoice|charge|refund|deposit|payment/i;`
  `const RESCHEDULE_RE = /reschedule|reschedul|move (my|the) appointment/i;`
- `export interface AssistantServiceDeps { provider: AIProvider; organizationId?: string | null; }`
- `export async function handleAssistantChat(input: AssistantChatRequest, deps: AssistantServiceDeps): Promise<AssistantChatResponse>` — order matters: emergency → billing → reschedule → none.
  1. `lastContent = input.messages[input.messages.length - 1].content`.
  2. If `EMERGENCY_RE.test(lastContent)`: `await createEscalation({ type: 'customer_escalation', customerPhone: input.customerPhone ?? 'unknown', content: '[assistant emergency] ' + lastContent })`; return `{ reply: emergencyReply(tradespersonName), action: 'emergency', escalated: true }` where `emergencyReply(name) = "If this is a life-threatening emergency, call 911 now. Otherwise please call " + (name ?? 'your tradesperson') + " directly — I can't dispatch urgent help from here."` (no provider call, no ledger write).
  3. Else `const result = await runSupportAssistant({ provider: deps.provider, messages: input.messages, contextSnippet: input.contextSnippet, tradespersonName: input.tradespersonName });`
  4. `let action: AssistantAction = 'none'; let escalated = false;` — if `BILLING_RE.test(lastContent)`: `action='billing'; escalated=true;` and `await createEscalation({ type: 'customer_escalation', customerPhone: input.customerPhone ?? 'unknown', content: lastContent })`. Else if `RESCHEDULE_RE.test(lastContent)`: `action='reschedule'`.
  5. If `result.usage.tokensInput + result.usage.tokensOutput > 0`: `await recordAiUsage({ requestId: randomUUID(), provider: deps.provider.metadata().name, model: result.usage.model, tokensInput: result.usage.tokensInput, tokensOutput: result.usage.tokensOutput, source: 'llm', organizationId: deps.organizationId ?? null });`
  6. Return `{ reply: result.reply, action, escalated }`.

Tests: `vi.hoisted` mocks → `vi.mock('../services/escalation-service.js', () => ({ createEscalation: mocks.createEscalation }))`, `vi.mock('../services/ai-usage-service.js', () => ({ recordAiUsage: mocks.recordAiUsage }))`. FakeProvider injected via deps. Cases:
1. normal LLM reply + nonzero usage → reply passthrough, `recordAiUsage` called once with `{ provider: 'fake', model: 'fake/model', tokensInput: 100, tokensOutput: 50, source: 'llm' }`, `action: 'none'`, `escalated: false`, `createEscalation` not called.
2. empty-text (fallback) → `supportFallbackReply` text, `recordAiUsage` NOT called.
3. "there is a gas leak right now" → `createEscalation` called with type `'customer_escalation'`, `customerPhone: 'unknown'` when input omits customerPhone, no `recordAiUsage`, `action: 'emergency'`, `escalated: true`.
4. "the invoice for the deposit looks wrong" → `action: 'billing'`, `escalated: true`, `createEscalation` called.
5. "please reschedule Tuesday's appointment" → `action: 'reschedule'`, `escalated: false`, `createEscalation` NOT called.

Verify: `npm run test --workspace=apps/api` && `npm run typecheck --workspace=apps/api`

## T4 — apps/api: POST /api/assistant route + mount

Files:
- CREATE `apps/api/src/routes/assistant.ts`
- CREATE `apps/api/src/routes/assistant.test.ts`
- EDIT `apps/api/src/app.ts`

Key implementation:
- Zod body schema in `routes/assistant.ts`:
  ```ts
  const assistantMessageSchema = z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(4000),
  });
  const assistantBody = z
    .object({
      messages: z.array(assistantMessageSchema).min(1),
      contextSnippet: z.string().max(4000).optional(),
      tradespersonName: z.string().trim().max(80).optional(),
      customerPhone: z.string().trim().regex(/^\+?[1-9][0-9]{1,14}$/).optional(),
    })
    .refine((b) => b.messages[b.messages.length - 1].role === 'user', {
      message: 'last message must be from the user',
    });
  ```
- `router.post('/', requireAuth, async (req, res) => { ... })`:
  - `const parsed = assistantBody.safeParse(req.body);` — on failure `400 { error: 'invalid_body' }`.
  - `const provider = createProvider();` (env-driven, default fallback-only).
  - `const org = await getOrgContextByUserId(req.auth!.userId).catch(() => null);` — `organizationId: org?.organizationId ?? null` (missing org is NOT fatal here, unlike inbox).
  - `const body = await handleAssistantChat(parsed.data, { provider, organizationId: orgId });` → `res.json(body)`.
  - catch → `console.error('[assistant] error:', err);` → `res.status(500).json({ error: 'server_error' })`.
- `app.ts`: import `assistantRouter` from `./routes/assistant.js`; add `app.use('/api/assistant', assistantRouter);` after `mountDashboardRoutes(app);`.

Tests (`routes/assistant.test.ts`, copy auth.test.ts scaffolding: `JWT_SECRET`, sign token with `jwt.sign({ sub: USER_ID }, JWT_SECRET, { issuer: 'tradescheduler' })`):
- `vi.hoisted` mock `handleAssistantChat` + mock `../services/assistant.service.js`; mock `../services/organization-service.js` (`getOrgContextByUserId` → resolves `{ organizationId: 'org-1', timezone: 'America/New_York' }`).
1. valid body + Bearer header → 200 with the mocked `{ reply, action, escalated }` echoed.
2. invalid body (empty `messages`, role `'gopher'`, last role `'assistant'`, 4001-char content) → 400 `{ error: 'invalid_body' }`.
3. no Authorization header → 401 `{ error: 'missing_token' }`.
4. `handleAssistantChat` rejects → 500 `{ error: 'server_error' }`.

Verify: `npm run test --workspace=apps/api` && `npm run typecheck --workspace=apps/api`

## T5 — migration 012: widen rl_escalations.type CHECK

Files:
- CREATE `apps/api/src/db/migrations/012-assistant-escalation-type.sql`
- EDIT `apps/api/scripts/db-migrate.mjs` (MIGRATIONS array)
- EDIT `apps/api/scripts/local-db.mjs` (MIGRATIONS array)
- EDIT `supabase/schema.sql` (rl_escalations CHECK block)

Key implementation:
- Migration (idempotent widen, pattern from 011-confirmation-codes.sql):
  ```sql
  -- Migration 012: widen rl_escalations.type CHECK for the RidgeLine Assistant
  -- ('customer_escalation' — created when the assistant flags billing/emergency turns).
  -- Idempotent: local-db.mjs re-applies all migrations on every boot. Widening does
  -- NOT rewrite existing rows — every legacy type is still valid under the new CHECK.
  alter table public.rl_escalations
    drop constraint if exists rl_escalations_type_check,
    add constraint rl_escalations_type_check check (type in (
      'ambiguous_intent', 'no_availability', 'calendar_api_failure',
      'sms_delivery_failure', 'processing_error', 'customer_escalation'
    ));
  ```
- Append `"012-assistant-escalation-type.sql",` after `"011-confirmation-codes.sql",` in BOTH `apps/api/scripts/db-migrate.mjs` and `apps/api/scripts/local-db.mjs`.
- `supabase/schema.sql`: in the rl_escalations CREATE block add `'customer_escalation'` to the type CHECK list (same 6 values).

Verify: `npm run db:local --workspace=apps/api` (re-applies all migrations; look for `[local-db] applied 012-assistant-escalation-type.sql`). Review with `git --no-pager diff -- apps/api/src/db/migrations apps/api/scripts supabase/schema.sql`.

## T6 — apps/web: RidgeLineAssistant chat widget

Files:
- CREATE `apps/web/components/assistant/RidgelineAssistant.tsx`
- EDIT `apps/web/app/layout.tsx`

Key implementation:
- `"use client"`; imports: `useState` from react; icons `Sparkles, Send, X` from `lucide-react`; `authedFetch` from `../../lib/auth` (component at `components/assistant/` → repo-root web lib is two levels up).
- State: `open`, `messages` (local only, init with one assistant message: `"Hi, I'm RidgeLine Assistant. Ask me about today's schedule, moving an appointment, or anything customer-facing."`), `input`, `busy`, `error`.
- Toggle button: `fixed bottom-5 right-5 z-50` accent button; when closed show Sparkles icon + skeleton text; panel when open: `fixed bottom-20 right-5 z-50 w-[22rem] h-[28rem] flex flex-col rounded-xl border border-border bg-surface text-ink shadow-card` (Tailwind tokens from tailwind.config.ts: bg/surface/ink/border/accent — dark mode via `data-theme` / `.dark`).
- Message list `flex-1 overflow-y-auto`; user bubbles `bg-accent text-accent-ink rounded-xl`, assistant bubbles `bg-surface-2 rounded-xl`; entry row: input `flex-1 bg-surface-2 border border-border rounded-xl px-3 py-2` + Send button, disabled while `busy`.
- Submit: `authedFetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [...messages, userMsg], tradespersonName: undefined }) })`. On ok → push assistant reply; if `body.escalated` also push a second short assistant bubble `"I've flagged this for follow-up."`. On `401` → `error = 'Sign in to use RidgeLine Assistant.'` and keep the widget usable (retry allowed). Other non-ok → `error = 'Something went wrong on our end. Try again.'`. On ok clear error.
- `layout.tsx`: import the component; in `<body className="font-sans min-h-dvh">`, after `{children}` add `<RidgeLineAssistant />`.
- No web component test infra — verification is build + manual.

Verify: `npm run build --workspace=apps/web`; manual: `npm run dev --workspace=apps/api` + `npm run dev --workspace=apps/web -- -p 3100`, open http://localhost:3100, open widget, send a message → with `AI_PROVIDER` unset expect the canned grounded fallback (`supportFallbackReply`) proving the empty-text path end-to-end; send "reschedule my job" → reply plus `reschedule` action path.