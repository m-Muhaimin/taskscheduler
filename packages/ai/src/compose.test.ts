import { afterEach, describe, expect, it, vi } from "vitest";
import { createProvider } from "./compose.js";
import { RuleBasedFallbackProvider } from "./fallback.js";
import { OpenAiProvider } from "./providers/openai-adapter.js";
import { OllamaLlmProvider } from "./providers/ollama-llm.js";
import { CensusLlmProvider } from "./census-llm.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createProvider — explicit mode selection", () => {
  it("returns OpenAiProvider for openai mode with a key", () => {
    const provider = createProvider("openai", { apiKey: "sk-test" });
    expect(provider).toBeInstanceOf(OpenAiProvider);
    expect(provider.metadata().name).toBe("openai");
  });

  it("returns OllamaLlmProvider for ollama mode without a key", () => {
    const provider = createProvider("ollama");
    expect(provider).toBeInstanceOf(OllamaLlmProvider);
    expect(provider.metadata().name).toBe("ollama");
  });

  it("returns CensusLlmProvider for census mode with a key", () => {
    const provider = createProvider("census", { apiKey: "ck-test" });
    expect(provider).toBeInstanceOf(CensusLlmProvider);
    expect(provider.metadata().name).toBe("census");
  });

  it("returns the rule-based fallback for fallback-only mode", () => {
    const provider = createProvider("fallback-only");
    expect(provider).toBeInstanceOf(RuleBasedFallbackProvider);
  });

  it("fails fast when openai mode has no API key", () => {
    expect(() => createProvider("openai")).toThrow(/OPENAI_API_KEY/);
  });

  it("fails fast when census mode has no API key", () => {
    expect(() => createProvider("census")).toThrow(/CENSUS_API_KEY/);
  });
});

describe("createProvider — env-driven selection", () => {
  it("defaults to fallback-only when AI_PROVIDER is unset or unknown", () => {
    vi.stubEnv("AI_PROVIDER", undefined);
    expect(createProvider()).toBeInstanceOf(RuleBasedFallbackProvider);
    vi.stubEnv("AI_PROVIDER", "not-a-provider");
    expect(createProvider()).toBeInstanceOf(RuleBasedFallbackProvider);
  });

  it("selects openai from AI_PROVIDER + OPENAI_API_KEY env", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    expect(createProvider()).toBeInstanceOf(OpenAiProvider);
  });

  it("explicit mode beats env", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-env");
    expect(createProvider("fallback-only")).toBeInstanceOf(RuleBasedFallbackProvider);
  });
});
