// Pure rule-based intent parser — build-sequence.md Step 5.
//
// Moved here from apps/api/src/services/intent-service.ts (Checkpoint 01)
// so the LLM package (packages/ai) can use it as a fallback without taking
// a dependency on apps/api.
//
// Pure function: no I/O, no env, no network. Case-insensitive, trims
// whitespace, strips surrounding punctuation before matching.
//
// Rules (checked in order — first match wins):
//  1. reschedule signals  → { intent: 'reschedule', confidence: 0.95 }
//  2. confirm             → { intent: 'confirm', confidence: 0.95 }
//  3. help                → { intent: 'help', confidence: 0.95 }
//  4. numeric slot choice (only when conversation state exists)
//                         → { intent: 'slot-choice', confidence: 0.9 }
//  5. fallback            → { intent: 'unknown', confidence: 0.0 }
//
// Numbers alone WITHOUT a conversation state → unknown, not slot-choice.

/** Normalize a raw SMS body for matching: lowercase, trim, collapse
 *  internal whitespace, strip leading/trailing punctuation. */
function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** True when `normalized` is a reschedule signal. */
function isReschedule(s: string): boolean {
  if (s === 'r') return true;
  const reschedulePhrases = [
    'reschedule', 'reschedule it', 'can we reschedule', 'could we reschedule',
    'move', 'move it', 'change time', 'change the time', 'change my time',
    'can we move', 'could we move', 'move my appointment', 'change my appointment',
    'reschedule my appointment', 'move my booking', 'change my booking',
    'reschedule my booking', 'i want to reschedule', 'i need to reschedule',
    'please reschedule', 'lets reschedule', 'let us reschedule',
    'moving my appointment', 'moving my booking', 'shifting my appointment',
    'shifting my booking',
  ];
  if (reschedulePhrases.includes(s)) return true;
  if (
    s.startsWith('reschedule') ||
    s.startsWith('can we reschedule') ||
    s.startsWith('could we reschedule') ||
    s.startsWith('move my') ||
    s.startsWith('change my') ||
    s.startsWith('change the') ||
    s.startsWith('moving my') ||
    s.startsWith('shifting my')
  ) return true;
  return false;
}

/** True when `normalized` is a confirm signal. */
function isConfirm(s: string): boolean {
  const confirmPhrases = [
    'confirm', 'confirmed', 'yes', 'yeah', 'yep', 'sure', 'ok', 'okay',
    'go ahead', 'go ahead with it', 'that works', 'that works for me',
    'works for me', 'sounds good', 'sounds great', 'perfect', 'that is perfect',
    "that'll work", 'that will work', 'count me in', 'confirm it',
    'confirm the booking', 'confirm my booking', 'confirm appointment',
    'book it', 'booked', 'lock it in', 'lock it', 'lets do it',
    "let\'s do it", 'do it', 'go for it',
  ];
  if (confirmPhrases.includes(s)) return true;
  if (s.startsWith('confirm')) return true;
  if (s.startsWith('book it') || s.startsWith('book me')) return true;
  return false;
}

/** True when `normalized` is a help signal. */
function isHelp(s: string): boolean {
  const helpPhrases = [
    'help', 'i need help', 'i need some help', 'can you help', 'could you help',
    'what are my options', 'what are the options', 'tell me my options',
    'show me my options', 'what can i do', 'what do i do', 'im stuck',
    'im stuck on this', 'stuck', 'not sure what to do', 'dont know what to do',
    'idk what to do', 'what now', 'now what', 'help me', 'help me out',
    'please help', 'need help', 'give me options', 'send me options',
    'list my options', 'what are my choices', 'what choices do i have',
  ];
  if (helpPhrases.includes(s)) return true;
  if (
    s.startsWith('help') ||
    s.startsWith('i need help') ||
    s.startsWith('can you help') ||
    s.startsWith('could you help') ||
    s.startsWith('what are my options') ||
    s.startsWith('what are the options') ||
    s.startsWith('what can i do') ||
    s.startsWith('what do i do') ||
    s.startsWith('not sure') ||
    s.startsWith('dont know') ||
    s.startsWith('idk') ||
    s.startsWith('now what') ||
    s.startsWith('give me options') ||
    s.startsWith('send me options') ||
    s.startsWith('what are my choices')
  ) return true;
  return false;
}

/** True when `normalized` looks like a bare slot-number choice. */
function looksLikeSlotChoice(s: string): boolean {
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isInteger(n) && n >= 1 && n <= 9;
  }
  if (/^(option|choice|pick|i choose|my choice is|select)\s*\d+$/.test(s)) return true;
  if (/^(number|slot)\s*\d+$/.test(s)) return true;
  return false;
}

/** Parse a raw inbound SMS body into an intent.

 *  `conversationStateExists` is true when a conversation row exists for the
 *  sender's phone. Slot-choice only fires when both the message looks numeric
 *  AND state exists; bare numbers without state → unknown. */
export function parseIntent(
  body: string,
  conversationStateExists: boolean = false,
): { intent: 'reschedule' | 'confirm' | 'help' | 'slot-choice' | 'unknown' | 'no-matching-booking'; confidence: number } {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return { intent: 'unknown', confidence: 0.0 };
  }

  const normalized = normalize(body);

  if (isReschedule(normalized)) {
    return { intent: 'reschedule', confidence: 0.95 };
  }

  if (isConfirm(normalized)) {
    return { intent: 'confirm', confidence: 0.95 };
  }

  if (isHelp(normalized)) {
    return { intent: 'help', confidence: 0.95 };
  }

  if (conversationStateExists && looksLikeSlotChoice(normalized)) {
    return { intent: 'slot-choice', confidence: 0.9 };
  }

  return { intent: 'unknown', confidence: 0.0 };
}
