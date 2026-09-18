/** Provider-agnostic usage + compose orchestration types that both the LLM
 *  path and the rule-based fallback path must agree on.

 *  These are defined here (not duplicated in fallback.ts) so there is exactly
 *  one source of truth for the types the compose pipeline is built on. */

import { z } from "zod";
import { AIProvider, type AiUsage } from "./provider.js";
import { InboundParseSchema } from "./structured.js";
import { RuleBasedFallbackProvider } from "./fallback.js";
import { OllamaLlmProvider } from "./providers/ollama-llm.js";
import type { Intent, IntentResult } from "@tradescheduler/shared";

// ---------------------------------------------------------------------------
// Result of parsing one inbound message — threaded through compose
// ---------------------------------------------------------------------------

/** Everything the worker dispatch needs from classifyStep for one inbound SMS:
 *
 *  - `intentResult`  : the { intent, confidence } the rest of the system has
 *                      always consumed (same shape as the existing rule parser
 *                      output — no contract change for Checkpoint 02+).
 *  - `aiUsage`       : real usage when the LLM was called, null when the
 *                      rule-based fallback produced the result (zero cost).
 *  - `source`        : which path produced it — feeds the observability
 *                      checkpoint (P0.9) later without painting into a corner.
 *  - `requestId`     : stable id tying this LLM call → dashboard log → cost
 *                      record later. */
export interface ClassifyResult {
  intentResult: IntentResult;
  aiUsage: AiUsage | null;
  source: "llm" | "rule" | "context" | "escalation";
  /** Stable request id for the classify call — use for tieing logs + cost
   *  records later. */
  requestId: string;
}

// ---------------------------------------------------------------------------
// Context passed into classifyStep — what the compose layer knows at call time
// ---------------------------------------------------------------------------

/** What the compose layer knows about the inbound message at classify time.
 *  Nothing here is persisted by classifyStep itself — it just reads it. */
export interface ClassifyContext {
  /** The raw inbound body. */
  body: string;
  /** Whether a conversation state row already exists for this phone — same
   *  semantics as the existing parseIntent(…, conversationStateExists) flag. */
  conversationStateExists: boolean;
  /** Optional prior-step hint: when the agent is already in a step that
   *  disambiguated the intent (e.g. offering slots, awaiting confirmation),
   *  this is set so classifyStep can short-circuit without calling the LLM.
   *  When present and non-empty, it is trusted over a fresh classification. */
  suggestedIntent: Intent | null;
}

// ---------------------------------------------------------------------------
// Provider factory — picks the concrete adapter from env
// ---------------------------------------------------------------------------

export type ProviderMode = "ollama" | "fallback-only";

/** Build the provider the compose layer will call. When AI_PROVIDER is
 *  `fallback-only` (or unset and no AI_API_KEY), this returns the rule-based
 *  fallback so the whole pipeline can be tested offline and the fallback path
 *  is the default. */
export function createProvider(mode: ProviderMode, config?: ProviderConfig): AIProvider {
  if (mode === "census") {
    Invariant(`CENSUS_API_KEY is required when AI_PROVIDER=census`, config?.apiKey != null);
    return new CensusLlmProvider(
      config!.apiKey!,
      config!.model ?? "census/llama-4-scout",
      config!.baseUrl ?? "https://api.census.ai/v1",
      config!.temperature ?? 0,
    );
  }
  // fallback-only (default when AI_PROVIDER is unset or 'fallback-only')
  return new RuleBasedFallbackProvider();
}

export type ProviderConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
};

export type { AiError } from "./provider.js";

function Invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
