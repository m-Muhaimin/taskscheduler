/** classifyStep — the dispatch policy for one inbound SMS.

 *  Policy (exact, Checkpoint 01 §3):
 *   1. If context.suggestedIntent is set, trust it — no LLM, no parser.
 *   2. Call the LLM. On success with conf >= 0.7 → return.
 *      On failure OR conf < 0.7 → fall through.
 *   3. Call the rule-based parser. On known intent with conf >= 0.7 → return.
 *      Otherwise → fall through.
 *   4. Escalate + return { intent: 'unknown', confidence: 0.0 }.
 *
 *  Never guess. Never let the LLM write state transitions directly (that
 *  boundary is enforced in Checkpoint 06, not here — here we only classify). */

import { parseIntent } from "@tradescheduler/shared";
import type { AIProvider } from "./provider.js";
import type { Intent, IntentResult } from "@tradescheduler/shared";
import { InboundParseSchema } from "./structured.js";
import type { ClassifyResult, ClassifyContext, AiError } from "./compose.js";

// ---------------------------------------------------------------------------
// Escalation input shape — defined here, not imported from apps/api.
//
//  packages/ai/ does NOT depend on apps/api/ (wrong direction). The caller
//  builds this object and passes it to onEscalate; in production that callback
//  calls the real escalation-service.createEscalation. For tests it's a stub.
// ---------------------------------------------------------------------------

/** Shape of the object the terminal fallback passes to onEscalate.
 *  Mirrors the existing CreateEscalationInput from escalation-service.ts
 *  (type, customerPhone, content) so the production callback is a thin wrap. */
export interface EscalationInput {
  type: "processing_error" | "ambiguous_intent" | "no_availability" | "calendar_api_failure" | "sms_delivery_failure";
  customerPhone: string;
  content: string | null;
}

// ---------------------------------------------------------------------------
// classifyStep
// ---------------------------------------------------------------------------

export async function classifyStep(
  provider: AIProvider,
  context: ClassifyContext,
  /** When the terminal fallback escalates, this is called. Injected for
   *  testability; in production this is the real escalation-service function. */
  onEscalate: (input: EscalationInput) => Promise<void>,
  /** Stable request id for this classify call — passed through to the result
   *  so logs + cost records can tie back to it later. */
  requestId: string,
): Promise<ClassifyResult> {
  // 1. Context hint — short-circuit without any provider call.
  if (context.suggestedIntent != null) {
    return {
      intentResult: { intent: context.suggestedIntent, confidence: 0.95 },
      aiUsage: null,
      source: "context",
      requestId,
    };
  }

  // 2. LLM path.
  const llmResult = await classifyWithLlm(provider, context, requestId).catch(
    (err: unknown): { error: AiError | null; final: ClassifyResult | null } => {
      const error = normalizeError(err);
      return { error, final: null };
    },
  );

  if (llmResult?.error == null && llmResult?.final != null) {
    // LLM produced a result. Respect the confidence threshold as in the policy.
    if (llmResult.final.intentResult.confidence >= 0.7) {
      return llmResult.final;
    }
    // LLM was unsure (conf < 0.7) — fall through to the rule parser.
  }

  // 3. Rule-based fallback.
  const ruleResult = await classifyWithRuleParser(context, requestId).catch(
    (err: unknown): { error: AiError | null; final: ClassifyResult | null } => {
      return { error: normalizeError(err), final: null };
    },
  );

  if (ruleResult?.error == null && ruleResult?.final != null) {
    if (ruleResult.final.intentResult.confidence >= 0.7) {
      return ruleResult.final;
    }
  }

  // 4. Terminal fallback — escalate and return unknown.
  await onEscalate({
    type: (llmResult?.error?.kind === "provider_unavailable" || ruleResult?.error?.kind === "provider_unavailable")
      ? "processing_error"
      : "ambiguous_intent",
    customerPhone: "unknown", // phone known by caller; classifyStep doesn't have it
    content: `Inbound message could not be classified: "${context.body}"` +
      (llmResult?.error ? ` [llm: ${llmResult.error.kind}]` : "") +
      (ruleResult?.error ? ` [rule: ${ruleResult.error.kind}]` : ""),
  });

  return {
    intentResult: { intent: "unknown", confidence: 0.0 },
    aiUsage: null,
    source: "escalation",
    requestId,
  };
}

// ---------------------------------------------------------------------------
// Internal — LLM path
// ---------------------------------------------------------------------------

async function classifyWithLlm(
  provider: AIProvider,
  context: ClassifyContext,
  requestId: string,
): Promise<{ final: ClassifyResult; error: null } | { final: null; error: AiError }> {
  try {
    const parsed = await provider.generateStructured<typeof InboundParseSchema>({
      schema: InboundParseSchema,
      prompt: context.body,
      maxTokens: 1024,
    });

    const intentResult: IntentResult = {
      intent: mapIntent(parsed.data.intent),
      confidence: parsed.data.confidence,
    };

    return {
      final: {
        intentResult,
        aiUsage: parsed.usage,
        source: "llm",
        requestId,
      },
      error: null,
    };
  } catch (err) {
    return { final: null, error: normalizeError(err) };
  }
}

// ---------------------------------------------------------------------------
// Internal — rule-based fallback path
// ---------------------------------------------------------------------------

async function classifyWithRuleParser(
  context: ClassifyContext,
  requestId: string,
): Promise<{ final: ClassifyResult; error: null } | { final: null; error: AiError }> {
  const existing = parseIntent(context.body, context.conversationStateExists);
  const intentResult: IntentResult = {
    intent: existing.intent,
    confidence: existing.confidence,
  };

  return {
    final: {
      intentResult,
      aiUsage: null,
      source: "rule",
      requestId,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map the LLM's intent label (which includes the new values) into the
 *  existing `Intent` union the rest of the system consumes. The new labels
 *  that the existing dispatch doesn't yet handle get mapped to 'unknown' so
 *  they follow the existing escalation path until Checkpoint 06 wires them. */
function mapIntent(aiIntent: string): Intent {
  switch (aiIntent) {
    case "new_booking":
    case "cancel":
    case "question":
    case "emergency":
      // New labels the existing dispatch can't act on yet — route through
      // the escalation path until Checkpoint 06 extends the worker switch.
      return "unknown";
    case "reschedule":
    case "confirm":
      return aiIntent as Intent;
    case "slot_choice":
      // LLM emits snake_case; existing Intent union uses kebab-case.
      return "slot-choice";
    case "unknown":
      return "unknown";
    default:
      return "unknown";
  }
}

function normalizeError(err: unknown): AiError {
  if (err && typeof err === "object" && "kind" in err) {
    return err as AiError;
  }
  return { kind: "provider_unavailable", message: String(err), retryable: true };
}

// ---------------------------------------------------------------------------
// Public API surface — the package root re-exports everything consumers of
// @tradescheduler/ai need: the dispatch entry (classifyStep), the provider
// factory + metadata types, and the structured-output schema taxonomy.
// ---------------------------------------------------------------------------

export { createProvider, type ProviderMode, type ProviderConfig } from "./compose.js";
export type { ClassifyResult, ClassifyContext } from "./compose.js";
export type { AIProvider, AiError, AiUsage, ProviderMetadata } from "./provider.js";
export { InboundParseSchema, AiIntentSchema } from "./structured.js";
export type { InboundParseResult, AiIntent } from "./structured.js";
