import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAvailableSlots, pickOfferedSlots, createCalendarEvent, type CalendarClient, type AuthFn, type FreeBusyFn, type ListEventsFn, type CreateEventFn, type CalendarAuthResult } from './calendar-service.js';
import type { AvailableSlot, Booking, BusinessHours } from '@tradescheduler/shared';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockCalendarClient(): CalendarClient {
  return {
    freebusy: {
      query: vi.fn().mockResolvedValue({ data: { calendars: undefined } }),
    },
    events: {
      list: vi.fn().mockResolvedValue({ data: { items: undefined } }),
      insert: vi.fn().mockResolvedValue({ data: { id: undefined } }),
    },
  };
}

function makeMockAuthClient(calendarId: string = 'primary'): CalendarAuthResult {
  return {
    client: makeMockCalendarClient(),
    calendarId,
  };
}

const mockAuthFn = vi.fn<AuthFn>().mockResolvedValue(makeMockAuthClient());
const mockFreeBusyFn = vi.fn<FreeBusyFn>().mockResolvedValue({
  data: {
    calendars: {
      primary: { busy: [] },
    },
  },
});
const mockListEventsFn = vi.fn<ListEventsFn>().mockResolvedValue({
  data: { items: [] },
});
const mockCreateEventFn = vi.fn<CreateEventFn>().mockResolvedValue({
  data: { id: 'cal-evt-123' },
});

const BUSINESS_HOURS: BusinessHours = {
  start: '09:00',
  end: '17:00',
  timezone: 'America/Chicago',
};

const NOW = new Date('2026-09-18T12:00:00Z');
const FROM_DATE = new Date('2026-09-18T00:00:00Z');
const TO_DATE = new Date('2026-09-25T00:00:00Z');

const EXISTING_BOOKINGS: Booking[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('calendar-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAvailableSlots', () => {
    it('returns slots within business hours when the calendar is free', async () => {
      const result = await getAvailableSlots(
        'user-1',
        'primary',
        BUSINESS_HOURS,
        EXISTING_BOOKINGS,
        FROM_DATE,
        TO_DATE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
      );

      expect(result.errors).toHaveLength(0);
      expect(result.slots.length).toBeGreaterThan(0);

      // All slots should be within business hours (09:00–17:00).
      for (const slot of result.slots) {
        const h = slot.startTime.getHours();
        expect(h).toBeGreaterThanOrEqual(9);
        expect(h).toBeLessThan(17);
        // 1-hour duration.
        const diff = slot.endTime.getTime() - slot.startTime.getTime();
        expect(diff).toBe(3600_000);
      }
    });

    it('filters out slots that overlap busy periods', async () => {
      const busyPeriods = [
        { start: '2026-09-18T10:00:00Z', end: '2026-09-18T11:00:00Z' },
      ];

      mockFreeBusyFn.mockResolvedValue({
        data: {
          calendars: {
            primary: { busy: busyPeriods },
          },
        },
      });

      const result = await getAvailableSlots(
        'user-1',
        'primary',
        BUSINESS_HOURS,
        EXISTING_BOOKINGS,
        FROM_DATE,
        TO_DATE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
      );

      // The 10:00 slot should be filtered out.
      for (const slot of result.slots) {
        expect(slot.startTime.getTime()).not.toBe(new Date('2026-09-18T10:00:00Z').getTime());
      }
    });

    it('filters out slots that overlap existing events from the calendar', async () => {
      const existingEvent = {
        id: 'evt-1',
        start: { dateTime: '2026-09-18T14:00:00Z' },
        end: { dateTime: '2026-09-18T15:00:00Z' },
      };

      mockListEventsFn.mockResolvedValue({
        data: { items: [existingEvent] },
      });

      const result = await getAvailableSlots(
        'user-1',
        'primary',
        BUSINESS_HOURS,
        EXISTING_BOOKINGS,
        FROM_DATE,
        TO_DATE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
      );

      for (const slot of result.slots) {
        expect(slot.startTime.getTime()).not.toBe(new Date('2026-09-18T14:00:00Z').getTime());
      }
    });

    it('filters out slots that overlap existing bookings from our DB', async () => {
      const existingBooking: Booking = {
        id: 'booking-1',
        userId: 'user-1',
        customerPhone: '+155****1234',
        customerName: 'Test Customer',
        serviceDescription: 'Plumbing',
        startTime: '2026-09-18T11:00:00Z',
        endTime: '2026-09-18T12:00:00Z',
        status: 'confirmed',
        depositStatus: 'transferred',
        googleCalendarEventId: 'cal-evt-1',
        smsHistory: [],
        rescheduledFromId: null,
        rescheduleLog: [],
      };

      const result = await getAvailableSlots(
        'user-1',
        'primary',
        BUSINESS_HOURS,
        [existingBooking],
        FROM_DATE,
        TO_DATE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
      );

      for (const slot of result.slots) {
        expect(slot.startTime.getTime()).not.toBe(new Date('2026-09-18T11:00:00Z').getTime());
      }
    });

    it('caps the result at 20 slots', async () => {
      // Make the freebusy and events return empty so all business-hours slots pass.
      const result = await getAvailableSlots(
        'user-1',
        'primary',
        BUSINESS_HOURS,
        [],
        FROM_DATE,
        TO_DATE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
      );

      expect(result.slots.length).toBeLessThanOrEqual(20);
    });

    it('returns errors when calendar auth fails, with empty slots', async () => {
      const failingAuthFn: AuthFn = vi.fn().mockRejectedValue(new Error('token expired'));

      const result = await getAvailableSlots(
        'user-1',
        'primary',
        BUSINESS_HOURS,
        EXISTING_BOOKINGS,
        FROM_DATE,
        TO_DATE,
        failingAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
      );

      expect(result.slots).toHaveLength(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].type).toBe('calendar_api_error');
    });

    it('continues with empty busy list when freebusy.query throws', async () => {
      const failingFreeBusyFn: FreeBusyFn = vi.fn().mockRejectedValue(new Error('network boom'));
      const cleanAuthFn: AuthFn = vi.fn().mockResolvedValue({
        client: makeMockCalendarClient(),
        calendarId: 'primary',
      });

      const result = await getAvailableSlots(
        'user-1',
        'primary',
        BUSINESS_HOURS,
        EXISTING_BOOKINGS,
        FROM_DATE,
        TO_DATE,
        cleanAuthFn,
        failingFreeBusyFn,
        mockListEventsFn,
      );

      // Should not throw — errors collected, slots still generated.
      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns at most 20 slots even when more are available', async () => {
      const result = await getAvailableSlots(
        'user-1',
        'primary',
        BUSINESS_HOURS,
        [],
        FROM_DATE,
        TO_DATE,
        mockAuthFn,
        mockFreeBusyFn,
        mockListEventsFn,
      );

      expect(result.slots.length).toBeLessThanOrEqual(20);
      // Verify sorted ascending.
      for (let i = 1; i < result.slots.length; i++) {
        expect(result.slots[i].startTime.getTime()).toBeGreaterThanOrEqual(
          result.slots[i - 1].startTime.getTime(),
        );
      }
    });
  });

  describe('pickOfferedSlots', () => {
    it('returns up to 3 slots with ascending option numbers', () => {
      const available: AvailableSlot[] = [
        { startTime: new Date('2026-09-18T10:00:00Z'), endTime: new Date('2026-09-18T11:00:00Z') },
        { startTime: new Date('2026-09-18T14:00:00Z'), endTime: new Date('2026-09-18T15:00:00Z') },
        { startTime: new Date('2026-09-19T09:00:00Z'), endTime: new Date('2026-09-19T10:00:00Z') },
        { startTime: new Date('2026-09-19T11:00:00Z'), endTime: new Date('2026-09-19T12:00:00Z') },
      ];

      const offered = pickOfferedSlots(available);

      expect(offered).toHaveLength(3);
      expect(offered[0].optionNumber).toBe(1);
      expect(offered[1].optionNumber).toBe(2);
      expect(offered[2].optionNumber).toBe(3);
      expect(offered[0].startTime).toBe(available[0].startTime.toISOString());
      expect(offered[2].startTime).toBe(available[2].startTime.toISOString());
    });

    it('returns all available slots when fewer than 3', () => {
      const available: AvailableSlot[] = [
        { startTime: new Date('2026-09-18T10:00:00Z'), endTime: new Date('2026-09-18T11:00:00Z') },
      ];

      const offered = pickOfferedSlots(available);

      expect(offered).toHaveLength(1);
      expect(offered[0].optionNumber).toBe(1);
    });

    it('returns empty array for empty input', () => {
      const offered = pickOfferedSlots([]);
      expect(offered).toHaveLength(0);
    });
  });

  describe('createCalendarEvent', () => {
    const TEST_BOOKING: Booking = {
      id: 'booking-42',
      userId: 'user-1',
      customerPhone: '+155****1234',
      customerName: 'Test Customer',
      serviceDescription: 'Pipe repair',
      startTime: '2026-09-20T10:00:00Z',
      endTime: '2026-09-20T11:00:00Z',
      status: 'pending',
      depositStatus: 'unpaid',
      googleCalendarEventId: null,
      smsHistory: [],
      rescheduledFromId: null,
      rescheduleLog: [],
    };

    it('creates an event and returns the event ID', async () => {
      const mockClient = makeMockCalendarClient();
      mockCreateEventFn.mockResolvedValue({
        data: { id: 'new-evt-999' },
      });

      const authFn: AuthFn = vi.fn().mockResolvedValue({
        client: mockClient,
        calendarId: 'primary',
      });

      const eventId = await createCalendarEvent(
        'user-1',
        'primary',
        TEST_BOOKING,
        authFn,
        mockCreateEventFn,
      );

      expect(eventId).toBe('new-evt-999');
      expect(mockCreateEventFn).toHaveBeenCalledTimes(1);

      // Verify the event payload shape.
      const calls = mockCreateEventFn.mock.calls;
      expect(calls.length).toBe(1);
      const callArgs = calls[0];
      expect(callArgs[0]).toBe(mockClient);
      expect(callArgs[1]).toBe('primary');
      const event = callArgs[2] as Record<string, unknown>;
      expect(event.summary).toBe('Pipe repair');
      expect(event.start).toEqual({ dateTime: '2026-09-20T10:00:00Z' });
      expect(event.end).toEqual({ dateTime: '2026-09-20T11:00:00Z' });
      expect(event.reminders).toBeDefined();
    });

    it('throws when auth fails', async () => {
      const failingAuthFn: AuthFn = vi.fn().mockRejectedValue(new Error('no token'));

      await expect(
        createCalendarEvent('user-1', 'primary', TEST_BOOKING, failingAuthFn, mockCreateEventFn),
      ).rejects.toThrow('no token');
      expect(mockCreateEventFn).not.toHaveBeenCalled();
    });

    it('throws when event creation fails (caller must handle escalation)', async () => {
      const mockClient = makeMockCalendarClient();
      mockCreateEventFn.mockRejectedValue(new Error('calendar quota exceeded'));

      const authFn: AuthFn = vi.fn().mockResolvedValue({
        client: mockClient,
        calendarId: 'primary',
      });

      await expect(
        createCalendarEvent('user-1', 'primary', TEST_BOOKING, authFn, mockCreateEventFn),
      ).rejects.toThrow('calendar quota exceeded');
    });
  });
});
