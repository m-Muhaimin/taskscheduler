import twilio from 'twilio';
import { normalizeChannelAddress, toChannelAddress } from './phone-utils.js';
import { insertOutbound, markFailed, markSent } from './outbound-ledger.js';
import type { Channel, MessagingKind } from '../types.js';

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
 *   (default none — no delivery tracking unless asked). When `organizationId`
 *   is present (T18) a default callback URL is derived from
 *   TWILIO_MESSAGE_STATUS_CALLBACK_URL, falling back to
 *   API_BASE_URL + '/api/twilio/webhooks/status'.
 * - T18 ledger: when `organizationId` is present, one rl_outbound_messages
 *   row is written BEFORE the Twilio create (status 'queued'), marked 'sent'
 *   with the message SID on success, or 'failed' on throw (then the error
 *   rethrows — callers decide retry/escalation). No organizationId → zero
 *   ledger/db behavior (legacy callers byte-identical).
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
  /** T18: when present, a rl_outbound_messages ledger row is written (org-scoped). */
  organizationId?: string;
  /** T18: outbound kind for the ledger row / WhatsApp template resolution. */
  kind?: MessagingKind;
  /** T18: customer row id for the ledger row (nullable column). */
  customerId?: string;
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

  // T18 ledger: one row per tracked outbound message, written BEFORE the
  // Twilio create so every attempted message is visible even if the create
  // throws or the process dies mid-send. The ledger stores the bare E.164
  // (no whatsapp: prefix — see migration 014 column comment).
  const ledgerRow = input.organizationId
    ? await insertOutbound({
        organizationId: input.organizationId,
        customerId: input.customerId ?? null,
        toPhone: normalizeChannelAddress(input.to).e164,
        body: input.body,
        channel,
        kind: input.kind ?? null,
      })
    : null;

  // T18: with a ledger row, default the StatusCallback so Twilio reports
  // delivery back to us. Without organizationId the old pass-through stands.
  const defaultStatusCallbackUrl = input.organizationId
    ? (process.env.TWILIO_MESSAGE_STATUS_CALLBACK_URL ??
      (process.env.API_BASE_URL
        ? `${process.env.API_BASE_URL.replace(/\/$/, '')}/api/twilio/webhooks/status`
        : undefined))
    : undefined;
  const statusCallbackUrl = input.statusCallbackUrl ?? defaultStatusCallbackUrl;

  try {
    // Local-dev dry run (TWILIO_SMS_DRY_RUN=true): skip Twilio and creds
    // entirely, logging what WOULD be sent. Used to smoke-test SMS flows
    // without real messages or creds. Logs the body + channel on purpose
    // (dev-only; the real-send trail below stays PII-free). With a ledger
    // row, the dry run still records it — status 'sent' with a dry-run sid.
    if (process.env.TWILIO_SMS_DRY_RUN === 'true') {
      const dryRunSid = `dry-run-${Date.now()}`;
      console.log(
        '[sms:dry-run] would send',
        JSON.stringify({ to, from, body: input.body, channel }),
      );
      if (ledgerRow) await markSent(dryRunSid, ledgerRow.id);
      return { messageSid: dryRunSid, status: 'queued' };
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
    }

    const client = twilio(accountSid, authToken);
    const createParams: { to: string; from: string; body: string; statusCallback?: string } = {
      to,
      from,
      body: input.body,
    };
    if (statusCallbackUrl) createParams.statusCallback = statusCallbackUrl;
    const message = await client.messages.create(createParams);
    console.log(
      '[sms] sent',
      JSON.stringify({ messageSid: message.sid, status: message.status, to, from, channel }),
    );
    if (ledgerRow) await markSent(message.sid, ledgerRow.id);
    return { messageSid: message.sid, status: message.status };
  } catch (err) {
    console.error('[sms] send failed', JSON.stringify({ to, from }), err);
    // T18: a tracked message that never made it to Twilio is recorded as
    // failed — never silently absent from the ledger. The rethrow preserves
    // the pre-T18 contract for callers.
    if (ledgerRow) {
      try {
        await markFailed(null, ledgerRow.id, null);
      } catch (ledgerErr) {
        console.error('[sms] ledger markFailed failed', ledgerErr);
      }
    }
    throw err;
  }
}