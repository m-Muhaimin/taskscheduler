// Structured-output Zod schemas for the booking/dispatch agent.
//
// These are the schemas the LLM (Checkpoint 06) must produce for an inbound
// message. They are a SUPERSET of the existing `Intent` / `IntentResult`
// types from `@tradescheduler/shared` — the new values (new_booking, cancel,
// question, emergency) extend the taxonomy; the existing ones (reschedule,
// confirm, slot_choice, unknown) remain valid so existing downstream code
// keeps working.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Intent taxonomy — superset of the existing 5-value union
// ---------------------------------------------------------------------------

/**
 * The intent labels an LLM classify step may produce.
 *
 * Existing values (reschedule, confirm, slot_choice, unknown) are preserved
 * verbatim so the existing `parseIntent` contract is a fallback path, not
 * replaced. The new values extend the taxonomy for the booking agent:
 *
 *   - new_booking  : customer opening a fresh request ("I need my AC fixed")
 *   - cancel       : explicit cancellation request
 *   - question     : informational / FAQ-style (broader than existing 'help')
 *   - emergency    : urgent / time-sensitive signal
 *
 * `unknown` stays as the terminal fallback value.
 */
export const AiIntentSchema = z.enum([
  'new_booking',
  'reschedule',
  'cancel',
  'question',
  'emergency',
  'slot_choice',
  'confirm',
  'unknown',
]);

// ---------------------------------------------------------------------------
// Structured output — what the LLM produces for one inbound message
// ---------------------------------------------------------------------------

/**
 * The full structured output the LLM is asked to produce for a single
 * inbound SMS message. Zod validates this; if schema rejects, the compose
 * layer treats it as `AiError.schema_rejection` and falls through to the
 * fallback path (Checkpoint 01 policy).
 */
export const InboundParseSchema = z
  .object({
    intent: AiIntentSchema,
    /**
     * 0..1. For LLM output this is the model's own confidence signal, not a
     * fixed constant like the rule parser's 0.95. The dispatch policy treats
     * < 0.7 the same way existing code treats `unknown` (escalate).
     */
    confidence: z.number().min(0).max(1),
    /** Extracted customer name, if any was stated. `null` when not mentioned. */
    customer_name: z.string().trim().nullable().optional(),
    /** What the customer wants done — e.g. "AC repair", "water heater check".
     * `null` when not stated. */
    service_description: z.string().trim().nullable().optional(),
    /** Preferred date from the message, ISO 8601, null when not stated. */
    preferred_date: z.string().datetime().nullable().optional(),
    /** Preferred start time, ISO 8601, null when not stated. */
    preferred_time_start: z.string().datetime().nullable().optional(),
    /** Preferred end time, ISO 8601, null when not stated. */
    preferred_time_end: z.string().datetime().nullable().optional(),
    /** Urgency signal the model detected. `undefined` when not inferable. */
    urgency: z.enum(['low', 'normal', 'high', 'emergency']).optional(),
    /**
     * Things the model noticed it cannot resolve without asking the customer
     * back. Used by the agent state machine (Checkpoint 06) to decide whether
     * to continue or to ask a clarifying question.
     */
    missing_information: z.array(z.string().trim()).default([]),
    /**
     * Brief reason / summary — used for logging + the AI Inbox (Checkpoint 08),
     * NOT for customer-facing text. Capped so it can't balloon.
     */
    reasoning: z.string().trim().max(300).optional(),
  })
  .strict(); // reject unknown keys — prevents a provider leaking extra fields

// ---------------------------------------------------------------------------
// Re-export the types that consumers need
// ---------------------------------------------------------------------------

/** The runtime shape of `InboundParseSchema` — what `generateStructured()`
 *  returns once Zod validates it. */
export type InboundParseResult = z.infer<typeof InboundParseSchema>;

/** The set of intent labels the LLM may return — extends the existing
 *  `Intent` union for classification, but `Intent` is still what the existing
 *  worker dispatch (reschedule/confirm/help/slot-choice/unknown) consumes. */
export type AiIntent = z.infer<typeof AiIntentSchema>;
