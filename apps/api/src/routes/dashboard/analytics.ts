import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getAnalytics } from '../../services/dashboard-service.js';
import type { DashboardApiErrorResponse } from '@tradescheduler/shared';

/**
 * GET /api/dashboard/analytics — 30d demand/outcomes/revenue/booking-rate/cost
 * series plus top services and technician load. aiCostByDay is org-scoped
 * (rl_ai_usage.organization_id, T9) — see the shared type comment. requireAuth
 * guarantees req.auth before this handler runs.
 */
const router = Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const ctx = await getOrgContextByUserId(req.auth!.userId);
    if (!ctx) {
      res.status(403).json({ error: 'no_organization' } satisfies DashboardApiErrorResponse);
      return;
    }
    const analytics = await getAnalytics(ctx.organizationId, ctx.timezone);
    res.json(analytics);
  } catch (err) {
    console.error('[dashboard] analytics error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const analyticsRouter = router;