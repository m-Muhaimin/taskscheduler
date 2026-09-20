import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getEscalations } from '../../services/escalation-service.js';
import type { DashboardApiErrorResponse, EscalationStatus } from '@tradescheduler/shared';

/**
 * GET /api/dashboard/escalations — org-scoped pending-first escalation list
 * (T20). Pending escalations sort first, then newest; optional `status`
 * filter (pending|resolved) and clamped `page`/`pageSize` pagination.
 * requireAuth guarantees req.auth before this handler runs.
 */
const router = Router();

/** Parse a page/pageSize query value; NaN-safe, clamped (defaults 1 / 20, pageSize max 100). */
function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const ctx = await getOrgContextByUserId(req.auth!.userId);
    if (!ctx) {
      res.status(403).json({ error: 'no_organization' } satisfies DashboardApiErrorResponse);
      return;
    }
    const rawStatus = req.query.status;
    let status: EscalationStatus | undefined;
    // Empty `?status=` counts as "no filter" — only reject non-empty values.
    if (rawStatus !== undefined && rawStatus !== '') {
      if (rawStatus === 'pending' || rawStatus === 'resolved') {
        status = rawStatus;
      } else {
        res.status(400).json({ error: 'invalid_query' } satisfies DashboardApiErrorResponse);
        return;
      }
    }
    const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = clampInt(req.query.pageSize, 20, 1, 100);
    const response = await getEscalations(ctx.organizationId, {
      ...(status ? { status } : {}),
      page,
      pageSize,
      timezone: ctx.timezone,
    });
    res.json(response);
  } catch (err) {
    console.error('[dashboard] escalations error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const escalationsRouter = router;