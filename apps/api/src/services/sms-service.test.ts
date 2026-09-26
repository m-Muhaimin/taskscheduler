import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    create: vi.fn(),
    clientFactory: vi.fn(),
    insertOutbound: vi.fn(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
    hasSmsOptIn: vi.fn(),
    recordSmsOptIn: vi.fn(),
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

vi.mock('./consent-service.js', () => ({
  hasSmsOptIn: mocks.hasSmsOptIn,
  recordSmsOptIn: mocks.recordSmsOptIn,
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
  mocks.hasSmsOptIn.mockReset();
  mocks.recordSmsOptIn.mockReset();
  mocks.insertOutbound.mockResolvedValue({ id: 'ledger-1' });
  mocks.markSent.mockResolvedValue(undefined);
  mocks.markFailed.mockResolvedValue(undefined);
  // Default: the pre-existing tests name a customerId, so the consent gate
  // passes for them without any edit.
  mocks.hasSmsOptIn.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_PHONE_NUMBER;
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

describe('sendSms — status callback + dry-run passthrough', () => {
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

    const result = await sendSms({ to: '+15559876543', body: 'Hi!' });

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
      toPhone: '+15559876543', // bare E.164 on the ledger
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
});

describe('sendSms — SMS consent hard rule', () => {
  const base = {
    to: '+15551234567',
    from: '+15559876543',
    body: 'your appointment is confirmed',
    organizationId: 'org-1',
  };

  // The committed suite sets `create` per-test; the consent tests share one
  // happy-path stub so the only variable under test is the gate itself.
  beforeEach(() => {
    mocks.create.mockResolvedValue({ sid: 'SMconsent', status: 'queued' });
  });

  it('refuses a proactive send to a customer with no consent record', async () => {
    mocks.hasSmsOptIn.mockResolvedValue(false);

    await expect(sendSms({ ...base, customerId: 'cust-1', kind: 'booking_confirmation' })).rejects.toThrow(
      /no SMS consent record/,
    );

    // Fail closed with no trace: no ledger row, no Twilio request.
    expect(mocks.hasSmsOptIn).toHaveBeenCalledWith('cust-1');
    expect(mocks.insertOutbound).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it('fails closed with no ledger row when the consent read itself errors', async () => {
    mocks.hasSmsOptIn.mockRejectedValue(new Error('DATABASE_URL not configured'));

    await expect(
      sendSms({ ...base, customerId: 'cust-1', kind: 'booking_confirmation' }),
    ).rejects.toThrow('DATABASE_URL not configured');

    expect(mocks.insertOutbound).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('TWILIO_SMS_DRY_RUN=true does NOT bypass the consent gate', async () => {
    // The gate sits above the dry-run branch. If the two are ever reordered (or
    // the dry-run branch grows an early return above the gate) this refuses to
    // fail and a refused send would silently go "out" in dev.
    process.env.TWILIO_SMS_DRY_RUN = 'true';
    mocks.hasSmsOptIn.mockResolvedValue(false);

    await expect(
      sendSms({ ...base, customerId: 'cust-1', kind: 'booking_confirmation' }),
    ).rejects.toThrow(/no SMS consent record/);

    // Nothing at all: no ledger insert, no markSent, no Twilio create.
    expect(mocks.hasSmsOptIn).toHaveBeenCalledWith('cust-1');
    expect(mocks.insertOutbound).not.toHaveBeenCalled();
    expect(mocks.markSent).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('allows the send when the customer has a logged consent record', async () => {
    mocks.hasSmsOptIn.mockResolvedValue(true);

    await sendSms({ ...base, customerId: 'cust-1', kind: 'booking_confirmation' });

    // Non-vacuous: the gate really ran, for THIS customer. Deleting
    // assertSmsConsent would make this fail rather than pass silently.
    expect(mocks.hasSmsOptIn).toHaveBeenCalledWith('cust-1');
    expect(mocks.insertOutbound).toHaveBeenCalled();
    expect(mocks.markSent).toHaveBeenCalled();
  });

  it('allows each transactional OTP kind without consulting consent', async () => {
    const kinds = [
      'verification_code',
      'confirm_code',
      'number_verified',
      'code_mismatch',
      'confirm_failed',
    ] as const;

    for (const kind of kinds) {
      mocks.insertOutbound.mockClear();
      mocks.markSent.mockClear();
      mocks.hasSmsOptIn.mockClear();
      mocks.hasSmsOptIn.mockResolvedValue(false);

      await sendSms({ ...base, customerId: 'cust-1', kind });

      expect(mocks.hasSmsOptIn).not.toHaveBeenCalled();
      expect(mocks.markSent).toHaveBeenCalled();
    }
  });

  it('does not consult consent for a send with no customerId (staff ack, manual reply)', async () => {
    mocks.hasSmsOptIn.mockClear();
    mocks.hasSmsOptIn.mockResolvedValue(false);

    await sendSms({ ...base, kind: 'staff_ack' });

    expect(mocks.hasSmsOptIn).not.toHaveBeenCalled();
    expect(mocks.markSent).toHaveBeenCalled();

    // Non-vacuity: the gate is LIVE in this very environment — the same input
    // plus a customerId is refused. So "hasSmsOptIn not called" above is about
    // the exemption, not about the gate having been deleted.
    mocks.hasSmsOptIn.mockClear();
    await expect(
      sendSms({ ...base, customerId: 'cust-1', kind: 'booking_confirmation' }),
    ).rejects.toThrow(/no SMS consent record/);
    expect(mocks.hasSmsOptIn).toHaveBeenCalledWith('cust-1');
  });

  it('checks consent for a customer send with no kind at all', async () => {
    mocks.hasSmsOptIn.mockResolvedValue(false);

    await expect(sendSms({ ...base, customerId: 'cust-1' })).rejects.toThrow(/no SMS consent record/);
  });

  it('gates a customer send with NO organizationId: refused, no ledger row, no Twilio call', async () => {
    mocks.hasSmsOptIn.mockResolvedValue(false);

    await expect(
      sendSms({ to: base.to, from: base.from, body: base.body, customerId: 'cust-1' }),
    ).rejects.toThrow(/no SMS consent record/);

    expect(mocks.hasSmsOptIn).toHaveBeenCalledWith('cust-1');
    expect(mocks.insertOutbound).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
  });

  it('gates a customer send with NO organizationId: consent present, send proceeds untracked', async () => {
    mocks.hasSmsOptIn.mockResolvedValue(true);

    const result = await sendSms({
      to: base.to,
      from: base.from,
      body: base.body,
      customerId: 'cust-1',
    });

    // Gated, allowed, and untracked: no organizationId means no ledger row at
    // all (the pre-T18 legacy contract), but the consent gate still ran.
    expect(mocks.hasSmsOptIn).toHaveBeenCalledWith('cust-1');
    expect(result).toEqual({ messageSid: 'SMconsent', status: 'queued' });
    expect(mocks.insertOutbound).not.toHaveBeenCalled();
    expect(mocks.markSent).not.toHaveBeenCalled();
    expect(mocks.markFailed).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it('treats a blank customerId as absent: exempt, and null on the ledger', async () => {
    mocks.hasSmsOptIn.mockResolvedValue(false);

    await sendSms({ ...base, customerId: '   ' });

    // A blank id is NOT a customer: it cannot silently exempt a send by
    // looking like one, and it never reaches the ledger's customer_id column.
    expect(mocks.hasSmsOptIn).not.toHaveBeenCalled();
    expect(mocks.insertOutbound).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: null }),
    );
    expect(mocks.markSent).toHaveBeenCalled();
  });

  it('trims a padded customerId and uses the trimmed value for BOTH the gate and the ledger', async () => {
    mocks.hasSmsOptIn.mockResolvedValue(false);

    await expect(sendSms({ ...base, customerId: '  cust-1  ' })).rejects.toThrow(
      /no SMS consent record/,
    );

    expect(mocks.hasSmsOptIn).toHaveBeenCalledWith('cust-1');
  });
});
