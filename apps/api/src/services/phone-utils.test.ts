import { describe, expect, it } from 'vitest';
import { countryCodeFromE164, normalizeChannelAddress } from './phone-utils.js';

describe('normalizeChannelAddress', () => {
  it('returns the sms channel and the address verbatim when there is no prefix', () => {
    expect(normalizeChannelAddress('+15551234567')).toEqual({
      channel: 'sms',
      e164: '+15551234567',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeChannelAddress('  +15551234567 ')).toEqual({
      channel: 'sms',
      e164: '+15551234567',
    });
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

  it('returns null for an address that is not bare E.164', () => {
    expect(countryCodeFromE164('whatsapp:+8801712345678')).toBeNull();
  });
});
