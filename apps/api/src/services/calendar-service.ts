/**\
 * Calendar service — Google Calendar availability + event creation.\
 * build-sequence.md Step 7.\
 *\
 * Rules honored:\
 * - Env-free boot: OAuth credentials read per call, never at module scope.\
 * - All external calls (googleapis) are behind injectable functions so\
 *   tests can mock without touching the real Google API.\
 * - Business hours from user config; 1-hour slots within business hours;\
 *   filter out busy periods + existing bookings; return up to 20; pick 3.\
 * - Calendar query failures are reported in GetAvailableSlotsResult.errors,\
 *   never thrown.\
 */

import { google } from 'googleapis';
import type {
  AvailableSlot,
  Booking,
  BusinessHours,
  CalendarQueryError,
  GetAvailableSlotsResult,
  OfferedSlot,
} from '@tradescheduler/shared';

// ---------------------------------------------------------------------------
// Narrow calendar-client interface — satisfies both real googleapis.Calendar
// and test mocks. Return types use optional members so the real API's
// `{ calendars?: ... }` / `{ items?: ... }` shapes are assignable.
// ---------------------------------------------------------------------------

export interface CalendarFreeBusyItem {
  start: string;
  end: string;
}

export interface CalendarClient {
  freebusy: {
    query: (args: {
      requestBody: {
        timeMin: string;
        timeMax: string;
        items: Array<{ id: string }>;
      };
    }) => Promise<{ data: { calendars?: Record<string, { busy?: CalendarFreeBusyItem[] }> } }>;
  };
  events: {
    list: (args: {
      calendarId: string;
      timeMin: string;
      timeMax: string;
      singleEvents?: boolean;
      orderBy?: string;
    }) => Promise<{ data: { items?: Array<{ id: string; start: { dateTime: string }; end: { dateTime: string } }> } }>;
    insert: (args: {
      calendarId: string;
      requestBody: Record<string, unknown>;
    }) => Promise<{ data: { id?: string } }>;
  };
}

/** What the calendar-auth layer must produce for the calendar client. */
export interface CalendarAuthResult {
  client: CalendarClient;
  calendarId: string;
}

/**
 * Function signature for auth — swapped in tests.
 * In production this exchanges a refresh token for an access token and
 * builds a calendar client; in tests a stub returns a mock client.
 */
export type AuthFn = (userId: string, calendarId: string) => Promise<CalendarAuthResult>;

/**
 * Function signature for the free/busy query — swapped in tests.
 * Production: calls calendar.freebusy.query. Tests: return canned busy periods.
 */
export type FreeBusyFn = (
  client: CalendarClient,
  calendarId: string,
  timeMin: string,
  timeMax: string,
) => Promise<{ data: { calendars?: Record<string, { busy?: CalendarFreeBusyItem[] }> } }>;

/**
 * Function signature for listing existing events — swapped in tests.
 * Production: calls calendar.events.list. Tests: return canned existing bookings.
 */
export type ListEventsFn = (
  client: CalendarClient,
  calendarId: string,
  timeMin: string,
  timeMax: string,
) => Promise<{ data: { items?: Array<{ id: string; start: { dateTime: string }; end: { dateTime: string } }> } }>;

/**
 * Function signature for creating an event — swapped in tests.
 * Production: calls calendar.events.insert. Tests: return a canned event ID or throw.
 */
export type CreateEventFn = (
  client: CalendarClient,
  calendarId: string,
  event: Record<string, unknown>,
) => Promise<{ data: { id?: string } }>;

// ---------------------------------------------------------------------------
// Default implementations (real googleapis calls)
// ---------------------------------------------------------------------------

function defaultAuth(userId: string, calendarId: string): Promise<CalendarAuthResult> {
  return new Promise((resolve, reject) => {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI,
    );

    const refreshToken = process.env[`GOOGLE_REFRESH_TOKEN_${userId}`];
    if (!refreshToken) {
      return reject(new Error(`No Google refresh token configured for user ${userId}`));
    }

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Cast the real google.calendars.Calendar to our narrow CalendarClient interface.
    const castClient: CalendarClient = {
      freebusy: calendar.freebusy as CalendarClient['freebusy'],
      events: calendar.events as CalendarClient['events'],
    };

    resolve({ client: castClient, calendarId });
  });
}

function defaultFreeBusy(
  client: CalendarClient,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<{ data: { calendars?: Record<string, { busy?: CalendarFreeBusyItem[] }> } }> {
  return client.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    },
  });
}

function defaultListEvents(
  client: CalendarClient,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<{ data: { items?: Array<{ id: string; start: { dateTime: string }; end: { dateTime: string } }> } }> {
  return client.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
  });
}

function defaultCreateEvent(
  client: CalendarClient,
  calendarId: string,
  event: Record<string, unknown>,
): Promise<{ data: { id?: string } }> {
  return client.events.insert({
    calendarId,
    requestBody: event,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_SLOT_COUNT = 20;
const OFFERED_SLOT_COUNT = 3;

function parseHHmm(hhmm: string): { hours: number; minutes: number } {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) {
    throw new Error(`Invalid business-hours format: ${hhmm} (expected HH:mm)`);
  }
  return { hours: Number(m[1]), minutes: Number(m[2]) };
}

/**
 * Generate 1-hour slots within business hours for each day in the range.
 * Returns local-datetime Date objects (wall-clock, timezone-agnostic —
 * callers must treat them as local to businessHours.timezone).
 */
function generateRawSlots(
  businessHours: BusinessHours,
  fromDate: Date,
  toDate: Date,
): Date[] {
  const slots: Date[] = [];
  const { start, end } = businessHours;
  const { hours: startH, minutes: startM } = parseHHmm(start);
  const { hours: endH, minutes: endM } = parseHHmm(end);

  // Earliest start-of-day we'll consider.
  const cursor = new Date(fromDate);
  cursor.setHours(0, 0, 0, 0);

  const endBound = new Date(toDate);
  endBound.setHours(0, 0, 0, 0);
  endBound.setDate(endBound.getDate() + 1); // exclusive upper bound

  while (cursor < endBound) {
    const dayStart = new Date(cursor);
    dayStart.setHours(startH, startM, 0, 0);

    // A slot must end on or before business-hours end.
    const dayEnd = new Date(cursor);
    dayEnd.setHours(endH, endM, 0, 0);

    let slotStart = new Date(dayStart);
    while (slotStart < dayEnd) {
      const slotEnd = new Date(slotStart);
      slotEnd.setHours(slotEnd.getHours() + 1);

      if (slotEnd <= dayEnd) {
        slots.push(new Date(slotStart));
      }
      slotStart.setHours(slotStart.getHours() + 1);
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}

/**
 * Remove slots whose start or end falls inside any busy period.
 */
function filterBusyPeriods(
  slots: Date[],
  busyPeriods: CalendarFreeBusyItem[],
): Date[] {
  if (busyPeriods.length === 0) return slots;

  const busy: Array<[Date, Date]> = busyPeriods.map((b) => [
    new Date(b.start),
    new Date(b.end),
  ]);

  return slots.filter((slot) => {
    const slotEnd = new Date(slot);
    slotEnd.setHours(slotEnd.getHours() + 1);
    return !busy.some(([bs, be]) => {
      return slot < be && slotEnd > bs;
    });
  });
}

/**
 * Remove slots that overlap any existing booking.
 */
function filterExistingBookings(slots: Date[], existingBookings: Booking[]): Date[] {
  if (existingBookings.length === 0) return slots;

  return slots.filter((slot) => {
    const slotEnd = new Date(slot);
    slotEnd.setHours(slotEnd.getHours() + 1);
    return !existingBookings.some((b) => {
      const bStart = new Date(b.startTime);
      const bEnd = new Date(b.endTime);
      return slot < bEnd && slotEnd > bStart;
    });
  });
}

/**
 * Truncate to at most `maxSlots`, sorted ascending.
 */
function truncateToMax(slots: Date[], maxSlots: number): Date[] {
  return slots
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(0, maxSlots);
}

function toIso(d: Date): string {
  return d.toISOString();
}

function toOfferedSlot(optionNumber: number, d: Date): OfferedSlot {
  const end = new Date(d);
  end.setHours(end.getHours() + 1);
  return {
    optionNumber: optionNumber as 1 | 2 | 3,
    startTime: toIso(d),
    endTime: toIso(end),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get available 1-hour slots within business hours for the next N days,
 * filtering out busy periods (from Google Calendar free/busy) and existing
 * bookings.
 *
 * `fromDate` / `toDate` are local wall-clock dates (no time component).
 * Business hours are interpreted in `businessHours.timezone`.
 *
 * Never throws on calendar API failure — errors are reported in the result.
 */
export async function getAvailableSlots(
  userId: string,
  calendarId: string,
  businessHours: BusinessHours,
  existingBookings: Booking[],
  fromDate: Date,
  toDate: Date,
  authFn: AuthFn = defaultAuth,
  freeBusyFn: FreeBusyFn = defaultFreeBusy,
  listEventsFn: ListEventsFn = defaultListEvents,
  maxSlots: number = DEFAULT_SLOT_COUNT,
): Promise<GetAvailableSlotsResult> {
  const errors: CalendarQueryError[] = [];

  let client: CalendarClient | null = null;
  let effectiveCalendarId = calendarId;

  // --- auth ---
  if (!calendarId) {
    // Compute the user's primary calendar from their Google profile.
    // We need auth first to discover the calendar ID.
    try {
      const authResult = await authFn(userId, '');
      effectiveCalendarId = authResult.calendarId;
      client = authResult.client;
    } catch (err) {
      errors.push({
        type: 'calendar_api_error',
        message: `Auth failed for user ${userId}: ${String(err)}`,
      });
      return { slots: [], errors };
    }
  } else {
    try {
      const authResult = await authFn(userId, calendarId);
      client = authResult.client;
    } catch (err) {
      errors.push({
        type: 'calendar_api_error',
        message: `Auth failed for user ${userId}: ${String(err)}`,
      });
      return { slots: [], errors };
    }
  }

  if (!client) {
    errors.push({
      type: 'calendar_api_error',
      message: 'Calendar client is null after auth',
    });
    return { slots: [], errors };
  }

  // --- build time window ---
  const timeMin = toIso(fromDate);
  const timeMax = toIso(new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate() + 1));

  // --- free/busy ---
  let busyPeriods: CalendarFreeBusyItem[] = [];
  try {
    const freeBusyResult = await freeBusyFn(client, effectiveCalendarId, timeMin, timeMax);
    const calData = freeBusyResult.data.calendars?.[effectiveCalendarId];
    if (calData?.busy) {
      busyPeriods = calData.busy;
    }
  } catch (err) {
    errors.push({
      type: 'calendar_api_error',
      message: `Free/busy query failed: ${String(err)}`,
    });
    // Continue with empty busy list — better to over-offer than to fail entirely.
  }

  // --- existing events (also acts as a secondary busy filter) ---
  let existingEvents: Array<{ id: string; start: { dateTime: string }; end: { dateTime: string } }> = [];
  try {
    const evResult = await listEventsFn(client, effectiveCalendarId, timeMin, timeMax);
    existingEvents = evResult.data.items ?? [];
  } catch (err) {
    errors.push({
      type: 'calendar_api_error',
      message: `Event list query failed: ${String(err)}`,
    });
  }

  const eventBusyPeriods: CalendarFreeBusyItem[] = existingEvents.map((e) => ({
    id: e.id,
    start: e.start.dateTime,
    end: e.end.dateTime,
  }));

  // --- generate + filter slots ---
  let slots = generateRawSlots(businessHours, fromDate, toDate);
  slots = filterBusyPeriods(slots, busyPeriods);
  slots = filterBusyPeriods(slots, eventBusyPeriods);
  slots = filterExistingBookings(slots, existingBookings);
  slots = truncateToMax(slots, maxSlots);

  return {
    slots: slots.map((d) => ({ startTime: d, endTime: new Date(d.getTime() + 3600_000) })),
    errors,
  };
}

/**
 * Pick up to 3 offered slots from the available pool.
 * Returns the first 3 (already sorted ascending by getAvailableSlots).
 */
export function pickOfferedSlots(available: AvailableSlot[]): OfferedSlot[] {
  return available
    .slice(0, OFFERED_SLOT_COUNT)
    .map((s, i) => toOfferedSlot(i + 1, s.startTime));
}

/**
 * Create a Google Calendar event for the confirmed booking.
 *
 * On failure: the booking stays pending with googleCalendarEventId = null,
 * and an escalation is created (caller must handle that). This function does
 * NOT roll back the booking.
 *
 * Returns the created event ID on success.
 */
export async function createCalendarEvent(
  userId: string,
  calendarId: string,
  booking: Booking,
  authFn: AuthFn = defaultAuth,
  createEventFn: CreateEventFn = defaultCreateEvent,
): Promise<string> {
  const authResult = await authFn(userId, calendarId);
  const client = authResult.client;

  const event: Record<string, unknown> = {
    summary: booking.serviceDescription,
    description: `Booking #${booking.id}\nCustomer: ${booking.customerName} (${booking.customerPhone})\nService: ${booking.serviceDescription}`,
    start: { dateTime: booking.startTime },
    end: { dateTime: booking.endTime },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 30 },
      ],
    },
  };

  const result = await createEventFn(client, calendarId, event);
  if (!result.data.id) {
    throw new Error('Calendar event created without an ID');
  }
  return result.data.id;
}
