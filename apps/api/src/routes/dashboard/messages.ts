import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getOutboundMessages } from '../../services/outbound-ledger.js';
import type { DashboardApiErrorResponse, MessageDeliveryStatus } from '@tradescheduler/shared';

const router = Router();

const VALID_CHANNELS = new Set(['sms']);
const VALID_STATUSES: ReadonlySet<string> = new Set([
  'queued', 'sent', 'delivered', 'failed', 'retried', 'escalated', 'blocked_optin',
]);

/** NaN-safe page/pageSize parse; defaults 1/20, pageSize clamped 1..100. */
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
    // channel: optional; empty string treated as absent; anything else invalid.
    const rawChannel = req.query.channel;
    if (rawChannel !== undefined && rawChannel !== '' && typeof rawChannel === 'string' && !VALID_CHANNELS.has(rawChannel)) {
      res.status(400).json({ error: 'invalid_query' } satisfies DashboardApiErrorResponse);
      return;
    }
    // status: optional; empty string treated as absent; anything else invalid.
    const rawStatus = req.query.status;
    if (rawStatus !== undefined && rawStatus !== '' && typeof rawStatus === 'string' && !VALID_STATUSES.has(rawStatus)) {
      res.status(400).json({ error: 'invalid_query' } satisfies DashboardApiErrorResponse);
      return;
    }
    const page = clampInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = clampInt(req.query.pageSize, 20, 1, 100);
    const { messages, total } = await getOutboundMessages(ctx.organizationId, {
      ...(rawChannel && rawChannel !== '' ? { channel: rawChannel as 'sms' } : {}),
      ...(rawStatus && rawStatus !== '' ? { status: rawStatus as MessageDeliveryStatus } : {}),
      page,
      pageSize,
      timezone: ctx.timezone,
    });
    res.json({ messages, total, page, pageSize });
  } catch (err) {
    console.error('[dashboard] messages error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const messagesRouter = router;