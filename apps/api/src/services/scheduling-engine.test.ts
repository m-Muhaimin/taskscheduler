import { describe, expect, it } from 'vitest';
import {
  getTimezoneOffsetMs,
  zonedMidnightMs,
  wallClockParts,
  generateCandidateSlots,
  filterBlockedPeriods,
  filterBookingBlocks,
  filterBeforeNotice,
  pickOfferedSlots,
  createSchedulingEngine,
  type SchedulingEngine,
} from './scheduling-engine.js';
import type { BusinessHours, Booking, AvailableSlot } from '@tradescheduler/shared';

const NY: BusinessHours = { start: '09:00', end: '17:00', timezone: 'America/New_York' };

function booking(id: string, startIso: string, endIso: string): Booking {
  return {
    id,
    userId: 'user-1',
    customerPhone: '+15551234567',
    customerName: 'Sam',
    serviceDescription: 'drain',
    startTime: startIso,
    endTime: endIso,
    status: 'confirmed',
    depositStatus: 'paid',
    googleCalendarEventId: null,
    smsHistory: [],
    rescheduledFromId: null,
    rescheduleLog: [],
  };
}

describe('getTimezoneOffsetMs', () => {
  it('returns -4h (EDT) for a July instant in New York', () => {
    expect(getTimezoneOffsetMs(Date.UTC(2026, 6, 15, 12), 'America/New_York')).toBe(-4 * 3600_000);
  });

  it('returns -5h (EST) for a January instant in New York', () => {
    expect(getTimezoneOffsetMs(Date.UTC(2026, 0, 15, 12), 'America/New_York')).toBe(-5 * 3600_000);
  });

  it('returns 0 for UTC', () => {
    expect(getTimezoneOffsetMs(Date.UTC(2026, 6, 15, 12), 'UTC')).toBe(0);
  });
});

describe('zonedMidnightMs', () => {
  it('returns 04:00Z for 2026-07-04 local midnight in New York (EDT)', () => {
    expect(zonedMidnightMs(2026, 6, 4, 'America/New_York')).toBe(Date.UTC(2026, 6, 4, 4));
  });

  it('returns 05:00Z for 2026-01-04 local midnight in New York (EST)', () => {
    expect(zonedMidnightMs(2026, 0, 4, 'America/New_York')).toBe(Date.UTC(2026, 0, 4, 5));
  });
});

describe('wallClockParts', () => {
  it('maps an instant to the right wall-clock date across the date line', () => {
    // 2026-07-05T23:30Z is 2026-07-06 09:30 in Sydney (AEST +10).
    const p = wallClockParts(Date.UTC(2026, 6, 5, 23, 30), 'Australia/Sydney');
    expect(p).toEqual({ year: 2026, month: 6, day: 6 });
  });
});

describe('generateCandidateSlots', () => {
  const july6 = new Date(Date.UTC(2026, 6, 6, 12)); // any instant on 2026-07-06 NY

  it('generates 09:00..16:00 (8 slots) for a 09:00-17:00 NY day', () => {
    const slots = generateCandidateSlots(NY, july6, july6);
    expect(slots).toHaveLength(8);
    expect(slots[0].toISOString()).toBe('2026-07-06T13:00:00.000Z'); // 09:00 EDT
    expect(slots[7].toISOString()).toBe('2026-07-06T20:00:00.000Z'); // 16:00 EDT
  });

  it('honors slotDurationMinutes (90 -> 5 slots)', () => {
    const slots = generateCandidateSlots(NY, july6, july6, { slotDurationMinutes: 90 });
    expect(slots).toHaveLength(5); // 09:00, 10:30, 12:00, 13:30, 15:00
    expect(slots[1].toISOString()).toBe('2026-07-06T14:30:00.000Z'); // 10:30 EDT
  });

  it('generates across a multi-day window', () => {
    const july7 = new Date(Date.UTC(2026, 6, 7, 12));
    expect(generateCandidateSlots(NY, july6, july7)).toHaveLength(16);
  });

  it('rejects overnight business hours', () => {
    expect(() =>
      generateCandidateSlots({ start: '22:00', end: '06:00', timezone: 'UTC' }, july6, july6),
    ).toThrow(/single day/);
  });
});

describe('filterBlockedPeriods', () => {
  const july6 = new Date(Date.UTC(2026, 6, 6, 12));
  const day = generateCandidateSlots(NY, july6, july6);

  it('removes slots overlapping the block', () => {
    const out = filterBlockedPeriods(day, [
      { start: new Date('2026-07-06T18:30:00.000Z'), end: new Date('2026-07-06T19:30:00.000Z') }, // 10:30-11:30 EDT
    ]);
    const starts = out.map((s) => s.getUTCHours());
    expect(starts).not.toContain(18); // 10:00 EDT slot overlaps
    expect(starts).not.toContain(19); // 11:00 EDT slot overlaps
    expect(starts).toContain(17); // 09:00 EDT stays
  });

  it('applies buffer padding around the block', () => {
    // 10:00-10:30 EDT block with 30-min buffer sweeps the 09:00 and 10:00 slots.
    const padded = filterBlockedPeriods(
      day,
      [{ start: new Date('2026-07-06T14:00:00.000Z'), end: new Date('2026-07-06T14:30:00.000Z') }],
      30,
    );
    expect(padded).toHaveLength(6); // 12:00..16:00 EDT remain

    // Without buffer the same block only removes the 10:00 slot.
    const plain = filterBlockedPeriods(
      day,
      [{ start: new Date('2026-07-06T14:00:00.000Z'), end: new Date('2026-07-06T14:30:00.000Z') }],
      0,
    );
    expect(plain).toHaveLength(7);
  });
});

describe('filterBookingBlocks', () => {
  const july6 = new Date(Date.UTC(2026, 6, 6, 12));
  const day = generateCandidateSlots(NY, july6, july6);
  const other = booking('apt-other', '2026-07-06T18:00:00.000Z', '2026-07-06T19:00:00.000Z'); // 10:00-11:00 EDT

  it('removes slots overlapping another booking', () => {
    const starts = filterBookingBlocks(day, [other]).map((s) => s.getUTCHours());
    expect(starts).not.toContain(18);
    expect(starts).toContain(17);
  });

  it('keeps the excluded (being-rescheduled) booking from blocking', () => {
    expect(filterBookingBlocks(day, [other], ['apt-other'])).toHaveLength(8);
  });
});

describe('filterBeforeNotice', () => {
  const july6 = new Date(Date.UTC(2026, 6, 6, 12));
  const day = generateCandidateSlots(NY, july6, july6);

  it('drops slots in the past even with zero notice', () => {
    const now = Date.UTC(2026, 6, 6, 18, 30); // 10:30 EDT
    const out = filterBeforeNotice(day, now, 0);
    expect(out.every((s) => s.getTime() >= now)).toBe(true);
  });

  it('enforces a minimum notice window', () => {
    const now = Date.UTC(2026, 6, 6, 18, 30); // 10:30 EDT
    const out = filterBeforeNotice(day, now, 120);
    const earliest = now + 120 * 60_000;
    expect(out.every((s) => s.getTime() >= earliest)).toBe(true); // 12:30 EDT -> 13:00 onward
  });
});

describe('pickOfferedSlots', () => {
  const monday = new Date(Date.UTC(2026, 6, 6, 12));
  const slots: AvailableSlot[] = generateCandidateSlots(NY, monday, monday)
    .map((s) => ({ startTime: s, endTime: new Date(s.getTime() + 3600_000) }))
    .concat(
      generateCandidateSlots(
        NY,
        new Date(Date.UTC(2026, 6, 7, 12)),
        new Date(Date.UTC(2026, 6, 7, 12)),
      ).map((s) => ({ startTime: s, endTime: new Date(s.getTime() + 3600_000) })),
    );

  it('spreads the 3 offers across distinct days', () => {
    const offers = pickOfferedSlots(slots, 'America/New_York');
    expect(offers).toHaveLength(3);
    // Day-spread first (one offer per day), then earliest remaining slot.
    expect(offers.map((o) => o.startTime.slice(0, 10))).toEqual([
      '2026-07-06',
      '2026-07-07',
      '2026-07-06', // top-up: earliest remaining (day-1 10:00 EDT)
    ]);
    expect(offers[0].startTime).toBe('2026-07-06T13:00:00.000Z');
  });

  it('groups by UTC date when no timezone is given', () => {
    const offers = pickOfferedSlots(slots);
    expect(offers).toHaveLength(3);
    expect(offers[0].optionNumber).toBe(1);
  });

  it('returns fewer offers than 3 when the pool is small', () => {
    const offers = pickOfferedSlots(slots.slice(0, 2));
    expect(offers).toHaveLength(2);
    expect(offers[1].optionNumber).toBe(2);
  });
});

describe('createSchedulingEngine().getAvailableSlots', () => {
  // Future wall-clock dates so the minimum-notice filter never wipes the pool.
  const DAY_MS = 24 * 3600_000;
  const base = new Date(Date.now() + DAY_MS);
  const from = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 12);
  const to = new Date(from.getTime() + DAY_MS);
  const client = {
    events: { list: async () => ({ data: { items: [] } }) },
    freebusy: { query: async () => ({ data: { calendars: {} } }) },
  } as unknown as import('./calendar-service.js').CalendarClient;
  const authOk = async () => ({ client, calendarId: 'primary' });
  const freeBusyEmpty = async () => ({ data: { calendars: { primary: { busy: [] } } } });
  const listEmpty = async () => ({ data: { items: [] } });

  function engine(config?: Parameters<typeof createSchedulingEngine>[0]): SchedulingEngine {
    return createSchedulingEngine(config);
  }

  it('returns tz-correct slots with no blocking', async () => {
    const result = await engine().getAvailableSlots(
      'user-1', 'primary', NY, [], from, to, authOk, freeBusyEmpty, listEmpty, 20,
    );
    expect(result.errors).toEqual([]);
    expect(result.slots).toHaveLength(16);
  });

  it('filters busy periods and other bookings end-to-end', async () => {
    // Day-1 09:00 EDT slot is busy; day-2 09:00 EDT is a confirmed booking.
    const day1Nine = generateCandidateSlots(NY, from, from)[0];
    const day2Nine = generateCandidateSlots(NY, to, to)[0];
    const busy = async () => ({
      data: {
        calendars: {
          primary: {
            busy: [{ start: day1Nine.toISOString(), end: new Date(day1Nine.getTime() + 3600_000).toISOString() }],
          },
        },
      },
    });
    const result = await engine({ minimumNoticeMinutes: 0 }).getAvailableSlots(
      'user-1', 'primary', NY,
      [booking('apt-x', day2Nine.toISOString(), new Date(day2Nine.getTime() + 3600_000).toISOString())],
      from, to, authOk, busy, listEmpty, 20,
    );
    expect(result.slots).toHaveLength(14);
    const starts = result.slots.map((s) => s.startTime.toISOString());
    expect(starts).not.toContain(day1Nine.toISOString());
    expect(starts).not.toContain(day2Nine.toISOString());
  });

  it('excludes the being-rescheduled booking via excludeBookingIds', async () => {
    const day2Nine = generateCandidateSlots(NY, to, to)[0];
    const result = await engine().getAvailableSlots(
      'user-1', 'primary', NY,
      [booking('apt-mine', day2Nine.toISOString(), new Date(day2Nine.getTime() + 3600_000).toISOString())],
      from, to, authOk, freeBusyEmpty, listEmpty, 20, { excludeBookingIds: ['apt-mine'] },
    );
    expect(result.slots).toHaveLength(16);
  });

  it('applies minimum notice from the engine config', async () => {
    const result = await (
      createSchedulingEngine({ minimumNoticeMinutes: 120 }).getAvailableSlots as SchedulingEngine['getAvailableSlots']
    )(
      'user-1', 'primary', NY, [], from, to, authOk, freeBusyEmpty, listEmpty, 20,
    );
    const now = Date.now();
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.slots.every((s) => s.startTime.getTime() >= now + 120 * 60_000)).toBe(true);
  });

  it('returns errors and no slots when auth fails', async () => {
    const badAuth = async () => {
      throw new Error('no refresh token');
    };
    const result = await engine().getAvailableSlots(
      'user-1', '', NY, [], from, to, badAuth, freeBusyEmpty, listEmpty,
    );
    expect(result.slots).toEqual([]);
    expect(result.errors[0]?.type).toBe('calendar_api_error');
  });

  it('records free/busy failure but still returns generated slots', async () => {
    const badBusy = async () => {
      throw new Error('freebusy down');
    };
    const result = await engine().getAvailableSlots(
      'user-1', 'primary', NY, [], from, to, authOk, badBusy, listEmpty,
    );
    expect(result.errors[0]?.type).toBe('calendar_api_error');
    expect(result.slots.length).toBeGreaterThan(0);
  });
});
