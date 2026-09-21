/**
 * RidgeLine Assistant — one support-chat turn (ridgeline-assistant-chat.md T3).
 *
 * Owns the chat-turn policy for /api/assistant: an emergency pre-check on the
 * last user message (escalation row, NEVER a provider call), the provider turn
 * via runSupportAssistant (which grounds empty-text/error results into a
 * canned reply with zero usage internally), the AI-cost ledger via
 * recordAiUsage (only real LLM calls — zero-usage fallback turns never write a
 * row), and keyword actions (billing → escalation row, reschedule → no row).
 *
 * The provider is injected so tests can script it — the route layer (T4)
 * builds it with createProvider() from @tradescheduler/ai (AI_PROVIDER env,
 * default fallback-only). No DB work happens in this file; escalation and
 * ledger delegate to their service modules (the lazy-pool pattern lives
 * there), so this module has no pg dependency.
 */
import { randomUUID } from 'node:crypto';
import { runSupportAssistant, type AIProvider } from '@tradescheduler/ai';
import type { AssistantAction, AssistantChatRequest, AssistantChatResponse } from '@tradescheduler/shared';
import { createEscalation } from './escalation-service.js';
import { recordAiUsage } from './ai-usage-service.js';

// ---------------------------------------------------------------------------
// Keyword signals — tested on the LAST user message, case-insensitive.
// Check order is authoritative: emergency → billing → reschedule → none.
// ---------------------------------------------------------------------------

const EMERGENCY_RE = /emergency|burst|flood|gas leak|carbon monoxide|fire/i;
const BILLING_RE = /bill|invoice|charge|refund|deposit|payment/i;
const RESCHEDULE_RE = /reschedule|reschedul|move (my|the) appointment|change (my|the) time/i;

/** Canned reply for the emergency path — true emergencies go to emergency
 *  services first; the assistant never dispatches urgent help from here. */
const EMERGENCY_REPLY =
  "This sounds urgent. If there's a gas leak, flooding, or fire risk, please call emergency services right now — I can't dispatch an emergency response.";

// ---------------------------------------------------------------------------
// handleAssistantTurn — exported for the /api/assistant route (T4)
// ---------------------------------------------------------------------------

export async function handleAssistantTurn(
  input: AssistantChatRequest & { organizationId?: string },
  provider: AIProvider,
): Promise<AssistantChatResponse> {
  const lastContent = input.messages[input.messages.length - 1].content;
  const customerPhone = input.customerPhone ?? 'unknown';

  // 1. Emergency pre-check FIRST: escalation row, no provider call, no ledger.
  //    An escalation row is always created as an audit trail even for anonymous
  //    requests (phone='unknown'); the row is attributed to an org via the
  //    two-arm phone rule when a real phone is available.
  if (EMERGENCY_RE.test(lastContent)) {
    await createEscalation({
      type: 'customer_escalation',
      customerPhone,
      content: lastContent,
    });
    return { reply: EMERGENCY_REPLY, action: 'emergency', escalated: true };
  }

  // 2. Provider turn — runSupportAssistant already returns a grounded canned
  //    reply (zero usage) on empty text or a thrown provider error, so no
  //    try/catch is needed here.
  const result = await runSupportAssistant({
    provider,
    messages: input.messages,
    contextSnippet: input.contextSnippet,
    tradespersonName: input.tradespersonName,
  });

  // 3. Keyword actions on the last user message, checked in order.
  let action: AssistantAction = 'none';
  let escalated = false;

  if (BILLING_RE.test(lastContent)) {
    // The assistant cannot resolve billing matters — the tradesperson must.
    action = 'billing';
    escalated = true;
    await createEscalation({ type: 'customer_escalation', customerPhone, content: lastContent });
  } else if (RESCHEDULE_RE.test(lastContent)) {
    action = 'reschedule';
  }

  // 4. Cost ledger — only real LLM calls (nonzero usage) record a row.
  if (result.usage.tokensInput + result.usage.tokensOutput > 0) {
    await recordAiUsage({
      requestId: randomUUID(),
      provider: result.providerName,
      model: result.usage.model,
      tokensInput: result.usage.tokensInput,
      tokensOutput: result.usage.tokensOutput,
      source: 'llm',
      // organizationId is optional — include it only when the caller provided one.
      ...(input.organizationId != null ? { organizationId: input.organizationId } : {}),
    });
  }

  return { reply: result.reply, action, escalated };
}