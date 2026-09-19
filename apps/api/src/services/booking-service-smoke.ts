/**
 * One-off smoke: booking-service lookups against real Postgres (CP04).
 * Inserts a tradesperson + appointment, exercises all three lookups, cleans up.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { findBookingById, findBookingByPhone, findUserProfile, updateBookingTimes } from './booking-service.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const orgId = randomUUID();
const userId = randomUUID();
const aptId = randomUUID();

try {
  await pool.query(
    `insert into public.rl_organizations (id, name, slug, timezone, status)
     values ($1, 'E2E Booking Org', 'e2e-booking-org', 'America/New_York', 'active')`,
    [orgId],
  );
  await pool.query(
    `insert into public.rl_tradespeople (id, email, password_hash, display_name,
       phone_number, google_calendar_id, business_hours, sms_reschedule_template)
     values ($1, lower($2), 'x', 'E2E Tech', '+15558880000', 'primary',
       '{"start":"08:00","end":"16:00","timezone":"America/New_York"}'::jsonb,
       'Pick: {{slot1}} / {{slot2}} / {{slot3}}')`,
    [userId, `e2e-${Date.now()}@tradescheduler.test`],
  );
  await pool.query(
    `insert into public.rl_appointments
       (id, organization_id, user_id, customer_phone, customer_name,
        service_description, start_time, end_time, status, deposit_status)
     values ($1, $2, $3, '+15551234567', 'Sam', 'drain fix',
       '2026-09-25T14:00:00Z', '2026-09-25T15:00:00Z', 'pending', 'paid')`,
    [aptId, orgId, userId],
  );

  const byId = await findBookingById(orgId, aptId);
  const byPhone = await findBookingByPhone(orgId, '+15551234567');

  // CP04 confirm leg: persist status='confirmed' + new times + event id.
  const confirmed = await updateBookingTimes(orgId, aptId, {
    startTime: '2026-09-26T09:30:00Z',
    endTime: '2026-09-26T10:30:00Z',
    status: 'confirmed',
    googleCalendarEventId: 'cal-evt-e2e-1',
  });
  const reread = await findBookingById(orgId, aptId);
  const wrongOrgPersist = await updateBookingTimes('00000000-0000-0000-0000-000000000000', aptId, {
    startTime: '2026-09-26T09:30:00Z',
    endTime: '2026-09-26T10:30:00Z',
    status: 'confirmed',
    googleCalendarEventId: 'cal-evt-e2e-1',
  });
  const byPhoneWrongOrg = await findBookingByPhone('00000000-0000-0000-0000-000000000000', '+15551234567');
  const user = await findUserProfile(userId);

  const ok =
    byId?.id === aptId &&
    byId?.customerName === 'Sam' &&
    byPhone?.id === aptId &&
    byPhoneWrongOrg === null &&
    user?.googleCalendarId === 'primary' &&
    user?.businessHours.start === '08:00' &&
    confirmed?.status === 'confirmed' &&
    confirmed?.googleCalendarEventId === 'cal-evt-e2e-1' &&
    confirmed?.startTime === '2026-09-26T09:30:00.000Z' &&
    reread?.status === 'confirmed' &&
    wrongOrgPersist === null;

  console.log('byId:', byId?.id, '| byPhone:', byPhone?.id, '| wrongOrg:', byPhoneWrongOrg, '| user:', user?.googleCalendarId, user?.businessHours.start, '| confirmed:', confirmed?.status, confirmed?.googleCalendarEventId, '| reread:', reread?.status, '| wrongOrgPersist:', wrongOrgPersist);
  console.log(ok ? '[SMOKE] ALL BOOKING LOOKUPS PASSED' : '[SMOKE] FAILED');
} finally {
  await pool.query('delete from public.rl_appointments where id = $1', [aptId]);
  await pool.query('delete from public.rl_tradespeople where id = $1', [userId]);
  await pool.query('delete from public.rl_organizations where id = $1', [orgId]);
  await pool.end();
}
