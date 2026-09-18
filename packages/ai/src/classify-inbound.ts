/**
 * classifyInbound — the orchestration layer that implements the fallback policy.
 *
 * Flow:
 *  1. Try LLM (OpenAI) structured classification.
 *  2. On failure (error / timeout / schema_rejection / confidence < 0.7), retry
 *     up to maxRetries times, then fall through to the rule-based parser.
 *  3. Rule-based parser result:
 *      - If high-confidence (>= 0.9): use it (superset guarantee — never downgrade).
 *      - If unknown (confidence 0.0): escalate, never guess.
 *  4. Merge: if the rule-based parser had higher confidence than the LLM on the
 *     intent, use the rule-based intent (superset guarantee). The LLM output's
 *     structured fields (service, customer_name, preferred_date, missing_information)
 *     are preserved on top of the rule-based intent.
 *
 * This function is the ONLY place that knows about both the LLM provider and the
 * rule-based fallback. Everything else in packages/ai/ is either the provider
 * interface or a single adapter.
 */

import { AIProvider, type AiMessage, type AiError, type AiErrorKind } from './provider.js';
import { InboundParseSchema, type InboundParseResult } from './schema.js';
import { RuleBasedFallbackProvider } from './fallback-provider.js';

export interface ClassifyContext {
  /** Whether a conversation state already exists for this phone (passed to rule parser). */
  conversationStateExists?: boolean;
  /** Optional metadata about the inbound message (phone number, etc.) for escalation context. */
  metadata?: Record<string, unknown>;
}

export interface ClassifyResult {
  intent: InboundParseResult['intent'];
  service: InboundParseResult['service'];
  customerName: InboundParseResult['customerName'];
  preferredDate: InboundParseResult['preferred_date'];
  preferredTimeStart: InboundParseResult['preferred_time_start'];
  preferredTimeEnd: InboundParseResult['preferred_time_end'];
  urgency: InboundParseResult['urgency'];
  missingInformation: InboundParseResult['missing_information'];
  confidence: number;
  source: 'llm' | 'rule_based' | 'merged' | 'escalated';
  escalated: boolean;
  rawLlmIntent?: string;       // the LLM's raw intent value, before merge
  rawRuleIntent?: string;      // the rule parser's raw intent value, before merge
}

const DEFAULT_SYSTEM_PROMPT = `You are a scheduling assistant for a tradesperson (plumber/electrician/HVAC).
Classify the customer's latest SMS message into one of these intents:

- new_booking: The customer wants to book a NEW appointment (e.g. "I need my AC fixed", "can you send someone to check my heater", "do you do water heater installation").
- reschedule: The customer wants to MOVE an existing appointment (e.g. "reschedule", "can we move my appointment", "change my time").
- cancel: The customer wants to CANCEL an existing appointment (e.g. "cancel my booking", "I need to cancel").
- question: The customer has a QUESTION (e.g. "do you do water heaters?", "what are your hours?", "how much does it cost?").
- emergency: The customer has an URGENT/time-sensitive issue (e.g. "my heater is leaking RIGHT NOW", "water is flooding", "gas smell").
- unknown: If you genuinely cannot classify the message into any of the above.

Important rules:
- If the message is a clear reschedule/confirm/help signal (from the legacy rule parser), prefer that intent.
- Extract any service type the customer mentions (e.g. "AC", "heater", "water heater", "electrical") into the "service" field.
- Extract any date/time preferences into the appropriate fields. Use ISO date format (YYYY-MM-DD) for dates.
- If you cannot determine the service type, date, or time, set missing_information to a list of what you still need to ask.
- urgency: "high" for emergency/urgent language, "medium" for time-sensitive but not emergency, "low" otherwise.
- confidence: your self-assessed confidence in this classification. 0.0-1.0. Be honest — if unsure, set confidence low and list what's missing.
- missing_information: a list of field names you still need from the customer (e.g. ["service_type", "preferred_date", "preferred_time"]).
`;

export async function classifyInbound(
  llmProvider: AIProvider,
  fallbackProvider: RuleBasedFallbackProvider,
  userMessage: string,
  context: ClassifyContext = {},
): Promise<ClassifyResult> {
  const messages: AiMessage[] = [
    { role: 'user', content: userMessage },
  ];

  // --- 1. Try LLM ---
  let llmResult: InboundParseResult | null = null;
  let llmError: AiError | null = null;

  for (let attempt = 0; attempt <= llmProvider['maxRetries'] ?? 2; attempt++) {
    try {
      llmResult = await llmProvider.generateStructured(
        DEFAULT_SYSTEM_PROMPT,
        messages,
        InboundParseSchema,
      );
      if (llmResult.confidence != null && llmResult.confidence >= 0.7) {
        break; // Good result, stop retrying.
      }
      // Low confidence — fall through to retry or fallback.
      llmResult = null;
    } catch (err) {
      llmError = err as AiError;
      if (attempt < (llmProvider['maxRetries'] ?? 2)) {
        await sleep(Math.pow(2, attempt) * 1000);
        continue;
      }
      break;
    }
  }

  // --- 2. If LLM succeeded with good confidence, return it (after merge check) ---
  if (llmResult != null && llmResult.confidence != null && llmResult.confidence >= 0.7) {
    // --- 3. Merge: also run the rule-based parser to check for superset guarantee ---
    let ruleResult: InboundParseResult | null = null;
    try {
      ruleResult = await fallbackProvider.generateStructured(
        DEFAULT_SYSTEM_PROMPT,
        messages,
        InboundParseSchema,
      );
    } catch {
      // Rule-based parser failed — unlikely, but treat as no rule result.
    }

    // Superset guarantee: if the rule-based parser matched a high-confidence
    // intent (reschedule/confirm/help/slot-choice at >= 0.9), use that intent
    // regardless of what the LLM said. The LLM's structured fields are preserved.
    if (ruleResult != null && ruleResult.confidence != null && ruleResult.confidence >= 0.9) {
      return mergeResults(llmResult, ruleResult, 'merged');
    }

    return mergeResults(llmResult, ruleResult, 'llm');
  }

  // --- 4. LLM failed or low confidence — try rule-based fallback ---
  let ruleResult: InboundParseResult | null = null;
  try {
    ruleResult = await fallbackProvider.generateStructured(
      DEFAULT_SYSTEM_PROMPT,
      messages,
      InboundParseSchema,
    );
  } catch (err) {
    const error = err as AiError;
    console.error('[classifyInbound] rule-based fallback also failed:', error);
  }

  // --- 5. Rule-based result ---
  if (ruleResult != null) {
    if (ruleResult.confidence != null && ruleResult.confidence >= 0.9) {
      // High-confidence rule match — use it.
      return {
        intent: ruleResult.intent,
        service: ruleResult.service,
        customerName: ruleResult.customer_name ?? undefined,
        preferredDate: ruleResult.preferred_date ?? undefined,
        preferredTimeStart: ruleResult.preferred_time_start ?? undefined,
        preferredTimeEnd: ruleResult.preferred_time_end ?? undefined,
        urgency: ruleResult.urgency,
        missingInformation: ruleResult.missing_information,
        confidence: ruleResult.confidence,
        source: 'rule_based',
        escalated: false,
        rawRuleIntent: ruleResult.intent,
      };
    }

    // Rule-based returned unknown (confidence 0.0) — escalate, never guess.
    if (ruleResult.confidence == null || ruleResult.confidence < 0.1) {
      return {
        intent: 'unknown',
        service: undefined,
        customerName: undefined,
        preferredDate: undefined,
        preferredTimeStart: undefined,
        preferredTimeEnd: undefined,
        urgency: undefined,
        missingInformation: ['intent'],
        confidence: 0,
        source: 'escalated',
        escalated: true,
        rawRuleIntent: ruleResult.intent,
      };
    }
  }

  // --- 6. Both LLM and rule-based failed or returned unknown — escalate ---
  return {
    intent: 'unknown',
    service: undefined,
    customerName: undefined,
    preferredDate: undefined,
    preferredTimeStart: undefined,
    preferredTimeEnd: undefined,
    urgency: undefined,
    missingInformation: ['intent'],
    confidence: 0,
    source: 'escalated',
    escalated: true,
  };
}

/**
 * Merge LLM and rule-based results.
 *
 * Rule: if the rule-based parser had a high-confidence match (>= 0.9), that
 * intent wins (superset guarantee). Otherwise, the LLM's intent is used, with
 * the LLM's structured fields preserved.
 */
function mergeResults(
  llm: InboundParseResult,
  rule: InboundParseResult | null,
  source: 'llm' | 'merged',
): ClassifyResult {
  const ruleIntentWins = rule != null &&
    rule.confidence != null &&
    rule.confidence >= 0.9 &&
    rule.intent !== 'unknown';

  // Pick the winning intent.
  const intent = ruleIntentWins ? rule.intent : llm.intent;
  const confidence = ruleIntentWins ? rule.confidence! : (llm.confidence ?? 0);

  // Preserve LLM's structured fields on top of the winning intent.
  return {
    intent,
    service: llm.service, // LLM may have extracted service even if rule parser didn't
    customerName: llm.customer_name ?? undefined,
    preferredDate: llm.preferred_date ?? undefined,
    preferredTimeStart: llm.preferred_time_start ?? undefined,
    preferredTimeEnd: llm.preferred_time_end ?? undefined,
    urgency: llm.urgency,
    missingInformation: llm.missing_information,
    confidence,
    source,
    escalated: false,
    rawLlmIntent: llm.intent,
    rawRuleIntent: rule?.intent,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
