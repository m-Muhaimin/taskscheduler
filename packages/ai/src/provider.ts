// Provider-agnostic LLM interface for the booking/dispatch agent.
//
// One interface, multiple adapters. The first wired adapter is OpenAI
// (Structured Outputs via response_format: { type: 'json_schema', ... }).
// The compose layer never imports a concrete adapter directly; it picks one
// from createProvider() based on LLM_PROVIDER.
//
// Swapping to another provider = add one adapter file + update the factory.

import type { z } from 'zod';

// ---------------------------------------------------------------------------
// Provider metadata — stable, loggable, not behavior-affecting
// ---------------------------------------------------------------------------

export interface ProviderMetadata {
  /** Lowercase provider name for routing / logging. */
  name: string;
  /** Stable model id the adapter uses, e.g. 'openai/gpt-4o-mini'. */
  model: string;
  /** Whether generateStructured() is backed by a real structured-output mode
   *  (json_schema / tool_use) vs. a prompt-level "reply in JSON" contract. */
  supportsStructured: boolean;
}

// ---------------------------------------------------------------------------
// Usage — returned by every provider call, threaded through compose
// ---------------------------------------------------------------------------

export interface AiUsage {
  tokensInput: number;
  tokensOutput: number;
  /** Provider-specific model id (may differ from metadata().model in
   *  multi-model providers). */
  model: string;
}

// ---------------------------------------------------------------------------
// Errors — the compose layer matches on `kind`, never on a raw message
// ---------------------------------------------------------------------------

export type AiError =
  | { kind: 'provider_unavailable'; message: string; retryable: boolean }
  | { kind: 'schema_rejection'; raw: unknown; reason: string }
  | { kind: 'rate_limited'; message: string; retryAfter?: number }
  | { kind: 'auth'; message: string }
  | { kind: 'quota'; message: string };

// ---------------------------------------------------------------------------
// Structured output options — Zod schema drives both the provider's
// json_schema (where supported) and the post-hoc validation
// ---------------------------------------------------------------------------

export interface GenerateStructuredOptions<TSchema extends z.ZodType> {
  /** Zod schema the LLM's output must satisfy. Providers that support
   *  structured output use this to build their json_schema; all providers
   *  validate the raw response against it after decoding. */
  schema: TSchema;
  /** The user-facing message that drives the model. */
  prompt: string;
  /** System prompt override; undefined → use the adapter default. */
  system?: string;
  /** Request-level token budget; adapters clamp on their side where possible. */
  maxTokens?: number;
}

export interface GenerateTextOptions {
  prompt: string;
  system?: string;
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// The interface
// ---------------------------------------------------------------------------

export interface AIProvider {
  /**
   * Returns Zod-validated structured output. On provider error or schema
   * rejection, throws an `AiError` the compose layer can match on.
   */
  generateStructured<TSchema extends z.ZodType>(
    options: GenerateStructuredOptions<TSchema>,
  ): Promise<{ data: z.infer<TSchema>; usage: AiUsage }>;
  /** Unstructured text — useful for drafting replies later. */
  generateText(options: GenerateTextOptions): Promise<{ text: string; usage: AiUsage }>;
  /** Provider name + model for logs/cost attribution. */
  metadata(): ProviderMetadata;
}
