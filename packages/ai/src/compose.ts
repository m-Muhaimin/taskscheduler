/** Provider-agnostic usage + compose orchestration types that both the LLM
 *  path and the rule-based fallback path must agree on.
 *
 *  These are defined here (not duplicated in fallback.ts) so there is exactly
 *  one source of truth for the types the compose pipeline is built on. */

import type { AIProvider, AiUsage } from "./provider.js";
import { RuleBasedFallbackProvider } from "./fallback.js";
import { OpenAiProvider } from "./providers/openai-adapter.js";
import { OllamaLlmProvider } from "./providers/ollama-llm.js";
import { CensusLlmProvider } from "./census-llm.js";
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
  source: "llm" | "rule" | "context" | "escalation" | "merged";
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
// Provider factory — picks the concrete adapter from env, with a programmatic
// override for tests and wiring-time injection
// ---------------------------------------------------------------------------

export type ProviderMode = "openai" | "ollama" | "census" | "fallback-only";

export type ProviderConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
};

/** Build the provider the compose layer will call.
 *
 *  Selection order: explicit `mode` argument wins; otherwise AI_PROVIDER is
 *  read from the environment. Unset or unknown → fallback-only (the rule-based
 *  parser), so the pipeline runs offline and the fallback path is the default.
 *
 *  OpenAI/Census require their API key when selected — missing keys fail fast
 *  at construction time (never silently degrade to the fallback when a real
 *  provider was requested). Ollama accepts an empty key for local instances. */
export function createProvider(mode?: ProviderMode, config?: ProviderConfig): AIProvider {
  const selected: ProviderMode = mode ?? (parseProviderMode(process.env.AI_PROVIDER) ?? "fallback-only");

  switch (selected) {
    case "openai": {
      const apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY;
      invariant(apiKey != null && apiKey !== "", "OPENAI_API_KEY is required when AI_PROVIDER=openai");
      return new OpenAiProvider(
        apiKey!,
        config?.model ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        config?.temperature ?? 0,
      );
    }
    case "ollama": {
      return new OllamaLlmProvider(
        config?.model ?? process.env.OLLAMA_MODEL ?? "gemma4",
        config?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? "https://ollama.com",
        config?.apiKey ?? process.env.OLLAMA_API_KEY ?? "",
        config?.temperature ?? 0,
      );
    }
    case "census": {
      const apiKey = config?.apiKey ?? process.env.CENSUS_API_KEY;
      invariant(apiKey != null && apiKey !== "", "CENSUS_API_KEY is required when AI_PROVIDER=census");
      return new CensusLlmProvider(
        apiKey!,
        config?.model ?? process.env.CENSUS_MODEL ?? "census/llama-4-scout",
        config?.baseUrl ?? process.env.CENSUS_BASE_URL ?? "https://api.census.ai/v1",
        config?.temperature ?? 0,
      );
    }
    case "fallback-only":
    default:
      return new RuleBasedFallbackProvider();
  }
}

export type { AiError } from "./provider.js";

function parseProviderMode(raw: string | undefined): ProviderMode | undefined {
  switch (raw) {
    case "openai":
    case "ollama":
    case "census":
    case "fallback-only":
      return raw;
    default:
      return undefined;
  }
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
