import { describe, expect, it, vi } from "vitest";
import { classifyStep } from "../src/index.js";

// ---------------------------------------------------------------------------
// classifyStep — context hint path (no provider call at all)
// ---------------------------------------------------------------------------

describe("classifyStep — context hint short-circuits", () => {
  it("returns the suggestedIntent without calling the provider", async () => {
    const provider = { generateStructured: vi.fn(), generateText: vi.fn(), metadata: vi.fn() };
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider as any,
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
// classifyStep — rule-based fallback path (LLM unavailable)
// ---------------------------------------------------------------------------

describe("classifyStep — fallback to rule-based parser", () => {
  it("falls through to rule parser when LLM throws provider_unavailable", async () => {
    const provider = {
      generateStructured: vi.fn().mockRejectedValue({ kind: "provider_unavailable", message: "boom", retryable: true }),
      generateText: vi.fn(),
      metadata: vi.fn(),
    };
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider as any,
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
    const provider = {
      generateStructured: vi.fn().mockResolvedValue({
        data: { intent: "unknown", confidence: 0.4, customer_name: null, service_description: null, preferred_date: null, preferred_time_start: null, preferred_time_end: null, urgency: undefined, missing_information: [], reasoning: "" },
        usage: { tokensInput: 10, tokensOutput: 5, model: "census/foo" },
      }),
      generateText: vi.fn(),
      metadata: vi.fn(),
    };
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider as any,
      {
        body: "hello",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-3",
    );

    expect(result.intentResult).toEqual({ intent: "unknown", confidence: 0.0 }); // rule parser also unknown for "hello" → terminal escalation
    expect(result.source).toBe("escalation");
    expect(onEscalate).toHaveBeenCalledTimes(1);
    expect(onEscalate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ambiguous_intent",
        content: expect.stringContaining("hello"),
      }),
    );
  });

  it("handles a message the rule parser recognizes even after LLM fails", async () => {
    const provider = {
      generateStructured: vi.fn().mockRejectedValue({ kind: "rate_limited", message: "ratelimited", retryAfter: 5 }),
      generateText: vi.fn(),
      metadata: vi.fn(),
    };
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider as any,
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
  it("escalates when LLM fails AND rule parser returns unknown", async () => {
    const provider = {
      generateStructured: vi.fn().mockRejectedValue({ kind: "provider_unavailable", message: "down", retryable: true }),
      generateText: vi.fn(),
      metadata: vi.fn(),
    };
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider as any,
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

  it("returns unknown + escalates when LLM returns unknown with low confidence", async () => {
    const provider = {
      generateStructured: vi.fn().mockResolvedValue({
        data: { intent: "unknown", confidence: 0.3, customer_name: null, service_description: null, preferred_date: null, preferred_time_start: null, preferred_time_end: null, urgency: undefined, missing_information: [], reasoning: "unsure" },
        usage: { tokensInput: 8, tokensOutput: 4, model: "census/foo" },
      }),
      generateText: vi.fn(),
      metadata: vi.fn(),
    };
    const onEscalate = vi.fn();

    const result = await classifyStep(
      provider as any,
      {
        body: "blah blah",
        conversationStateExists: false,
        suggestedIntent: null,
      },
      onEscalate,
      "req-6",
    );

    expect(result.intentResult).toEqual({ intent: "unknown", confidence: 0.0 }); // rule parser path for "blah blah"
    expect(result.source).toBe("escalation");
    expect(onEscalate).toHaveBeenCalledTimes(1);
  });
});
