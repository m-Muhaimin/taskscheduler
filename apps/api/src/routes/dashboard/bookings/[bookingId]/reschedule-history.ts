import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { RescheduleHistoryResponse } from '@tradescheduler/shared';

const router = Router();

// ── JWT auth (inline — mirrors the escalations guard) ────────────────────
const JWT_SECRET = process.env.JWT_SECRET ?? '';
const JWT_ISSUER = process.env.JWT_ISSUER ?? 'tradescheduler';

function authorize(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    _res.status(401).json({ error: 'missing_token' });
    return;
  }
  const token = header.slice(7);
  if (!JWT_SECRET) {
    _res.status(500).json({ error: 'server_not_configured' });
    return;
  }
  try {
    jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER });
    next();
  } catch {
    _res.status(401).json({ error: 'invalid_token' });
  }
}

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

router.get('/:bookingId/reschedule-history', authorize, (req, res) => {
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
