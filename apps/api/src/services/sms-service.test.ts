import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    create: vi.fn(),
    clientFactory: vi.fn(),
    insertOutbound: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
  };
});

vi.mock('twilio', () => ({
  default: mocks.clientFactory.mockImplementation(() => ({
    messages: { create: mocks.create },
  })),
}));

vi.mock('./outbound-ledger.js', () => ({
  insertOutbound: mocks.insertOutbound,
  markSent: mocks.markSent,
  markFailed: mocks.markFailed,
}));

import { sendSms } from './sms-service.js';

const ENV = {
  TWILIO_ACCOUNT_SID: 'AC_test_sid',
  TWILIO_AUTH_TOKEN: 'test_twilio_auth_token_000',
  TWILIO_PHONE_NUMBER: '+15551234567',
};

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = ENV.TWILIO_ACCOUNT_SID;
  process.env.TWILIO_AUTH_TOKEN = ENV.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_PHONE_NUMBER = ENV.TWILIO_PHONE_NUMBER;
  mocks.create.mockReset();
  mocks.clientFactory.mockClear();
  mocks.insertOutbound.mockReset();
  mocks.markSent.mockReset();
  mocks.markFailed.mockReset();
  mocks.insertOutbound.mockResolvedValue({ id: 'ledger-1' });
  mocks.markSent.mockResolvedValue(undefined);
  mocks.markFailed.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_PHONE_NUMBER;
  delete process.env.TWILIO_WHATSAPP_NUMBER;
  delete process.env.TWILIO_SMS_DRY_RUN;
  delete process.env.API_BASE_URL;
  delete process.env.TWILIO_MESSAGE_STATUS_CALLBACK_URL;
  delete process.env.OUTBOUND_MESSAGES_TABLE;
});

describe('sendSms', () => {
  it('sends via the Twilio client and returns messageSid + status', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM123', status: 'queued' });

    const result = await sendSms({ to: '+15559876543', from: '+15551234567', body: 'Hi!' });

    expect(result).toEqual({ messageSid: 'SM123', status: 'queued' });
    expect(mocks.create).toHaveBeenCalledWith({
      to: '+15559876543',
      from: '+15551234567',
      body: 'Hi!',
    });
  });

  it('defaults `from` to TWILIO_PHONE_NUMBER when omitted', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM456', status: 'queued' });

    await sendSms({ to: '+15559876543', body: 'Hi!' });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ from: ENV.TWILIO_PHONE_NUMBER }),
    );
  });

  it('throws without crashing when credentials are missing (env-free guard)', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;

    await expect(sendSms({ to: '+15559876543', body: 'Hi!' })).rejects.toThrow(
      /credentials not configured/,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('throws when TWILIO_PHONE_NUMBER is missing and `from` not given', async () => {
    delete process.env.TWILIO_PHONE_NUMBER;

    await expect(sendSms({ to: '+15559876543', body: 'Hi!' })).rejects.toThrow(
      /TWILIO_PHONE_NUMBER/,
    );
  });

  it('rejects when Twilio API fails, logging but not swallowing the error', async () => {
    mocks.create.mockRejectedValue(new Error('twilio api boom'));

    await expect(sendSms({ to: '+15559876543', body: 'Hi!' })).rejects.toThrow('twilio api boom');
  });

  it('dry-runs without Twilio when TWILIO_SMS_DRY_RUN=true (no creds needed)', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_SMS_DRY_RUN = 'true';

    const result = await sendSms({ to: '+15559876543', from: '+15551234567', body: 'Hi!' });

    expect(result.messageSid).toMatch(/^dry-run-/);
    expect(result.status).toBe('queued');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('dry-run still validates the recipient and from', async () => {
    process.env.TWILIO_SMS_DRY_RUN = 'true';
    delete process.env.TWILIO_PHONE_NUMBER;

    await expect(sendSms({ to: '+15559876543', body: 'Hi!' })).rejects.toThrow(
      /TWILIO_PHONE_NUMBER/,
    );
    await expect(sendSms({ to: '', from: '+15551234567', body: 'Hi!' })).rejects.toThrow(
      /`to` is required/,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('sendSms — T17 whatsapp channel', () => {
  const WHATSAPP_NUMBER = '+8809612345678'; // org BYON (business WhatsApp) number

  beforeEach(() => {
    process.env.TWILIO_WHATSAPP_NUMBER = WHATSAPP_NUMBER;
  });

  it('prefixes `to` with whatsapp: and selects TWILIO_WHATSAPP_NUMBER as from', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM789', status: 'queued' });

    const result = await sendSms({ to: '+8801712345678', body: 'Hi!', channel: 'whatsapp' });

    expect(result).toEqual({ messageSid: 'SM789', status: 'queued' });
    expect(mocks.create).toHaveBeenCalledWith({
      to: 'whatsapp:+8801712345678',
      from: WHATSAPP_NUMBER,
      body: 'Hi!',
    });
  });

  it('never double-prefixes an already-prefixed `to` (idempotent addressing)', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM790', status: 'queued' });

    await sendSms({ to: 'whatsapp:+8801712345678', body: 'Hi!', channel: 'whatsapp' });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'whatsapp:+8801712345678' }),
    );
  });

  it('throws a clear error when no WhatsApp sender is configured, before any API call', async () => {
    delete process.env.TWILIO_WHATSAPP_NUMBER;

    await expect(sendSms({ to: '+8801712345678', body: 'Hi!', channel: 'whatsapp' })).rejects.toThrow(
      /TWILIO_WHATSAPP_NUMBER/,
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('an explicit `from` overrides the env sender for whatsapp (caller-supplied sender)', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM791', status: 'queued' });

    await sendSms({
      to: '+8801712345678',
      from: 'whatsapp:+8801987654321',
      body: 'Hi!',
      channel: 'whatsapp',
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'whatsapp:+8801712345678', from: 'whatsapp:+8801987654321' }),
    );
  });

  it('passes statusCallbackUrl to Twilio ONLY when the caller sets it', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM792', status: 'queued' });

    await sendSms({
      to: '+15559876543',
      body: 'Hi!',
      statusCallbackUrl: 'https://example.com/twilio/status',
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ statusCallback: 'https://example.com/twilio/status' }),
    );
  });

  it('dry-run logs the channel and skips Twilio entirely (no creds needed)', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_SMS_DRY_RUN = 'true';

    const result = await sendSms({ to: '+8801712345678', body: 'Hi!', channel: 'whatsapp' });

    expect(result.messageSid).toMatch(/^dry-run-/);
    expect(result.status).toBe('queued');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('sendSms — T18 outbound ledger', () => {
  it('with organizationId: ledger row written (bare E.164) before Twilio create; markSent(sid, row.id) on success', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM123', status: 'queued' });

    const result = await sendSms({
      to: '+15559876543',
      body: 'Hi!',
      organizationId: 'org-1',
      customerId: 'cust-1',
      kind: 'booking_confirmation',
    });

    expect(result).toEqual({ messageSid: 'SM123', status: 'queued' });
    expect(mocks.insertOutbound).toHaveBeenCalledWith({
      organizationId: 'org-1',
      customerId: 'cust-1',
      toPhone: '+15559876543', // bare E.164, no whatsapp: prefix on the ledger
      body: 'Hi!',
      channel: 'sms',
      kind: 'booking_confirmation',
    });
    expect(mocks.create).toHaveBeenCalledWith({
      to: '+15559876543',
      from: ENV.TWILIO_PHONE_NUMBER,
      body: 'Hi!',
    });
    expect(mocks.markSent).toHaveBeenCalledWith('SM123', 'ledger-1');
  });

  it('with organizationId but no kind/customerId: ledger row gets nulls', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM124', status: 'queued' });

    await sendSms({ to: '+15559876543', body: 'Hi!', organizationId: 'org-1' });

    expect(mocks.insertOutbound).toHaveBeenCalledWith({
      organizationId: 'org-1',
      customerId: null,
      toPhone: '+15559876543',
      body: 'Hi!',
      channel: 'sms',
      kind: null,
    });
    expect(mocks.markSent).toHaveBeenCalledWith('SM124', 'ledger-1');
  });

  it('without organizationId: NO ledger interactions (zero behavior change for existing callers)', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM125', status: 'queued' });

    await sendSms({ to: '+15559876543', body: 'Hi!' });

    expect(mocks.insertOutbound).not.toHaveBeenCalled();
    expect(mocks.markSent).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it('defaults statusCallbackUrl from API_BASE_URL when organizationId is present', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    mocks.create.mockResolvedValue({ sid: 'SM126', status: 'queued' });

    await sendSms({ to: '+15559876543', body: 'Hi!', organizationId: 'org-1' });

    expect(mocks.create).toHaveBeenCalledWith({
      to: '+15559876543',
      from: ENV.TWILIO_PHONE_NUMBER,
      body: 'Hi!',
      statusCallback: 'https://api.example.com/api/twilio/webhooks/status',
    });
  });

  it('TWILIO_MESSAGE_STATUS_CALLBACK_URL wins over API_BASE_URL', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    process.env.TWILIO_MESSAGE_STATUS_CALLBACK_URL = 'https://proxy.example.com/tw/status';
    mocks.create.mockResolvedValue({ sid: 'SM127', status: 'queued' });

    await sendSms({ to: '+15559876543', body: 'Hi!', organizationId: 'org-1' });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ statusCallback: 'https://proxy.example.com/tw/status' }),
    );
  });

  it('an explicit statusCallbackUrl still beats the default', async () => {
    process.env.API_BASE_URL = 'https://api.example.com';
    mocks.create.mockResolvedValue({ sid: 'SM128', status: 'queued' });

    await sendSms({
      to: '+15559876543',
      body: 'Hi!',
      organizationId: 'org-1',
      statusCallbackUrl: 'https://example.com/custom/status',
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ statusCallback: 'https://example.com/custom/status' }),
    );
  });

  it('no default statusCallbackUrl when API_BASE_URL is unset', async () => {
    mocks.create.mockResolvedValue({ sid: 'SM129', status: 'queued' });

    await sendSms({ to: '+15559876543', body: 'Hi!', organizationId: 'org-1' });

    expect(mocks.create).toHaveBeenCalledWith({
      to: '+15559876543',
      from: ENV.TWILIO_PHONE_NUMBER,
      body: 'Hi!',
    });
  });

  it('Twilio create throw: markFailed(null, ledgerRow.id, null) then rethrow', async () => {
    mocks.create.mockRejectedValue(new Error('twilio api boom'));

    await expect(
      sendSms({ to: '+15559876543', body: 'Hi!', organizationId: 'org-1' }),
    ).rejects.toThrow('twilio api boom');
    expect(mocks.markFailed).toHaveBeenCalledWith(null, 'ledger-1', null);
  });

  it('ledger insert throw: propagates WITHOUT a create attempt or markFailed (no row to mark)', async () => {
    mocks.insertOutbound.mockRejectedValue(new Error('ledger inserted? no.'));
    mocks.create.mockResolvedValue({ sid: 'SM130', status: 'queued' });

    await expect(
      sendSms({ to: '+15559876543', body: 'Hi!', organizationId: 'org-1' }),
    ).rejects.toThrow('ledger inserted? no.');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it('dry-run with organizationId still writes the ledger: insert + markSent with a dry-run sid', async () => {
    process.env.TWILIO_SMS_DRY_RUN = 'true';

    const result = await sendSms({ to: '+15559876543', body: 'Hi!', organizationId: 'org-1' });

    expect(result.messageSid).toMatch(/^dry-run-/);
    expect(mocks.insertOutbound).toHaveBeenCalledTimes(1);
    expect(mocks.markSent).toHaveBeenCalledWith(result.messageSid, 'ledger-1');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('whatsapp channel with organizationId: ledger stores the bare E.164 (no prefix), Twilio gets the prefixed to', async () => {
    process.env.TWILIO_WHATSAPP_NUMBER = '+8809612345678';
    mocks.create.mockResolvedValue({ sid: 'SM131', status: 'queued' });

    await sendSms({
      to: '+8801712345678',
      body: 'Hi!',
      channel: 'whatsapp',
      organizationId: 'org-1',
      kind: 'help',
    });

    expect(mocks.insertOutbound).toHaveBeenCalledWith({
      organizationId: 'org-1',
      customerId: null,
      toPhone: '+8801712345678', // bare E.164 on the ledger
      body: 'Hi!',
      channel: 'whatsapp',
      kind: 'help',
    });
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'whatsapp:+8801712345678' }),
    );
  });
});
