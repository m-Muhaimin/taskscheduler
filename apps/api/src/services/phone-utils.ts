/**
 * Phone/channel address helpers (T17 Phase B — WhatsApp fallback plumbing).
 *
 * Twilio WhatsApp traffic addresses EVERY side with a `whatsapp:` prefix
 * (`whatsapp:+8801…82345678`). These helpers strip/apply that prefix without
 * ever loosening the E.164 contract underneath: normalization returns a bare
 * E.164 so every existing gate (webhook 400, worker escalation, customer
 * upsert, org lookup) and every outbound/ledger write keeps validating real
 * numbers.
 *
 * Pure functions — no env, no IO — so they are trivially testable.
 */

import type { Channel } from '../types.js';

const WHATSAPP_PREFIX_RE = /^whatsapp:/i;

/**
 * Split a Twilio address into (channel, bare E.164). No `whatsapp:` prefix →
 * channel 'sms' and the address returned unchanged; a prefix is stripped and
 * reported as channel 'whatsapp'. Unknown prefixes (e.g. `voice:`) are left
 * untouched by the strip and will still fail the downstream E.164 gates.
 */
export function normalizeChannelAddress(
  addr: string,
): { channel: Channel; e164: string } {
  const trimmed = addr.trim();
  const match = trimmed.match(WHATSAPP_PREFIX_RE);
  if (match) {
    return { channel: 'whatsapp', e164: trimmed.slice(match[0].length).trim() };
  }
  return { channel: 'sms', e164: trimmed };
}

/**
 * Render a bare E.164 for a channel: `whatsapp:+880…` for the whatsapp
 * channel, bare E.164 for sms. Idempotent — an already-`whatsapp:`-prefixed
 * input is stripped first, so re-prefixing can never double-prefix.
 */
export function toChannelAddress(e164: string, channel: Channel): string {
  const bare = e164.trim().replace(WHATSAPP_PREFIX_RE, '');
  return channel === 'whatsapp' ? `whatsapp:${bare}` : bare;
}

// Known country codes — longest prefix first so +880 (BD) is never misread as
// a 2-digit code starting with 88. Order matters: 880 must precede 8x/9x
// fallbacks. Kept deliberately small (the channels currently in scope);
// extend the table before adding new countries in Phase D.
const KNOWN_COUNTRY_CODES: ReadonlyArray<{ code: string; name: string }> = [
  { code: '880', name: 'BD' },
  { code: '91', name: 'IN' },
  { code: '44', name: 'GB' },
  { code: '1', name: 'NANP' },
];

/**
 * Extract the leading ITU dialing code (INCLUDING '+') from an E.164 number,
 * or null when the input is not E.164-shaped.
 *
 * Approach: exact known-code match first (BD +880, IN +91, GB +44, NANP +1)
 * via a small table, then a documented best-effort generic rule — country
 * codes are 1-3 digits and +1 is the only 1-digit code, so unknown countries
 * fall back to the first 3 digits (the ITU maximum; 4xx/8xx/9xx blocks carry
 * the 3-digit codes). Phase D's country gate only matches +880 from the known
 * table, so the generic path is never decision-critical.
 */
export function countryCodeFromE164(e164: string): string | null {
  const bare = e164.trim().replace(WHATSAPP_PREFIX_RE, '').replace(/^\+/, '');
  if (!/^[1-9][0-9]{1,14}$/.test(bare)) return null;

  for (const { code } of KNOWN_COUNTRY_CODES) {
    if (bare.startsWith(code)) return `+${code}`;
  }

  return `+${bare.slice(0, 3)}`;
}