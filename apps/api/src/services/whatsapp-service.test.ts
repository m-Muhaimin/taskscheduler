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

import { sendWhatsAppTemplate } from './whatsapp-service.js';
import type { SendWhatsAppTemplateInput } from './whatsapp-service.js';

const ENV = {
  TWILIO_ACCOUNT_SID: 'AC_test_sid',
  TWILIO_AUTH_TOKEN: 'test_twilio_auth_token_000',
  TWILIO_WHATSAPP_NUMBER: '+8809612345678',
};

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = ENV.TWILIO_ACCOUNT_SID;
  process.env.TWILIO_AUTH_TOKEN = ENV.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_WHATSAPP_NUMBER = ENV.TWILIO_WHATSAPP_NUMBER;
  mocks.create.mockReset();
  mocks.clientFactory.mockClear();
});

afterEach(() => {
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_WHATSAPP_NUMBER;
  delete process.env.TWILIO_SMS_DRY_RUN;
});

describe('sendWhatsAppTemplate', () => {
  const SID = 'HX1234567890abcdef';

  it('sends a content template via the Twilio client with whatsapp: addressing', async () => {
    mocks.create.mockResolvedValue({ sid: 'SMwa1', status: 'queued' });

    const result = await sendWhatsAppTemplate({
      to: '+8801712345678',
      contentSid: SID,
      contentVariables: { 1: 'Your appointment is confirmed.' },
    });

    expect(result).toEqual({ messageSid: 'SMwa1', status: 'queued' });
    expect(mocks.create).toHaveBeenCalledWith({
      to: 'whatsapp:+8801712345678',
      from: ENV.TWILIO_WHATSAPP_NUMBER,
      contentSid: SID,
      contentVariables: '{"1":"Your appointment is confirmed."}',
    });
  });

  it('defaults `from` to TWILIO_WHATSAPP_NUMBER when omitted', async () => {
    mocks.create.mockResolvedValue({ sid: 'SMwa2', status: 'queued' });

    await sendWhatsAppTemplate({ to: '+8801712345678', contentSid: SID, contentVariables: {} });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ from: ENV.TWILIO_WHATSAPP_NUMBER }),
    );
  });

  it('an explicit `from` overrides the env sender', async () => {
    mocks.create.mockResolvedValue({ sid: 'SMwa3', status: 'queued' });

    await sendWhatsAppTemplate({
      to: '+8801712345678',
      from: 'whatsapp:+8801987654321',
      contentSid: SID,
      contentVariables: { 1: 'hi' },
    });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'whatsapp:+8801987654321' }),
    );
  });

  it('throws a clear error when no WhatsApp sender is configured, before any API call', async () => {
    delete process.env.TWILIO_WHATSAPP_NUMBER;

    await expect(
      sendWhatsAppTemplate({ to: '+8801712345678', contentSid: SID, contentVariables: {} }),
    ).rejects.toThrow(/TWILIO_WHATSAPP_NUMBER/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('throws when contentSid is missing', async () => {
    await expect(
      sendWhatsAppTemplate({
        to: '+8801712345678',
        contentVariables: {},
      } as unknown as SendWhatsAppTemplateInput),
    ).rejects.toThrow(/contentSid/);
  });

  it('dry-runs without Twilio when TWILIO_SMS_DRY_RUN=true (no creds needed)', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_SMS_DRY_RUN = 'true';

    const result = await sendWhatsAppTemplate({
      to: '+8801712345678',
      contentSid: SID,
      contentVariables: { 1: 'hi' },
    });

    expect(result.messageSid).toMatch(/^dry-run-/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects when the Twilio API fails, logging but not swallowing the error', async () => {
    mocks.create.mockRejectedValue(new Error('twilio template boom'));

    await expect(
      sendWhatsAppTemplate({ to: '+8801712345678', contentSid: SID, contentVariables: {} }),
    ).rejects.toThrow('twilio template boom');
  });
});