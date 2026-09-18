## `@tradescheduler/ai` — Provider-Agnostic LLM Layer

A workspace package in the npm workspaces monorepo providing a provider-agnostic
LLM interface with Zod-validated structured output, pluggable LLM adapters, a
rule-based fallback (explicit, not a replacement), and the orchestration policy
that classifies one inbound SMS.

### What it does

- **Provider interface** (`src/provider.ts`, `AIProvider`): `generateStructured()`,
  `generateText()`, `metadata()`.
- **Structured schema** (`src/structured.ts`, `InboundParseSchema`): 8 intents
  (`new_booking`, `reschedule`, `cancel`, `question`, `emergency`, `slot_choice`,
  `confirm`, `unknown`) + structured fields (service_description, customer_name,
  preferred_date, preferred_time_start, preferred_time_end, urgency,
  missing_information, confidence).
- **Pluggable adapters** (`src/providers/`): OpenAI, Ollama, Census — selected at
  runtime by `AI_PROVIDER` via the `createProvider()` factory.
- **Rule-based fallback** (`src/fallback.ts`): wraps `parseIntent()` from
  `@tradescheduler/shared`. Explicit fallback — never a silent replacement.
- **Orchestration** (`classifyStep` in `src/index.ts`), exact policy:
  1. Context hint (`suggestedIntent`) short-circuits — no LLM, no parser.
  2. LLM succeeds with conf >= 0.7 → LLM result wins.
  3. Rule parser runs on **every** call. Superset guarantee: a rule intent at
     conf >= 0.9 overrides a conflicting LLM result that would otherwise win
     (LLM >= 0.7) → `source: "merged"`, LLM usage preserved.
  4. LLM failed / < 0.7 → rule intent at conf >= 0.7 wins (`source: "rule"`).
  5. Both unknown → escalate, never guess (`source: "escalation"`).

### Provider selection & environment

Default is `AI_PROVIDER=fallback-only` — rule-based parser only, no API key
required. Set `AI_PROVIDER` to opt into an LLM provider; a selected provider
with a missing API key fails fast at construction (never silently degrades).

| Provider       | Environment variables                                        |
| -------------- | ------------------------------------------------------------ |
| `openai`       | `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`)      |
| `ollama`       | `OLLAMA_API_KEY`, `OLLAMA_MODEL`, `OLLAMA_BASE_URL`           |
| `census`       | `CENSUS_API_KEY`, `CENSUS_MODEL`, `CENSUS_BASE_URL`           |
| `fallback-only`| —                                                            |

All variables are documented in the repo root `.env.example`.

### Usage

```ts
import { createProvider, classifyStep } from "@tradescheduler/ai";

// env-driven (AI_PROVIDER), or pass an explicit mode:
const provider = createProvider("openai"); // { apiKey?, model? } optional
await createProvider(); // reads AI_PROVIDER from the environment

const result = await classifyStep(
  provider,
  { body: smsBody, conversationStateExists, suggestedIntent },
  onEscalate,      // async (input: EscalationInput) => Promise<void>
  requestId,       // stable id tied to logs + future cost records
);
// result: { intentResult: { intent, confidence }, aiUsage, source, requestId }
// aiUsage is the real token usage when the LLM was called; null for rule/context paths.
```

### Running tests

From the repo root (workspaces):

```bash
npx vitest run packages/ai
npx -w packages/ai tsc --noEmit
```
