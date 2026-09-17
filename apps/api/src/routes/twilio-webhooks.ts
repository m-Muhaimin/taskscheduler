import { Router } from 'express';
import { verifyTwilioSignature } from '../middleware/twilio-signature.js';
import type { TwilioInboundSmsPayload } from '../types.js';

/**
 * POST /api/twilio/webhooks/inbound-sms (spec §2.1).
 * Signature FIRST (401 on invalid/missing), then required-field check (400),
 * then 200 with empty body — no processing yet (enqueue lands in Step 4).
 */
const REQUIRED_FIELDS = ['From', 'To', 'Body', 'MessageSid'] as const;

export const twilioWebhooksRouter: Router = Router();

twilioWebhooksRouter.post('/inbound-sms', verifyTwilioSignature, (req, res) => {
  const body = (req.body ?? {}) as Partial<TwilioInboundSmsPayload>;

  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = body[field];
    return typeof value !== 'string' || value.length === 0;
  });

  if (missing.length > 0) {
    res.status(400).json({ error: 'missing_fields', fields: missing });
    return;
  }

  console.log(
    '[webhook] inbound-sms',
    JSON.stringify({
      from: body.From,
      to: body.To,
      body: body.Body,
      messageSid: body.MessageSid,
      accountSid: body.AccountSid ?? null,
    }),
  );
  res.sendStatus(200);
});
