/** RidgeLine Assistant — the support-chat adapter for @tradescheduler/ai.

 *  One user turn in, one reply out. The caller provides a provider + the
 *  AssistantMessage thread; this module builds the system prompt (grounded in
 *  the customer-support knowledge base rules), fires ONE generateText call
 *  with the last user message as the prompt, and guarantees the API layer
 *  always receives non-empty text.
 *
 *  Critical contract: the built-in fallback provider (RuleBasedFallbackProvider,
 *  what createProvider() returns when AI_PROVIDER is unset) returns
 *  { text: "", usage: { 0, 0, 'builtin/parseIntent' } }. runSupportAssistant
 *  converts empty/whitespace text AND thrown errors into a grounded canned
 *  reply (supportFallbackReply) so no caller ever sees empty text. On that
 *  path it does NOT pretend to have a live operator — it says the scheduling
 *  system is unreachable and the tradesperson will follow up. */

import type { AIProvider, AiUsage } from "./provider.js";
import type { AssistantMessage } from "@tradescheduler/shared";

// ---------------------------------------------------------------------------
// System prompt — encodes the domain rules from the customer-support KB:
// fronts a solo tradesperson, short plain answers, confirm/reschedule
// primitives, billing → defer to the tradesperson, true emergencies →
// emergency services (never book), never claims to be human, never invents
// appointments, and anything unresolvable is flagged for follow-up.
// ---------------------------------------------------------------------------

export const RIDGELINE_SUPPORT_SYSTEM_PROMPT = `You are RidgeLine Assistant, the front-desk
support agent for a solo tradesperson (plumbing / HVAC / electrical). Rules:
- Reply in plain text, 1-4 short sentences. Friendly and professional.
- You handle booking confirmations, reschedule requests, and general front-desk questions for the tradesperson's customers.
- NEVER invent bookings, dates, prices, deposits, or availability that are not in the context.
- Billing and payment questions (invoices, charges, deposits, refunds) go to the tradesperson — do not resolve them yourself.
- If the customer reports a true emergency (gas leak, flood, fire, carbon monoxide), tell them to call emergency services now and do NOT book or dispatch.
- If you do not know the answer, say you will flag it for the tradesperson to confirm.
- Never claim to be human — you are the tradesperson's automated assistant.
- Flag anything you cannot resolve for the tradesperson to follow up on.`;

/** Build the support system prompt: the base rules + current context +
 *  tradesperson name + the flattened chat history (every message except the
 *  one being answered), role-prefixed as Customer: / RidgeLine:. */
export function buildSupportSystemPrompt(
  messages: AssistantMessage[],
  contextSnippet?: string,
  tradespersonName?: string,
): string {
  const history = messages
    .map((m) => (m.role === "user" ? `Customer: ${m.content}` : `RidgeLine: ${m.content}`))
    .join("\n");
  return (
    RIDGELINE_SUPPORT_SYSTEM_PROMPT +
    `\n\nContext:\n${contextSnippet ?? "(none provided)"}` +
    `\n\nTradesperson: ${tradespersonName ?? "your tradesperson"}` +
    `\n\nChat history:\n${history}`
  );
}

/** Grounded canned reply for the fallback path (empty provider text or thrown
 *  error). Honest about the scheduling system being unreachable; the
 *  tradesperson follows up. Never pretends a live operator is on the line. */
export function supportFallbackReply(tradespersonName?: string): string {
  return `Thanks for your message. I can't reach my scheduling system right now, so I've noted your question and will have ${tradespersonName ?? "your tradesperson"} follow up with you shortly.`;
}

// ---------------------------------------------------------------------------
// runSupportAssistant
// ---------------------------------------------------------------------------

export interface SupportAssistantInput {
  provider: AIProvider;
  messages: AssistantMessage[];
  contextSnippet?: string;
  tradespersonName?: string;
}

export interface SupportAssistantResult {
  reply: string;
  usage: AiUsage;
  /** Provider name from provider.metadata().name — for cost/log attribution. */
  providerName: string;
}

export async function runSupportAssistant(input: SupportAssistantInput): Promise<SupportAssistantResult> {
  const { provider, messages, contextSnippet, tradespersonName } = input;

  // Guard: a chat turn is only valid when it ends in the customer's message.
  // The route layer validates too, but this is the service boundary — never
  // answer an assistant message as if it were a new customer turn.
  const last = messages[messages.length - 1];
  if (messages.length === 0 || last.role !== "user") {
    throw new Error('support-assistant: last message must have role "user"');
  }

  const system = buildSupportSystemPrompt(messages.slice(0, -1), contextSnippet, tradespersonName);

  try {
    const { text, usage } = await provider.generateText({
      prompt: last.content,
      system,
      maxTokens: 512,
    });

    // Empty/whitespace text = provider unavailable (the built-in fallback
    // provider returns exactly "" — zero tokens, zero cost). Preserve the
    // provider's usage (zero for the fallback) and ground the reply.
    if (text.trim() === "") {
      return { reply: supportFallbackReply(tradespersonName), usage, providerName: provider.metadata().name };
    }
    return { reply: text, usage, providerName: provider.metadata().name };
  } catch {
    // Provider threw — same grounded fallback, with a zero usage marker so the
    // caller's ledger never records cost for a call that produced no reply.
    return {
      reply: supportFallbackReply(tradespersonName),
      usage: { tokensInput: 0, tokensOutput: 0, model: provider.metadata().model },
      providerName: provider.metadata().name,
    };
  }
}