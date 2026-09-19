import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getSummary } from '../../services/dashboard-service.js';
import type { DashboardApiErrorResponse } from '@tradescheduler/shared';

/**
 * GET /api/dashboard/summary — Overview page: 5 metric cards, top-4 inbox,
 * today timeline, revenue recovery. Org-scoped via the caller's membership.
 * requireAuth guarantees req.auth before this handler runs.
 */
const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const ctx = await getOrgContextByUserId(req.auth!.userId);
    if (!ctx) {
      res.status(403).json({ error: 'no_organization' } satisfies DashboardApiErrorResponse);
      return;
    }
    const summary = await getSummary(ctx.organizationId, ctx.timezone);
    res.json(summary);
  } catch (err) {
    console.error('[dashboard] summary error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const summaryRouter = router;