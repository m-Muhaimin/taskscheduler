import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  return {
    create: vi.fn(),
    clientFactory: vi.fn(),
  };
});

vi.mock('twilio', () => ({
  default: mocks.clientFactory.mockImplementation(() => ({
    messages: { create: mocks.create },
  })),
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
});

afterEach(() => {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_PHONE_NUMBER;
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
});
