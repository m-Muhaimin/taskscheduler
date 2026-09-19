/**
 * Reschedule flow orchestration.
 * build-sequence.md Step 8.
 *
 * Composes calendar-service, sms-service, conversation-service, and
 * escalation-service into the three-handler reschedule flow:
 *   initiateRescheduleFlow  → offer 3 slots via SMS
 *   processSlotChoice        → confirm the customer's numeric choice
 *   confirmReschedule        → create calendar event + mark booking confirmed
 *
 * All external deps are injected so tests can mock without touching real
 * Twilio / Google / Postgres.
 */

import { sendSms, type SendSmsInput } from './sms-service.js';
import { createCalendarEvent, type AuthFn, type CreateEventFn, type FreeBusyFn, type ListEventsFn } from './calendar-service.js';
import { createEscalation, type CreateEscalationInput } from './escalation-service.js';
import { createConversation, getConversationByPhone, updateConversation, type UpdateConversationInput } from './conversation-service.js';
import { schedulingEngine } from './scheduling-engine.js';
import type {
  AvailableSlot,
  Booking,
  BusinessHours,
  ConversationState,
  ConversationStateValue,
  EscalationType,
  IsoString,
  OfferedSlot,
  GetAvailableSlotsResult,
} from '@tradescheduler/shared';

// ---------------------------------------------------------------------------
// Injected dependency types (mockable in tests)
// ---------------------------------------------------------------------------

export type BookingLookupFn = (bookingId: string) => Promise<Booking | null>;
export type UserLookupFn = (userId: string) => Promise<{
  id: string;
  phoneNumber: string;
  googleCalendarId: string | null;
  businessHours: BusinessHours;
  smsSettings: { rescheduleTemplate: string };
} | null>;
export type SmsSendFn = (input: SendSmsInput) => Promise<{ messageSid: string; status: string }>;
export type ConversationLookupFn = (phone: string) => Promise<ConversationState | null>;
export type ConversationUpdateFn = (id: string, input: UpdateConversationInput) => Promise<ConversationState>;
export type CreateEscalationFn = (input: CreateEscalationInput) => Promise<import('@tradescheduler/shared').Escalation>;
export type GetAvailableSlotsFn = (
  userId: string,
  calendarId: string,
  businessHours: BusinessHours,
  existingBookings: Booking[],
  fromDate: Date,
  toDate: Date,
  authFn?: AuthFn,
  freeBusyFn?: FreeBusyFn,
  listEventsFn?: ListEventsFn,
  maxSlots?: number,
  opts?: { excludeBookingIds?: string[] },
) => Promise<GetAvailableSlotsResult>;
export type PickOfferedSlotsFn = (available: AvailableSlot[], timeZone?: string) => OfferedSlot[];
export type SiblingBookingsFn = (userId: string, fromIso: IsoString, toIso: IsoString) => Promise<Booking[]>;

// ---------------------------------------------------------------------------
// Default SMS sender (real sendSms)
// ---------------------------------------------------------------------------

async function defaultSendSms(input: SendSmsInput) {
  return sendSms(input);
}

// ---------------------------------------------------------------------------
// initiateRescheduleFlow
// ---------------------------------------------------------------------------

/**
 * Entry point for a reschedule request.
 *
 * 1. Look up the booking (must exist, must be in a rescheduleable state).
 * 2. Look up the user (for business hours + calendar + SMS template).
 * 3. Query available slots via getAvailableSlots.
 * 4. Pick 3 offered slots.
 * 5. Create a ConversationState row in 'offering_slots' state.
 * 6. Send the SMS offer with the 3 slot options.
 *
 * Returns the created ConversationState (with offeredSlots populated).
 *
 * On calendar failure with no slots: creates a 'no_availability' escalation
 * and returns null (caller should handle the no-slots path).
 */
export async function initiateRescheduleFlow(
  bookingId: string,
  customerPhone: string,
  authFn: AuthFn,
  freeBusyFn: FreeBusyFn,
  listEventsFn: ListEventsFn,
  bookingLookupFn: BookingLookupFn,
  userLookupFn: UserLookupFn,
  smsSendFn: SmsSendFn = defaultSendSms,
  conversationCreateFn: typeof createConversation = createConversation,
  getAvailableSlotsFn: GetAvailableSlotsFn = schedulingEngine.getAvailableSlots,
  pickOfferedSlotsFn: PickOfferedSlotsFn = schedulingEngine.pickOfferedSlots,
  createEscalationFn: CreateEscalationFn = createEscalation,
  siblingBookingsFn?: SiblingBookingsFn,
): Promise<ConversationState | null> {
  // 1. Booking must exist.
  const booking = await bookingLookupFn(bookingId);
  if (!booking) {
    return null;
  }

  // 2. User must exist.
  const user = await userLookupFn(booking.userId);
  if (!user) {
    return null;
  }

  // 3. Query available slots.
  const now = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toDate = new Date(fromDate);
  toDate.setDate(toDate.getDate() + 7); // next 7 days

  // Sibling bookings (other appointments) block the same windows the
  // being-rescheduled booking occupies — but never itself.
  const siblings = siblingBookingsFn
    ? await siblingBookingsFn(booking.userId, fromDate.toISOString(), toDate.toISOString())
    : [];
  const existingBookings = siblings.filter((b) => b.id !== booking.id);

  const result = await getAvailableSlotsFn(
    booking.userId,
    user.googleCalendarId ?? '',
    user.businessHours,
    existingBookings,
    fromDate,
    toDate,
    authFn,
    freeBusyFn,
    listEventsFn,
    undefined,
    { excludeBookingIds: [booking.id] },
  );

  if (result.errors.length > 0 && result.slots.length === 0) {
    // Calendar completely unavailable — escalate.
    await createEscalationFn({
      type: 'calendar_api_failure',
      customerPhone,
      content: `Failed to query availability for booking ${bookingId}: ${result.errors.map((e) => e.message).join('; ')}`,
    });
    return null;
  }

  if (result.slots.length === 0) {
    // No slots available — escalate.
    await createEscalationFn({
      type: 'no_availability',
      customerPhone,
      content: `No available slots for booking ${bookingId} in the next 7 days`,
    });
    return null;
  }

  // 4. Pick 3 offered slots (day-spread grouped in the user's timezone).
  const offered = pickOfferedSlotsFn(result.slots, user.businessHours.timezone);

  // 5. Create conversation state.
  const conversation = await conversationCreateFn({
    phone: customerPhone,
    userId: booking.userId,
    bookingId,
    state: 'offering_slots',
    offeredSlots: offered,
    escalationReason: null,
  });

  // 6. Send SMS offer.
  const template = user.smsSettings.rescheduleTemplate;
  const body = template
    .replace('{slot1}', offered[0].startTime)
    .replace('{slot2}', offered[1].startTime)
    .replace('{slot3}', offered[2].startTime)
    .replace('{bookingId}', bookingId);

  await smsSendFn({
    to: customerPhone,
    body,
  });

  return conversation;
}

// ---------------------------------------------------------------------------
// processSlotChoice
// ---------------------------------------------------------------------------

/**
 * Handle a customer's numeric slot choice (e.g. "1", "option 2").
 *
 * 1. Look up the conversation by phone (must exist, must be in 'offering_slots' state).
 * 2. Validate the choice is within the offered range.
 * 3. Transition conversation to 'awaiting_slot_choice' and store selectedSlot.
 * 4. Send a confirmation-asking SMS ("Reply YES to confirm...").
 *
 * Returns the updated ConversationState.
 *
 * Returns null when:
 *   - No conversation exists for the phone.
 *   - Conversation is not in 'offering_slots' state.
 *   - Choice is out of range.
 */
export async function processSlotChoice(
  phone: string,
  choice: number,
  conversationLookupFn: ConversationLookupFn = getConversationByPhone,
  conversationUpdateFn: ConversationUpdateFn = updateConversation,
  smsSendFn: SmsSendFn = defaultSendSms,
): Promise<ConversationState | null> {
  const conversation = await conversationLookupFn(phone);
  if (!conversation) {
    return null;
  }

  if (conversation.state !== 'offering_slots') {
    return null;
  }

  if (!conversation.offeredSlots || conversation.offeredSlots.length === 0) {
    return null;
  }

  const idx = choice - 1;
  if (idx < 0 || idx >= conversation.offeredSlots.length) {
    return null;
  }

  const selected = conversation.offeredSlots[idx];

  const updated = await conversationUpdateFn(conversation.id, {
    state: 'awaiting_slot_choice' as ConversationStateValue,
    selectedSlot: selected,
  });

  // Ask for explicit confirmation.
  await smsSendFn({
    to: phone,
    body: `You chose ${selected.startTime}. Reply YES to confirm this slot, or reply with a different option number to choose again.`,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// confirmReschedule
// ---------------------------------------------------------------------------

/**
 * Handle a customer's explicit confirm reply (e.g. "yes", "confirm").
 *
 * 1. Look up the conversation by phone (must exist, must be in 'awaiting_slot_choice' state).
 * 2. Look up the booking.
 * 3. Create the Google Calendar event via createCalendarEvent.
 * 4. On success: update booking to confirmed with eventId; mark conversation completed.
 * 5. On calendar failure: booking stays pending with null eventId; escalation created.
 *
 * Returns { success: true, booking, conversation } on success.
 * Returns { success: false, error } when:
 *   - No conversation in the right state.
 *   - Booking not found.
 *   - Calendar event creation fails (escalation created, booking NOT rolled back).
 */
export async function confirmReschedule(
  phone: string,
  authFn: AuthFn,
  createEventFn: CreateEventFn,
  bookingLookupFn: BookingLookupFn,
  conversationLookupFn: ConversationLookupFn = getConversationByPhone,
  conversationUpdateFn = updateConversation,
  smsSendFn: SmsSendFn = defaultSendSms,
  createEscalationFn = createEscalation,
): Promise<{ success: boolean; booking?: Booking; conversation?: ConversationState; error?: string }> {
  const conversation = await conversationLookupFn(phone);
  if (!conversation) {
    return { success: false, error: 'No conversation found' };
  }

  if (conversation.state !== 'awaiting_slot_choice') {
    return { success: false, error: 'Conversation not in awaiting_slot_choice state' };
  }

  if (!conversation.selectedSlot || !conversation.bookingId) {
    return { success: false, error: 'Conversation has no selectedSlot or bookingId' };
  }

  const booking = await bookingLookupFn(conversation.bookingId);
  if (!booking) {
    return { success: false, error: `Booking ${conversation.bookingId} not found` };
  }

  // Create the calendar event.
  let eventId: string | null = null;
  try {
    eventId = await createCalendarEvent(
      booking.userId,
      '',
      {
        ...booking,
        startTime: conversation.selectedSlot.startTime,
        endTime: conversation.selectedSlot.endTime,
        googleCalendarEventId: null,
        status: 'pending' as Booking['status'],
      },
      authFn,
      createEventFn,
    );
  } catch (err) {
    // Event creation failed — booking stays pending, escalation created.
    await createEscalationFn({
      type: 'calendar_api_failure',
      customerPhone: phone,
      content: `Failed to create calendar event for booking ${booking.id}: ${String(err)}`,
    });

    await conversationUpdateFn(conversation.id, {
      state: 'escalated' as ConversationStateValue,
      escalationReason: `Calendar event creation failed: ${String(err)}`,
    });

    return { success: false, error: `Calendar event creation failed: ${String(err)}` };
  }

  // Success — update booking and conversation.
  // In a real implementation, the booking update would go through a booking-service.
  // For now we return the intended state; the caller (process-inbound-sms) handles
  // the actual booking update via its own deps.

  const updatedConversation = await conversationUpdateFn(conversation.id, {
    state: 'completed' as ConversationStateValue,
    completedAt: new Date().toISOString(),
  });

  return {
    success: true,
    booking: {
      ...booking,
      startTime: conversation.selectedSlot.startTime,
      endTime: conversation.selectedSlot.endTime,
      status: 'confirmed' as Booking['status'],
      googleCalendarEventId: eventId,
    },
    conversation: updatedConversation,
  };
}
