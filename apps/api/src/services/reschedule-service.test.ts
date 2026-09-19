import type { SmsRecord } from './sms-service.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initiateRescheduleFlow,
  processSlotChoice,
  confirmReschedule,
  type BookingLookupFn,
  type UserLookupFn,
  type SmsSendFn,
  type ConversationLookupFn,
  type ConversationUpdateFn,
  type CreateEscalationFn,
  type GetAvailableSlotsFn,
  type PickOfferedSlotsFn,
} from './reschedule-service.js';
import type { Booking, ConversationState, OfferedSlot, ConversationStateValue, RescheduleLogEntry } from '@tradescheduler/shared';
import type { CreateEscalationInput } from './escalation-service.js';
import type { UpdateConversationInput } from './conversation-service.js';
import type { GetAvailableSlotsResult } from '@tradescheduler/shared';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CUSTOMER_PHONE = '+155****1234';
const USER_ID = 'user-1';
const BOOKING_ID = 'booking-1';
const CALENDAR_ID = 'primary';
const NOW = new Date('2026-09-18T12:00:00Z');

function makeBooking(status: Booking['status'] = 'pending'): Booking {
  return {
    id: BOOKING_ID,
    userId: USER_ID,
    customerPhone: CUSTOMER_PHONE,
    customerName: 'Test Customer',
    serviceDescription: 'Pipe repair',
    startTime: '2026-09-20T10:00:00Z',
    endTime: '2026-09-20T11:00:00Z',
    status,
    depositStatus: 'transferred',
    googleCalendarEventId: null,
    smsHistory: [],
    rescheduledFromId: null,
    rescheduleLog: [],
  };
}

function makeUser(googleCalendarId: string = CALENDAR_ID) {
  return {
    id: USER_ID,
    phoneNumber: '+155****9876',
    googleCalendarId,
    businessHours: { start: '09:00', end: '17:00', timezone: 'America/Chicago' },
    smsSettings: { rescheduleTemplate: 'Options: {slot1}, {slot2}, {slot3} for {bookingId}. Reply 1-3.' },
  };
}

function makeOfferedSlots(): OfferedSlot[] {
  return [
    { optionNumber: 1, startTime: '2026-09-20T10:00:00Z', endTime: '2026-09-20T11:00:00Z' },
    { optionNumber: 2, startTime: '2026-09-20T14:00:00Z', endTime: '2026-09-20T15:00:00Z' },
    { optionNumber: 3, startTime: '2026-09-21T09:00:00Z', endTime: '2026-09-21T10:00:00Z' },
  ];
}

function makeConversation(
  state: ConversationStateValue = 'offering_slots',
  offeredSlots: OfferedSlot[] | null = makeOfferedSlots(),
  selectedSlot: OfferedSlot | null = null,
  escalationReason: string | null = null,
  completedAt: string | null | undefined = undefined,
  smsHistory: SmsRecord[] = [],
  rescheduleLog: RescheduleLogEntry[] = [],
): ConversationState {
  return {
    id: 'conv-1',
    phone: CUSTOMER_PHONE,
    userId: USER_ID,
    bookingId: BOOKING_ID,
    state,
    offeredSlots,
    selectedSlot,
    escalationReason,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    completedAt: completedAt ?? null,
  };
}

// ---------------------------------------------------------------------------
// Typed mock factories
// ---------------------------------------------------------------------------

const mockBookingLookup = vi.fn<BookingLookupFn>().mockResolvedValue(makeBooking());
const mockUserLookup = vi.fn<UserLookupFn>().mockResolvedValue(makeUser());
const mockSmsSend = vi.fn<SmsSendFn>().mockResolvedValue({ messageSid: 'SM-mock-123', status: 'queued' });
const mockConversationLookup = vi.fn<ConversationLookupFn>().mockResolvedValue(makeConversation());
const mockConversationUpdate = vi.fn<ConversationUpdateFn>().mockResolvedValue(makeConversation('awaiting_slot_choice'));
const mockCreateEscalation = vi.fn<CreateEscalationFn>().mockResolvedValue({
    id: 'esc-1',
    type: 'ambiguous_intent',
    customerPhone: CUSTOMER_PHONE,
    content: 'test escalation',
    status: 'pending',
    createdAt: NOW.toISOString(),
    resolvedAt: null,
  });
const mockCreateConversation = vi.fn().mockResolvedValue(makeConversation('offering_slots', makeOfferedSlots()));

const mockAuthFn = vi.fn().mockResolvedValue({
  client: {
    freebusy: { query: vi.fn() },
    events: { list: vi.fn(), insert: vi.fn() },
  },
  calendarId: CALENDAR_ID,
});

const mockFreeBusyFn = vi.fn().mockResolvedValue({
  data: { calendars: { [CALENDAR_ID]: { busy: [] } } },
});

const mockListEventsFn = vi.fn().mockResolvedValue({ data: { items: [] } });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reschedule-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initiateRescheduleFlow', () => {
    it('creates a conversation state and sends an offer SMS when slots are available', async () => {
      mockBookingLookup.mockResolvedValue(makeBooking());
      mockUserLookup.mockResolvedValue(makeUser());
      mockCreateConversation.mockResolvedValue(makeConversation('offering_slots', makeOfferedSlots()));

      const getAvailableSlotsMock = vi.fn<GetAvailableSlotsFn>().mockResolvedValue({
        slots: [
          { startTime: new Date('2026-09-20T10:00:00Z'), endTime: new Date('2026-09-20T11:00:00Z') },
          { startTime: new Date('2026-09-20T14:00:00Z'), endTime: new Date('2026-09-20T15:00:00Z') },
          { startTime: new Date('2026-09-21T09:00:00Z'), endTime: new Date('2026-09-21T10:00:00Z') },
        ],
        errors: [],
        existingBookings: [],
      } as GetAvailableSlotsResult);

      const pickOfferedSlotsMock = vi.fn<PickOfferedSlotsFn>().mockReturnValue(makeOfferedSlots());

      const result = await initiateRescheduleFlow(
        BOOKING_ID,
        CUSTOMER_PHONE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
        mockBookingLookup,
        mockUserLookup,
        mockSmsSend,
        mockCreateConversation,
        getAvailableSlotsMock,
        pickOfferedSlotsMock,
        mockCreateEscalation,
      );

      expect(result).not.toBeNull();
      expect(result?.state).toBe('offering_slots');
      expect(result?.offeredSlots).toHaveLength(3);
      expect(mockSmsSend).toHaveBeenCalledWith({
        to: CUSTOMER_PHONE,
        body: expect.stringContaining('2026-09-20T10:00:00Z'),
      });
      expect(mockCreateEscalation).not.toHaveBeenCalled();
    });

    it('returns null when the booking is not found', async () => {
      mockBookingLookup.mockResolvedValue(null);

      const result = await initiateRescheduleFlow(
        'non-existent',
        CUSTOMER_PHONE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
        mockBookingLookup,
        mockUserLookup,
        mockSmsSend,
      );

      expect(result).toBeNull();
      expect(mockSmsSend).not.toHaveBeenCalled();
    });

    it('returns null when the user is not found', async () => {
      mockBookingLookup.mockResolvedValue(makeBooking());
      mockUserLookup.mockResolvedValue(null);

      const result = await initiateRescheduleFlow(
        BOOKING_ID,
        CUSTOMER_PHONE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
        mockBookingLookup,
        mockUserLookup,
      );

      expect(result).toBeNull();
    });

    it('creates a no_availability escalation and returns null when no slots available', async () => {
      mockBookingLookup.mockResolvedValue(makeBooking());
      mockUserLookup.mockResolvedValue(makeUser());
      mockCreateEscalation.mockClear();

      const result = await initiateRescheduleFlow(
        BOOKING_ID,
        CUSTOMER_PHONE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
        mockBookingLookup,
        mockUserLookup,
        mockSmsSend,
        mockCreateConversation,
        vi.fn<GetAvailableSlotsFn>().mockResolvedValue({ slots: [], errors: [] } as GetAvailableSlotsResult),
        vi.fn<PickOfferedSlotsFn>().mockReturnValue([]),
        mockCreateEscalation,
      );

      expect(result).toBeNull();
      expect(mockCreateEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'no_availability' }),
      );
    });

    it('creates a calendar_api_failure escalation when calendar errors out with no slots', async () => {
      mockBookingLookup.mockResolvedValue(makeBooking());
      mockUserLookup.mockResolvedValue(makeUser());
      mockCreateEscalation.mockClear();

      const result = await initiateRescheduleFlow(
        BOOKING_ID,
        CUSTOMER_PHONE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
        mockBookingLookup,
        mockUserLookup,
        mockSmsSend,
        mockCreateConversation,
        vi.fn<GetAvailableSlotsFn>().mockResolvedValue({
          slots: [],
          errors: [{ type: 'calendar_api_error', message: 'freebusy failed' }],
        } as GetAvailableSlotsResult),
        vi.fn<PickOfferedSlotsFn>().mockReturnValue([]),
        mockCreateEscalation,
      );

      expect(result).toBeNull();
      expect(mockCreateEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'calendar_api_failure' }),
      );
    });

    it('sends the SMS with the reschedule template interpolated', async () => {
      mockBookingLookup.mockResolvedValue(makeBooking());
      mockUserLookup.mockResolvedValue(makeUser());
      mockCreateConversation.mockResolvedValue(makeConversation('offering_slots', makeOfferedSlots()));

      const getAvailableSlotsMock = vi.fn<GetAvailableSlotsFn>().mockResolvedValue({
        slots: [
          { startTime: new Date('2026-09-20T10:00:00Z'), endTime: new Date('2026-09-20T11:00:00Z') },
          { startTime: new Date('2026-09-20T14:00:00Z'), endTime: new Date('2026-09-20T15:00:00Z') },
          { startTime: new Date('2026-09-21T09:00:00Z'), endTime: new Date('2026-09-21T10:00:00Z') },
        ],
        errors: [],
        existingBookings: [],
      } as GetAvailableSlotsResult);

      const pickOfferedSlotsMock = vi.fn<PickOfferedSlotsFn>().mockReturnValue(makeOfferedSlots());

      const result = await initiateRescheduleFlow(
        BOOKING_ID,
        CUSTOMER_PHONE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
        mockBookingLookup,
        mockUserLookup,
        mockSmsSend,
        mockCreateConversation,
        getAvailableSlotsMock,
        pickOfferedSlotsMock,
        vi.fn(),
      );

      expect(mockSmsSend).toHaveBeenCalledWith({
        to: CUSTOMER_PHONE,
        body: expect.stringContaining('2026-09-20T10:00:00Z'),
      });
      expect(mockSmsSend).toHaveBeenCalledWith({
        to: CUSTOMER_PHONE,
        body: expect.stringContaining('2026-09-20T14:00:00Z'),
      });
      expect(mockSmsSend).toHaveBeenCalledWith({
        to: CUSTOMER_PHONE,
        body: expect.stringContaining('2026-09-21T09:00:00Z'),
      });
      expect(mockSmsSend).toHaveBeenCalledWith({
        to: CUSTOMER_PHONE,
        body: expect.stringContaining(BOOKING_ID),
      });
    });
  });

  describe('processSlotChoice', () => {
    it('updates conversation to awaiting_slot_choice and sends confirm-ask SMS', async () => {
      const conv = makeConversation('offering_slots', makeOfferedSlots());
      mockConversationLookup.mockResolvedValue(conv);
      mockConversationUpdate.mockResolvedValue(
        makeConversation('awaiting_slot_choice', makeOfferedSlots(), makeOfferedSlots()[0]),
      );

      const result = await processSlotChoice(
        CUSTOMER_PHONE,
        1,
        mockConversationLookup,
        mockConversationUpdate,
        mockSmsSend,
      );

      expect(result).not.toBeNull();
      expect(result?.state).toBe('awaiting_slot_choice');
      expect(result?.selectedSlot).toEqual(makeOfferedSlots()[0]);
      expect(mockSmsSend).toHaveBeenCalledWith({
        to: CUSTOMER_PHONE,
        body: expect.stringContaining('2026-09-20T10:00:00Z'),
      });
      expect(mockSmsSend).toHaveBeenCalledWith({
        to: CUSTOMER_PHONE,
        body: expect.stringContaining('YES'),
      });
    });

    it('returns null when no conversation exists for the phone', async () => {
      mockConversationLookup.mockResolvedValue(null);

      const result = await processSlotChoice(CUSTOMER_PHONE, 1, mockConversationLookup, mockConversationUpdate, mockSmsSend);

      expect(result).toBeNull();
      expect(mockConversationUpdate).not.toHaveBeenCalled();
      expect(mockSmsSend).not.toHaveBeenCalled();
    });

    it('returns null when conversation is not in offering_slots state', async () => {
      mockConversationLookup.mockResolvedValue(makeConversation('completed'));

      const result = await processSlotChoice(CUSTOMER_PHONE, 1, mockConversationLookup, mockConversationUpdate, mockSmsSend);

      expect(result).toBeNull();
      expect(mockConversationUpdate).not.toHaveBeenCalled();
    });

    it('returns null when the choice is out of range', async () => {
      mockConversationLookup.mockResolvedValue(makeConversation('offering_slots', makeOfferedSlots()));

      const result = await processSlotChoice(CUSTOMER_PHONE, 99, mockConversationLookup, mockConversationUpdate, mockSmsSend);

      expect(result).toBeNull();
      expect(mockConversationUpdate).not.toHaveBeenCalled();
    });

    it('returns null when offeredSlots is empty', async () => {
      mockConversationLookup.mockResolvedValue(makeConversation('offering_slots', []));

      const result = await processSlotChoice(CUSTOMER_PHONE, 1, mockConversationLookup, mockConversationUpdate, mockSmsSend);

      expect(result).toBeNull();
      expect(mockConversationUpdate).not.toHaveBeenCalled();
    });

    it('selects the correct slot for choice 2', async () => {
      const offeredSlots = makeOfferedSlots();
      mockConversationLookup.mockResolvedValue(makeConversation('offering_slots', offeredSlots));
      mockConversationUpdate.mockResolvedValue(
        makeConversation('awaiting_slot_choice', offeredSlots, offeredSlots[1]),
      );

      const result = await processSlotChoice(CUSTOMER_PHONE, 2, mockConversationLookup, mockConversationUpdate, mockSmsSend);

      expect(result?.selectedSlot).toEqual(offeredSlots[1]);
      expect(mockConversationUpdate).toHaveBeenCalledWith('conv-1', expect.objectContaining({
        state: 'awaiting_slot_choice',
        selectedSlot: offeredSlots[1],
      }));
    });
  });

  describe('confirmReschedule', () => {
    const SELECTED_SLOT: OfferedSlot = {
      optionNumber: 1,
      startTime: '2026-09-20T10:00:00Z',
      endTime: '2026-09-20T11:00:00Z',
    };

    it('creates a calendar event and returns success with updated booking', async () => {
      mockConversationLookup.mockResolvedValue(
        makeConversation('awaiting_slot_choice', makeOfferedSlots(), SELECTED_SLOT),
      );
      mockConversationUpdate.mockResolvedValue(
        makeConversation('completed', makeOfferedSlots(), SELECTED_SLOT, null, NOW.toISOString()),
      );
      mockBookingLookup.mockResolvedValue(makeBooking('pending'));
      mockCreateEscalation.mockClear();
      // afterEach's restoreAllMocks strips the module-level impl after the first
      // test — re-establish it here so auth works in any run order.
      mockAuthFn.mockResolvedValue({
        client: {
          freebusy: { query: vi.fn() },
          events: { list: vi.fn(), insert: vi.fn() },
        },
        calendarId: CALENDAR_ID,
      });

      const createEventFn = vi.fn().mockResolvedValue({ data: { id: 'cal-evt-confirmed-1' } });

      const result = await confirmReschedule(
        CUSTOMER_PHONE,
        mockAuthFn,
        createEventFn as Parameters<typeof confirmReschedule>[2],
        mockBookingLookup,
        mockConversationLookup,
        mockConversationUpdate,
        mockSmsSend,
        mockCreateEscalation,
      );

      expect(result.success).toBe(true);
      expect(result.booking).toBeDefined();
      expect(result.booking!.status).toBe('confirmed');
      expect(result.booking!.googleCalendarEventId).toBe('cal-evt-confirmed-1');
      expect(result.booking!.startTime).toBe(SELECTED_SLOT.startTime);
      expect(result.booking!.endTime).toBe(SELECTED_SLOT.endTime);
      expect(result.conversation?.state).toBe('completed');
      expect(createEventFn).toHaveBeenCalledTimes(1);
      expect(mockCreateEscalation).not.toHaveBeenCalled();
    });

    it('returns failure when no conversation exists', async () => {
      mockConversationLookup.mockResolvedValue(null);
      mockBookingLookup.mockResolvedValue(makeBooking());

      const createEventFn = vi.fn();

      const result = await confirmReschedule(
        CUSTOMER_PHONE,
        mockAuthFn,
        createEventFn as Parameters<typeof confirmReschedule>[2],
        mockBookingLookup,
        mockConversationLookup,
        mockConversationUpdate,
        mockSmsSend,
        mockCreateEscalation,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No conversation found');
      expect(mockConversationUpdate).not.toHaveBeenCalled();
    });

    it('returns failure when conversation is not in awaiting_slot_choice state', async () => {
      mockConversationLookup.mockResolvedValue(makeConversation('offering_slots'));
      mockBookingLookup.mockResolvedValue(makeBooking());

      const createEventFn = vi.fn();

      const result = await confirmReschedule(
        CUSTOMER_PHONE,
        mockAuthFn,
        createEventFn as Parameters<typeof confirmReschedule>[2],
        mockBookingLookup,
        mockConversationLookup,
        mockConversationUpdate,
        mockSmsSend,
        mockCreateEscalation,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not in awaiting_slot_choice state');
    });

    it('returns failure when selectedSlot or bookingId is missing', async () => {
      mockConversationLookup.mockResolvedValue(
        makeConversation('awaiting_slot_choice', null, null, null, null),
      );
      mockBookingLookup.mockResolvedValue(makeBooking());

      const createEventFn = vi.fn();

      const result = await confirmReschedule(
        CUSTOMER_PHONE,
        mockAuthFn,
        createEventFn as Parameters<typeof confirmReschedule>[2],
        mockBookingLookup,
        mockConversationLookup,
        mockConversationUpdate,
        mockSmsSend,
        mockCreateEscalation,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('no selectedSlot or bookingId');
    });

    it('returns failure when booking is not found', async () => {
      mockConversationLookup.mockResolvedValue(
        makeConversation('awaiting_slot_choice', makeOfferedSlots(), SELECTED_SLOT),
      );
      mockConversationUpdate.mockResolvedValue(
        makeConversation('escalated', makeOfferedSlots(), SELECTED_SLOT, 'Booking not found', null),
      );
      mockBookingLookup.mockResolvedValue(null);

      const createEventFn = vi.fn();

      const result = await confirmReschedule(
        CUSTOMER_PHONE,
        mockAuthFn,
        createEventFn as Parameters<typeof confirmReschedule>[2],
        mockBookingLookup,
        mockConversationLookup,
        mockConversationUpdate,
        mockSmsSend,
        mockCreateEscalation,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Booking booking-1 not found');
    });

    it('creates an escalation and returns failure when calendar event creation throws', async () => {
      mockConversationLookup.mockResolvedValue(
        makeConversation('awaiting_slot_choice', makeOfferedSlots(), SELECTED_SLOT),
      );
      mockConversationUpdate.mockResolvedValue(
        makeConversation('escalated', makeOfferedSlots(), SELECTED_SLOT, 'Calendar event creation failed: boom', null),
      );
      mockBookingLookup.mockResolvedValue(makeBooking('pending'));
      mockCreateEscalation.mockClear();

      const createEventFn = vi.fn().mockRejectedValue(new Error('calendar quota exceeded'));

      const result = await confirmReschedule(
        CUSTOMER_PHONE,
        mockAuthFn,
        createEventFn as Parameters<typeof confirmReschedule>[2],
        mockBookingLookup,
        mockConversationLookup,
        mockConversationUpdate,
        mockSmsSend,
        mockCreateEscalation,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Calendar event creation failed');
      expect(mockCreateEscalation).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'calendar_api_failure' }),
      );
      expect(mockConversationUpdate).toHaveBeenCalledWith('conv-1', expect.objectContaining({
        state: 'escalated',
        escalationReason: expect.stringContaining('Calendar event creation failed'),
      }));
    });
  });
});
