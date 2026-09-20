import twilio from 'twilio';
import { toChannelAddress } from './phone-utils.js';
import type { Channel } from '../types.js';

/**
 * SMS/WhatsApp primitive for all downstream flows (reschedule offers,
 * confirmations, missed-call auto-text) — build-sequence.md Step 3.
 *
 * Rules honored:
 * - Env-free boot: credentials are read per call, never at module scope.
 * - No silently empty sender number: `from` defaults to TWILIO_PHONE_NUMBER
 *   (SMS) or TWILIO_WHATSAPP_NUMBER (whatsapp channel), and is validated
 *   before any API call.
 * - Channel-aware addressing: channel='whatsapp' prefixes `to` with
 *   `whatsapp:` (idempotent — a pre-prefixed address is never double-prefixed)
 *   and selects the WhatsApp sender; any other/omitted channel keeps SMS
 *   behavior byte-for-byte unchanged.
 * - `statusCallbackUrl` is passed through only when the caller supplies it
 *   (default none — no delivery tracking unless asked).
 * - On Twilio API failure: log + rethrow (callers decide retry/escalation).
 * - Logged trail (no message body, to minimize PII in logs).
 */
export interface SendSmsInput {
  to: string;
  /** Defaults to TWILIO_PHONE_NUMBER (sms) / TWILIO_WHATSAPP_NUMBER (whatsapp) when omitted. */
  from?: string;
  body: string;
  /** Defaults to 'sms' when omitted — legacy callers keep SMS behavior. */
  channel?: Channel;
  /** Twilio Message StatusCallback URL; forwarded only when set (Phase C). */
  statusCallbackUrl?: string;
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
  const channel: Channel = input.channel ?? 'sms';
  const from =
    channel === 'whatsapp'
      ? (input.from ?? process.env.TWILIO_WHATSAPP_NUMBER)
      : (input.from ?? process.env.TWILIO_PHONE_NUMBER);
  if (!from) {
    throw new Error(
      channel === 'whatsapp'
        ? 'Twilio WhatsApp sender number not configured (TWILIO_WHATSAPP_NUMBER or `from`)'
        : 'Twilio outbound number not configured (TWILIO_PHONE_NUMBER or `from`)',
    );
  }
  if (!input.to) {
    throw new Error('sendSms: `to` is required');
  }

  // WhatsApp requires a whatsapp:+ address on To (and From). toChannelAddress
  // is idempotent, so a pre-prefixed `to` still lands on the channel.
  const to = channel === 'whatsapp' ? toChannelAddress(input.to, 'whatsapp') : input.to;

  // Local-dev dry run (TWILIO_SMS_DRY_RUN=true): skip Twilio and creds
  // entirely, logging what WOULD be sent. Used to smoke-test SMS flows
  // without real messages or creds. Logs the body + channel on purpose
  // (dev-only; the real-send trail below stays PII-free).
  if (process.env.TWILIO_SMS_DRY_RUN === 'true') {
    console.log(
      '[sms:dry-run] would send',
      JSON.stringify({ to, from, body: input.body, channel }),
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
    const createParams: { to: string; from: string; body: string; statusCallback?: string } = {
      to,
      from,
      body: input.body,
    };
    if (input.statusCallbackUrl) createParams.statusCallback = input.statusCallbackUrl;
    const message = await client.messages.create(createParams);
    console.log(
      '[sms] sent',
      JSON.stringify({ messageSid: message.sid, status: message.status, to, from, channel }),
    );
    return { messageSid: message.sid, status: message.status };
  } catch (err) {
    console.error('[sms] send failed', JSON.stringify({ to, from }), err);
    throw err;
  }
}