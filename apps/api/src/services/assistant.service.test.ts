import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAssistantTurn } from './assistant.service.js';
import { supportFallbackReply } from '@tradescheduler/ai';
import type { AIProvider, AiUsage, ProviderMetadata } from '@tradescheduler/ai';
import type { AssistantMessage } from '@tradescheduler/shared';

/**
 * Unit tests for the RidgeLine Assistant chat-turn service (T3).
 *
 * The service does no DB work itself — it delegates to the escalation and
 * ai-usage service modules, so those two MODULES are mocked via vi.hoisted +
 * vi.mock (same pattern as process-inbound-sms.test.ts / auth.test.ts), and
 * the AI turn is exercised through a local FakeProvider injected into
 * handleAssistantTurn (the injection the T4 route will use).
 */
const mocks = vi.hoisted(() => ({
  createEscalation: vi.fn(),
  recordAiUsage: vi.fn(),
}));

vi.mock('./escalation-service.js', () => ({
  createEscalation: mocks.createEscalation,
}));
vi.mock('./ai-usage-service.js', () => ({
  recordAiUsage: mocks.recordAiUsage,
}));

// ---------------------------------------------------------------------------
// FakeProvider — scripted AIProvider injected into handleAssistantTurn.
// metadata() → { name: 'fake', model: 'fake/model', supportsStructured: false };
// generateStructured throws; generateText returns whatever the test scripted
// and records every call so tests can assert "provider never called".
// ---------------------------------------------------------------------------

const SCRIPTED_USAGE: AiUsage = { tokensInput: 100, tokensOutput: 50, model: 'fake/model' };
const ZERO_USAGE: AiUsage = { tokensInput: 0, tokensOutput: 0, model: 'fake/model' };

class FakeProvider implements AIProvider {
  readonly generateTextCalls: { prompt: string; system?: string; maxTokens?: number }[] = [];

  constructor(
    private readonly scriptedText: string,
    private readonly scriptedUsage: AiUsage = SCRIPTED_USAGE,
  ) {}

  metadata(): ProviderMetadata {
    return { name: 'fake', model: 'fake/model', supportsStructured: false };
  }

  async generateStructured(): Promise<never> {
    throw new Error('generateStructured should never be called by the assistant service');
  }

  async generateText(options: { prompt: string; system?: string; maxTokens?: number }): Promise<{ text: string; usage: AiUsage }> {
    this.generateTextCalls.push(options);
    return { text: this.scriptedText, usage: this.scriptedUsage };
  }
}

function userTurn(content: string): AssistantMessage[] {
  return [{ role: 'user', content }];
}

const EMERGENCY_COPY =
  "This sounds urgent. If there's a gas leak, flooding, or fire risk, please call emergency services right now — I can't dispatch an emergency response.";

beforeEach(() => {
  mocks.createEscalation.mockReset();
  mocks.recordAiUsage.mockReset();
});

describe('handleAssistantTurn', () => {
  it('passes the provider reply through and records usage for real LLM calls, forwarding organizationId', async () => {
    const provider = new FakeProvider('You can confirm a booking by replying "yes" to the confirmation text.');
    const result = await handleAssistantTurn(
      { messages: userTurn('How do I confirm a booking?'), organizationId: 'org-1' },
      provider,
    );

    expect(result).toEqual({
      reply: 'You can confirm a booking by replying "yes" to the confirmation text.',
      action: 'none',
      escalated: false,
    });
    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'fake',
        model: 'fake/model',
        tokensInput: 100,
        tokensOutput: 50,
        source: 'llm',
        organizationId: 'org-1',
        requestId: expect.any(String),
      }),
    );
    expect(mocks.createEscalation).not.toHaveBeenCalled();
  });

  it('skips the ledger on zero-usage fallback turns but still applies keyword actions', async () => {
    const provider = new FakeProvider('', ZERO_USAGE);
    const result = await handleAssistantTurn(
      { messages: userTurn('please reschedule my appointment') },
      provider,
    );

    expect(result.reply).toBe(supportFallbackReply());
    expect(result.action).toBe('reschedule');
    expect(result.escalated).toBe(false);
    expect(mocks.recordAiUsage).not.toHaveBeenCalled();
    expect(mocks.createEscalation).not.toHaveBeenCalled();
  });

  it('handles emergencies before any provider call: escalation row + canned reply, no ledger', async () => {
    const provider = new FakeProvider('this text must never be reached');
    const result = await handleAssistantTurn(
      { messages: userTurn('my water heater is leaking and flooding right now') },
      provider,
    );

    expect(result.action).toBe('emergency');
    expect(result.escalated).toBe(true);
    expect(result.reply).toBe(EMERGENCY_COPY);
    expect(provider.generateTextCalls).toHaveLength(0);
    expect(mocks.recordAiUsage).not.toHaveBeenCalled();
    expect(mocks.createEscalation).toHaveBeenCalledTimes(1);
    expect(mocks.createEscalation).toHaveBeenCalledWith({
      type: 'customer_escalation',
      customerPhone: 'unknown',
      content: 'my water heater is leaking and flooding right now',
    });
  });

  it('escalates billing turns with an escalation row', async () => {
    const provider = new FakeProvider("I'll flag that refund question for Mike to review.");
    const result = await handleAssistantTurn(
      { messages: userTurn('can I get a refund on my deposit') },
      provider,
    );

    expect(result.action).toBe('billing');
    expect(result.escalated).toBe(true);
    expect(mocks.createEscalation).toHaveBeenCalledTimes(1);
    expect(mocks.createEscalation).toHaveBeenCalledWith({
      type: 'customer_escalation',
      customerPhone: 'unknown',
      content: 'can I get a refund on my deposit',
    });
    // A real LLM turn still records the ledger alongside the escalation.
    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
  });

  it('flags reschedule turns without an escalation row and passes the provider reply through', async () => {
    const provider = new FakeProvider('Got it — when would you like to move it to?');
    const result = await handleAssistantTurn(
      { messages: userTurn('can we reschedule my appointment') },
      provider,
    );

    expect(result.action).toBe('reschedule');
    expect(result.escalated).toBe(false);
    expect(result.reply).toBe('Got it — when would you like to move it to?');
    expect(mocks.createEscalation).not.toHaveBeenCalled();
    expect(mocks.recordAiUsage).toHaveBeenCalledTimes(1);
    // organizationId is only included when the caller provided one.
    expect(mocks.recordAiUsage).toHaveBeenCalledWith(
      expect.not.objectContaining({ organizationId: expect.any(String) }),
    );
  });

  it('passes customerPhone through to escalation rows when provided', async () => {
    const provider = new FakeProvider('I hear you — flagged for follow-up.');
    await handleAssistantTurn(
      {
        messages: userTurn('the invoice for my deposit looks wrong'),
        customerPhone: '+15551234567',
      },
      provider,
    );

    expect(mocks.createEscalation).toHaveBeenCalledTimes(1);
    expect(mocks.createEscalation).toHaveBeenCalledWith({
      type: 'customer_escalation',
      customerPhone: '+15551234567',
      content: 'the invoice for my deposit looks wrong',
    });
  });
});