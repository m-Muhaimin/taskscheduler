import { Router } from 'express';
import { escalationsRouter } from './escalations.js';
import { bookingsRouter } from './bookings/[bookingId]/reschedule-history.js';
import { summaryRouter } from './summary.js';
import { inboxRouter } from './inbox.js';
import { scheduleRouter } from './schedule.js';
import { jobsRouter } from './jobs.js';
import { customersRouter } from './customers.js';
import { analyticsRouter } from './analytics.js';

/** Dashboard API routes (Step 9 + T2/T3):
 *  - GET  /api/dashboard/summary
 *  - GET  /api/dashboard/inbox
 *  - GET  /api/dashboard/schedule
 *  - GET  /api/dashboard/jobs
 *  - GET  /api/dashboard/customers
 *  - GET  /api/dashboard/analytics
 *  - GET  /api/dashboard/escalations
 *  - GET  /api/dashboard/bookings/:bookingId/reschedule-history
 *  All are JWT-protected (Bearer token in Authorization header).
 */
export function mountDashboardRoutes(app: import('express').Express): void {
  app.use('/api/dashboard/summary', summaryRouter);
  app.use('/api/dashboard/inbox', inboxRouter);
  app.use('/api/dashboard/schedule', scheduleRouter);
  app.use('/api/dashboard/jobs', jobsRouter);
  app.use('/api/dashboard/customers', customersRouter);
  app.use('/api/dashboard/analytics', analyticsRouter);
  app.use('/api/dashboard/escalations', escalationsRouter);
  app.use('/api/dashboard/bookings', bookingsRouter);
}