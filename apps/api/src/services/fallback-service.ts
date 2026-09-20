/**
 * SMS → WhatsApp fallback engine (T18 Phase D). Entry point: the Twilio
 * StatusCallback route calls handleFailedSms(row) when an SMS delivery report
 * comes back failed/undelivered on a tracked outbound message.
 *
 * Policy (ordered gates — a failed SMS only reaches WhatsApp when every gate
 * passes, see plan docs/tasks/v2/whatsapp-channel-fallback.md Phase D):
 *   1. Country gate — the To phone must be in WHATSAPP_FALLBACK_COUNTRIES.
 *   2. Consent gate — an existing, phone-verified customer who explicitly
 *      opted in (whatsapp_opted_in). Anything else → 'blocked_optin': the
 *      ledger row is marked blocked_optin so the consent refusal is visible,
 *      NEVER a silent drop.
 *   3. Template gate — a WHATSAPP_TEMPLATE_<KIND> content SID (falling back
 *      to WHATSAPP_TEMPLATE_GENERIC). Missing → escalate sms_delivery_failure
 *      (template-not-configured) — an operator must approve a WhatsApp
 *      template before the engine can retry.
 *   4. Send — the original SMS body is re-sent as template variable {1}.
 *      Success → ledger 'retried'. Throw → ledger 'escalated' + escalation.
 *
 * Idempotent: re-reads the ledger row by message_sid first; a terminal row
 * (delivered/retried/escalated — or already handled) is a no-op, so a
 * duplicated Twilio callback never double-sends or double-escalates.
 */
import { countryCodeFromE164 } from './phone-utils.js';
import { getByMessageSid, markStatus, TERMINAL_STATUSES, type OutboundLedgerRow } from './outbound-ledger.js';
import { getCustomerByPhone } from './consent-service.js';
import { sendWhatsAppTemplate } from './whatsapp-service.js';
import { createEscalation } from './escalation-service.js';

export type FallbackOutcome =
  | 'no_fallback' // country miss / idempotent no-op — row stays 'failed', nothing else happens
  | 'blocked_optin' // no verified+opted-in customer — ledger marked blocked_optin
  | 'no_template' // no content template configured — escalated, row stays 'failed'
  | 'retried' // WhatsApp template send accepted — ledger marked retried
  | 'escalated'; // WhatsApp send failed — ledger marked escalated + escalation row

export interface FallbackResult {
  outcome: FallbackOutcome;
  detail: string;
}

/**
 * Handle a failed/undelivered SMS delivery report for a tracked outbound row.
 * Returns {outcome, detail}; the route marks the outcome on the ledger for
 * retried|escalated|blocked_optin (fallback-service marks internally at each
 * decision point, and the route re-marks — both are guarded/idempotent).
 */
export async function handleFailedSms(row: OutboundLedgerRow): Promise<FallbackResult> {
  // Idempotency: re-read the row by SID; a terminal row is a no-op. A missing
  // re-read (row vanished) also falls through to a no-op against the input row.
  const fresh = row.messageSid ? await getByMessageSid(row.messageSid) : null;
  const current = fresh ?? row;
  if (TERMINAL_STATUSES.includes(current.status)) {
    return { outcome: 'no_fallback', detail: `already ${current.status} — no-op` };
  }

  // 1. Country gate: the To phone must be eligible for WhatsApp fallback.
  const allowlist = (process.env.WHATSAPP_FALLBACK_COUNTRIES ?? '+880')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  const country = countryCodeFromE164(current.toPhone);
  if (!country || !allowlist.includes(country)) {
    return { outcome: 'no_fallback', detail: `country ${country ?? 'unknown'} not in fallback allowlist` };
  }

  // 2. Consent gate: existing, verified, opted-in customer.
  const customer = await getCustomerByPhone(current.organizationId, current.toPhone);
  if (!customer || !customer.phoneVerifiedAt || !customer.whatsappOptedIn) {
    await markStatus(current.id, 'blocked_optin');
    return {
      outcome: 'blocked_optin',
      detail: !customer
        ? 'no customer row for phone'
        : !customer.phoneVerifiedAt
          ? 'customer phone not verified'
          : 'customer has not opted in to WhatsApp',
    };
  }

  // 3. Template gate: kind-specific SID, else generic, else escalate.
  const templateSid = resolveTemplateSid(current.kind);
  if (!templateSid) {
    await createEscalation({
      type: 'sms_delivery_failure',
      customerPhone: current.toPhone,
      content: `template-not-configured: ${current.kind ?? 'unknown'}`,
    });
    await markStatus(current.id, 'failed', 'template-not-configured');
    return { outcome: 'no_template', detail: 'no WHATSAPP_TEMPLATE_* content SID configured' };
  }

  // 4. Send the original SMS body as template variable {1}.
  try {
    await sendWhatsAppTemplate({
      to: current.toPhone,
      contentSid: templateSid,
      contentVariables: { 1: current.body },
    });
    await markStatus(current.id, 'retried');
    return { outcome: 'retried', detail: `whatsapp template ${templateSid} accepted` };
  } catch (err) {
    console.error('[fallback] whatsapp template send failed', err);
    await markStatus(current.id, 'escalated');
    await createEscalation({
      type: 'sms_delivery_failure',
      customerPhone: current.toPhone,
      content: current.body,
    });
    return { outcome: 'escalated', detail: `whatsapp send threw: ${String(err)}` };
  }
}

/**
 * Resolve the WhatsApp content-template SID for a MessagingKind:
 * WHATSAPP_TEMPLATE_<KIND_UPPER_SNAKE> (e.g. WHATSAPP_TEMPLATE_BOOKING_CONFIRMATION)
 * → WHATSAPP_TEMPLATE_GENERIC → null. Empty/whitespace values count as unset
 * (.env.example ships blank placeholders).
 */
export function resolveTemplateSid(kind: string | null): string | null {
  const kindSid = kind ? process.env[`WHATSAPP_TEMPLATE_${kind.toUpperCase()}`] : undefined;
  const genericSid = process.env.WHATSAPP_TEMPLATE_GENERIC;
  const candidate = (kindSid && kindSid.trim()) || (genericSid && genericSid.trim()) || '';
  return candidate.length > 0 ? candidate : null;
}