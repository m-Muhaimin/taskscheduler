import { Router } from 'express';
import { verifyTwilioSignature } from '../middleware/twilio-signature.js';
import { getByMessageSid, markStatus, TERMINAL_STATUSES } from '../services/outbound-ledger.js';
import type { TwilioStatusCallbackPayload } from '../types.js';

/**
 * POST /api/twilio/webhooks/status — Twilio Message StatusCallback (delivery
 * reports for outbound messages; T18 Phase C).
 *
 * - Signature FIRST (same verifyTwilioSignature middleware as twilio-webhooks):
 *   invalid/missing signature → 401 before any state is touched.
 * - Form-encoded TwilioStatusCallbackPayload. Lookup by MessageSid; an
 *   unknown SID is a 200 no-op (message predates the ledger, or a dry-run sid).
 * - Status map: queued → no-op (already queued), sent → sent, delivered →
 *   delivered, failed|undelivered → failed, anything else ignored.
 * - Terminal rows (delivered/retried/escalated) → 200 no-op: idempotent.
 *   (The ledger's own UPDATE guard enforces the same rule at the DB layer.)
 * - failed|undelivered → failed. No retry, no fallback, no new status: the
 *   row is recorded as 'failed' and the callback ends there.
 * - ALWAYS responds 200 — Twilio retries non-2xx, and a delivery report for a
 *   phone we no longer track must never cause callback storms.
 */
export const twilioStatusRouter: Router = Router();

twilioStatusRouter.post('/status', verifyTwilioSignature, async (req, res) => {
  const body = (req.body ?? {}) as Partial<TwilioStatusCallbackPayload>;
  const sid = body.MessageSid;
  const messageStatus = body.MessageStatus;
  const errorCode =
    typeof body.ErrorCode === 'string' && body.ErrorCode.trim().length > 0
      ? body.ErrorCode.trim()
      : null;

  // Malformed callback (missing sid/status): no state to update — 200 so
  // Twilio stops retrying a body that can never make progress.
  if (typeof sid !== 'string' || sid.length === 0) {
    res.sendStatus(200);
    return;
  }

  try {
    const row = await getByMessageSid(sid);
    if (!row) {
      res.sendStatus(200);
      return;
    }

    // Idempotency: a terminal row is never re-processed nor re-marked.
    if (TERMINAL_STATUSES.includes(row.status)) {
      res.sendStatus(200);
      return;
    }

    switch (messageStatus) {
      case 'queued': {
        // queued → queued: no-op (the row is already queued or sent).
        res.sendStatus(200);
        return;
      }
      case 'sent': {
        await markStatus(row.id, 'sent');
        break;
      }
      case 'delivered': {
        await markStatus(row.id, 'delivered');
        break;
      }
      case 'failed':
      case 'undelivered': {
        // Record the failure and stop. There is no retry engine this round —
        // see docs/tasks/sms-only-cleanup/DECISION.md. The row stays 'failed'
        // until a human acts; a later real delivery report is still recorded.
        await markStatus(row.id, 'failed', errorCode);
        break;
      }
      default: {
        // Other Twilio statuses ('accepted', 'scheduled', 'canceled', ...)
        // carry no ledger meaning — ignore.
        break;
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error('[twilio-status] callback handling failed', err);
    res.sendStatus(200); // always 200; the reply already failed silently upstream
  }
});