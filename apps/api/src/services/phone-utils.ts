/**
 * Phone address normalization helpers for the SMS pipeline.
 *
 * SMS pipeline: callers normalize inbound webhook addresses to bare E.164
 * for customer/org lookups. All channel handling is SMS-only.
 */

/**
 * Normalize a raw inbound address to its bare E.164 form and the resolved channel.
 *
 * SMS-only: all addresses are bare E.164 (e.g. +8801XXX…). No channel-prefix
 * normalization — inbound From/To are Twilio phone numbers.
 */
export function normalizeChannelAddress(raw: string): { channel: 'sms'; e164: string } {
  const stripped = raw.trim();
  if (!stripped) {
    throw new Error('normalizeChannelAddress: empty address');
  }
  // validate E.164
  const E164_RE = /^\+?[1-9]\d{1,14}$/;
  if (!E164_RE.test(stripped)) {
    throw new Error(`normalizeChannelAddress: invalid E.164: ${stripped}`);
  }
  return { channel: 'sms', e164: stripped };
}

// Known country codes — longest prefix first so +880 (BD) is never misread as
// a 2-digit code starting with 88. Order matters: 880 must precede 8x/9x
// fallbacks. Kept deliberately small; extend the table before adding new
// countries.
const KNOWN_COUNTRY_CODES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '880', name: 'BD' },
  { code: '91', name: 'IN' },
  { code: '44', name: 'GB' },
  { code: '1', name: 'NANP' },
];

/**
 * Extract the leading ITU dialing code (INCLUDING '+') from an E.164 number,
 * or null when the input is not E.164-shaped.
 */
export function countryCodeFromE164(e164: string): string | null {
  const bare = e164.trim().replace(/^\+/, '');
  if (!/^[1-9][0-9]{1,14}$/.test(bare)) return null;

  for (const { code } of KNOWN_COUNTRY_CODES) {
    if (bare.startsWith(code)) return `+${code}`;
  }

  return `+${bare.slice(0, 3)}`;
}
