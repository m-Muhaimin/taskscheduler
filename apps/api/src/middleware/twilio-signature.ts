import twilio from 'twilio';
import type { RequestHandler } from 'express';

/**
 * Twilio webhook signature verification (spec §2.1).
 * Fails closed: missing TWILIO_AUTH_TOKEN, missing/invalid X-Twilio-Signature → 401.
 * Uses the Twilio SDK `validateRequest` (HMAC-SHA1) — never hand-rolled HMAC
 * (build-sequence.md Step 2).
 *
 * Env-free boot rule: TWILIO_AUTH_TOKEN is read inside the handler, not at
 * module scope, so the server still boots with no .env.
 */
export const verifyTwilioSignature: RequestHandler = (req, res, next) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error('[twilio-signature] TWILIO_AUTH_TOKEN not configured; rejecting');
    res.status(401).send('Unauthorized');
    return;
  }

  const signature = req.headers['x-twilio-signature'];
  if (typeof signature !== 'string' || signature.length === 0) {
    res.status(401).send('Unauthorized');
    return;
  }

  // Twilio validates against the full request URL (protocol + host + path [+ query]).
  const url = `${req.protocol}://${req.get('host') ?? ''}${req.originalUrl}`;
  const params = (req.body ?? {}) as Record<string, unknown>;

  try {
    const valid = twilio.validateRequest(authToken, signature, url, params);
    if (!valid) {
      res.status(401).send('Unauthorized');
      return;
    }
  } catch (err) {
    console.error('[twilio-signature] validation threw', err);
    res.status(401).send('Unauthorized');
    return;
  }

  next();
};
