import { Router } from 'express';
import { escalationsRouter } from './escalations.js';
import { messagesRouter } from './messages.js';
import { bookingsRouter } from './bookings/[bookingId]/reschedule-history.js';
import { summaryRouter } from './summary.js';
import { inboxRouter } from './inbox.js';
import { scheduleRouter } from './schedule.js';
import { jobsRouter } from './jobs.js';
import { customersRouter } from './customers.js';
import { analyticsRouter } from './analytics.js';
import { settingsRouter } from './settings.js';

/** Dashboard API routes (Step 9 + T2/T3 + T10 + T11):
 *  - GET  /api/dashboard/summary
 *  - GET  /api/dashboard/inbox
 *  - POST /api/dashboard/inbox/:conversationId/reply   (T10)
 *  - POST /api/dashboard/inbox/:conversationId/approve (T10)
 *  - GET  /api/dashboard/schedule
 *  - GET  /api/dashboard/jobs
 *  - GET  /api/dashboard/customers
 *  - GET  /api/dashboard/analytics
 *  - GET/PATCH /api/dashboard/settings/automation      (T11)
 *  - GET  /api/dashboard/escalations
 *  - GET  /api/dashboard/messages
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
  app.use('/api/dashboard/settings', settingsRouter);
  app.use('/api/dashboard/escalations', escalationsRouter);
  app.use('/api/dashboard/messages', messagesRouter);
  app.use('/api/dashboard/bookings', bookingsRouter);
}