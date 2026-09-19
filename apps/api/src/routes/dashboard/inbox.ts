import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getOrgContextByUserId } from '../../services/organization-service.js';
import { getInboxItems, deriveInboxSuggestion } from '../../services/dashboard-service.js';
import { getInboxConversation, enqueueOutboundReply, closeConversation } from '../../services/inbox-service.js';
import type {
  DashboardInboxResponse,
  DashboardApiErrorResponse,
  InboxActionResponse,
} from '@tradescheduler/shared';

/**
 * Inbox routes (T2/T3 + T10):
 *  - GET  /api/dashboard/inbox — 50 most recently updated conversations,
 *    display-ready (name, state, last message, AI suggestion, relative time,
 *    channel). requireAuth guarantees req.auth before this handler runs.
 *  - POST /api/dashboard/inbox/:conversationId/reply — queue a manual
 *    outbound reply ({body: string}, trimmed 1..2000) and close the
 *    conversation (row renders 'handled' on next fetch).
 *  - POST /api/dashboard/inbox/:conversationId/approve — same, but the body
 *    is derived server-side with the same suggestion logic as the list
 *    (deriveInboxSuggestion); 400 no_suggestion when there is nothing.
 */
const router = Router();

const INBOX_PAGE_LIMIT = 50;
const REPLY_BODY_MAX = 2000;

/** Reply body: required, trimmed 1..REPLY_BODY_MAX chars, else null (400). */
function parseReplyBody(req: Request): string | null {
  const raw = (req.body as { body?: unknown } | undefined)?.body;
  if (typeof raw !== 'string') return null;
  const body = raw.trim();
  if (body.length < 1 || body.length > REPLY_BODY_MAX) return null;
  return body;
}

async function resolveOrg(req: Request, res: import('express').Response): Promise<{ organizationId: string; timezone: string } | null> {
  const ctx = await getOrgContextByUserId(req.auth!.userId);
  if (!ctx) {
    res.status(403).json({ error: 'no_organization' } satisfies DashboardApiErrorResponse);
    return null;
  }
  return ctx;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const ctx = await resolveOrg(req, res);
    if (!ctx) return;
    const items = await getInboxItems(ctx.organizationId, ctx.timezone, INBOX_PAGE_LIMIT);
    const body: DashboardInboxResponse = { items };
    res.json(body);
  } catch (err) {
    console.error('[dashboard] inbox error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

router.post('/:conversationId/reply', requireAuth, async (req, res) => {
  try {
    const ctx = await resolveOrg(req, res);
    if (!ctx) return;

    const conversationId = req.params.conversationId;
    if (typeof conversationId !== 'string' || conversationId.length === 0) {
      res.status(400).json({ error: 'invalid_body' } satisfies DashboardApiErrorResponse);
      return;
    }

    const body = parseReplyBody(req);
    if (body === null) {
      res.status(400).json({ error: 'invalid_body' } satisfies DashboardApiErrorResponse);
      return;
    }

    const conversation = await getInboxConversation(conversationId, ctx.organizationId);
    if (!conversation) {
      res.status(404).json({ error: 'conversation_not_found' } satisfies DashboardApiErrorResponse);
      return;
    }

    await enqueueOutboundReply(conversation.id, body, ctx.organizationId);
    await closeConversation(conversation.id, ctx.organizationId);
    res.json({ ok: true } satisfies InboxActionResponse);
  } catch (err) {
    console.error('[dashboard] inbox reply error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

router.post('/:conversationId/approve', requireAuth, async (req, res) => {
  try {
    const ctx = await resolveOrg(req, res);
    if (!ctx) return;

    const conversationId = req.params.conversationId;
    if (typeof conversationId !== 'string' || conversationId.length === 0) {
      res.status(400).json({ error: 'invalid_body' } satisfies DashboardApiErrorResponse);
      return;
    }

    const conversation = await getInboxConversation(conversationId, ctx.organizationId);
    if (!conversation) {
      res.status(404).json({ error: 'conversation_not_found' } satisfies DashboardApiErrorResponse);
      return;
    }

    const body = deriveInboxSuggestion({
      outboundBody: conversation.outboundBody,
      state: conversation.state,
      offeredSlots: conversation.offeredSlots,
      escalationReason: conversation.escalationReason,
      tz: ctx.timezone,
    });
    if (!body) {
      res.status(400).json({ error: 'no_suggestion' } satisfies DashboardApiErrorResponse);
      return;
    }

    await enqueueOutboundReply(conversation.id, body, ctx.organizationId);
    await closeConversation(conversation.id, ctx.organizationId);
    res.json({ ok: true } satisfies InboxActionResponse);
  } catch (err) {
    console.error('[dashboard] inbox approve error:', err);
    res.status(500).json({ error: 'server_error' } satisfies DashboardApiErrorResponse);
  }
});

export const inboxRouter = router;