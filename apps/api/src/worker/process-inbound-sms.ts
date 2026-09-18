import type { QueueJob } from '../services/queue-service.js';
import { parseIntent } from '../services/intent-service.js';
import { sendSms } from '../services/sms-service.js';
import { createEscalation } from '../services/escalation-service.js';
import { getConversationByPhone } from '../services/conversation-service.js';

/** Handler for `type = 'inbound_sms'` (build-sequence.md Step 8). */

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

  // Look up existing conversation for this phone (needed for slot-choice intent).
  let conversationStateExists = false;
  try {
    const conv = await getConversationByPhone(customerPhone);
    conversationStateExists = !!conv;
  } catch {
    conversationStateExists = false;
  }

  const { intent, confidence } = parseIntent(body, conversationStateExists);

  switch (intent) {
    case 'reschedule': {
      await handleRescheduleIntent(customerPhone, body);
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
      await handleConfirmIntent(customerPhone);
      break;
    }

    case 'help': {
      await sendHelpSms(customerPhone);
      break;
    }

    case 'unknown': {
      await escalateAmbiguousIntent(customerPhone, body);
      break;
    }

    case 'no-matching-booking': {
      await sendNoMatchingBookingSms(customerPhone);
      break;
    }

    default: {
      await escalateAmbiguousIntent(customerPhone, body);
    }
  }
}

// ---------------------------------------------------------------------------
// Intent handlers — delegate to reschedule-service
// ---------------------------------------------------------------------------

/**
 * Enter the reschedule flow: find the booking (TODO: wire to real store),
 * query available slots, pick 3, create conversation state, send offer SMS.
 */
async function handleRescheduleIntent(customerPhone: string, _body: string): Promise<void> {
  try {
    // TODO: look up bookingId from conversation state or booking store.
    const bookingId = 'TODO-from-store';
    await initiateRescheduleFlow(
      bookingId,
      customerPhone,
      defaultAuth as Parameters<typeof initiateRescheduleFlow>[2],
      (cal: any, calId: string, tMin: string, tMax: string) =>
        cal.freebusy.query({ requestBody: { timeMin: tMin, timeMax: tMax, items: [{ id: calId }] } }),
      (cal: any, calId: string, tMin: string, tMax: string) =>
        cal.events.list({ calendarId: calId, timeMin: tMin, timeMax: tMax, singleEvents: true, orderBy: 'startTime' }),
      (id: string) => Promise.resolve(null), // TODO: real booking lookup
      (id: string) => Promise.resolve(null), // TODO: real user lookup
      sendSms as Parameters<typeof initiateRescheduleFlow>[7],
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
    await processSlotChoice(customerPhone, choice);
  } catch (err) {
    console.error('[worker] processSlotChoice failed:', err);
  }
}

/**
 * Validate conversation state, create calendar event, mark booking confirmed.
 */
async function handleConfirmIntent(customerPhone: string): Promise<void> {
  try {
    const result = await confirmReschedule(
      customerPhone,
      defaultAuth as Parameters<typeof confirmReschedule>[1],
      (cal: any, calId: string, event: any) => cal.events.insert({ calendarId: calId, requestBody: event }),
      (id: string) => Promise.resolve(null), // TODO: real booking lookup
    );
    if (!result.success) {
      console.error('[worker] confirmReschedule failed:', result.error);
      if (result.error?.includes('No conversation found') ||
          result.error?.includes('not in awaiting_slot_choice')) {
        await sendNoMatchingBookingSms(customerPhone);
      }
    }
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
export async function sendHelpSms(customerPhone: string): Promise<void> {
  await sendSms({
    to: customerPhone,
    body: `Hi! I can help with rescheduling or confirming your booking. Reply RESCHEDULE to change your appointment time, CONFIRM to lock it in, or reply with a help keyword and I'll walk you through your options.`,
  });
}

/**
 * Real: send an SMS telling the customer we couldn't find a booking for
 * their number. No escalation — this is an informative dead-end, not an
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
