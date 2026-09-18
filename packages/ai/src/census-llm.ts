/** Census (Groq-side) adapter — first wired provider.

 *  Census supports response_format: { type: "json_schema", json_schema: {...} }
 *  which lets us pass a Zod-derived schema directly. The adapter:
 *   1. Builds census/json_schema from the caller's Zod schema (where supported)
 *   2. Calls the API
 *   3. Decodes the JSON
 *   4. Validates against the Zod schema (so a provider sending extra/missing
 *      fields is caught, not silently accepted)
 *   5. Maps API errors → AiError kinds the compose layer can match on
 *
 *  NOT a final choice — replace census-llm.ts with another adapter file and
 *  update createProvider()'s map. The interface is what the rest of P0 depends
 *  on, not the provider name. */

import { z } from "zod";
import { AIProvider, type AiUsage } from "./provider.js";

// ---------------------------------------------------------------------------
// Census request/response types — narrow around what we actually use
// ---------------------------------------------------------------------------

interface CensusRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  response_format?: { type: "json_schema"; json_schema: CensusJsonSchema };
  max_tokens?: number;
  temperature?: number;
}

interface CensusJsonSchema {
  name: string;
  description?: string;
  strict: boolean;
  schema: Record<string, unknown>;
}

interface CensusChoice {
  message: { content: string };
}

interface CensusUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

interface CensusResponse {
  choices: Array<CensusChoice>;
  usage: CensusUsage;
  model: string;
}

// ---------------------------------------------------------------------------
// CensusLlmProvider
// ---------------------------------------------------------------------------

export class CensusLlmProvider implements AIProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly temperature: number = 0,
  ) {}

  metadata(): ProviderMetadata {
    return { name: "census", model: this.model, supportsStructured: true };
  }

  async generateText(options: { prompt: string; system?: string; maxTokens?: number }): Promise<{ text: string; usage: AiUsage }> {
    const msg: CensusRequest = {
      model: this.model,
      messages: [
        { role: "system", content: options.system ?? DEFAULT_SYSTEM },
        { role: "user", content: options.prompt },
      ],
      max_tokens: options.maxTokens ?? 256,
      temperature: this.temperature,
    };

    const response = await this.post(msg, /*structured*/ false);
    const decoded = decodeText(response);
    return { text: decoded.text, usage: decoded.usage };
  }

  async generateStructured<TSchema extends z.ZodType>(options: {
    schema: TSchema;
    prompt: string;
    system?: string;
    maxTokens?: number;
  }): Promise<{ data: z.infer<TSchema>; usage: AiUsage }> {
    const schema = options.schema;
    const isObject = schema instanceof z.ZodObject;

    const censusSchema: CensusJsonSchema =
      isObject
        ? zodToCensusSchema(schema as unknown as z.ZodObject<z.ZodRawShape, "strip", z.ZodTypeAny>)
        : { name: "output", description: "structured output", strict: true, schema: { type: "object", properties: { intent: { type: "string" } }, required: ["intent"] } };

    const msg: CensusRequest = {
      model: this.model,
      messages: [
        { role: "system", content: options.system ?? DEFAULT_SYSTEM },
        { role: "user", content: options.prompt },
      ],
      response_format: { type: "json_schema", json_schema: censusSchema },
      max_tokens: options.maxTokens ?? 1024,
      temperature: this.temperature,
    };

    const response = await this.post(msg, /*structured*/ true);
    const raw = response.choices[0]?.message?.content;
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw { kind: "provider_unavailable", message: "empty response from Census", retryable: true } as AiError;
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
  // HTTP — one function both paths use, with structured vs. text request shape
  // ---------------------------------------------------------------------------

  private async post(body: CensusRequest, structured: boolean): Promise<CensusResponse> {
    // Census endpoint is chat/completions; structured is driven by response_format.
    const url = `${this.baseUrl}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const retry = res.headers.get("Retry-After");
      throw { kind: "rate_limited", message: `Census 429: ${await res.text()}`, retryAfter: retry ? Number(retry) : undefined } as AiError;
    }
    if (res.status === 401 || res.status === 403) {
      throw { kind: "auth", message: `Census auth failed (${res.status}): ${await res.text()}` } as AiError;
    }
    if (!res.ok) {
      throw { kind: "provider_unavailable", message: `Census ${res.status}: ${await res.text()}`, retryable: res.status >= 500 } as AiError;
    }

    const json = (await res.json()) as CensusResponse;
    if (!json.choices || json.choices.length === 0) {
      throw { kind: "provider_unavailable", message: "Census returned no choices", retryable: true } as AiError;
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

function decodeText(response: CensusResponse): { text: string; usage: AiUsage } {
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

/** Best-effort ZodObject → Census json_schema. Only top-level shape is used;
 *  nested objects are represented as { type: "object" } without their inner
 *  shape — good enough for the classification schema (which is flat). */
function zodToCensusSchema(zodSchema: z.ZodObject<z.ZodRawShape, "strip", z.ZodTypeAny>): CensusJsonSchema {
  const shape = zodSchema.shape;
  const props: Record<string, { type: string; description?: string }> = {};

  for (const [key, def] of Object.entries(shape)) {
    const desc = (def as { _def?: { description?: string } })._def?.description;
    props[key] = { type: zodTypeLabel(def), description: desc };
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
