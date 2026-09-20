import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getByMessageSid: vi.fn(),
  markStatus: vi.fn(),
  getCustomerByPhone: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
  createEscalation: vi.fn(),
}));

vi.mock('../services/outbound-ledger.js', () => ({
  getByMessageSid: mocks.getByMessageSid,
  markStatus: mocks.markStatus,
  TERMINAL_STATUSES: ['delivered', 'retried', 'escalated'],
}));

vi.mock('../services/consent-service.js', () => ({
  getCustomerByPhone: mocks.getCustomerByPhone,
}));

vi.mock('../services/whatsapp-service.js', () => ({
  sendWhatsAppTemplate: mocks.sendWhatsAppTemplate,
}));

vi.mock('../services/escalation-service.js', () => ({
  createEscalation: mocks.createEscalation,
}));

import { handleFailedSms, resolveTemplateSid } from './fallback-service.js';
import type { OutboundLedgerRow } from './outbound-ledger.js';

function row(overrides: Partial<OutboundLedgerRow> = {}): OutboundLedgerRow {
  return {
    id: 'ledger-1',
    organizationId: 'org-1',
    customerId: 'cust-1',
    toPhone: '+8801712345678',
    body: 'Hi, your appointment is confirmed.',
    channel: 'sms',
    messageSid: 'SM123',
    kind: 'booking_confirmation',
    status: 'sent',
    errorCode: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...overrides,
  };
}

const CONSENTED = {
  id: 'cust-1',
  phoneVerifiedAt: '2026-09-01T00:00:00.000Z',
  whatsappOptedIn: true,
};

beforeEach(() => {
  mocks.getByMessageSid.mockReset();
  mocks.markStatus.mockReset();
  mocks.getCustomerByPhone.mockReset();
  mocks.sendWhatsAppTemplate.mockReset();
  mocks.createEscalation.mockReset();
  // Idempotency re-read: default to "no re-read found" so `current` is the
  // INPUT row passed to handleFailedSms (exercises the `fresh ?? row` path).
  // The idempotency test overrides this with a terminal fresh row.
  mocks.getByMessageSid.mockResolvedValue(null);
  mocks.getCustomerByPhone.mockResolvedValue(CONSENTED);
  mocks.markStatus.mockResolvedValue(undefined);
  mocks.sendWhatsAppTemplate.mockResolvedValue({ messageSid: 'SMwa1', status: 'queued' });
  mocks.createEscalation.mockResolvedValue({ id: 'esc-1' });
});

afterEach(() => {
  delete process.env.WHATSAPP_FALLBACK_COUNTRIES;
  delete process.env.WHATSAPP_TEMPLATE_GENERIC;
  delete process.env.WHATSAPP_TEMPLATE_BOOKING_CONFIRMATION;
});

describe('handleFailedSms — T18 fallback engine', () => {
  it('idempotency: re-read terminal row → no_fallback no-op', async () => {
    mocks.getByMessageSid.mockResolvedValue(row({ status: 'delivered' }));

    const result = await handleFailedSms(row({ status: 'sent' }));

    expect(result).toEqual({ outcome: 'no_fallback', detail: 'already delivered — no-op' });
    expect(mocks.markStatus).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
    expect(mocks.createEscalation).not.toHaveBeenCalled();
  });

  it('country gate: non-allowlisted To phone → no_fallback, row stays failed', async () => {
    const result = await handleFailedSms(row({ toPhone: '+15551234567' }));

    expect(result.outcome).toBe('no_fallback');
    expect(result.detail).toContain('not in fallback allowlist');
    expect(mocks.markStatus).not.toHaveBeenCalled();
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('country gate: custom WHATSAPP_FALLBACK_COUNTRIES allowlist is honored', async () => {
    process.env.WHATSAPP_FALLBACK_COUNTRIES = '+1,+44';
    process.env.WHATSAPP_TEMPLATE_GENERIC = 'HXgeneric';

    const result = await handleFailedSms(row({ toPhone: '+15551234567' }));

    expect(result.outcome).toBe('retried');
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+15551234567' }),
    );
  });

  it('consent gate: no customer row → blocked_optin, ledger marked, nothing sent', async () => {
    mocks.getCustomerByPhone.mockResolvedValue(null);

    const result = await handleFailedSms(row());

    expect(result).toEqual({ outcome: 'blocked_optin', detail: 'no customer row for phone' });
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'blocked_optin');
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('consent gate: unverified customer → blocked_optin', async () => {
    mocks.getCustomerByPhone.mockResolvedValue({
      ...CONSENTED,
      phoneVerifiedAt: null,
    });

    const result = await handleFailedSms(row());

    expect(result.outcome).toBe('blocked_optin');
    expect(result.detail).toContain('not verified');
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'blocked_optin');
  });

  it('consent gate: verified but not opted-in → blocked_optin', async () => {
    mocks.getCustomerByPhone.mockResolvedValue({ ...CONSENTED, whatsappOptedIn: false });

    const result = await handleFailedSms(row());

    expect(result.outcome).toBe('blocked_optin');
    expect(result.detail).toContain('not opted in');
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'blocked_optin');
  });

  it('template gate: no WHATSAPP_TEMPLATE_* SID → no_template, escalated as template-not-configured, row stays failed', async () => {
    const result = await handleFailedSms(row());

    expect(result.outcome).toBe('no_template');
    expect(mocks.createEscalation).toHaveBeenCalledWith({
      type: 'sms_delivery_failure',
      customerPhone: '+8801712345678',
      content: 'template-not-configured: booking_confirmation',
    });
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'failed', 'template-not-configured');
    expect(mocks.sendWhatsAppTemplate).not.toHaveBeenCalled();
  });

  it('send: WHATSAPP_TEMPLATE_GENERIC → template sent with body as {1} → retried', async () => {
    process.env.WHATSAPP_TEMPLATE_GENERIC = 'HXgeneric';

    const result = await handleFailedSms(row());

    expect(result).toEqual({
      outcome: 'retried',
      detail: 'whatsapp template HXgeneric accepted',
    });
    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith({
      to: '+8801712345678',
      contentSid: 'HXgeneric',
      contentVariables: { 1: 'Hi, your appointment is confirmed.' },
    });
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'retried');
    expect(mocks.createEscalation).not.toHaveBeenCalled();
  });

  it('send: kind-specific WHATSAPP_TEMPLATE_<KIND> wins over the generic SID', async () => {
    process.env.WHATSAPP_TEMPLATE_GENERIC = 'HXgeneric';
    process.env.WHATSAPP_TEMPLATE_BOOKING_CONFIRMATION = 'HXbooking';

    await handleFailedSms(row());

    expect(mocks.sendWhatsAppTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ contentSid: 'HXbooking' }),
    );
  });

  it('send throw: ledger escalated + sms_delivery_failure escalation with the body', async () => {
    process.env.WHATSAPP_TEMPLATE_GENERIC = 'HXgeneric';
    mocks.sendWhatsAppTemplate.mockRejectedValue(new Error('template api down'));

    const result = await handleFailedSms(row());

    expect(result.outcome).toBe('escalated');
    expect(result.detail).toContain('template api down');
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'escalated');
    expect(mocks.createEscalation).toHaveBeenCalledWith({
      type: 'sms_delivery_failure',
      customerPhone: '+8801712345678',
      content: 'Hi, your appointment is confirmed.',
    });
  });
});

describe('resolveTemplateSid', () => {
  it('returns null when unset or blank', () => {
    expect(resolveTemplateSid('booking_confirmation')).toBeNull();
    process.env.WHATSAPP_TEMPLATE_GENERIC = '   ';
    expect(resolveTemplateSid('booking_confirmation')).toBeNull();
  });

  it('prefers the kind-specific SID and trims whitespace', () => {
    process.env.WHATSAPP_TEMPLATE_GENERIC = 'HXgeneric';
    process.env.WHATSAPP_TEMPLATE_BOOKING_CONFIRMATION = '  HXbooking  ';
    expect(resolveTemplateSid('booking_confirmation')).toBe('HXbooking');
  });

  it('falls back to the generic SID', () => {
    process.env.WHATSAPP_TEMPLATE_GENERIC = 'HXgeneric';
    expect(resolveTemplateSid('slot_invalid')).toBe('HXgeneric');
  });
});