/** Fallback adapter — wraps the EXISTING rule-based intent parser.

 *  This is NOT a new parser. It exists so the compose dispatch policy can
 *  treat "rule-based parser" as a first-class provider in the same pipeline,
 *  which makes the fallback path deterministic and testable without mocking
 *  HTTP.
 *
 *  Usage is null (zero tokens, zero cost) because this is a pure function
 *  with no external call. */

import { z } from "zod";
import type { AIProvider, AiUsage, AiError, ProviderMetadata } from "./provider.js";
import { parseIntent, type IntentResult, type Intent } from "@tradescheduler/shared";
import { InboundParseSchema } from "./structured.js";

export class RuleBasedFallbackProvider implements AIProvider {
  metadata(): ProviderMetadata {
    return { name: "rule-based-fallback", model: "builtin/parseIntent", supportsStructured: false };
  }

  async generateText(): Promise<{ text: string; usage: AiUsage }> {
    return { text: "", usage: { tokensInput: 0, tokensOutput: 0, model: "builtin/parseIntent" } };
  }

  async generateStructured<TSchema extends z.ZodType>(options: { schema: TSchema; prompt: string; system?: string; maxTokens?: number }): Promise<{ data: z.infer<TSchema>; usage: AiUsage }> {
    // Map the existing IntentResult { intent, confidence } into the new
    // InboundParseSchema shape so the downstream (compose.ts) sees the same
    // type whether it came from the LLM or the rule parser.
    const existing = parseIntent(options.prompt, false);

    // slot-choice becomes slot_choice (camelCase) so it matches the new
    // enum; the rest are already valid labels in InboundParseSchema.
    const mappedIntent: "new_booking" | "reschedule" | "cancel" | "question" | "emergency" | "slot_choice" | "confirm" | "unknown" =
      existing.intent === "slot-choice" ? "slot_choice" : (existing.intent as "reschedule" | "confirm" | "unknown" | "new_booking" | "cancel" | "question" | "emergency" | "slot_choice");

    const mapped = {
      intent: mappedIntent,
      confidence: existing.confidence,
      customer_name: null,
      service_description: null,
      preferred_date: null,
      preferred_time_start: null,
      preferred_time_end: null,
      urgency: undefined,
      missing_information: [],
      reasoning: `rule-based fallback: matched ${existing.intent} (confidence ${existing.confidence})`,
    };

    // InboundParseSchema is the only schema we support for now; if something
    // else is passed in, safeParse will reject and we escalate.
    const result = InboundParseSchema.safeParse(mapped);
    if (!result.success) {
      throw { kind: "schema_rejection", raw: mapped, reason: result.error.message } as AiError;
    }

    return {
      data: result.data as z.infer<TSchema>,
      usage: { tokensInput: 0, tokensOutput: 0, model: "builtin/parseIntent" },
    };
  }
}

