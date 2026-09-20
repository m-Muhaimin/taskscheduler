import { randomInt, timingSafeEqual, createHash } from 'node:crypto';

/**
 * T14 — OTP code primitives (issue/verify).
 *
 * Deliberately PURE: generates and compares codes only. Persistence (the
 * rl_customers writes) lives in the worker (process-inbound-sms.ts) — keeping
 * this module free of DB/env state makes it trivially unit-testable and lets
 * the worker own its write policy. No UPSERT_COLUMNS constant here: there is
 * no upsert in this module by design.
 *
 * Env-free boot: no module-scope env reads, no pool, no singletons.
 */

const CODE_LENGTH = 6;
const CODE_MAX_EXCLUSIVE = 10 ** CODE_LENGTH; // 000000..999999

/** Fresh 6-digit numeric code, crypto-random (uniform 0..999999). */
export function issueCode(): string {
  return String(randomInt(0, CODE_MAX_EXCLUSIVE)).padStart(CODE_LENGTH, '0');
}

/**
 * Constant-time compare of a submitted code against the stored one.
 * Same-length guard keeps timingSafeEqual from throwing; different lengths
 * (or non-string input) simply never match.
 */
export function verifyCode(expected: string, input: string): boolean {
  if (typeof input !== 'string' || input.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(input));
}

// ---------------------------------------------------------------------------
// T15 — flow-confirmation code primitives (same purity contract as T14)
// ---------------------------------------------------------------------------

/**
 * Fresh one-shot 6-digit confirmation code for a sensitive flow (reschedule
 * confirm / new booking). Returns BOTH the plaintext (for the SMS) and its
 * sha256 hex digest (for persistence — never store the plaintext).
 */
export function issueFlowCode(): { code: string; hash: string } {
  const code = issueCode();
  return { code, hash: sha256Hex(code) };
}

/**
 * Constant-time compare of two hex digest strings: the stored sha256 hash vs
 * the freshly computed sha256 of the submitted code. Same-length guard keeps
 * timingSafeEqual from throwing; unequal lengths (or non-string input) simply
 * never match.
 */
export function verifyFlowCode(expected: string, input: string): boolean {
  if (
    typeof expected !== 'string' ||
    typeof input !== 'string' ||
    input.length !== expected.length
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(input));
}

/** sha256 hex digest — hash the submitted code before comparing to the stored hash. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}