import { describe, expect, it, vi } from "vitest";
import { withRetry, isRetryableKind, retryDelayMs, DEFAULT_RETRY_OPTIONS } from "./retry.js";

describe("isRetryableKind", () => {
  it("retries rate_limited", () => {
    expect(isRetryableKind({ kind: "rate_limited", message: "429" })).toBe(true);
  });

  it("retries provider_unavailable when retryable is true", () => {
    expect(isRetryableKind({ kind: "provider_unavailable", message: "5xx", retryable: true })).toBe(true);
  });

  it("retries provider_unavailable when retryable is undefined (defaults to retryable)", () => {
    expect(isRetryableKind({ kind: "provider_unavailable", message: "5xx" })).toBe(true);
  });

  it("does not retry auth or schema_rejection", () => {
    expect(isRetryableKind({ kind: "auth", message: "401" })).toBe(false);
    expect(isRetryableKind({ kind: "schema_rejection", message: "bad json" })).toBe(false);
  });

  it("does not retry provider_unavailable flagged retryable: false", () => {
    expect(isRetryableKind({ kind: "provider_unavailable", message: "boom", retryable: false })).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the value on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(withRetry(fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a retryable failure then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ kind: "provider_unavailable", message: "5xx", retryable: true })
      .mockResolvedValueOnce("ok");
    const result = await withRetry(fn, { baseDelayMs: 0, maxDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and rethrows the last retryable error", async () => {
    const err = { kind: "rate_limited", message: "429", retryAfter: 0 };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { baseDelayMs: 0, maxDelayMs: 0 })).rejects.toBe(err);
    // 1 initial + 2 retries = 3
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const err = { kind: "auth", message: "401" };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects a custom maxRetries", async () => {
    const err = { kind: "provider_unavailable", message: "down", retryable: true };
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRetry(fn, { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 })).rejects.toBe(err);
    // 1 initial + 1 retry = 2
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("retryDelayMs", () => {
  it("honors retryAfter in milliseconds", () => {
    expect(retryDelayMs({ kind: "rate_limited", retryAfter: 3 }, 1, DEFAULT_RETRY_OPTIONS)).toBe(3000);
  });

  it("caps retryAfter at maxDelayMs", () => {
    expect(retryDelayMs({ kind: "rate_limited", retryAfter: 9999 }, 1, { ...DEFAULT_RETRY_OPTIONS, maxDelayMs: 5000 })).toBe(5000);
  });

  it("grows exponentially without retryAfter", () => {
    const d1 = retryDelayMs({ kind: "provider_unavailable", retryable: true }, 1, DEFAULT_RETRY_OPTIONS);
    const d2 = retryDelayMs({ kind: "provider_unavailable", retryable: true }, 2, DEFAULT_RETRY_OPTIONS);
    expect(d2).toBeGreaterThan(d1);
  });
});
