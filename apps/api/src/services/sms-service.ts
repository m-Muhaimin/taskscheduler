import twilio from 'twilio';
import { insertOutbound, markFailed, markSent } from './outbound-ledger.js';
import { hasSmsOptIn } from './consent-service.js';
import type { Channel, MessagingKind } from '../types.js';

/**
 * Kinds that are part of a transaction the customer initiated and are
 * therefore not marketing messages: an OTP is the customer proving they can
 * receive at this number, so delivery is what produces the consent record the
 * gate reads. Every other kind is a proactive send and needs a logged consent
 * record.
 *
 * Deliberately limited to the five OTP/handshake kinds. `reschedule_offer` and
 * `slot_invalid` are transactional in spirit (they are replies inside a flow we
 * already agreed with the customer) but are NOT in this set — they take the
 * `hasSmsOptIn` path like any other proactive send, which is safe because the
 * consent record is written on the customer's first inbound SMS, before any
 * flow reply can go out.
 *
 * Refusal of these is deliberately NOT enforced here: failing to deliver an
 * OTP deadlocks the verification gate, and the gate is what produces consent.
 */
const TRANSACTIONAL_KINDS: ReadonlySet<MessagingKind> = new Set<MessagingKind>([
  'verification_code',
  'confirm_code',
  'number_verified',
  'code_mismatch',
  'confirm_failed',
]);

/**
 * SMS primitive for all downstream flows (reschedule offers,
 * confirmations, missed-call auto-text) — build-sequence.md Step 3.
 *
 * Rules honored:
 * - Env-free boot: credentials are read per call, never at module scope.
 * - No silently empty sender number: `from` defaults to TWILIO_PHONE_NUMBER
 *   and is validated before any API call.
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
 * - Consent hard rule: a send that names a `customerId` is refused unless
 *   the customer has a logged SMS consent record or the kind is one of the
 *   five transactional OTP kinds. See assertSmsConsent below. The check runs
 *   first, so a refused send writes no ledger row and makes no Twilio request.
 *   A send with no `customerId` is UNGATED — that exemption is a caller
 *   discipline (staff ack + manual dashboard reply only), not something this
 *   function can enforce, so a new automated send MUST thread the customer id.
 * - On Twilio API failure: log + rethrow (callers decide retry/escalation).
 * - Logged trail (no message body, to minimize PII in logs).
 */
export interface SendSmsInput {
  to: string;
  /** Defaults to TWILIO_PHONE_NUMBER when omitted. */
  from?: string;
  body: string;
  /** Defaults to 'sms' when omitted — legacy callers keep SMS behavior. */
  channel?: Channel;
  /** Twilio Message StatusCallback URL; forwarded only when set (Phase C). */
  statusCallbackUrl?: string;
  /** T18: when present, a rl_outbound_messages ledger row is written (org-scoped). */
  organizationId?: string;
  /** T18: outbound kind for the ledger row. */
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

/**
 * The customer id a send is scoped to, normalized: a non-blank string, or null
 * for "no customer".
 *
 * A blank or whitespace-only id is treated as ABSENT. Absent means exempt, so
 * a stray `customerId: ''` would otherwise silently turn a gated send into an
 * ungated one — and the raw blank string would be written to the ledger's
 * customer_id column. Normalizing once, here, means the gate and the ledger can
 * never disagree about whether the send named a customer.
 */
function scopedCustomerId(input: SendSmsInput): string | null {
  const raw = input.customerId;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The consent hard rule. A send that names a customer must be backed by a
 * logged consent record unless the kind is transactional.
 *
 * THE EXEMPTION IS CALLER DISCIPLINE, NOT ENFORCEMENT. `customerId == null`
 * means UNGATED — the gate deliberately does not look up the recipient's phone
 * number to decide whether they are a customer. Only two send paths are
 * allowed to rely on that: the staff acknowledgement
 * (worker/process-inbound-sms.ts) and the manual dashboard reply
 * (routes/dashboard/inbox.ts → worker/process-outbound-sms.ts). Both address a
 * person the tradesperson is already in conversation with and neither has a
 * customer row. Every automated customer-facing send in
 * worker/process-inbound-sms.ts threads the in-scope `customer.id` precisely
 * so it lands here instead of in the exemption.
 *
 * Throws rather than silently dropping: the caller decides whether to
 * escalate, and a silent drop looks identical to a Twilio outage.
 */
async function assertSmsConsent(input: SendSmsInput, customerId: string | null): Promise<void> {
  if (customerId == null) return;

  const kind = input.kind;
  if (kind && TRANSACTIONAL_KINDS.has(kind)) return;

  if (await hasSmsOptIn(customerId)) return;

  console.warn(
    '[sms] refused: no SMS consent record',
    JSON.stringify({ customerId, kind: kind ?? null, to: input.to }),
  );
  throw new Error(
    'sendSms: blocked — no SMS consent record for this customer (consent is recorded on their first inbound SMS)',
  );
}

export async function sendSms(input: SendSmsInput): Promise<SentSms> {
  // One normalization, shared by the gate and the ledger insert below.
  const customerId = scopedCustomerId(input);

  // Consent hard rule — the FIRST thing that happens: before the ledger
  // insert, before the dry-run branch, before client.messages.create. A
  // refused send leaves no trace at all: no rl_outbound_messages row, no
  // Twilio request. A DB error inside the consent read propagates the same
  // way, so the gate fails closed rather than open.
  await assertSmsConsent(input, customerId);

  const channel: Channel = input.channel ?? 'sms';
  const from = input.from ?? process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new Error('Twilio outbound number not configured (TWILIO_PHONE_NUMBER or `from`)');
  }
  if (!input.to) {
    throw new Error('sendSms: `to` is required');
  }

  // T18 ledger: one row per tracked outbound message, written BEFORE the
  // Twilio create so every attempted message is visible even if the create
  // throws or the process dies mid-send. The ledger stores the bare E.164.
  const ledgerRow = input.organizationId
    ? await insertOutbound({
        organizationId: input.organizationId,
        customerId,
        toPhone: input.to,
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
        : process.env.RENDER_EXTERNAL_URL
          ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/api/twilio/webhooks/status`
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
        JSON.stringify({ to: input.to, from, body: input.body, channel }),
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
      to: input.to,
      from,
      body: input.body,
    };
    if (statusCallbackUrl) createParams.statusCallback = statusCallbackUrl;
    const message = await client.messages.create(createParams);
    console.log(
      '[sms] sent',
      JSON.stringify({ messageSid: message.sid, status: message.status, to: input.to, from, channel }),
    );
    if (ledgerRow) await markSent(message.sid, ledgerRow.id);
    return { messageSid: message.sid, status: message.status };
  } catch (err) {
    console.error('[sms] send failed', JSON.stringify({ to: input.to, from }), err);
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