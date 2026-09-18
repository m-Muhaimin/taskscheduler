import { Router } from 'express';
import { escalationsRouter } from './escalations.js';
import { bookingsRouter } from './bookings/[bookingId]/reschedule-history.js';

/** Dashboard API routes (Step 9):
 *  - GET  /api/dashboard/escalations
 *  - GET  /api/dashboard/bookings/:bookingId/reschedule-history
 *  Both are JWT-protected (Bearer token in Authorization header).
 */
export function mountDashboardRoutes(app: import('express').Express): void {
  app.use('/api/dashboard/escalations', escalationsRouter);
  app.use('/api/dashboard/bookings', bookingsRouter);
}
