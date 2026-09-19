/**
 * Booking/appointment domain service (CP04).
 *
 * Replaces the worker's TODO stubs with real lookups:
 *   findBookingById   — booking from rl_appointments by id (org-scoped)
 *   findBookingByPhone — most recent booking for a customer phone (org-scoped)
 *   findUserProfile    — tradesperson row from rl_tradespeople → shared User
 *
 * Env-free boot: DATABASE_URL read on first use (same pattern as
 * conversation-domain.ts / conversation-service.ts). Mocks swap the pool via
 * vi.mock('pg') in tests.
 */

import { Pool } from 'pg';
import type { Booking, BusinessHours, User } from '@tradescheduler/shared';

// ---------------------------------------------------------------------------
// Lazy pool
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

// ---------------------------------------------------------------------------
// Row types (rl_appointments)
// ---------------------------------------------------------------------------

interface AppointmentRow {
  id: string;
  organization_id: string;
  user_id: string;
  customer_phone: string;
  customer_name: string | null;
  service_description: string | null;
  start_time: Date;
  end_time: Date;
  status: Booking['status'];
  deposit_amount: string | null;
  deposit_status: string;
  google_calendar_event_id: string | null;
  rescheduled_from_id: string | null;
}

function rowToBooking(row: AppointmentRow): Booking {
  return {
    id: row.id,
    userId: row.user_id,
    customerPhone: row.customer_phone,
    customerName: row.customer_name ?? '',
    serviceDescription: row.service_description ?? '',
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
    status: row.status,
    depositStatus: row.deposit_status,
    googleCalendarEventId: row.google_calendar_event_id,
    smsHistory: [],
    rescheduledFromId: row.rescheduled_from_id,
    rescheduleLog: [],
  };
}

const APPOINTMENT_COLUMNS = `
  id, organization_id, user_id, customer_phone, customer_name,
  service_description, start_time, end_time, status,
  deposit_amount, deposit_status, google_calendar_event_id, rescheduled_from_id
`;

// ---------------------------------------------------------------------------
// Booking lookups
// ---------------------------------------------------------------------------

/** Fetch a single booking by id, scoped to an organization. */
export async function findBookingById(
  organizationId: string,
  bookingId: string,
): Promise<Booking | null> {
  const { rows } = await getPool().query<AppointmentRow>(
    `select ${APPOINTMENT_COLUMNS}
       from public.rl_appointments
      where id = $1 and organization_id = $2`,
    [bookingId, organizationId],
  );
  return rows[0] ? rowToBooking(rows[0]) : null;
}

/** Most recent booking for a customer phone, scoped to an organization. */
export async function findBookingByPhone(
  organizationId: string,
  phone: string,
): Promise<Booking | null> {
  const { rows } = await getPool().query<AppointmentRow>(
    `select ${APPOINTMENT_COLUMNS}
       from public.rl_appointments
      where organization_id = $1 and customer_phone = $2
      order by start_time desc
      limit 1`,
    [organizationId, phone],
  );
  return rows[0] ? rowToBooking(rows[0]) : null;
}

/**
 * Bookings that overlap the [fromIso, toIso) window for a user
 * (org-scoped). Only pending/confirmed appointments count as blockers.
 * Ordered by start_time ascending. Uses strict-overlap semantics
 * (start_time < windowEnd AND end_time > windowStart) so boundary-touching
 * appointments are excluded.
 */
export async function findUserBookingsInWindow(
  organizationId: string,
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<Booking[]> {
  const { rows } = await getPool().query<AppointmentRow>(
    `select ${APPOINTMENT_COLUMNS}
       from public.rl_appointments
      where organization_id = $1
        and user_id = $2
        and status in ('pending', 'confirmed')
        and start_time < $3
        and end_time > $4
      order by start_time asc`,
    [organizationId, userId, toIso, fromIso],
  );
  return rows.map(rowToBooking);
}

// ---------------------------------------------------------------------------
// Booking update (persist a confirmed reschedule)
// ---------------------------------------------------------------------------

export interface BookingStatusPatch {
  startTime: string;
  endTime: string;
  status: Booking['status'];
  googleCalendarEventId: string | null;
}

/**
 * Persist the confirmed reschedule on rl_appointments (org-scoped).
 * Returns the updated Booking, or null when the row does not exist.
 */
export async function updateBookingTimes(
  organizationId: string,
  bookingId: string,
  patch: BookingStatusPatch,
): Promise<Booking | null> {
  const { rows } = await getPool().query<AppointmentRow>(
    `update public.rl_appointments
        set start_time = $1,
            end_time = $2,
            status = $3,
            google_calendar_event_id = $4,
            updated_at = now()
      where id = $5 and organization_id = $6
      returning ${APPOINTMENT_COLUMNS}`,
    [patch.startTime, patch.endTime, patch.status, patch.googleCalendarEventId, bookingId, organizationId],
  );
  return rows[0] ? rowToBooking(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Tradesperson profile lookup
// ---------------------------------------------------------------------------

interface TradespersonRow {
  id: string;
  phone_number: string | null;
  google_calendar_id: string | null;
  business_hours: BusinessHours | null;
  sms_reschedule_template: string | null;
}

const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  start: '09:00',
  end: '17:00',
  timezone: 'America/New_York',
};

const DEFAULT_RESCHEDULE_TEMPLATE =
  'You can reschedule your booking. Here are 3 available times: ' +
  '1) {{slot1}} 2) {{slot2}} 3) {{slot3}}. Reply with the number of your choice.';

/** Tradesperson profile → shared User shape (CP04 userLookupFn). */
export async function findUserProfile(userId: string): Promise<User | null> {
  const { rows } = await getPool().query<TradespersonRow>(
    `select id, phone_number, google_calendar_id, business_hours, sms_reschedule_template
       from public.rl_tradespeople
      where id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    phoneNumber: row.phone_number ?? '',
    googleCalendarId: row.google_calendar_id,
    businessHours: row.business_hours ?? DEFAULT_BUSINESS_HOURS,
    smsSettings: {
      rescheduleTemplate: row.sms_reschedule_template ?? DEFAULT_RESCHEDULE_TEMPLATE,
    },
  };
}

/** Sets the tradesperson's google_calendar_id (connect/disconnect bookkeeping).
 *  `calendarId` null clears it. Returns false when the user row doesn't exist. */
export async function setUserGoogleCalendarId(
  userId: string,
  calendarId: string | null,
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `update public.rl_tradespeople
        set google_calendar_id = $2
      where id = $1`,
    [userId, calendarId],
  );
  return (rowCount ?? 0) > 0;
}
