import twilio from 'twilio';

/**
 * SMS primitive for all downstream flows (reschedule offers, confirmations,
 * missed-call auto-text) — build-sequence.md Step 3.
 *
 * Rules honored:
 * - Env-free boot: credentials are read per call, never at module scope.
 * - No silently empty TWILIO_PHONE_NUMBER: `from` defaults to it, and it is
 *   validated before any API call.
 * - On Twilio API failure: log + rethrow (callers decide retry/escalation).
 * - Logged trail (no message body, to minimize PII in logs).
 */
export interface SendSmsInput {
  to: string;
  /** Defaults to TWILIO_PHONE_NUMBER when omitted. */
  from?: string;
  body: string;
}

export interface SmsRecord {
  direction: 'inbound' | 'outbound';
  body: string;
  timestamp: Date;
}
export interface SentSms {
  messageSid: string;
  status: string;
}

export async function sendSms(input: SendSmsInput): Promise<SentSms> {
  const from = input.from ?? process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new Error('Twilio outbound number not configured (TWILIO_PHONE_NUMBER or `from`)');
  }
  if (!input.to) {
    throw new Error('sendSms: `to` is required');
  }

  // Local-dev dry run (TWILIO_SMS_DRY_RUN=true): skip Twilio and creds
  // entirely, logging what WOULD be sent. Used to smoke-test SMS flows
  // without real messages or creds. Logs the body on purpose (dev-only;
  // the real-send trail below stays PII-free).
  if (process.env.TWILIO_SMS_DRY_RUN === 'true') {
    console.log(
      '[sms:dry-run] would send',
      JSON.stringify({ to: input.to, from, body: input.body }),
    );
    return { messageSid: `dry-run-${Date.now()}`, status: 'queued' };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  }

  const client = twilio(accountSid, authToken);
  try {
    const message = await client.messages.create({ to: input.to, from, body: input.body });
    console.log(
      '[sms] sent',
      JSON.stringify({ messageSid: message.sid, status: message.status, to: input.to, from }),
    );
    return { messageSid: message.sid, status: message.status };
  } catch (err) {
    console.error('[sms] send failed', JSON.stringify({ to: input.to, from }), err);
    throw err;
  }
}
