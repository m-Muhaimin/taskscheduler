import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { classifyStep, createProvider } from '@tradescheduler/ai';
import {
  initiateRescheduleFlow,
  processSlotChoice,
  confirmReschedule,
  type SmsSendFn,
} from '../services/reschedule-service.js';
import { defaultAuth } from '../services/calendar-service.js';
import type { QueueJob } from '../services/queue-service.js';
import { schedulingEngine } from '../services/scheduling-engine.js';
import { sendSms, type SendSmsInput, type SentSms } from '../services/sms-service.js';
import type { Channel, MessagingKind } from '../types.js';
import { createEscalation } from '../services/escalation-service.js';
import { createConversation, getConversationByPhone } from '../services/conversation-service.js';
import { recordSmsOptIn } from '../services/consent-service.js';
import {
  findOrCreateCustomer,
  findOrCreateConversation,
  appendMessage,
} from '../services/conversation-domain.js';
import type { Customer } from '../services/conversation-domain.js';
import { issueCode, verifyCode, issueFlowCode, verifyFlowCode, sha256Hex } from '../services/verification-service.js';
import type { ConversationState } from '@tradescheduler/shared';
import { resolveOrganizationIdByTwilioNumber, getOrgContextByUserId } from '../services/organization-service.js';
import { resolveStaffByPhone } from '../services/staff-phone-service.js';
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

  // Customer-facing SMS: channel is always 'sms'. From is the bare E.164.
  const customerPhone = raw.From.trim();
  const channel: Channel = 'sms';
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
  const rawTo = typeof raw.To === 'string' ? raw.To : null;
  const toNumber = rawTo?.trim() ?? null;
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

  // T16: staff-phone recognition. If the From number belongs to a member of
  // the RESOLVED org, route to the operator flow instead of the customer flow:
  // one escalation row (surfaces on the existing dashboard escalations list)
  // + a short staff ack. NO customer row, NO conversation/message write, NO
  // classify. Staff of ANOTHER org are still customers of THIS org — the
  // resolution query is org-scoped. On resolution/store failure: log, and if
  // the number was NOT resolved as staff the customer flow below handles it
  // (its own escalation posture stays untouched).
  let staffResolved = false;
  try {
    const staff = await resolveStaffByPhone(customerPhone, organizationId);
    if (staff) {
      staffResolved = true;
      await createEscalation({
        type: 'staff_sms',
        customerPhone,
        content: `[staff sms from ${staff.tradespersonId}] ${body}`,
      });
      // Staff ack — default ON; dry-run friendly (TWILIO_SMS_DRY_RUN logs, does
      // not send). Ack failure must not fail the job: the escalation row above
      // is the source of truth. Ledger row written with organizationId so the
      // Messages delivery surface picks it up.
      //
      // DELIBERATELY EXEMPT from the sendSms consent gate: it addresses the
      // operator, not a customer, and no customer row exists for it (the flow
      // returned above without touching the customer table). Never add a
      // customerId here — see the module's exemption contract in sms-service.ts.
      try {
        await sendSms({
          to: customerPhone,
          body: 'Message logged to your dashboard — reply there.',
          organizationId,
        });
      } catch (ackErr) {
        console.error('[worker] staff ack SMS failed:', ackErr);
      }
    }
  } catch (err) {
    console.error('[worker] staff-phone flow failed:', err);
  }
  if (staffResolved) return;

  // CP03 spec H.3-H.5: customer + conversation + message layer in front of
  // the existing dispatch. Failures here escalate but do not kill the job loop.
  let customer: Customer | null = null;
  try {
    customer = await findOrCreateCustomer(organizationId, customerPhone);
    const conversation = await findOrCreateConversation(customer.id, channel);
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

  // T14: first-contact OTP verification gate. Runs between the message write
  // (above) and classify/dispatch (below). An unverified customer must prove
  // control of the From number once: until then the worker only issues/checks
  // codes and NEVER classifies, replies with intent content, or escalates.
  // Verified customers skip the gate entirely (zero behavior change).
  if (!customer) return; // defensive — findOrCreateCustomer never returns null

  // Consent hard rule, write point: a customer who has replied to us has
  // demonstrably consented to SMS at this number. Record it here — once, for
  // the inbound message — so sms-service.ts's outbound gate passes for their
  // later proactive sends. Idempotent; the staff flow above already returned.
  await recordSmsOptIn(customer.id);

  let verifiedNow = false;
  if (!customer.phoneVerifiedAt) {
    const outcome = await runVerificationGate(customer, customerPhone, body, channel);
    if (outcome !== 'verified-now') {
      // The job completes in worker tick(); the SMS re-issue loop IS the retry
      // path (T14) — no classify, no dispatch, no escalation row.
      return;
    }
    verifiedNow = true;
  }

  // Look up existing conversation state for this phone (needed for slot-choice intent).
  let conversationStateExists = false;
  let conversation: ConversationState | null = null;
  try {
    conversation = await getConversationByPhone(customerPhone);
    conversationStateExists = !!conversation;
  } catch {
    conversationStateExists = false;
  }

  // T15: confirm-code handshake. While a conversation is awaiting its
  // confirmation code, the next message IS the code — verify it here, BEFORE
  // classify (a bare 6-digit code is not an intent and must never be routed or
  // escalated as one). Only a verified code proceeds to the calendar mutation;
  // every other outcome completes the job with an SMS (re-ask / fresh code)
  // and the code reply itself is never classified or dispatched.
  if (conversation?.state === 'awaiting_confirmation_code') {
    const outcome = await runConfirmCodeGate(conversation, body, channel, customer.id);

    if (outcome === 'verified') {
      // Same contract as the handleConfirmIntent caller below: the booking
      // confirmation names the in-scope customer, so sms-service.ts's consent
      // gate applies instead of exempting the send for want of a customerId.
      await performConfirmation(organizationId, customerPhone, channel, customer.id);
    }
    return;
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
      await handleRescheduleIntent(organizationId, customerPhone, body, channel, customer.id);
      break;
    }

    case 'slot-choice': {
      const trimmed = body.trim();
      const choice = parseInt(trimmed, 10);
      if (!isNaN(choice) && choice >= 1 && choice <= 3) {
        await handleSlotChoiceIntent(customerPhone, choice, channel, organizationId, customer.id);
      }
      break;
    }

    case 'confirm': {
      await handleConfirmIntent(organizationId, customerPhone, body, channel, customer.id);
      break;
    }

    case 'help': {
      await sendHelpSms(customerPhone, channel, organizationId, customer.id);
      break;
    }

    case 'unknown': {
      // classifyStep already escalated unclassifiable messages (source 'escalation');
      // guard so we never write a second escalation row for the same message.
      if (result.source !== 'escalation') await escalateAmbiguousIntent(customerPhone, body);
      break;
    }

    case 'no-matching-booking': {
      await sendNoMatchingBookingSms(customerPhone, channel, organizationId, customer.id);
      break;
    }

    default: {
      if (result.source !== 'escalation') await escalateAmbiguousIntent(customerPhone, body);
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
async function handleRescheduleIntent(
  organizationId: string,
  customerPhone: string,
  _body: string,
  channel: Channel,
  customerId?: string,
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
      await sendNoMatchingBookingSms(customerPhone, channel, organizationId, customerId);
      return;
    }

    // All outbound SMS goes to sendSms with org/customer context for the ledger.
    const flowSmsSender: SmsSendFn = (input: SendSmsInput) =>
      sendSms({ ...input, organizationId, customerId });

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
      flowSmsSender,
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

async function handleSlotChoiceIntent(
  customerPhone: string,
  choice: number,
  channel: Channel,
  organizationId?: string,
  customerId?: string,
): Promise<void> {
  try {
    // Same contract as handleRescheduleIntent's flowSmsSender: every customer-
    // facing send on this path names the customer, so sendSms's consent gate
    // actually applies instead of exempting the send for want of a customerId.
    const choiceSmsSender: SmsSendFn = (input: SendSmsInput) =>
      sendSms({ ...input, organizationId, customerId });
    const conversation = await processSlotChoice(
      customerPhone,
      choice,
      undefined,
      undefined,
      choiceSmsSender,
    );
    if (!conversation) {
      // No conversation in 'offering_slots' state, or choice out of range.
      await sendInvalidChoiceSms(customerPhone, channel, organizationId, customerId);
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
 * Confirm the slot choice — GATED by a one-shot confirmation code (T15).
 * The calendar mutation (confirmReschedule) only runs after the customer
 * replies with the code issued by runConfirmCodeGate. A CONFIRM text with no
 * code yet pending starts the handshake instead: code SMS + transition to
 * `awaiting_confirmation_code`, NO mutation. This replaces the old direct
 * CONFIRM-text → calendar-mutation match.
 */
async function handleConfirmIntent(
  organizationId: string,
  customerPhone: string,
  body: string,
  channel: Channel,
  customerId?: string,
): Promise<void> {
  try {
    let conversation: ConversationState | null = null;
    try {
      conversation = await getConversationByPhone(customerPhone);
    } catch {
      conversation = null;
    }

    if (conversation) {
      const outcome = await runConfirmCodeGate(conversation, body, channel, customerId);
      // 'code-issued' | 'retry' | 'reissued': the gate sent an SMS (fresh
      // code / re-ask) and the conversation is now awaiting its code — the
      // job completes here with NO mutation. 'not-applicable': conversation
      // isn't at a confirmation step — fall through so confirmReschedule's
      // own state checks report the usual dead-end.
      if (
        outcome === 'code-issued' ||
        outcome === 'retry' ||
        outcome === 'reissued'
      ) {
        return;
      }
    }

    await performConfirmation(organizationId, customerPhone, channel, customerId);
  } catch (err) {
    console.error('[worker] confirm flow failed:', err);
    await createEscalation({
      type: 'processing_error',
      customerPhone,
      content: `confirm flow failed: ${String(err)}`,
    });
  }
}

/**
 * The actual confirmation mutation + post-mutation SMS. Only runs once the
 * T15 code handshake verified (or no gate applied): confirmReschedule →
 * persist the confirmed booking → confirmation SMS.
 */
async function performConfirmation(
  organizationId: string,
  customerPhone: string,
  channel: Channel,
  customerId?: string,
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
        await sendNoMatchingBookingSms(customerPhone, channel, organizationId, customerId);
      } else {
        await sendConfirmFailedSms(customerPhone, channel, organizationId, customerId);
      }
      return;
    }

    // Success: persist the confirmed reschedule, then tell the customer.
    const booking = result.booking;
    if (!booking) {
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
    // Resolve the org timezone so the confirmation SMS shows the time in the
    // customer's local context, not a hardcoded America/New_York.
    const tz = (await getOrgContextByUserId(organizationId))?.timezone ?? 'America/New_York';
    await sendConfirmationSms(customerPhone, booking, channel, tz, organizationId, customerId);
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

/**
 * Customer reply: always SMS. Keeps the legacy sendSms shape ({ to, body } —
 * no channel key) so existing unit-test contracts and live behavior are
 * byte-for-byte unchanged.
 *
 * `customerId` and `kind` are what make sendSms's consent gate apply. Both are
 * threaded by every automated customer-facing caller below; omitting either
 * turns the send into an ungated one (see sms-service.ts's exemption contract).
 * `kind` also stops the outbound ledger writing `kind: null` for these rows.
 */
function replySms(
  customerPhone: string,
  body: string,
  organizationId?: string,
  customerId?: string,
  kind?: MessagingKind,
): Promise<SentSms> {
  const input: SendSmsInput = {
    to: customerPhone,
    body,
  };
  if (organizationId) input.organizationId = organizationId;
  if (customerId) input.customerId = customerId;
  if (kind) input.kind = kind;
  return sendSms(input);
}

/** Real: send a help SMS to the customer explaining what they can do. */
/** Real: tell the customer their numeric choice didn't match an offer. */
export async function sendInvalidChoiceSms(customerPhone: string, channel: Channel = 'sms', organizationId?: string, customerId?: string): Promise<void> {
  await replySms(
    customerPhone,
    `Sorry, I didn't catch that. Reply with 1, 2, or 3 to pick a time, or HELP for your options.`,
    organizationId,
    customerId,
    'slot_invalid',
  );
}

/** Real: courteous heads-up when the confirmation step fails (calendar etc.). */
export async function sendConfirmFailedSms(customerPhone: string, channel: Channel = 'sms', organizationId?: string, customerId?: string): Promise<void> {
  await replySms(
    customerPhone,
    `Sorry, something went wrong confirming your appointment. Our team will contact you shortly to sort it out.`,
    organizationId,
    customerId,
    // Transactional by kind: the customer asked for this appointment to be
    // moved and we must tell them it failed. Admitted by the allowlist even
    // without a consent record.
    'confirm_failed',
  );
}

/** Real: confirm the appointment to the customer with the new time. */
export async function sendConfirmationSms(customerPhone: string, booking: import('@tradescheduler/shared').Booking, channel: Channel = 'sms', timezone?: string, organizationId?: string, customerId?: string): Promise<void> {
  const when = new Date(booking.startTime).toLocaleString('en-US', {
    timeZone: timezone ?? 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  await replySms(
    customerPhone,
    `Your appointment is confirmed for ${when}. Reply RESCHEDULE if you need to move it.`,
    organizationId,
    customerId,
    'booking_confirmation',
  );
}

export async function sendHelpSms(customerPhone: string, channel: Channel = 'sms', organizationId?: string, customerId?: string): Promise<void> {
  await replySms(
    customerPhone,
    `Hi! I can help with rescheduling or confirming your booking. Reply RESCHEDULE to change your appointment time, CONFIRM to lock it in, or reply with a help keyword and I'll walk you through your options.`,
    organizationId,
    customerId,
    'help',
  );
}

/**
 * Real: send an SMS telling the customer we couldn't find a booking for
 * their number. No escalation — this is an informative dead-end, not an
 * operational incident.
 */
export async function sendNoMatchingBookingSms(customerPhone: string, channel: Channel = 'sms', organizationId?: string, customerId?: string): Promise<void> {
  await replySms(
    customerPhone,
    `Hi! I wasn't able to find a booking under this number. Please contact us directly to sort this out.`,
    organizationId,
    customerId,
    'no_matching_booking',
  );
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

// ---------------------------------------------------------------------------
// T14 — first-contact OTP verification gate
// Persistence lives here (lazy pool, env-free boot — same pattern as
// process-outbound-sms.ts); verification-service.ts stays pure.
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not configured');
    }
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

const VERIFICATION_CODE_TTL_MINUTES = 10;
const VERIFICATION_MAX_ATTEMPTS = 3;

const verificationCodeSms = (code: string): string =>
  `Your verification code is ${code}. Reply with it to continue.`;
const VERIFICATION_CONFIRMED_SMS = 'Number verified!';
const VERIFICATION_MISMATCH_SMS = "That doesn't match — try again.";

type VerificationOutcome =
  | 'verified-now' // code matched → caller falls through to classify/dispatch
  | 'code-issued'  // fresh code sent → stop (job completes, no classify)
  | 'retry'        // mismatch, attempts remain → stop
  | 'reissued';    // attempts exhausted → fresh code sent → stop

/**
 * Issue a fresh code, persist it (10-minute TTL, counter reset — a fresh code
 * always carries a fresh 3-attempt window), and send it to the customer.
 */
async function issueAndSendCode(customerId: string, customerPhone: string, channel: Channel): Promise<void> {
  const code = issueCode();
  await getPool().query(
    `update public.rl_customers
        set verification_code = $2,
            verification_code_expires_at = now() + interval '${VERIFICATION_CODE_TTL_MINUTES} minutes',
            verification_attempts = 0
      where id = $1`,
    [customerId, code],
  );
  await replySms(customerPhone, verificationCodeSms(code), undefined, customerId, 'verification_code');
}

/**
 * T14 gate: run for unverified customers only. Returns the outcome; the caller
 * falls through to classify ONLY on 'verified-now'.
 */
async function runVerificationGate(
  customer: Customer,
  customerPhone: string,
  body: string,
  channel: Channel,
): Promise<VerificationOutcome> {
  const submitted = body.trim();

  // No pending code, or it expired -> issue a fresh one.
  const expiresAt = customer.verificationCodeExpiresAt;
  const pending =
    customer.verificationCode !== null &&
    expiresAt !== null &&
    new Date(expiresAt).getTime() > Date.now();

  if (!pending) {
    await issueAndSendCode(customer.id, customerPhone, channel);
    return 'code-issued';
  }

  // Pending code - constant-time compare of the trimmed reply.
  const storedCode = customer.verificationCode;
  if (storedCode && verifyCode(storedCode, submitted)) {
    await getPool().query(
      `update public.rl_customers
          set phone_verified_at = now(),
              verification_code = null,
              verification_code_expires_at = null,
              verification_attempts = 0
        where id = $1`,
      [customer.id],
    );
    await replySms(customerPhone, VERIFICATION_CONFIRMED_SMS, undefined, customer.id, 'number_verified');
    return 'verified-now';
  }

  // Mismatch: count the attempt. Lockout is a re-issue (fresh code + fresh
  // 3-attempt window), not a hard block - the SMS loop IS the retry path.
  await getPool().query(
    `update public.rl_customers
        set verification_attempts = verification_attempts + 1
      where id = $1`,
    [customer.id],
  );
  const attempts = customer.verificationAttempts + 1;
  if (attempts >= VERIFICATION_MAX_ATTEMPTS) {
    await issueAndSendCode(customer.id, customerPhone, channel);
    return 'reissued';
  }

  await replySms(customerPhone, VERIFICATION_MISMATCH_SMS, undefined, customer.id, 'code_mismatch');
  return 'retry';
}

// ---------------------------------------------------------------------------
// T15 — per-flow confirmation-code gate (sensitive intents)
// Same shape as T14's gate: pure primitives live in verification-service.ts,
// persistence stays here via this file's lazy pool. The SMS loop IS the retry
// path (wrong codes re-ask, then re-issue a fresh code — never a hard block).
// ---------------------------------------------------------------------------

const FLOW_CODE_TTL_MINUTES = 10;
const CONFIRM_CODE_MAX_ATTEMPTS = 3;

const confirmCodeSms = (code: string): string =>
  `Reply with ${code} to confirm your appointment change.`;
const CONFIRM_CODE_MISMATCH_SMS = "That code didn't match — try again.";

type ConfirmCodeOutcome =
  | 'code-issued'    // fresh code sent; state → awaiting_confirmation_code; STOP
  | 'retry'          // mismatch, attempts remain; re-ask SMS; STOP
  | 'reissued'       // mismatch ×3 (or expired/stale); fresh code re-issued; STOP
  | 'verified'       // code matched; fields cleared; caller proceeds to the mutation
  | 'not-applicable'; // conversation not at a confirmation step; caller falls back

/**
 * T15 gate run when the flow reaches a final confirmation step: the confirm
 * intent after a slot choice, or a reply while the conversation is awaiting
 * its confirmation code (pre-classify). Returns the outcome; the caller
 * mutates ONLY on 'verified'.
 */
async function runConfirmCodeGate(
  conversation: ConversationState,
  submittedBody: string,
  channel: Channel,
  customerId?: string,
): Promise<ConfirmCodeOutcome> {
  const submitted = submittedBody.trim();
  const pending =
    conversation.confirmationCodeHash !== null &&
    conversation.confirmationCodeExpiresAt !== null &&
    new Date(conversation.confirmationCodeExpiresAt).getTime() > Date.now();

  if (!pending) {
    // The gate only applies at a confirmation step: a fresh CONFIRM after a
    // slot choice, or a stale/expired handshake still awaiting its code.
    // Any other state (offering_slots, completed, ...) is 'not-applicable' —
    // the caller keeps the pre-T15 dead-end behavior (no code issued).
    const atConfirmationStep =
      conversation.state === 'awaiting_slot_choice' ||
      conversation.state === 'awaiting_confirmation_code';
    if (!atConfirmationStep) {
      return 'not-applicable';
    }
    await issueFlowCodeAndSend(conversation.id, conversation.phone, channel, customerId);
    return 'code-issued';
  }

  // Pending code - constant-time compare of sha256(submitted) vs the stored hash.
  const matched = verifyFlowCode(
    conversation.confirmationCodeHash as string,
    sha256Hex(submitted),
  );
  if (matched) {
    await clearFlowCode(conversation.id);
    return 'verified';
  }

  // Mismatch: count the attempt. Lockout is a re-issue (fresh code + fresh
  // 3-attempt window), not a hard block (same semantics as T14).
  await getPool().query(
    `update public.rl_conversation_states
        set confirmation_attempts = confirmation_attempts + 1,
            updated_at = now()
      where id = $1`,
    [conversation.id],
  );
  const attempts = conversation.confirmationAttempts + 1;
  if (attempts >= CONFIRM_CODE_MAX_ATTEMPTS) {
    await issueFlowCodeAndSend(conversation.id, conversation.phone, channel, customerId);
    return 'reissued';
  }

  await replySms(conversation.phone, CONFIRM_CODE_MISMATCH_SMS, undefined, customerId, 'code_mismatch');
  return 'retry';
}

/**
 * Issue a fresh flow code: persist ONLY the sha256 hash (+10-minute TTL,
 * attempt counter reset), transition the conversation to
 * `awaiting_confirmation_code`, and send the plaintext code to the customer.
 * The plaintext never touches the DB — it exists only in this SMS.
 */
async function issueFlowCodeAndSend(conversationId: string, customerPhone: string, channel: Channel, customerId?: string): Promise<void> {
  const { code, hash } = issueFlowCode();
  await getPool().query(
    `update public.rl_conversation_states
        set state = 'awaiting_confirmation_code',
            confirmation_code_hash = $2,
            confirmation_code_expires_at = now() + interval '${FLOW_CODE_TTL_MINUTES} minutes',
            confirmation_attempts = 0,
            updated_at = now()
      where id = $1`,
    [conversationId, hash],
  );
  await replySms(customerPhone, confirmCodeSms(code), undefined, customerId, 'confirm_code');
}

/**
 * A verified code clears the handshake (hash/TTL/attempts, plus the never-used
 * plaintext column for hygiene) and returns the conversation to
 * `awaiting_slot_choice` — the only state confirmReschedule mutates from — so
 * the caller can proceed to the calendar mutation.
 */
async function clearFlowCode(conversationId: string): Promise<void> {
  await getPool().query(
    `update public.rl_conversation_states
        set state = 'awaiting_slot_choice',
            confirmation_code = null,
            confirmation_code_hash = null,
            confirmation_code_expires_at = null,
            confirmation_attempts = 0,
            updated_at = now()
      where id = $1`,
    [conversationId],
  );
}
