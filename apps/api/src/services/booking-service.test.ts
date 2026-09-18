import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Unit tests for booking-service (CP04) with a mocked `pg` Pool. */
const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
  },
}));

const DATABASE_URL = 'postgres://user:pass@localhost:5432/tradescheduler_test';

async function loadService() {
  return await import('./booking-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

const T0 = new Date('2026-09-18T14:00:00.000Z');
const T1 = new Date('2026-09-18T15:30:00.000Z');

function appointmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'apt-1',
    organization_id: 'org-1',
    user_id: 'user-1',
    customer_phone: '+15551234567',
    customer_name: 'Sam Customer',
    service_description: 'fix drain',
    start_time: T0,
    end_time: T1,
    status: 'pending',
    deposit_amount: '50.00',
    deposit_status: 'paid',
    google_calendar_event_id: null,
    rescheduled_from_id: null,
    ...overrides,
  };
}

describe('booking-service', () => {
  describe('updateBookingTimes', () => {
    it('persists the confirmed reschedule and returns the updated Booking', async () => {
      mocks.query.mockResolvedValue({ rows: [appointmentRow({ status: 'confirmed', start_time: new Date('2026-09-25T14:00:00.000Z'), end_time: new Date('2026-09-25T15:00:00.000Z'), google_calendar_event_id: 'cal-evt-1' })] });

      const svc = await loadService();
      const updated = await svc.updateBookingTimes('org-1', 'apt-1', {
        startTime: '2026-09-25T14:00:00.000Z',
        endTime: '2026-09-25T15:00:00.000Z',
        status: 'confirmed',
        googleCalendarEventId: 'cal-evt-1',
      });

      expect(updated?.id).toBe('apt-1');
      expect(updated?.status).toBe('confirmed');
      expect(updated?.googleCalendarEventId).toBe('cal-evt-1');
      // Org-scoped WHERE: update must not leak across tenants.
      const params = mocks.query.mock.calls[0][1] as unknown[];
      expect(params[4]).toBe('apt-1');
      expect(params[5]).toBe('org-1');
    });

    it('returns null when no row matches (org-scoped miss)', async () => {
      mocks.query.mockResolvedValue({ rows: [] });

      const svc = await loadService();
      const updated = await svc.updateBookingTimes('other-org', 'apt-1', {
        startTime: '2026-09-25T14:00:00.000Z',
        endTime: '2026-09-25T15:00:00.000Z',
        status: 'confirmed',
        googleCalendarEventId: null,
      });

      expect(updated).toBeNull();
    });
  });

  describe('findUserBookingsInWindow', () => {
    it('queries org-scoped overlap semantics with (toIso, fromIso) params and maps rows', async () => {
      const svc = await loadService();
      const aptB = { ...appointmentRow(), id: 'apt-b', start_time: new Date('2026-09-25T10:00:00.000Z'), end_time: new Date('2026-09-25T11:00:00.000Z') };
      mocks.query.mockResolvedValue({ rows: [appointmentRow(), aptB] });

      const bookings = await svc.findUserBookingsInWindow('org-1', 'user-1', '2026-09-24T00:00:00.000Z', '2026-09-26T00:00:00.000Z');

      const sql = mocks.query.mock.calls[0][0] as string;
      expect(sql).toContain('organization_id = $1');
      expect(sql).toContain('user_id = $2');
      expect(sql).toContain('start_time < $3');
      expect(sql).toContain('end_time > $4');
      expect(sql).toContain("status in ('pending', 'confirmed')");
      expect(mocks.query.mock.calls[0][1]).toEqual(['org-1', 'user-1', '2026-09-26T00:00:00.000Z', '2026-09-24T00:00:00.000Z']);
      expect(bookings).toHaveLength(2);
      expect(bookings[0].id).toBe('apt-1');
      expect(bookings[1].id).toBe('apt-b');
    });

    it('returns an empty array when no bookings overlap the window', async () => {
      const svc = await loadService();
      mocks.query.mockResolvedValue({ rows: [] });

      const bookings = await svc.findUserBookingsInWindow('org-1', 'user-1', '2026-09-24T00:00:00.000Z', '2026-09-26T00:00:00.000Z');

      expect(bookings).toEqual([]);
    });
  });

  describe('findBookingById', () => {
    it('returns the mapped Booking when found (org-scoped)', async () => {
      const svc = await loadService();
      mocks.query.mockResolvedValue({ rows: [appointmentRow()] });

      const booking = await svc.findBookingById('org-1', 'apt-1');

      expect(booking).toMatchObject({
        id: 'apt-1',
        userId: 'user-1',
        customerPhone: '+15551234567',
        customerName: 'Sam Customer',
        startTime: T0.toISOString(),
        endTime: T1.toISOString(),
        status: 'pending',
        depositStatus: 'paid',
        googleCalendarEventId: null,
        smsHistory: [],
        rescheduleLog: [],
      });
      const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('from public.ts_appointments');
      expect(sql).toContain('id = $1 and organization_id = $2');
      expect(params).toEqual(['apt-1', 'org-1']);
    });

    it('returns null when no row matches', async () => {
      const svc = await loadService();
      mocks.query.mockResolvedValue({ rows: [] });

      await expect(svc.findBookingById('org-1', 'missing')).resolves.toBeNull();
    });
  });

  describe('findBookingByPhone', () => {
    it('returns the most recent booking (start_time desc, limit 1)', async () => {
      const svc = await loadService();
      mocks.query.mockResolvedValue({ rows: [appointmentRow({ id: 'apt-latest' })] });

      const booking = await svc.findBookingByPhone('org-1', '+15551234567');

      expect(booking?.id).toBe('apt-latest');
      const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('order by start_time desc');
      expect(sql).toContain('limit 1');
      expect(params).toEqual(['org-1', '+15551234567']);
    });

    it('returns null when the phone has no bookings', async () => {
      const svc = await loadService();
      mocks.query.mockResolvedValue({ rows: [] });

      await expect(svc.findBookingByPhone('org-1', '+15559999999')).resolves.toBeNull();
    });
  });

  describe('findUserProfile', () => {
    it('maps the tradesperson row to the shared User shape', async () => {
      const svc = await loadService();
      mocks.query.mockResolvedValue({
        rows: [{
          id: 'user-1',
          phone_number: '+15558880000',
          google_calendar_id: 'primary',
          business_hours: { start: '08:00', end: '16:00', timezone: 'America/Chicago' },
          sms_reschedule_template: 'Pick a time: {{slot1}} / {{slot2}} / {{slot3}}',
        }],
      });

      const user = await svc.findUserProfile('user-1');

      expect(user).toEqual({
        id: 'user-1',
        phoneNumber: '+15558880000',
        googleCalendarId: 'primary',
        businessHours: { start: '08:00', end: '16:00', timezone: 'America/Chicago' },
        smsSettings: { rescheduleTemplate: 'Pick a time: {{slot1}} / {{slot2}} / {{slot3}}' },
      });
    });

    it('falls back to defaults when profile columns are null', async () => {
      const svc = await loadService();
      mocks.query.mockResolvedValue({
        rows: [{
          id: 'user-2',
          phone_number: null,
          google_calendar_id: null,
          business_hours: null,
          sms_reschedule_template: null,
        }],
      });

      const user = await svc.findUserProfile('user-2');

      expect(user?.googleCalendarId).toBeNull();
      expect(user?.businessHours).toEqual({ start: '09:00', end: '17:00', timezone: 'America/New_York' });
      expect(user?.smsSettings.rescheduleTemplate).toContain('{{slot1}}');
    });

    it('returns null for an unknown user', async () => {
      const svc = await loadService();
      mocks.query.mockResolvedValue({ rows: [] });

      await expect(svc.findUserProfile('nope')).resolves.toBeNull();
    });
  });
});
