import { Router } from 'express';
import type { RescheduleHistoryResponse } from '@tradescheduler/shared';
import { requireAuth } from '../../../../middleware/auth.js';

const router = Router();

// ── In-memory reschedule logs keyed by booking id ─────────────────────────
// Replace with a real data-layer query when the data layer lands.
const rescheduleLogs: Record<string, import('@tradescheduler/shared').RescheduleLogEntry[]> = {
  '00000000-0000-4000-8000-000000000010': [
    {
      action: 'reschedule-offer',
      timestamp: '2026-09-14T14:00:00.000Z',
      details: 'Offered Tue 4–6pm, Wed 8–10am, Fri 3–5pm.',
    },
    {
      action: 'reschedule-completed',
      timestamp: '2026-09-14T14:20:00.000Z',
      details: 'Customer confirmed by text.',
    },
  ],
  '00000000-0000-4000-8000-000000000020': [
    {
      action: 'reschedule-completed',
      timestamp: '2026-09-15T09:05:00.000Z',
      details: 'Customer called to move the visit.',
    },
  ],
};

// ── GET /api/dashboard/bookings/:bookingId/reschedule-history ────────────

router.get('/:bookingId/reschedule-history', requireAuth, (req, res) => {
  const bookingId = req.params.bookingId;

  if (typeof bookingId !== 'string' || bookingId.length === 0) {
    res.status(400).json({ error: 'invalid_booking_id' });
    return;
  }

  const log = rescheduleLogs[bookingId] ?? [];

  const response: RescheduleHistoryResponse = {
    bookingId,
    rescheduleLog: log,
  };

  res.json(response);
});

export const bookingsRouter = router;
