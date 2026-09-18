## `@nestedstack/ai` — Provider-Agnostic LLM Layer

A standalone npm package (`packages/ai/`) providing a provider-agnostic LLM interface with Zod-validated structured output, an OpenAI adapter (first wired provider), a rule-based fallback (explicit, not a replacement), and fallback policy orchestration.

### What it does

- **Provider interface** (`AIProvider`): `generateStructured()`, `generateText()`, `getUsage()`.
- **Structured schema** (`InboundParseSchema`): 6 intents (`new_booking`, `reschedule`, `cancel`, `question`, `emergency`, `unknown`) + structured fields (service, customer_name, preferred_date, preferred_time_start, preferred_time_end, urgency, missing_information, confidence).
- **OpenAI adapter**: structured output via `response_format: { type: "json_schema" }`, usage tracking, retry logic, error mapping (provider_unavailable, rate_limited, auth, schema_rejection).
- **Rule-based fallback**: wraps the existing `parseIntent()` from `@nestedstack/shared` — NOT deleted, NOT replaced.
- **Fallback policy** (`classifyInbound`): LLM first → if fails/low confidence → rule-based parser → if both unknown → escalate, never guess. Superset guarantee: rule-based high-confidence intent (>=0.9) wins over LLM.

### When to use

Use this package whenever the system needs to classify an inbound message, extract structured intent data, or call an LLM with Zod-validated output. The existing rule-based parser remains the explicit fallback for high-confidence keyword matches.

### Provider choice: OpenAI (gpt-4o-mini)

Justification: cleanest structured-output API, mature SDK, cheap ($0.15/1M input tokens), fast, capable enough for short SMS intent classification. The interface is provider-agnostic, so other providers (Anthropic, Ollama, etc.) can be wired later without changing the orchestration layer.

## Planned work (not started)

- **Checkpoint 03**: Customer + Conversation domain — `customers`, `customer_addresses`, `conversations`, `messages` tables, `findOrCreateCustomer`, `findOrCreateConversation`, `appendMessage` services, migration + tests.
- **Checkpoint 04**: Booking / Appointment domain — `appointments` table, concrete `BookingLookupFn` implementation, wire into `process-inbound-sms.ts`.
- **Checkpoint 05**: Real Scheduling Engine — `SchedulingEngine` service with `getAvailability()`, `createHold()`, `confirmBooking()`, etc. on top of calendar-service.ts.
- **Checkpoint 06**: AI Booking Agent — wire `@nestedstack/ai` + conversation domain + scheduling engine into a conversational booking agent.
- **Checkpoint 07**: Production communications hardening — idempotency, rate limiting, retry/dead-letter, delivery status tracking, CVE audit.
- **Checkpoint 08**: Replace dashboard fixtures with real API-backed data.
- **Checkpoint 09**: Technicians + Dispatch + Job Lifecycle.
- **Checkpoint 10**: Revenue Loop — missed-call recovery, follow-up automation, analytics.

## Running tests

```bash
cd packages/ai && npm test
```

## Environment variables

Add to your `.env` (or `.env.example`):

```
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```
