import { randomUUID } from 'node:crypto';
import { classifyStep, createProvider } from '@tradescheduler/ai';
import { initiateRescheduleFlow, processSlotChoice, confirmReschedule } from '../services/reschedule-service.js';
import { defaultAuth } from '../services/calendar-service.js';
import type { QueueJob } from '../services/queue-service.js';
import { schedulingEngine } from '../services/scheduling-engine.js';
import { sendSms } from '../services/sms-service.js';
import { createEscalation } from '../services/escalation-service.js';
import { createConversation, getConversationByPhone } from '../services/conversation-service.js';
import {
  findOrCreateCustomer,
  findOrCreateConversation,
  appendMessage,
} from '../services/conversation-domain.js';
import { resolveOrganizationIdByTwilioNumber } from '../services/organization-service.js';
import { findBookingById, findUserProfile, findBookingByPhone, updateBookingTimes, findUserBookingsInWindow } from '../services/booking-service.js';
import { recordAiUsage } from '../services/ai-usage-service.js';
import type { AiUsageSource } from '../services/ai-usage-service.js';

/** Handler for `type = 'inbound_sms'` (build-sequence.md Step 8). */

const E164_RE = /^\+?[1-9][0-9]{1,14}$/;

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function processInboundSms(job: QueueJob): Promise<void> {
  const payload = job.payload as Record<string, unknown>;

  const raw =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null;

  if (!raw || typeof raw.From !== 'string' || typeof raw.Body !== 'string') {
    await createEscalation({
      type: 'processing_error',
      customerPhone: 'unknown',
      content: `malformed inbound_sms job payload: ${JSON.stringify(payload)}`,
    });
    return;
  }

  const customerPhone = raw.From;
  const body = raw.Body;

  // CP03 spec C7: reject non-E.164 From BEFORE touching the customer table.
  if (!E164_RE.test(customerPhone)) {
    await createEscalation({
      type: 'processing_error',
      customerPhone,
      content: `inbound SMS From is not valid E.164: ${JSON.stringify(customerPhone)}`,
    });
    return;
  }

  // CP03 spec H.2: resolve organization from the inbound Twilio number (To).
  const toNumber = typeof raw.To === 'string' ? raw.To : null;
  let organizationId: string | null = null;
  if (toNumber) {
    try {
      organizationId = await resolveOrganizationIdByTwilioNumber(toNumber);
    } catch (err) {
      console.error('[worker] organization resolution failed:', err);
    }
  }
  if (!organizationId) {
    await createEscalation({
      type: 'processing_error',
      customerPhone,
      content: `no organization registered for Twilio number: ${JSON.stringify(toNumber)}`,
    });
    return;
  }

  // CP03 spec H.3-H.5: customer + conversation + message layer in front of
  // the existing dispatch. Failures here escalate but do not kill the job loop.
  try {
    const customer = await findOrCreateCustomer(organizationId, customerPhone);
    const conversation = await findOrCreateConversation(customer.id, 'sms');
    await appendMessage(
      conversation.id,
      'inbound',
      body,
      typeof raw.MessageSid === 'string' ? raw.MessageSid : null,
      { From: customerPhone, To: toNumber },
    );
  } catch (err) {
    console.error('[worker] conversation-domain write failed:', err);
    await createEscalation({
      type: 'processing_error',
      customerPhone,
      content: `conversation-domain write failed: ${String(err)}`,
    });
    return;
  }

  // Look up existing conversation state for this phone (needed for slot-choice intent).
  let conversationStateExists = false;
  try {
    const conv = await getConversationByPhone(customerPhone);
    conversationStateExists = !!conv;
  } catch {
    conversationStateExists = false;
  }

  const requestId = randomUUID();
  const provider = createProvider(); // reads AI_PROVIDER env; default fallback-only → rule parser
  const result = await classifyStep(
    provider,
    { body, conversationStateExists, suggestedIntent: null },
    // onEscalate — classifyStep passes customerPhone "unknown"; override with the REAL phone
    async (input) => {
      await createEscalation({
        type: input.type,
        customerPhone,
        content: input.content,
      });
    },
    requestId,
  );

  // Cost ledger (Checkpoint 01 §3 / P0.9): one rl_ai_usage row per real LLM
  // call. Observability only — classification + dispatch already happened, so
  // a failed insert must never kill the job; the whole record is wrapped.
  if (result.aiUsage) {
    try {
      await recordAiUsage({
        requestId,
        provider: provider.metadata().name, // 'openai' | 'census' | 'ollama'; unknown → cost 0
        model: result.aiUsage.model,
        tokensInput: result.aiUsage.tokensInput,
        tokensOutput: result.aiUsage.tokensOutput,
        // aiUsage is non-null only for 'llm'/'merged' sources (classifyStep
        // contract), so the wide ClassifyResult.source union narrows safely here.
        source: result.source as AiUsageSource,
        organizationId, // may be null (pre-org rows keep working)
      });
    } catch (err) {
      console.error('[worker] ai-usage record failed:', err);
    }
  }

  const { intent, confidence } = result.intentResult;

  switch (intent) {
    case 'reschedule': {
      await handleRescheduleIntent(organizationId, customerPhone, body);
      break;
    }

    case 'slot-choice': {
      const trimmed = body.trim();
      const choice = parseInt(trimmed, 10);
      if (!isNaN(choice) && choice >= 1 && choice <= 3) {
        await handleSlotChoiceIntent(customerPhone, choice);
      }
      break;
    }

    case 'confirm': {
      await handleConfirmIntent(organizationId, customerPhone);
      break;
    }

    case 'help': {
      await sendHelpSms(customerPhone);
      break;
    }

    case 'unknown': {
      // classifyStep already escalated unclassifiable messages (source 'escalation');
      // guard so we never write a second escalation row for the same message.
      if (result.source !== 'escalation') await escalateAmbiguousIntent(customerPhone, body);
      break;
    }

    case 'no-matching-booking': {
      await sendNoMatchingBookingSms(customerPhone);
      break;
    }

    default: {
      if (result.source !== 'escalation') await escalateAmbiguousIntent(customerPhone, body);
    }
  }
}

// ---------------------------------------------------------------------------
// Intent handlers � delegate to reschedule-service
// ---------------------------------------------------------------------------

/**
 * Enter the reschedule flow: find the booking (TODO: wire to real store),
 * query available slots, pick 3, create conversation state, send offer SMS.
 */
async function handleRescheduleIntent(
  organizationId: string,
  customerPhone: string,
  _body: string,
): Promise<void> {
  try {
    // CP04: resolve the booking id from conversation state when mid-flow,
    // otherwise fall back to the customer's most recent booking.
    let bookingId: string | null = null;
    try {
      const conv = await getConversationByPhone(customerPhone);
      if (conv?.bookingId) bookingId = conv.bookingId;
    } catch {
      bookingId = null;
    }
    if (!bookingId) {
      const booking = await findBookingByPhone(organizationId, customerPhone);
      bookingId = booking?.id ?? null;
    }

    if (!bookingId) {
      // Informative dead-end, not an escalation - no booking under this number.
      await sendNoMatchingBookingSms(customerPhone);
      return;
    }

    await initiateRescheduleFlow(
      bookingId,
      customerPhone,
      defaultAuth,
      (cal: any, calId: string, tMin: string, tMax: string) =>
        cal.freebusy.query({ requestBody: { timeMin: tMin, timeMax: tMax, items: [{ id: calId }] } }),
      (cal: any, calId: string, tMin: string, tMax: string) =>
        cal.events.list({ calendarId: calId, timeMin: tMin, timeMax: tMax, singleEvents: true, orderBy: 'startTime' }),
      (id: string) => findBookingById(organizationId, id),
      findUserProfile,
      sendSms,
      createConversation,
      schedulingEngine.getAvailableSlots,
      schedulingEngine.pickOfferedSlots,
      createEscalation,
      (userId: string, fromIso: string, toIso: string) =>
        findUserBookingsInWindow(organizationId, userId, fromIso, toIso),
    );
  } catch (err) {
    console.error('[worker] initiateRescheduleFlow failed:', err);
    await createEscalation({
      type: 'processing_error',
      customerPhone,
      content: `initiateRescheduleFlow failed: ${String(err)}`,
    });
  }
}

/**
 * Validate the numeric slot choice, update conversation, send confirm-ask SMS.
 */
async function handleSlotChoiceIntent(customerPhone: string, choice: number): Promise<void> {
  try {
    const conversation = await processSlotChoice(customerPhone, choice);
    if (!conversation) {
      // No conversation in 'offering_slots' state, or choice out of range.
      await sendInvalidChoiceSms(customerPhone);
    }
  } catch (err) {
    console.error('[worker] processSlotChoice failed:', err);
    await createEscalation({
      type: 'processing_error',
      customerPhone,
      content: `processSlotChoice failed: ${String(err)}`,
    });
  }
}

/**
 * Validate conversation state, create calendar event, mark booking confirmed.
 */
async function handleConfirmIntent(
  organizationId: string,
  customerPhone: string,
): Promise<void> {
  try {
    const result = await confirmReschedule(
      customerPhone,
      defaultAuth,
      (cal: any, calId: string, event: any) => cal.events.insert({ calendarId: calId, requestBody: event }),
      (id: string) => findBookingById(organizationId, id),
    );
    if (!result.success) {
      console.error('[worker] confirmReschedule failed:', result.error);
      if (result.error?.includes('No conversation found') ||
          result.error?.includes('not in awaiting_slot_choice')) {
        await sendNoMatchingBookingSms(customerPhone);
      } else {
        // Calendar failure or booking missing: escalation is handled inside
        // reschedule-service; give the customer a courteous heads-up.
        await sendConfirmFailedSms(customerPhone);
      }
      return;
    }

    // Success: persist the confirmed reschedule, then tell the customer.
    const booking = result.booking;
    if (!booking) {
      // Defensive: success result should always carry the booking. Escalate.
      await createEscalation({
        type: 'processing_error',
        customerPhone,
        content: `confirmReschedule succeeded without a booking`,
      });
      return;
    }
    await updateBookingTimes(organizationId, booking.id, {
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: 'confirmed',
      googleCalendarEventId: booking.googleCalendarEventId,
    });
    await sendConfirmationSms(customerPhone, booking);
  } catch (err) {
    console.error('[worker] confirmReschedule threw:', err);
    await createEscalation({
      type: 'processing_error',
      customerPhone,
      content: `confirmReschedule threw: ${String(err)}`,
    });
  }
}

// ---------------------------------------------------------------------------
// SMS helpers (real, via sms-service)
// ---------------------------------------------------------------------------

/** Real: send a help SMS to the customer explaining what they can do. */
/** Real: tell the customer their numeric choice didn't match an offer. */
export async function sendInvalidChoiceSms(customerPhone: string): Promise<void> {
  await sendSms({
    to: customerPhone,
    body: `Sorry, I didn't catch that. Reply with 1, 2, or 3 to pick a time, or HELP for your options.`,
  });
}

/** Real: courteous heads-up when the confirmation step fails (calendar etc.). */
export async function sendConfirmFailedSms(customerPhone: string): Promise<void> {
  await sendSms({
    to: customerPhone,
    body: `Sorry, something went wrong confirming your appointment. Our team will contact you shortly to sort it out.`,
  });
}

/** Real: confirm the appointment to the customer with the new time. */
export async function sendConfirmationSms(customerPhone: string, booking: import('@tradescheduler/shared').Booking): Promise<void> {
  const when = new Date(booking.startTime).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  await sendSms({
    to: customerPhone,
    body: `Your appointment is confirmed for ${when}. Reply RESCHEDULE if you need to move it.`,
  });
}

export async function sendHelpSms(customerPhone: string): Promise<void> {
  await sendSms({
    to: customerPhone,
    body: `Hi! I can help with rescheduling or confirming your booking. Reply RESCHEDULE to change your appointment time, CONFIRM to lock it in, or reply with a help keyword and I'll walk you through your options.`,
  });
}

/**
 * Real: send an SMS telling the customer we couldn't find a booking for
 * their number. No escalation � this is an informative dead-end, not an
 * operational incident.
 */
export async function sendNoMatchingBookingSms(customerPhone: string): Promise<void> {
  await sendSms({
    to: customerPhone,
    body: `Hi! I wasn't able to find a booking under this number. Please contact us directly to sort this out.`,
  });
}

// ---------------------------------------------------------------------------
// Escalation (real, via escalation-service)
// ---------------------------------------------------------------------------

/** Real: create an escalation when the intent is ambiguous / unrecognized. */
export async function escalateAmbiguousIntent(
  customerPhone: string,
  body: string,
): Promise<void> {
  await createEscalation({
    type: 'ambiguous_intent',
    customerPhone,
    content: body ?? null,
  });
}
