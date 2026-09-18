import { describe, expect, it, vi } from "vitest";
import { classifyStep } from "@tradescheduler/ai";
import type { AIProvider } from "@tradescheduler/ai";
import { parseIntent } from "@tradescheduler/shared";
import type { Intent } from "@tradescheduler/shared";

// ---------------------------------------------------------------------------
// Test doubles — a mock AIProvider that the compose layer calls
// ---------------------------------------------------------------------------

function mockProvider(overrides: {
  /** Any vitest mock. Typed loosely because the double is cast to AIProvider below. */
  structured?: unknown;
  text?: unknown;
  metadata?: unknown;
} = {}): AIProvider {
  return {
    // When overrides.structured is provided (e.g. mockRejectedValue), use it
    // directly so the mock actually rejects/resolves as configured. Otherwise
    // default to a high-confidence "unknown" so the LLM path is exercised.
    generateStructured: overrides.structured ??
      vi.fn().mockResolvedValue({
        data: {
          intent: "unknown",
          confidence: 0.85,
          customer_name: null,
          service_description: null,
          preferred_date: null,
          preferred_time_start: null,
          preferred_time_end: null,
          urgency: undefined,
          missing_information: [],
          reasoning: "llm classified",
        },
        usage: { tokensInput: 10, tokensOutput: 5, model: "census/foo" },
      }),
    generateText: overrides.text ??
      vi.fn().mockResolvedValue({
        text: "",
        usage: { tokensInput: 0, tokensOutput: 0, model: "census/foo" },
      }),
    metadata: overrides.metadata ?? vi.fn().mockReturnValue({
      name: "census",
      model: "census/foo",
      supportsStructured: true,
    }),
  } as unknown as AIProvider;
}

// ---------------------------------------------------------------------------
// classifyStep — context hint path (no provider call at all)
// ---------------------------------------------------------------------------

describe("classifyStep — context hint short-circuits", () => {
  it("returns the suggestedIntent without calling the provider", async () => {
    const provider = mockProvider();
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "yes",
        conversationStateExists: false,
        suggestedIntent: "confirm",
      },
      onEscalate,
      "req-1",
    );

    expect(provider.generateStructured).not.toHaveBeenCalled();
    expect(provider.generateText).not.toHaveBeenCalled();
    expect(result.intentResult).toEqual({ intent: "confirm", confidence: 0.95 });
    expect(result.source).toBe("context");
    expect(result.aiUsage).toBeNull();
    expect(onEscalate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// classifyStep — rule-based fallback path (LLM unavailable / low confidence)
// ---------------------------------------------------------------------------

describe("classifyStep — fallback to rule-based parser", () => {
  it("falls through to rule parser when LLM throws provider_unavailable", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({ kind: "provider_unavailable", message: "boom", retryable: true }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "reschedule",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-2",
    );

    expect(provider.generateStructured).toHaveBeenCalledTimes(1);
    // Rule parser picks up the reschedule the LLM couldn't classify.
    expect(result.intentResult).toEqual({ intent: "reschedule", confidence: 0.95 });
    expect(result.source).toBe("rule");
    expect(result.aiUsage).toBeNull();
    // No escalation — rule parser resolved it.
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it("falls through to rule parser when LLM returns confidence < 0.7", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockResolvedValue({
        data: {
          intent: "unknown",
          confidence: 0.4,
          customer_name: null,
          service_description: null,
          preferred_date: null,
          preferred_time_start: null,
          preferred_time_end: null,
          urgency: undefined,
          missing_information: [],
          reasoning: "unsure",
        },
        usage: { tokensInput: 10, tokensOutput: 5, model: "census/foo" },
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "reschedule",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-3",
    );

    // LLM returned unknown/0.4 (< 0.7) → rule parser runs and recognizes "reschedule".
    expect(result.intentResult).toEqual({ intent: "reschedule", confidence: 0.95 });
    expect(result.source).toBe("rule");
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it("handles a message the rule parser recognizes even after LLM fails", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({ kind: "rate_limited", message: "ratelimited", retryAfter: 5 }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "can we reschedule",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-4",
    );

    expect(result.intentResult).toEqual({ intent: "reschedule", confidence: 0.95 });
    expect(result.source).toBe("rule");
    expect(onEscalate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// classifyStep — terminal escalation path (both LLM and rule parser fail)
// ---------------------------------------------------------------------------

describe("classifyStep — terminal escalation", () => {
  it("escalates as processing_error when LLM fails (provider_unavailable)", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({ kind: "provider_unavailable", message: "down", retryable: true }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "asdfasdf",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-5",
    );

    expect(result.intentResult).toEqual({ intent: "unknown", confidence: 0.0 });
    expect(result.source).toBe("escalation");
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "processing_error",
        content: expect.stringContaining("asdfasdf"),
      }),
    );
  });

  it("escalates as ambiguous_intent when LLM is unsure AND rule parser unknown", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockResolvedValue({
        data: {
          intent: "unknown",
          confidence: 0.3,
          customer_name: null,
          service_description: null,
          preferred_date: null,
          preferred_time_start: null,
          preferred_time_end: null,
          urgency: undefined,
          missing_information: [],
          reasoning: "unsure",
        },
        usage: { tokensInput: 8, tokensOutput: 4, model: "census/foo" },
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "blah blah",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-6",
    );

    expect(result.intentResult).toEqual({ intent: "unknown", confidence: 0.0 });
    expect(result.source).toBe("escalation");
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ambiguous_intent",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// classifyStep — LLM path: returns LLM result when confidence >= 0.7
// ---------------------------------------------------------------------------

describe("classifyStep — LLM path returns on high confidence", () => {
  it("returns the LLM result when confidence >= 0.7", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockResolvedValue({
        data: {
          intent: "reschedule",
          confidence: 0.9,
          customer_name: null,
          service_description: null,
          preferred_date: null,
          preferred_time_start: null,
          preferred_time_end: null,
          urgency: undefined,
          missing_information: [],
          reasoning: "explicit reschedule signal",
        },
        usage: { tokensInput: 20, tokensOutput: 12, model: "census/foo" },
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "can we reschedule",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-7",
    );

    expect(result.intentResult).toEqual({ intent: "reschedule", confidence: 0.9 });
    expect(result.source).toBe("llm");
    expect(result.aiUsage).toEqual({ tokensInput: 20, tokensOutput: 12, model: "census/foo" });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it("returns LLM result for a new inquiry the rule parser can't handle", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockResolvedValue({
        data: {
          intent: "new_booking",
          confidence: 0.85,
          customer_name: "Alex",
          service_description: "AC repair",
          preferred_date: "2026-09-20T00:00:00.000Z",
          preferred_time_start: "2026-09-20T14:00:00.000Z",
          preferred_time_end: "2026-09-20T15:00:00.000Z",
          urgency: "normal",
          missing_information: ["service address"],
          reasoning: "customer wants AC fixed, gave a date and time window",
        },
        usage: { tokensInput: 35, tokensOutput: 40, model: "census/foo" },
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "I need my AC fixed tomorrow around 2pm",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-8",
    );

    // classifyStep maps new_booking -> "unknown" for the existing Intent union
    // until Checkpoint 06 extends the worker switch. The LLM source + usage
    // are preserved so the agent/observability layers can still act on it.
    expect(result.source).toBe("llm");
    expect(result.aiUsage).toEqual({ tokensInput: 35, tokensOutput: 40, model: "census/foo" });
    expect(result.intentResult).toEqual({ intent: "unknown", confidence: 0.85 });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it("returns LLM result for a second new-inquiry message", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockResolvedValue({
        data: {
          intent: "new_booking",
          confidence: 0.8,
          customer_name: null,
          service_description: "water heater check",
          preferred_date: null,
          preferred_time_start: null,
          preferred_time_end: null,
          urgency: "high",
          missing_information: ["preferred date", "service address"],
          reasoning: "customer wants a water heater looked at, urgent tone",
        },
        usage: { tokensInput: 30, tokensOutput: 35, model: "census/foo" },
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "Can you send someone to look at my water heater? It's making a weird noise.",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-9",
    );

    expect(result.source).toBe("llm");
    expect(result.aiUsage).toEqual({ tokensInput: 30, tokensOutput: 35, model: "census/foo" });
    expect(result.intentResult).toEqual({ intent: "unknown", confidence: 0.8 });
    expect(onEscalate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// classifyStep — Zod schema rejection path (malformed LLM response)
// ---------------------------------------------------------------------------

describe("classifyStep — Zod schema rejection", () => {
  it("falls through to rule parser when LLM returns confidence out of range (1.5)", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({
        kind: "schema_rejection",
        raw: { intent: "reschedule", confidence: 1.5 },
        reason: "Number must be less than or equal to 1",
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "reschedule",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-11",
    );

    expect(result.source).toBe("rule");
    expect(result.intentResult).toEqual({ intent: "reschedule", confidence: 0.95 });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it("falls through to rule parser when LLM returns a non-JSON body", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({
        kind: "schema_rejection",
        raw: "not json at all",
        reason: "Expected object, received string",
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "help",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-13",
    );

    expect(result.source).toBe("rule");
    expect(result.intentResult).toEqual({ intent: "help", confidence: 0.95 });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it("falls through to rule parser when LLM returns a malformed intent (out of enum)", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({
        kind: "schema_rejection",
        raw: { intent: "booking", confidence: 0.9 },
        reason: "Invalid enum value. Expected 'new_booking' | 'reschedule' | 'cancel' | 'question' | 'emergency' | 'slot_choice' | 'confirm' | 'unknown', received 'booking'",
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "reschedule",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-10",
    );

    // Schema rejection → rule parser runs and recognizes reschedule.
    expect(provider.generateStructured).toHaveBeenCalledTimes(1);
    expect(result.source).toBe("rule");
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it("falls through to rule parser when LLM returns missing required field (intent)", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({
        kind: "schema_rejection",
        raw: { confidence: 0.9 },
        reason: "Required",
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      {
        body: "2",
        conversationStateExists: true,
        suggestedIntent: null,
      },
      onEscalate,
      "req-12",
    );

    expect(result.source).toBe("rule");
    // slot-choice is recognized by the rule parser when state exists.
    expect(result.intentResult).toEqual({ intent: "slot-choice", confidence: 0.9 });
    expect(onEscalate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// classifyStep — existing parseIntent tests are untouched
// ---------------------------------------------------------------------------

// NOTE: The existing 92 tests in apps/api/src/services/intent-service.test.ts
// still pass unmodified. classifyStep's rule-path tests above exercise the SAME
// parseIntent function through the compose layer, but the original unit tests
// remain the authoritative regression surface for the rule parser itself.
describe("classifyStep — existing rule-parser contract preserved", () => {
  it("maps a reschedule signal through the rule path exactly as parseIntent does", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({ kind: "provider_unavailable", message: "down", retryable: true }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      { body: "move my appointment", conversationStateExists: false, suggestedIntent: null },
      onEscalate,
      "req-14",
    );

    expect(result.intentResult).toEqual(parseIntent("move my appointment", false));
    expect(result.source).toBe("rule");
  });

  it("maps a confirm signal through the rule path exactly as parseIntent does", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({ kind: "provider_unavailable", message: "down", retryable: true }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      { body: "that works", conversationStateExists: false, suggestedIntent: null },
      onEscalate,
      "req-15",
    );

    expect(result.intentResult).toEqual(parseIntent("that works", false));
    expect(result.source).toBe("rule");
  });

  it("preserves the unknown-when-no-state invariant for numbers through the rule path", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockRejectedValue({ kind: "provider_unavailable", message: "down", retryable: true }),
    });
    const onEscalate = vi.fn();

    const resultNoState = await classifyStep(
      provider,
      { body: "2", conversationStateExists: false, suggestedIntent: null },
      onEscalate,
      "req-16a",
    );
    const resultWithState = await classifyStep(
      provider,
      { body: "2", conversationStateExists: true, suggestedIntent: null },
      onEscalate,
      "req-16b",
    );

    // "2" without conversation state → rule parser returns unknown (conf 0.0) → escalation
    expect(resultNoState.intentResult).toEqual(parseIntent("2", false));
    expect(resultNoState.source).toBe("escalation");
    expect(onEscalate).toHaveBeenCalledTimes(1);
    // "2" with conversation state → rule parser returns slot-choice (conf 0.9) → rule path
    expect(resultWithState.intentResult).toEqual(parseIntent("2", true));
    expect(resultWithState.source).toBe("rule");
  });
});

// ---------------------------------------------------------------------------
// classifyStep — superset guarantee (rule parser >= 0.9 overrides the LLM)
// ---------------------------------------------------------------------------

describe("classifyStep — superset guarantee (rule >= 0.9 overrides LLM)", () => {
  it("merges when rule intent (>= 0.9) conflicts with a successful LLM result", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockResolvedValue({
        data: {
          intent: "cancel",
          confidence: 0.85,
          customer_name: null,
          service_description: null,
          preferred_date: null,
          preferred_time_start: null,
          preferred_time_end: null,
          urgency: undefined,
          missing_information: [],
          reasoning: "llm says cancel",
        },
        usage: { tokensInput: 12, tokensOutput: 6, model: "census/foo" },
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      { body: "reschedule", conversationStateExists: false, suggestedIntent: null },
      onEscalate,
      "req-20",
    );

    // Rule parser recognizes "reschedule" at 0.95 — deterministic keyword
    // beats the LLM's cancel signal (mapIntent(cancel) → "unknown").
    expect(result.intentResult).toEqual({ intent: "reschedule", confidence: 0.95 });
    expect(result.source).toBe("merged");
    // LLM usage is preserved — we already paid for the call.
    expect(result.aiUsage).toEqual({ tokensInput: 12, tokensOutput: 6, model: "census/foo" });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it("keeps the LLM result when rule and LLM agree on the intent", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockResolvedValue({
        data: {
          intent: "reschedule",
          confidence: 0.85,
          customer_name: null,
          service_description: null,
          preferred_date: null,
          preferred_time_start: null,
          preferred_time_end: null,
          urgency: undefined,
          missing_information: [],
          reasoning: "llm agrees",
        },
        usage: { tokensInput: 12, tokensOutput: 6, model: "census/foo" },
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      { body: "reschedule", conversationStateExists: false, suggestedIntent: null },
      onEscalate,
      "req-21",
    );

    expect(result.intentResult).toEqual({ intent: "reschedule", confidence: 0.85 });
    expect(result.source).toBe("llm");
    expect(result.aiUsage).toEqual({ tokensInput: 12, tokensOutput: 6, model: "census/foo" });
    expect(onEscalate).not.toHaveBeenCalled();
  });

  it("does not override when the rule parser is not high-confidence (< 0.9)", async () => {
    const provider = mockProvider({
      structured: vi.fn().mockResolvedValue({
        data: {
          intent: "new_booking",
          confidence: 0.8,
          customer_name: null,
          service_description: "AC repair",
          preferred_date: null,
          preferred_time_start: null,
          preferred_time_end: null,
          urgency: undefined,
          missing_information: [],
          reasoning: "llm sees a booking",
        },
        usage: { tokensInput: 9, tokensOutput: 3, model: "census/foo" },
      }),
    });
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider,
      { body: "I need my AC fixed tomorrow around 2pm", conversationStateExists: false, suggestedIntent: null },
      onEscalate,
      "req-22",
    );

    // mapIntent(new_booking) → "unknown"; rule parser has no >= 0.9 signal for
    // this body → plain LLM path.
    expect(result.source).toBe("llm");
    expect(result.intentResult).toEqual({ intent: "unknown", confidence: 0.8 });
    expect(onEscalate).not.toHaveBeenCalled();
  });
});
