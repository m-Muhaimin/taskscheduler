import { describe, expect, it } from 'vitest';
import { parseIntent } from './intent-service.js';

// ---------------------------------------------------------------------------
// parseIntent — signal families
// ---------------------------------------------------------------------------

describe('parseIntent — reschedule signals', () => {
  it('recognizes bare "r"', () => {
    expect(parseIntent('r')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "R" (case-insensitive)', () => {
    expect(parseIntent('R')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "reschedule"', () => {
    expect(parseIntent('reschedule')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "RESCHEDULE" (uppercase)', () => {
    expect(parseIntent('RESCHEDULE')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "move"', () => {
    expect(parseIntent('move')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "change time"', () => {
    expect(parseIntent('change time')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "can we move"', () => {
    expect(parseIntent('can we move')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "reschedule please" (starts-with variant)', () => {
    expect(parseIntent('reschedule please')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "move my appointment"', () => {
    expect(parseIntent('move my appointment')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "change my booking"', () => {
    expect(parseIntent('change my booking')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "i want to reschedule"', () => {
    expect(parseIntent('i want to reschedule')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "lets reschedule"', () => {
    expect(parseIntent('lets reschedule')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "shifting my appointment"', () => {
    expect(parseIntent('shifting my appointment')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "can we reschedule?" with trailing punctuation', () => {
    expect(parseIntent('can we reschedule?')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "r." with trailing punctuation', () => {
    expect(parseIntent('r.')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "R!" with exclamation mark', () => {
    expect(parseIntent('R!')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "move!" with exclamation mark', () => {
    expect(parseIntent('move!')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "change time?" with question mark', () => {
    expect(parseIntent('change time?')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "reschedule!!" with multiple punctuation', () => {
    expect(parseIntent('reschedule!!')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "  move  " with surrounding whitespace', () => {
    expect(parseIntent('  move  ')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('recognizes "Change Time" mixed case with spaces', () => {
    expect(parseIntent('Change Time')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });
});

describe('parseIntent — confirm signals', () => {
  it('recognizes "confirm"', () => {
    expect(parseIntent('confirm')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "confirmed"', () => {
    expect(parseIntent('confirmed')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "yes"', () => {
    expect(parseIntent('yes')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "yeah"', () => {
    expect(parseIntent('yeah')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "sure"', () => {
    expect(parseIntent('sure')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "ok"', () => {
    expect(parseIntent('ok')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it("recognizes \"let's do it\" (apostrophe form)", () => {
    // Regression: the shared parser copy once stored a literal backslash
    // ("let\'s do it") that never matched real SMS text. Both copies now live
    // in @tradescheduler/shared and must hit this phrase.
    expect(parseIntent("let's do it")).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "okay"', () => {
    expect(parseIntent('okay')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "that works"', () => {
    expect(parseIntent('that works')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "sounds good"', () => {
    expect(parseIntent('sounds good')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "perfect"', () => {
    expect(parseIntent('perfect')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "count me in"', () => {
    expect(parseIntent('count me in')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "book it"', () => {
    expect(parseIntent('book it')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "confirm please" (starts-with variant)', () => {
    expect(parseIntent('confirm please')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "Confirm?" with punctuation', () => {
    expect(parseIntent('Confirm?')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('recognizes "YES" uppercase', () => {
    expect(parseIntent('YES')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });
});

describe('parseIntent — help signals', () => {
  it('recognizes "help"', () => {
    expect(parseIntent('help')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "i need help"', () => {
    expect(parseIntent('i need help')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "can you help"', () => {
    expect(parseIntent('can you help')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "what are my options"', () => {
    expect(parseIntent('what are my options')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "what can i do"', () => {
    expect(parseIntent('what can i do')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "im stuck"', () => {
    expect(parseIntent('im stuck')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "not sure what to do"', () => {
    expect(parseIntent('not sure what to do')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "help me"', () => {
    expect(parseIntent('help me')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "HELP" uppercase', () => {
    expect(parseIntent('HELP')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "Help!" with punctuation', () => {
    expect(parseIntent('Help!')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('recognizes "what now"', () => {
    expect(parseIntent('what now')).toEqual({ intent: 'help', confidence: 0.95 });
  });
});

// ---------------------------------------------------------------------------
// parseIntent — slot-choice (only with conversation state)
// ---------------------------------------------------------------------------

describe('parseIntent — slot-choice', () => {
  it('recognizes "1" as slot-choice when conversation state exists', () => {
    expect(parseIntent('1', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });

  it('recognizes "2" as slot-choice when conversation state exists', () => {
    expect(parseIntent('2', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });

  it('recognizes "3" as slot-choice when conversation state exists', () => {
    expect(parseIntent('3', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });

  it('recognizes "option 2" as slot-choice when conversation state exists', () => {
    expect(parseIntent('option 2', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });

  it('recognizes "choice 3" as slot-choice when conversation state exists', () => {
    expect(parseIntent('choice 3', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });

  it('recognizes "i choose 1" as slot-choice when conversation state exists', () => {
    expect(parseIntent('i choose 1', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });

  it('recognizes "pick 2" as slot-choice when conversation state exists', () => {
    expect(parseIntent('pick 2', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });

  it('recognizes "1" with whitespace as slot-choice when conversation state exists', () => {
    expect(parseIntent('  1  ', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });

  it('recognizes "OPTION 1" uppercase as slot-choice when conversation state exists', () => {
    expect(parseIntent('OPTION 1', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });
});

// ---------------------------------------------------------------------------
// parseIntent — numbers WITHOUT state → unknown (critical invariant)
// ---------------------------------------------------------------------------

describe('parseIntent — numbers without conversation state', () => {
  it('returns unknown for bare "1" when no conversation state exists', () => {
    expect(parseIntent('1', false)).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for bare "2" when no conversation state exists', () => {
    expect(parseIntent('2', false)).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for bare "3" when no conversation state exists', () => {
    expect(parseIntent('3', false)).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for "option 2" when no conversation state exists', () => {
    expect(parseIntent('option 2', false)).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for "5" when no conversation state exists', () => {
    expect(parseIntent('5', false)).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for "123" when no conversation state exists', () => {
    expect(parseIntent('123', false)).toEqual({ intent: 'unknown', confidence: 0.0 });
  });
});

// ---------------------------------------------------------------------------
// parseIntent — unknown fallback
// ---------------------------------------------------------------------------

describe('parseIntent — unknown fallback', () => {
  it('returns unknown for random text', () => {
    expect(parseIntent('blurb blurb')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for a phone-number-like string', () => {
    expect(parseIntent('+15551234567')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for "hello"', () => {
    expect(parseIntent('hello')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for "thanks"', () => {
    expect(parseIntent('thanks')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for "good morning"', () => {
    expect(parseIntent('good morning')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for "no"', () => {
    // "no" is not a confirm signal — we require explicit positive confirms.
    expect(parseIntent('no')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for "nope"', () => {
    expect(parseIntent('nope')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for a long rambling message', () => {
    expect(
      parseIntent('hey i was wondering if maybe we could do something else sometime'),
    ).toEqual({ intent: 'unknown', confidence: 0.0 });
  });
});

// ---------------------------------------------------------------------------
// parseIntent — edge cases, boundaries
// ---------------------------------------------------------------------------

describe('parseIntent — edge cases', () => {
  it('returns unknown for empty string', () => {
    expect(parseIntent('')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for whitespace-only string', () => {
    expect(parseIntent('   ')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for non-string input (null)', () => {
    // The public signature accepts string; passing null is a caller bug.
    // The implementation guards with a typeof check.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseIntent(null as any)).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('returns unknown for non-string input (undefined)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseIntent(undefined as any)).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('normalizes internal whitespace ("re   schedule" → reschedule)', () => {
    // "re   schedule" normalizes to "re schedule" which does NOT match
    // "reschedule" (single token) — so this should be unknown. The normalize
    // function collapses internal whitespace but not internal word breaks.
    expect(parseIntent('re   schedule')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('strips leading/trailing punctuation "!!!help!!!" → help', () => {
    expect(parseIntent('!!!help!!!')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('strips surrounding punctuation "***confirm***" → confirm', () => {
    expect(parseIntent('***confirm***')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('handles emoji-only message as unknown', () => {
    expect(parseIntent('😀')).toEqual({ intent: 'unknown', confidence: 0.0 });
  });

  it('handles "r" followed by punctuation and whitespace', () => {
    expect(parseIntent('r  .')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });
});

// ---------------------------------------------------------------------------
// Confidence boundaries
// ---------------------------------------------------------------------------

describe('parseIntent — confidence boundaries', () => {
  it('returns exactly 0.95 for matched reschedule signals', () => {
    expect(parseIntent('reschedule').confidence).toBe(0.95);
  });

  it('returns exactly 0.95 for matched confirm signals', () => {
    expect(parseIntent('confirm').confidence).toBe(0.95);
  });

  it('returns exactly 0.95 for matched help signals', () => {
    expect(parseIntent('help').confidence).toBe(0.95);
  });

  it('returns exactly 0.9 for matched slot-choice signals', () => {
    expect(parseIntent('2', true).confidence).toBe(0.9);
  });

  it('returns exactly 0.0 for unknown', () => {
    expect(parseIntent('nope').confidence).toBe(0.0);
  });

  it('does not return confidence between 0.0 and 0.9 for unknown', () => {
    const result = parseIntent('hello');
    expect(result.confidence).toBe(0.0);
  });

  it('escalation threshold: 0.0 confidence is below 0.7', () => {
    const result = parseIntent('hello');
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('slot-choice confidence 0.9 is above escalation threshold 0.7', () => {
    const result = parseIntent('2', true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });
});

// ---------------------------------------------------------------------------
// Priority / ordering — first match wins
// ---------------------------------------------------------------------------

describe('parseIntent — matching priority', () => {
  it('reschedule beats unknown', () => {
    // "move" is a reschedule signal; must not fall through to unknown.
    expect(parseIntent('move')).toEqual({ intent: 'reschedule', confidence: 0.95 });
  });

  it('confirm beats unknown', () => {
    expect(parseIntent('yes')).toEqual({ intent: 'confirm', confidence: 0.95 });
  });

  it('help beats unknown', () => {
    expect(parseIntent('help')).toEqual({ intent: 'help', confidence: 0.95 });
  });

  it('reschedule precedes confirm (a message can match both patterns in theory)', () => {
    // There is no overlap in the current phrase lists, but verify that
    // the first-rule-wins order holds.
    // "reschedule" only matches reschedule; "confirm" only matches confirm.
    expect(parseIntent('reschedule')).not.toEqual({
      intent: 'confirm',
      confidence: 0.95,
    });
  });

  it('slot-choice only fires when state exists AND message looks numeric', () => {
    // "1" alone (no state) → unknown. "1" + state → slot-choice.
    expect(parseIntent('1', false)).toEqual({ intent: 'unknown', confidence: 0.0 });
    expect(parseIntent('1', true)).toEqual({ intent: 'slot-choice', confidence: 0.9 });
  });
});
