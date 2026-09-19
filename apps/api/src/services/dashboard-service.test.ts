import { describe, expect, it } from 'vitest';
import { deriveInboxSuggestion } from './dashboard-service.js';

/**
 * Unit tests for deriveInboxSuggestion (T10 extraction) — the single source
 * of truth for the inbox `suggestion` field AND the approve endpoint's
 * server-derived body: outbound body → offered_slots top-2 → escalation
 * reason (state 'escalated' only) → ''.
 */
const base = {
  outboundBody: null,
  state: null,
  offeredSlots: null,
  escalationReason: null,
  tz: 'America/New_York',
};

describe('deriveInboxSuggestion', () => {
  it('returns the last outbound body when present (highest priority)', () => {
    expect(
      deriveInboxSuggestion({
        ...base,
        outboundBody: 'We can fit you in Tuesday — reply Y to confirm.',
        state: 'offering_slots',
        offeredSlots: [
          { optionNumber: 1, startTime: '2026-09-14T13:00:00.000Z', endTime: '2026-09-14T14:00:00.000Z' },
          { optionNumber: 2, startTime: '2026-09-15T13:00:00.000Z', endTime: '2026-09-15T14:00:00.000Z' },
        ],
      }),
    ).toBe('We can fit you in Tuesday — reply Y to confirm.');
  });

  it('falls back to the top-2 offered slots times as "Offer slots: …"', () => {
    expect(
      deriveInboxSuggestion({
        ...base,
        state: 'offering_slots',
        offeredSlots: [
          { optionNumber: 1, startTime: '2026-09-14T13:00:00.000Z', endTime: '2026-09-14T14:00:00.000Z' },
          { optionNumber: 2, startTime: '2026-09-15T17:30:00.000Z', endTime: '2026-09-15T18:30:00.000Z' },
          { optionNumber: 3, startTime: '2026-09-16T18:00:00.000Z', endTime: '2026-09-16T19:00:00.000Z' },
        ],
      }),
    ).toBe('Offer slots: Mon 9:00, Tue 1:30');
  });

  it('falls back to the escalation reason only when the state is escalated', () => {
    expect(
      deriveInboxSuggestion({
        ...base,
        state: 'escalated',
        escalationReason: 'Customer asked for a date beyond the 14-day window.',
      }),
    ).toBe('Customer asked for a date beyond the 14-day window.');
  });

  it('does NOT use the escalation reason for non-escalated states', () => {
    expect(
      deriveInboxSuggestion({
        ...base,
        state: 'completed',
        escalationReason: 'Should never surface for completed states.',
      }),
    ).toBe('');
  });

  it('ignores offered slots when there is no state row (matches list behavior)', () => {
    expect(
      deriveInboxSuggestion({
        ...base,
        state: null,
        offeredSlots: [
          { optionNumber: 1, startTime: '2026-09-14T13:00:00.000Z', endTime: '2026-09-14T14:00:00.000Z' },
        ],
      }),
    ).toBe('');
  });

  it('returns "" when nothing is derivable (approve → 400 no_suggestion)', () => {
    expect(deriveInboxSuggestion(base)).toBe('');
  });
});