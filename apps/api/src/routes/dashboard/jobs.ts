import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getJobs } from '../../services/dashboard-service.js';
import type { DashboardApiErrorResponse } from '@tradescheduler/shared';

/**
 * GET /api/dashboard/jobs — 100 most recent appointments with display-ready
 * customer/service/technician/status/value rows. requireAuth guarantees
 * req.auth before this handler runs.
 */
const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const ctx = await getOrgContextByUserId(req.auth!.userId);
    if (!ctx) {
      res.status(403).json({ error: 'no_organization' } satisfies DashboardApiErrorResponse);
      return;
    }
    const jobs = await getJobs(ctx.organizationId, ctx.timezone);
    res.json(jobs);
  } catch (err) {
    console.error('[dashboard] jobs error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const jobsRouter = router;