import twilio from 'twilio';
import { toChannelAddress } from './phone-utils.js';

/**
 * WhatsApp template-send primitive (T18 Phase D) — the fallback channel's
 * outbound path. Sends a Twilio Content API template message (contentSid +
 * contentVariables), NOT a free-form body — WhatsApp Business API templates
 * need pre-approval, and the fallback engine re-sends the failed SMS body as
 * template variable {1}.
 *
 * Shape mirrors sms-service.ts:
 * - Env-free boot: credentials read per call, never at module scope.
 * - `from` defaults to TWILIO_WHATSAPP_NUMBER and is validated before any
 *   API call (clear error when unset).
 * - `to` is the bare E.164; the whatsapp: prefix is applied here.
 * - Dry-run parity: TWILIO_SMS_DRY_RUN=true logs what WOULD be sent and
 *   returns a `dry-run-…` sid without touching Twilio or requiring creds.
 * - On Twilio API failure: log + rethrow (the fallback service decides).
 */
export interface SendWhatsAppTemplateInput {
  to: string; // bare E.164 (whatsapp: is applied here)
  /** Defaults to TWILIO_WHATSAPP_NUMBER when omitted. */
  from?: string;
  /** Twilio Content API template SID (e.g. 'HX…'). */
  contentSid: string;
  /** Twilio Content API template variables, e.g. {1: 'body text'}. */
  contentVariables: Record<string, string>;
}

export interface WhatsAppSent {
  messageSid: string;
  status: string;
}

export async function sendWhatsAppTemplate(
  input: SendWhatsAppTemplateInput,
): Promise<WhatsAppSent> {
  const from = input.from ?? process.env.TWILIO_WHATSAPP_NUMBER;
  if (!from) {
    throw new Error(
      'Twilio WhatsApp sender number not configured (TWILIO_WHATSAPP_NUMBER or `from`)',
    );
  }
  if (!input.to) {
    throw new Error('sendWhatsAppTemplate: `to` is required');
  }
  if (!input.contentSid) {
    throw new Error('sendWhatsAppTemplate: `contentSid` is required');
  }

  const to = toChannelAddress(input.to, 'whatsapp');

  // Local-dev dry run: skip Twilio and creds entirely (parity with sms-service).
  if (process.env.TWILIO_SMS_DRY_RUN === 'true') {
    console.log(
      '[whatsapp:dry-run] would send template',
      JSON.stringify({ to, from, contentSid: input.contentSid, contentVariables: input.contentVariables }),
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
    // The Twilio SDK types contentVariables as a JSON string; the API expects
    // the serialized form (e.g. '{"1":"body text"}').
    const message = await client.messages.create({
      to,
      from,
      contentSid: input.contentSid,
      contentVariables: JSON.stringify(input.contentVariables),
    });
    console.log(
      '[whatsapp] sent template',
      JSON.stringify({ messageSid: message.sid, status: message.status, to, from, contentSid: input.contentSid }),
    );
    return { messageSid: message.sid, status: message.status };
  } catch (err) {
    console.error('[whatsapp] template send failed', JSON.stringify({ to, from, contentSid: input.contentSid }), err);
    throw err;
  }
}