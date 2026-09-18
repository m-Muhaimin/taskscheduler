/**
 * Scheduling Engine (CP05).
 *
 * Pure, timezone-correct availability core on top of calendar-service.ts:
 *   - Day boundaries are computed in `businessHours.timezone`, never in the
 *     server's local timezone (calendar-service's raw slot generator used the
 *     machine clock and could shift slots on any host whose TZ differs).
 *   - Slots are absolute UTC instants from the moment they are generated.
 *   - Configurable slot duration, buffer around blocked periods, and minimum
 *     notice (a same-day reschedule must not be offered 09:00 when it's 14:30).
 *   - The booking being rescheduled can be excluded from blocking, so its
 *     original time does not shadow the offers.
 *
 * The orchestrator mirrors calendar-service.getAvailableSlots' contract (never
 * throws; API failures land in `errors`) so it can be swapped in as the
 * reschedule flow's default without breaking callers.
 */
import type { BusinessHours, Booking, GetAvailableSlotsResult, OfferedSlot, AvailableSlot } from '@tradescheduler/shared';
import {
  defaultAuth,
  defaultFreeBusy,
  defaultListEvents,
  type AuthFn,
  type FreeBusyFn,
  type ListEventsFn,
  type CalendarClient,
  type CalendarFreeBusyItem,
} from './calendar-service.js';

// ---------------------------------------------------------------------------
// Timezone math (pure)
// ---------------------------------------------------------------------------

const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_MAX_SLOTS = 20;
const OFFERED_SLOT_COUNT = 3;

/** Milliseconds added to a UTC instant to get wall-clock time in `timeZone`. */
export function getTimezoneOffsetMs(instantMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(instantMs))) {
    parts[p.type] = p.value;
  }
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wall - instantMs;
}

/** Wall-clock {year, month (0-based), day} of an instant in `timeZone`. */
export function wallClockParts(
  instantMs: number,
  timeZone: string,
): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(instantMs))) {
    parts[p.type] = p.value;
  }
  return { year: Number(parts.year), month: Number(parts.month) - 1, day: Number(parts.day) };
}

/**
 * The UTC instant of local midnight for the given wall-clock date in
 * `timeZone`. Converges by offset fixed-point iteration; robust across DST
 * (transitions happen at night, outside the business-hours window).
 */
export function zonedMidnightMs(
  year: number,
  monthIndex: number,
  day: number,
  timeZone: string,
): number {
  let guess = Date.UTC(year, monthIndex, day);
  for (let i = 0; i < 3; i++) {
    guess = Date.UTC(year, monthIndex, day) - getTimezoneOffsetMs(guess, timeZone);
  }
  return guess;
}

function parseHHmm(hhmm: string): { hours: number; minutes: number } {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) {
    throw new Error(`Invalid business-hours format: ${hhmm} (expected HH:mm)`);
  }
  return { hours: Number(m[1]), minutes: Number(m[2]) };
}

export interface SlotGenerationOptions {
  /** Length of each offered slot, in minutes. Default 60. */
  slotDurationMinutes?: number;
}

/**
 * Generate candidate slot starts (absolute UTC instants) within business
 * hours, for every wall-clock day in [fromDate, toDate] as seen in
 * `businessHours.timezone`. Slots must fit entirely inside business hours.
 */
export function generateCandidateSlots(
  businessHours: BusinessHours,
  fromDate: Date,
  toDate: Date,
  options: SlotGenerationOptions = {},
): Date[] {
  const durationMs = (options.slotDurationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000;
  const { start, end } = businessHours;
  const { hours: startH, minutes: startM } = parseHHmm(start);
  const { hours: endH, minutes: endM } = parseHHmm(end);
  const startOffsetMs = (startH * 60 + startM) * 60_000;
  const endOffsetMs = (endH * 60 + endM) * 60_000;
  if (endOffsetMs <= startOffsetMs) {
    throw new Error(`Business hours must fit within a single day: ${start}-${end}`);
  }

  const fromParts = wallClockParts(fromDate.getTime(), businessHours.timezone);
  const toParts = wallClockParts(toDate.getTime(), businessHours.timezone);

  const slots: Date[] = [];
  const cursor = new Date(
    zonedMidnightMs(fromParts.year, fromParts.month, fromParts.day, businessHours.timezone),
  );
  const endCursor = new Date(
    zonedMidnightMs(toParts.year, toParts.month, toParts.day, businessHours.timezone),
  );

  while (cursor <= endCursor) {
    const dayStart = cursor.getTime() + startOffsetMs;
    const dayEnd = cursor.getTime() + endOffsetMs;
    for (let t = dayStart; t + durationMs <= dayEnd; t += durationMs) {
      slots.push(new Date(t));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setTime(zonedMidnightMs(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth(),
      cursor.getUTCDate(),
      businessHours.timezone,
    ));
  }

  return slots;
}

export interface BlockedPeriod {
  start: Date;
  end: Date;
}

/**
 * Remove slots overlapping any blocked period, padded by `bufferMinutes` on
 * both sides (travel / cleanup time between jobs).
 */
export function filterBlockedPeriods(
  slots: Date[],
  blocks: BlockedPeriod[],
  bufferMinutes = 0,
  slotDurationMinutes = DEFAULT_DURATION_MINUTES,
): Date[] {
  if (blocks.length === 0) return slots;
  const bufferMs = bufferMinutes * 60_000;
  const durationMs = slotDurationMinutes * 60_000;
  const padded = blocks.map((b) => ({
    start: b.start.getTime() - bufferMs,
    end: b.end.getTime() + bufferMs,
  }));
  return slots.filter((slot) => {
    const s = slot.getTime();
    const e = s + durationMs;
    return !padded.some((b) => s < b.end && e > b.start);
  });
}

/**
 * Remove slots overlapping other bookings (confirmed or pending). The booking
 * being rescheduled can be excluded by id so its old time does not block.
 */
export function filterBookingBlocks(
  slots: Date[],
  bookings: Booking[],
  excludeBookingIds: string[] = [],
  bufferMinutes = 0,
  slotDurationMinutes = DEFAULT_DURATION_MINUTES,
): Date[] {
  const others = bookings.filter((b) => !excludeBookingIds.includes(b.id));
  if (others.length === 0) return slots;
  return filterBlockedPeriods(
    slots,
    others.map((b) => ({ start: new Date(b.startTime), end: new Date(b.endTime) })),
    bufferMinutes,
    slotDurationMinutes,
  );
}

/**
 * Remove slots that start before `now + minimumNoticeMinutes`. A same-day
 * request must never be offered an already-past slot.
 */
export function filterBeforeNotice(
  slots: Date[],
  nowMs: number,
  minimumNoticeMinutes = 0,
): Date[] {
  if (minimumNoticeMinutes <= 0) {
    return slots.filter((s) => s.getTime() >= nowMs);
  }
  const earliest = nowMs + minimumNoticeMinutes * 60_000;
  return slots.filter((s) => s.getTime() >= earliest);
}

function sortAndLimit(slots: Date[], maxSlots: number): Date[] {
  return slots
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(0, maxSlots);
}

// ---------------------------------------------------------------------------
// Offer picking (spread across days)
// ---------------------------------------------------------------------------

/**
 * Pick up to 3 offered slots: the earliest slot of each distinct day first
 * (so offers spread across days instead of clustering at 09:00/10:00/11:00),
 * topped up from the pool's earliest remaining slots.
 *
 * `timeZone` makes the day boundary follow the tradesperson's business
 * timezone; when omitted, slots are grouped by UTC date.
 */
export function pickOfferedSlots(available: AvailableSlot[], timeZone?: string): OfferedSlot[] {
  const keyed = available.map((s) => ({
    slot: s,
    day: timeZone
      ? (() => {
          const p = wallClockParts(s.startTime.getTime(), timeZone);
          return `${p.year}-${p.month}-${p.day}`;
        })()
      : s.startTime.toISOString().slice(0, 10),
  }));

  const byDay = new Map<string, AvailableSlot[]>();
  for (const { slot, day } of keyed) {
    const list = byDay.get(day) ?? [];
    list.push(slot);
    byDay.set(day, list);
  }

  const orderedDays = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const offers: OfferedSlot[] = [];

  for (const [, slots] of orderedDays) {
    if (offers.length >= OFFERED_SLOT_COUNT) break;
    const earliest = slots[0];
    offers.push({
      optionNumber: (offers.length + 1) as 1 | 2 | 3,
      startTime: earliest.startTime.toISOString(),
      endTime: earliest.endTime.toISOString(),
    });
  }

  if (offers.length < OFFERED_SLOT_COUNT) {
    const taken = new Set(offers.map((o) => o.startTime));
    const offeredDays = new Set(offers.map((o) => o.startTime.slice(0, 10)));
    const ordered = keyed.map((i) => i.slot).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    // Prefer a slot on a day we have not offered yet (true spread).
    for (const slot of ordered) {
      if (offers.length >= OFFERED_SLOT_COUNT) break;
      const iso = slot.startTime.toISOString();
      if (taken.has(iso) || offeredDays.has(iso.slice(0, 10))) continue;
      taken.add(iso);
      offeredDays.add(iso.slice(0, 10));
      offers.push({
        optionNumber: (offers.length + 1) as 1 | 2 | 3,
        startTime: iso,
        endTime: slot.endTime.toISOString(),
      });
    }
    // All days covered but still short: fall back to earliest remaining.
    for (const slot of ordered) {
      if (offers.length >= OFFERED_SLOT_COUNT) break;
      const iso = slot.startTime.toISOString();
      if (taken.has(iso)) continue;
      taken.add(iso);
      offers.push({
        optionNumber: (offers.length + 1) as 1 | 2 | 3,
        startTime: iso,
        endTime: slot.endTime.toISOString(),
      });
    }
  }

  return offers;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface SchedulingEngineConfig {
  /** Length of each offered slot, in minutes (default 60). */
  slotDurationMinutes?: number;
  /** Padding around blocked periods on both sides, in minutes (default 0). */
  bufferMinutes?: number;
  /** Never offer a slot starting sooner than this many minutes from now (default 0). */
  minimumNoticeMinutes?: number;
}

export interface AvailabilityOptions {
  /** Bookings that must NOT block availability (the one being rescheduled). */
  excludeBookingIds?: string[];
}

export interface SchedulingEngine {
  getAvailableSlots: (
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
    options?: AvailabilityOptions,
  ) => Promise<GetAvailableSlotsResult>;
  pickOfferedSlots: (available: AvailableSlot[], timeZone?: string) => OfferedSlot[];
}

export function createSchedulingEngine(config: SchedulingEngineConfig = {}): SchedulingEngine {
  const slotDurationMinutes = config.slotDurationMinutes ?? DEFAULT_DURATION_MINUTES;
  const bufferMinutes = config.bufferMinutes ?? 0;
  const minimumNoticeMinutes = config.minimumNoticeMinutes ?? 0;

  async function getAvailableSlots(
    userId: string,
    calendarId: string,
    businessHours: BusinessHours,
    existingBookings: Booking[],
    fromDate: Date,
    toDate: Date,
    authFn: AuthFn = defaultAuth,
    freeBusyFn: FreeBusyFn = defaultFreeBusy,
    listEventsFn: ListEventsFn = defaultListEvents,
    maxSlots: number = DEFAULT_MAX_SLOTS,
    options: AvailabilityOptions = {},
  ): Promise<GetAvailableSlotsResult> {
    const errors: Array<{ type: string; message: string }> = [];

    let client: CalendarClient | null = null;
    let effectiveCalendarId = calendarId;

    try {
      const authResult = await authFn(userId, calendarId);
      client = authResult.client;
      if (!effectiveCalendarId) effectiveCalendarId = authResult.calendarId;
    } catch (err) {
      errors.push({ type: 'calendar_api_error', message: `Auth failed for user ${userId}: ${String(err)}` });
      return { slots: [], errors };
    }

    if (!client) {
      errors.push({ type: 'calendar_api_error', message: 'Calendar client is null after auth' });
      return { slots: [], errors };
    }

    const fromParts = wallClockParts(fromDate.getTime(), businessHours.timezone);
    const toParts = wallClockParts(toDate.getTime(), businessHours.timezone);
    const timeMin = new Date(zonedMidnightMs(fromParts.year, fromParts.month, fromParts.day, businessHours.timezone)).toISOString();
    const timeMaxDate = new Date(zonedMidnightMs(toParts.year, toParts.month, toParts.day, businessHours.timezone));
    timeMaxDate.setUTCDate(timeMaxDate.getUTCDate() + 1); // exclusive upper bound
    const timeMax = timeMaxDate.toISOString();

    let busyPeriods: CalendarFreeBusyItem[] = [];
    try {
      const freeBusyResult = await freeBusyFn(client, effectiveCalendarId, timeMin, timeMax);
      const calData = freeBusyResult.data.calendars?.[effectiveCalendarId];
      if (calData?.busy) busyPeriods = calData.busy;
    } catch (err) {
      errors.push({ type: 'calendar_api_error', message: `Free/busy query failed: ${String(err)}` });
    }

    let eventBlocks: BlockedPeriod[] = [];
    try {
      const evResult = await listEventsFn(client, effectiveCalendarId, timeMin, timeMax);
      eventBlocks = (evResult.data.items ?? []).map((e) => ({
        start: new Date(e.start.dateTime),
        end: new Date(e.end.dateTime),
      }));
    } catch (err) {
      errors.push({ type: 'calendar_api_error', message: `Event list query failed: ${String(err)}` });
    }

    let slots = generateCandidateSlots(businessHours, fromDate, toDate, { slotDurationMinutes });
    slots = filterBlockedPeriods(slots, eventBlocks, bufferMinutes, slotDurationMinutes);
    slots = filterBlockedPeriods(
      slots,
      busyPeriods.map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
      bufferMinutes,
      slotDurationMinutes,
    );
    slots = filterBookingBlocks(slots, existingBookings, options.excludeBookingIds ?? [], bufferMinutes, slotDurationMinutes);
    slots = filterBeforeNotice(slots, Date.now(), minimumNoticeMinutes);
    slots = sortAndLimit(slots, maxSlots);

    return {
      slots: slots.map((s) => ({
        startTime: s,
        endTime: new Date(s.getTime() + slotDurationMinutes * 60_000),
      })),
      errors,
    };
  }

  return {
    getAvailableSlots,
    pickOfferedSlots,
  };
}

/** Default engine (60-minute slots, no buffer, no minimum notice). */
export const schedulingEngine = createSchedulingEngine();
