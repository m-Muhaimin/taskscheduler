import { Router } from 'express';
import { verifyTwilioSignature } from '../middleware/twilio-signature.js';
import { enqueue } from '../services/queue-service.js';
import { normalizeChannelAddress } from '../services/phone-utils.js';
import type { TwilioInboundSmsPayload } from '../types.js';

/**
 * POST /api/twilio/webhooks/inbound-sms (spec §2.1).
 * Signature FIRST (401 on invalid/missing), then required-field check (400),
 * then enqueue an `inbound_sms` job (Step 4) and return 200 with empty body.
 */
const REQUIRED_FIELDS = ['From', 'To', 'Body', 'MessageSid'] as const;

export const twilioWebhooksRouter: Router = Router();

twilioWebhooksRouter.post('/inbound-sms', verifyTwilioSignature, async (req, res) => {
  const body = (req.body ?? {}) as Partial<TwilioInboundSmsPayload>;

  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = body[field];
    return typeof value !== 'string' || value.length === 0;
  });

  if (missing.length > 0) {
    res.status(400).json({ error: 'missing_fields', fields: missing });
    return;
  }

  // CP03 spec C7: reject non-E.164 From BEFORE enqueueing — no customer row
  // should ever be created for a malformed phone number. WhatsApp inbound
  // arrives as whatsapp:+880…; normalize (strip the prefix) FIRST so the gate
  // validates the bare E.164, then keep the raw values for the job payload
  // (the worker re-normalizes From and To for org lookup / channel routing).
  const { e164: fromE164, channel } = normalizeChannelAddress(body.From as string);
  if (!/^\+?[1-9][0-9]{1,14}$/.test(fromE164)) {
    res.status(400).json({ error: 'INVALID_PHONE' });
    return;
  }

  try {
    const job = await enqueue({
      type: 'inbound_sms',
      payload: {
        From: body.From,
        To: body.To,
        Body: body.Body,
        MessageSid: body.MessageSid,
        AccountSid: body.AccountSid ?? null,
        Channel: channel,
      },
    });
    console.log('[webhook] enqueued job', JSON.stringify({ id: job.id, type: job.type }));
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] enqueue failed', err);
    res.status(500).json({ error: 'queue_unavailable' });
  }
});
