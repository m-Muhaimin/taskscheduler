import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getCustomers } from '../../services/dashboard-service.js';
import type { DashboardApiErrorResponse } from '@tradescheduler/shared';

/**
 * GET /api/dashboard/customers — 100 most recently created org customers with
 * their job count (appointments on the same phone) and since-year.
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
    const customers = await getCustomers(ctx.organizationId, ctx.timezone);
    res.json(customers);
  } catch (err) {
    console.error('[dashboard] customers error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const customersRouter = router;