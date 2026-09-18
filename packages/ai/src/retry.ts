/** Retry wrapper for provider calls (Checkpoint 01 §3 — "retry logic").
 *
 *  The adapters already classify failures into AiError kinds with retry hints
 *  (retryable: true, retryAfter). This helper turns those hints into actual
 *  retries: exponential backoff with jitter, honoring Retry-After when the
 *  provider tells us to wait.
 *
 *  Policy:
 *  - `rate_limited`            → retry, honoring `retryAfter` (capped)
 *  - `provider_unavailable` with `retryable: true` → retry with backoff
 *  - everything else (auth, schema_rejection, non-retryable unavailable) → rethrow
 */

export interface RetryOptions {
  /** Max number of retries after the first attempt. Default 2. */
  maxRetries?: number;
  /** Base backoff in ms. Actual delay = base * 2^attempt + jitter. Default 250ms. */
  baseDelayMs?: number;
  /** Cap for any single backoff delay. Default 8000ms. */
  maxDelayMs?: number;
}

export const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
};

/** True when the error kind says the call is worth retrying. */
export function isRetryableKind(err: unknown): boolean {
  if (err && typeof err === "object" && "kind" in err) {
    const kind = (err as { kind?: string }).kind;
    if (kind === "rate_limited") return true;
    if (kind === "provider_unavailable") {
      return (err as { retryable?: boolean }).retryable !== false;
    }
  }
  return false;
}

/** Wait `ms` — extracted for testability (fake timers). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn`, retrying when the error is a retryable AiError kind. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts: Required<RetryOptions> = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableKind(err) || attempt >= opts.maxRetries) throw err;
      attempt += 1;
      const delay = retryDelayMs(err, attempt, opts);
      await sleep(delay);
    }
  }
}

/** Backoff for one retry: honors Retry-After for 429s, else exp backoff + jitter. */
export function retryDelayMs(
  err: unknown,
  attempt: number,
  opts: Required<RetryOptions> = DEFAULT_RETRY_OPTIONS,
): number {
  if (err && typeof err === "object" && "kind" in err) {
    const retryAfter = (err as { retryAfter?: number }).retryAfter;
    if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.min(retryAfter * 1000, opts.maxDelayMs);
    }
  }
  const base = opts.baseDelayMs * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * opts.baseDelayMs);
  return Math.min(base + jitter, opts.maxDelayMs);
}
