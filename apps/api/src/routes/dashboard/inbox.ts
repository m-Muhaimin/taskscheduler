import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getInboxItems } from '../../services/dashboard-service.js';
import type { DashboardInboxResponse, DashboardApiErrorResponse } from '@tradescheduler/shared';

/**
 * GET /api/dashboard/inbox — 50 most recently updated conversations, display-
 * ready (name, state, last message, AI suggestion, relative time, channel).
 * requireAuth guarantees req.auth before this handler runs.
 */
const router = Router();

const INBOX_PAGE_LIMIT = 50;

router.get('/', requireAuth, async (req, res) => {
  try {
    const ctx = await getOrgContextByUserId(req.auth!.userId);
    if (!ctx) {
      res.status(403).json({ error: 'no_organization' } satisfies DashboardApiErrorResponse);
      return;
    }
    const items = await getInboxItems(ctx.organizationId, ctx.timezone, INBOX_PAGE_LIMIT);
    const body: DashboardInboxResponse = { items };
    res.json(body);
  } catch (err) {
    console.error('[dashboard] inbox error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const inboxRouter = router;