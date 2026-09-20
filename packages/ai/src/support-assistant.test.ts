import { describe, expect, it } from "vitest";
import {
  RIDGELINE_SUPPORT_SYSTEM_PROMPT,
  buildSupportSystemPrompt,
  runSupportAssistant,
  supportFallbackReply,
} from "./support-assistant.js";
import type {
  AIProvider,
  AiUsage,
  GenerateStructuredOptions,
  GenerateTextOptions,
  ProviderMetadata,
} from "./provider.js";
import type { z } from "zod";
import type { AssistantMessage } from "@tradescheduler/shared";

// ---------------------------------------------------------------------------
// FakeProvider — scripted AIProvider for exercising runSupportAssistant.
// metadata() → { name: 'fake', model: 'fake/model', supportsStructured: false };
// generateStructured throws; generateText returns whatever the test scripted.
// ---------------------------------------------------------------------------

const SCRIPTED_USAGE: AiUsage = { tokensInput: 100, tokensOutput: 50, model: "fake/model" };

class FakeProvider implements AIProvider {
  readonly generateTextCalls: GenerateTextOptions[] = [];

  constructor(
    private readonly scriptedText: string,
    private readonly scriptedUsage: AiUsage = SCRIPTED_USAGE,
    private readonly shouldThrow = false,
  ) {}

  metadata(): ProviderMetadata {
    return { name: "fake", model: "fake/model", supportsStructured: false };
  }

  async generateStructured<TSchema extends z.ZodType>(
    _options: GenerateStructuredOptions<TSchema>,
  ): Promise<{ data: z.infer<TSchema>; usage: AiUsage }> {
    throw new Error("generateStructured should not be called by runSupportAssistant");
  }

  async generateText(options: GenerateTextOptions): Promise<{ text: string; usage: AiUsage }> {
    this.generateTextCalls.push(options);
    if (this.shouldThrow) throw new Error("provider exploded");
    return { text: this.scriptedText, usage: this.scriptedUsage };
  }
}

// A realistic chat thread: one prior exchange plus the latest user message,
// which is the only thing runSupportAssistant should send as the prompt.
const CHAT: AssistantMessage[] = [
  { role: "user", content: "I need to move my appointment" },
  { role: "assistant", content: "No problem — what day works for you?" },
  { role: "user", content: "Wednesday works for me" },
];

function cannedTradesperson() {
  return supportFallbackReply("Mike");
}

// ---------------------------------------------------------------------------
// runSupportAssistant — non-empty provider reply passes through
// ---------------------------------------------------------------------------

describe("runSupportAssistant — passthrough", () => {
  it("returns the scripted reply + usage + provider name and sends the last user message as the prompt", async () => {
    const provider = new FakeProvider("Wednesday at 2pm it is.");
    const result = await runSupportAssistant({
      provider,
      messages: CHAT,
      contextSnippet: "Appointments today: none",
      tradespersonName: "Mike",
    });

    expect(result.reply).toBe("Wednesday at 2pm it is.");
    expect(result.usage).toEqual(SCRIPTED_USAGE);
    expect(result.providerName).toBe("fake");

    expect(provider.generateTextCalls).toHaveLength(1);
    const call = provider.generateTextCalls[0];
    expect(call.prompt).toBe("Wednesday works for me");
    expect(call.maxTokens).toBe(512);
    // The system prompt embeds the flattened conversation history (minus the
    // last message), the context snippet, and the tradesperson name.
    expect(call.system).toContain("Customer: I need to move my appointment");
    expect(call.system).toContain("RidgeLine: No problem — what day works for you?");
    expect(call.system).toContain("Appointments today: none");
    expect(call.system).toContain("Tradesperson: Mike");
    expect(call.system).toContain("Chat history:");
  });

  it("omits the last user message from the flattened history (it is the prompt)", async () => {
    const provider = new FakeProvider("yep");
    await runSupportAssistant({ provider, messages: CHAT, contextSnippet: "ctx", tradespersonName: "Mike" });

    const system = provider.generateTextCalls[0].system ?? "";
    expect(system).not.toContain("Customer: Wednesday works for me");
    expect(system).toContain("Customer: I need to move my appointment");
  });
});

// ---------------------------------------------------------------------------
// runSupportAssistant — grounded fallback on empty / whitespace / throw
// ---------------------------------------------------------------------------

describe("runSupportAssistant — fallback on empty text", () => {
  it("returns the canned reply with the tradesperson's name when the provider returns empty text", async () => {
    const provider = new FakeProvider("");
    const result = await runSupportAssistant({
      provider,
      messages: CHAT,
      contextSnippet: "ctx",
      tradespersonName: "Mike",
    });

    expect(result.reply).toBe(cannedTradesperson());
    expect(result.reply).toContain("Mike");
    // Zero-usage fallback path: usage is preserved from the provider result.
    expect(result.usage).toEqual(SCRIPTED_USAGE);
    expect(result.providerName).toBe("fake");
  });

  it("returns the canned reply with the generic name when no tradespersonName is given", async () => {
    const provider = new FakeProvider("");
    const result = await runSupportAssistant({ provider, messages: CHAT });

    expect(result.reply).toBe(supportFallbackReply());
    expect(result.reply).toContain("your tradesperson");
  });
});

describe("runSupportAssistant — fallback on whitespace-only text", () => {
  it("treats whitespace-only text as empty and returns the canned reply", async () => {
    const provider = new FakeProvider("   \n\t  ");
    const result = await runSupportAssistant({
      provider,
      messages: CHAT,
      tradespersonName: "Mike",
    });

    expect(result.reply).toBe(cannedTradesperson());
    expect(result.usage).toEqual(SCRIPTED_USAGE);
    expect(result.providerName).toBe("fake");
  });
});

describe("runSupportAssistant — fallback when the provider throws", () => {
  it("returns the canned reply with zero usage when generateText rejects", async () => {
    const provider = new FakeProvider("never returned", SCRIPTED_USAGE, true);
    const result = await runSupportAssistant({
      provider,
      messages: CHAT,
      contextSnippet: "ctx",
      tradespersonName: "Mike",
    });

    expect(result.reply).toBe(cannedTradesperson());
    expect(result.usage).toEqual({ tokensInput: 0, tokensOutput: 0, model: "fake/model" });
    expect(result.providerName).toBe("fake");
  });
});

// ---------------------------------------------------------------------------
// runSupportAssistant — input guard (empty / non-user last message)
// ---------------------------------------------------------------------------

describe("runSupportAssistant — guard", () => {
  it("rejects when messages is empty", async () => {
    const provider = new FakeProvider("text");
    await expect(runSupportAssistant({ provider, messages: [] })).rejects.toThrow(
      'support-assistant: last message must have role "user"',
    );
  });

  it("rejects when the last message has role 'assistant'", async () => {
    const provider = new FakeProvider("text");
    const messages: AssistantMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    await expect(runSupportAssistant({ provider, messages })).rejects.toThrow(
      'support-assistant: last message must have role "user"',
    );
  });
});

// ---------------------------------------------------------------------------
// buildSupportSystemPrompt — history flattening + default sections
// ---------------------------------------------------------------------------

describe("buildSupportSystemPrompt", () => {
  it("defaults context and tradesperson when not provided", () => {
    const system = buildSupportSystemPrompt(CHAT);
    expect(system).toContain(RIDGELINE_SUPPORT_SYSTEM_PROMPT);
    expect(system).toContain("Context:\n(none provided)");
    expect(system).toContain("Tradesperson: your tradesperson");
    expect(system).toContain("Customer: Wednesday works for me");
  });

  it("flattens every message with the Customer:/RidgeLine: role prefixes", () => {
    const system = buildSupportSystemPrompt(CHAT, "Appointments today: none", "Mike");
    const historySection = system.split("Chat history:\n")[1];
    expect(historySection).toBe(
      "Customer: I need to move my appointment\n" +
        "RidgeLine: No problem — what day works for you?\n" +
        "Customer: Wednesday works for me",
    );
  });
});

// ---------------------------------------------------------------------------
// supportFallbackReply — name interpolation
// ---------------------------------------------------------------------------

describe("supportFallbackReply", () => {
  it("interpolates the tradesperson name and falls back to 'your tradesperson'", () => {
    expect(supportFallbackReply("Mike")).toContain("Mike");
    expect(supportFallbackReply()).toContain("your tradesperson");
    expect(supportFallbackReply(undefined)).toContain("your tradesperson");
  });
});

// ---------------------------------------------------------------------------
// RIDGELINE_SUPPORT_SYSTEM_PROMPT — the domain rules must be encoded
// ---------------------------------------------------------------------------

describe("RIDGELINE_SUPPORT_SYSTEM_PROMPT", () => {
  it("encodes the domain rules: billing, emergency, reschedule", () => {
    const prompt = RIDGELINE_SUPPORT_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("billing");
    expect(prompt).toContain("reschedule");
    expect(prompt).toContain("emergency");
  });

  it("fronts a solo tradesperson, never claims to be human, never invents appointments", () => {
    const prompt = RIDGELINE_SUPPORT_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("solo tradesperson");
    expect(prompt).toContain("never claim to be human");
    expect(prompt).toContain("never invent");
    expect(prompt).toContain("do not book");
  });

  it("directs true emergencies (gas leak, flood, fire, carbon monoxide) to emergency services", () => {
    const prompt = RIDGELINE_SUPPORT_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toMatch(/gas leak|flood|fire|carbon monoxide/);
    expect(prompt).toMatch(/emergency services|call.*emergency/);
  });

  it("defers billing and payment questions to the tradesperson", () => {
    const prompt = RIDGELINE_SUPPORT_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toMatch(/trade\w+.*billing|billing.*trade\w+/);
  });
});