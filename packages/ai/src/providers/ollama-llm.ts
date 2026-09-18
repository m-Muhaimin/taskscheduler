/** Ollama adapter — cloud-hosted LLM inference via the Ollama HTTP API.
 *
 *  Base URL: https://ollama.com (cloud endpoint, set OLLAMA_BASE_URL to override).
 *  Model default: "gemma4" — set OLLAMA_MODEL in env to override.
 *
 *  Ollama exposes an OpenAI-compatible chat/completions endpoint at
 *  POST /v1/chat/completions which accepts response_format:
 *  { type: "json_schema", json_schema: {...} } for structured output.
 *
 *  The adapter:
 *   1. Builds an Ollama-compatible json_schema from the caller's Zod schema
 *   2. Calls the Ollama HTTP API
 *   3. Decodes the JSON response
 *   4. Validates against the Zod schema (provider may return extra/missing fields)
 *   5. Maps API errors → AiError kinds the compose layer matches on
 *
 *  Auth: OLLAMA_API_KEY is sent as a Bearer token. Required for the cloud
 *  endpoint; omit for unauthenticated local instances.
 *
 *  Justification (Checkpoint 01): Ollama is the provider per user instruction —
 *  cloud-hosted gemma 4 model. Structured output via json_schema gives us
 *  schema-guaranteed responses. Swap to another provider = add one adapter file
 *  + update createProvider()'s map in compose.ts. */

import { z } from "zod";
import type { AIProvider, AiUsage, ProviderMetadata, AiError } from "../provider.js";
import { withRetry } from "../retry.js";

// ---------------------------------------------------------------------------
// Ollama request/response types — OpenAI-compat layer
// ---------------------------------------------------------------------------

interface OllamaRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format?: { type: "json_schema"; json_schema: OllamaJsonSchema };
  max_tokens?: number;
  temperature?: number;
}

interface OllamaJsonSchema {
  name: string;
  description?: string;
  strict: boolean;
  schema: Record<string, unknown>;
}

interface OllamaChoice {
  message: { content: string };
}

interface OllamaUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

interface OllamaResponse {
  choices: Array<OllamaChoice>;
  usage: OllamaUsage;
  model: string;
}

// ---------------------------------------------------------------------------
// OllamaLlmProvider
// ---------------------------------------------------------------------------

export class OllamaLlmProvider implements AIProvider {
  constructor(
    private readonly model: string = "gemma4",
    private readonly baseUrl: string = "https://ollama.com",
    private readonly apiKey: string = "",
    private readonly temperature: number = 0,
  ) {}

  metadata(): ProviderMetadata {
    return {
      name: "ollama",
      model: this.model,
      supportsStructured: true,
    };
  }

  async generateText(options: { prompt: string; system?: string; maxTokens?: number }): Promise<{ text: string; usage: AiUsage }> {
    const msg: OllamaRequest = {
      model: this.model,
      messages: [
        { role: "system", content: options.system ?? DEFAULT_SYSTEM },
        { role: "user", content: options.prompt },
      ],
      max_tokens: options.maxTokens ?? 256,
      temperature: this.temperature,
    };

    const response = await withRetry(() => this.post(msg, /*structured*/ false));
    return decodeResponse(response);
  }

  async generateStructured<TSchema extends z.ZodType>(options: {
    schema: TSchema;
    prompt: string;
    system?: string;
    maxTokens?: number;
  }): Promise<{ data: z.infer<TSchema>; usage: AiUsage }> {
    const schema = options.schema;
    const isObject = schema instanceof z.ZodObject;

    const ollamaSchema: OllamaJsonSchema =
      isObject
        ? zodToOllamaSchema(schema as unknown as z.ZodObject<z.ZodRawShape, "strip", z.ZodTypeAny>)
        : { name: "output", description: "structured output", strict: true, schema: { type: "object", properties: { intent: { type: "string" } }, required: ["intent"] } };

    const msg: OllamaRequest = {
      model: this.model,
      messages: [
        { role: "system", content: options.system ?? DEFAULT_SYSTEM },
        { role: "user", content: options.prompt },
      ],
      response_format: { type: "json_schema", json_schema: ollamaSchema },
      max_tokens: options.maxTokens ?? 1024,
      temperature: this.temperature,
    };

    const response = await withRetry(() => this.post(msg, /*structured*/ true));
    const raw = response.choices[0]?.message?.content;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw { kind: "provider_unavailable", message: "empty response from Ollama", retryable: true } as AiError;
    }

    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw { kind: "schema_rejection", raw: parsed, reason: result.error.message } as AiError;
    }

    return {
      data: result.data as z.infer<TSchema>,
      usage: {
        tokensInput: response.usage.prompt_tokens,
        tokensOutput: response.usage.completion_tokens,
        model: response.model,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // HTTP — one function both paths use
  // ---------------------------------------------------------------------------

  private async post(body: OllamaRequest, structured: boolean): Promise<OllamaResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const retry = res.headers.get("Retry-After");
      throw { kind: "rate_limited", message: `Ollama 429: ${await res.text()}`, retryAfter: retry ? Number(retry) : undefined } as AiError;
    }
    if (res.status === 401 || res.status === 403) {
      throw { kind: "auth", message: `Ollama auth failed (${res.status}): ${await res.text()}` } as AiError;
    }
    if (!res.ok) {
      throw { kind: "provider_unavailable", message: `Ollama ${res.status}: ${await res.text()}`, retryable: res.status >= 500 } as AiError;
    }

    const json = (await res.json()) as OllamaResponse;
    if (!json.choices || json.choices.length === 0) {
      throw { kind: "provider_unavailable", message: "Ollama returned no choices", retryable: true } as AiError;
    }
    return json;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM = `You are a booking assistant for a solo tradesperson. You receive a single inbound SMS message from a customer and must classify what they want in structured JSON.

Rules:
- Classify only what the message actually says. Do not invent details.
- If the message is clearly a request to book a new service, use new_booking.
- If the message asks to change an existing appointment, use reschedule.
- If the message asks to cancel, use cancel.
- If the message is informational / FAQ-style, use question.
- If the message signals urgency, no availability, or time-critical need, use emergency.
- If the message picks a slot number (1, 2, 3) from a previously offered set, use slot_choice.
- If the message is an explicit confirmation ("yes", "confirmed", "that works"), use confirm.
- If you genuinely cannot classify, use unknown and leave confidence low.
- confidence must be 0..1 and reflect how sure you are.
- missing_information lists what you would need to ask the customer to proceed.

Respond with ONLY a JSON object matching the schema. No markdown, no prose outside the JSON.`;

function decodeResponse(response: OllamaResponse): { text: string; usage: AiUsage } {
  const text = response.choices[0]?.message?.content ?? "";
  return {
    text,
    usage: {
      tokensInput: response.usage.prompt_tokens,
      tokensOutput: response.usage.completion_tokens,
      model: response.model,
    },
  };
}

/** Best-effort ZodObject → Ollama json_schema. Only top-level shape is used;
 *  nested objects are represented as { type: "object" } without their inner
 *  shape — good enough for the classification schema (which is flat). */
function zodToOllamaSchema(zodSchema: z.ZodObject<z.ZodRawShape, "strip", z.ZodTypeAny>): OllamaJsonSchema {
  const shape = zodSchema.shape;
  const props: Record<string, { type: string; description?: string; enum?: unknown[] }> = {};

  for (const [key, def] of Object.entries(shape)) {
    const desc = (def as { _def?: { description?: string } })._def?.description;
    props[key] = { type: zodTypeLabel(def), description: desc };
    if (def instanceof z.ZodEnum) {
      props[key].enum = def.options;
    }
  }

  return {
    name: "inbound_parse",
    description: "Structured classification of an inbound SMS message",
    strict: true,
    schema: { type: "object", properties: props, required: Object.keys(shape) },
  };
}

function zodTypeLabel(def: z.ZodType): string {
  if (def instanceof z.ZodString) return "string";
  if (def instanceof z.ZodNumber) return "number";
  if (def instanceof z.ZodBoolean) return "boolean";
  if (def instanceof z.ZodArray) return "array";
  if (def instanceof z.ZodObject) return "object";
  if (def instanceof z.ZodNullable || def instanceof z.ZodOptional) {
    return zodTypeLabel((def as unknown as { _def: { innerType: z.ZodType } })._def.innerType);
  }
  if (def instanceof z.ZodEnum) return "string";
  return "string";
}
