import { describe, expect, it } from 'vitest';
import { countryCodeFromE164, normalizeChannelAddress, toChannelAddress } from './phone-utils.js';

describe('normalizeChannelAddress', () => {
  it('strips a whatsapp: prefix and reports the whatsapp channel', () => {
    expect(normalizeChannelAddress('whatsapp:+8801712345678')).toEqual({
      channel: 'whatsapp',
      e164: '+8801712345678',
    });
  });

  it('returns sms + the address verbatim when there is no prefix', () => {
    expect(normalizeChannelAddress('+15551234567')).toEqual({
      channel: 'sms',
      e164: '+15551234567',
    });
  });

  it('is case-insensitive on the prefix and tolerant of surrounding whitespace', () => {
    expect(normalizeChannelAddress('  WhatsApp:+8801712345678 ')).toEqual({
      channel: 'whatsapp',
      e164: '+8801712345678',
    });
  });

  it('preserves the bare E.164 for the worker gates (a whatsapp: address still normalizes E.164-shaped)', () => {
    const { e164 } = normalizeChannelAddress('whatsapp:+1 555 123 4567');
    expect(e164).toBe('+1 555 123 4567'); // verbatim remainder — E.164 gates handle exotic input
  });
});

describe('toChannelAddress', () => {
  it('prepends whatsapp: for the whatsapp channel', () => {
    expect(toChannelAddress('+8801712345678', 'whatsapp')).toBe('whatsapp:+8801712345678');
  });

  it('returns the bare E.164 for sms', () => {
    expect(toChannelAddress('+15551234567', 'sms')).toBe('+15551234567');
  });

  it('is idempotent — never double-prefixes an already-prefixed address', () => {
    expect(toChannelAddress('whatsapp:+8801712345678', 'whatsapp')).toBe('whatsapp:+8801712345678');
  });
});

describe('countryCodeFromE164', () => {
  it('extracts known dialing codes including the leading +', () => {
    expect(countryCodeFromE164('+8801712345678')).toBe('+880'); // BD — longest prefix wins
    expect(countryCodeFromE164('+911234567890')).toBe('+91'); // IN
    expect(countryCodeFromE164('+442071234567')).toBe('+44'); // GB
    expect(countryCodeFromE164('+14155551234')).toBe('+1'); // NANP
  });

  it('falls back to a best-effort 3-digit code for unknown countries', () => {
    expect(countryCodeFromE164('+971501234567')).toBe('+971'); // AE (not in table)
  });

  it('returns null for non-E.164 input', () => {
    expect(countryCodeFromE164('not-a-phone')).toBeNull();
    expect(countryCodeFromE164('+')).toBeNull();
    expect(countryCodeFromE164('+1555123456789012')).toBeNull(); // 16 digits > E.164 max
  });

  it('accepts a whatsapp:-prefixed address (idempotent with normalize)', () => {
    expect(countryCodeFromE164('whatsapp:+8801712345678')).toBe('+880');
  });
});