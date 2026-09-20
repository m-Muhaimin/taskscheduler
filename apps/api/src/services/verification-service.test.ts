import { describe, expect, it } from 'vitest';
import { issueCode, verifyCode, issueFlowCode, verifyFlowCode, sha256Hex } from './verification-service.js';

/**
 * T14 — pure verification-service primitives. No DB, no env: issueCode is a
 * crypto-random 6-digit code, verifyCode is a constant-time same-length
 * compare that never throws.
 */
describe('verification-service', () => {
  it('issueCode returns a 6-digit numeric code', () => {
    for (let i = 0; i < 100; i++) {
      expect(issueCode()).toMatch(/^\d{6}$/);
    }
  });

  it('issueCode codes differ across calls (crypto-random, not fixed)', () => {
    const codes = new Set(Array.from({ length: 100 }, () => issueCode()));
    expect(codes.size).toBeGreaterThan(1);
  });

  it('verifyCode matches the exact stored code', () => {
    expect(verifyCode('123456', '123456')).toBe(true);
  });

  it('verifyCode rejects anything that is not the exact code', () => {
    expect(verifyCode('123456', '123457')).toBe(false); // same length, wrong digits
    expect(verifyCode('123456', '12345')).toBe(false);   // shorter
    expect(verifyCode('123456', '1234567')).toBe(false); // longer
    expect(verifyCode('123456', 'abcdef')).toBe(false);  // non-numeric
  });

  it('verifyCode never throws on the constant-time path (different lengths are short-circuited)', () => {
    expect(() => verifyCode('000000', '000000')).not.toThrow();
    expect(() => verifyCode('000000', '999999')).not.toThrow();
    expect(() => verifyCode('000000', '0')).not.toThrow();
  });
});

/**
 * T15 — flow-confirmation code primitives (issueFlowCode / verifyFlowCode /
 * sha256Hex). Same purity contract as T14: no DB, no env.
 */
describe('verification-service: T15 flow confirmation codes', () => {
  it('issueFlowCode returns a 6-digit code and a hash consistent with sha256(code)', () => {
    for (let i = 0; i < 100; i++) {
      const { code, hash } = issueFlowCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256Hex(code)).toBe(hash);
    }
  });

  it('issueFlowCode produces distinct hashes across calls (fresh code → fresh hash)', () => {
    const hashes = new Set(Array.from({ length: 50 }, () => issueFlowCode().hash));
    expect(hashes.size).toBeGreaterThan(1);
  });

  it('verifyFlowCode matches a stored hash against the recomputed hash of the same code', () => {
    const { code, hash } = issueFlowCode();
    expect(verifyFlowCode(hash, hash)).toBe(true);
    expect(verifyFlowCode(hash, sha256Hex(code))).toBe(true);
  });

  it('verifyFlowCode rejects different, malformed, or non-hash input without throwing', () => {
    const { code, hash } = issueFlowCode();
    const other = issueFlowCode();
    expect(verifyFlowCode(hash, sha256Hex(other.code))).toBe(false); // different code
    expect(verifyFlowCode(hash, 'tampered')).toBe(false);            // not a hash
    expect(verifyFlowCode(hash, '')).toBe(false);                    // empty
    expect(verifyFlowCode(hash, 'zz')).toBe(false);                  // too short (length guard)
    expect(verifyFlowCode('tampered', hash)).toBe(false);            // malformed stored side
    expect(verifyFlowCode(hash, code)).toBe(false);                  // plaintext ≠ hash
    expect(() =>
      verifyFlowCode(hash, 'x'.repeat(64)),                          // same length, garbage
    ).not.toThrow();
  });

  it('sha256Hex is deterministic, lowercase-hex, and sensitive to input', () => {
    expect(sha256Hex('482913')).toBe(sha256Hex('482913'));
    expect(sha256Hex('482913')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('482913')).not.toBe(sha256Hex('482914'));
  });
});