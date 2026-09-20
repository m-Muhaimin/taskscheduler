import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../app.js';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));

vi.mock('../services/queue-service.js', () => ({ enqueue: mocks.enqueue }));

/** Test-only token; never a real credential. Signatures are computed locally. */
const AUTH_TOKEN = 'test_twilio_auth_token_000';

const BASE_PARAMS = {
  From: '+15551234567',
  To: '+15559876543',
  Body: 'R',
  MessageSid: 'SM1234567890',
  AccountSid: 'AC1234567890',
};

/**
 * Twilio X-Twilio-Signature = base64(HMAC-SHA1(authToken, canonical))
 * where canonical = request URL + sorted form params as key+raw-value
 * (twilio-node's validateRequest does NOT URL-encode values — verified against
 * lib/webhooks/webhooks.js toFormUrlEncodedParam).
 */
function computeSignature(url: string, params: Record<string, string>): string {
  const canonical =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join('');
  return createHmac('sha1', AUTH_TOKEN).update(canonical).digest('base64');
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

beforeEach(() => {
  mocks.enqueue.mockReset();
  mocks.enqueue.mockResolvedValue({
    id: '00000000-0000-4000-8000-000000000000',
    type: 'inbound_sms',
    payload: {},
    status: 'pending',
    attempts: 0,
    lockedAt: null,
    lockedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(async () => {
  delete process.env.TWILIO_AUTH_TOKEN;
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

const webhookUrl = (): string => `${baseUrl}/api/twilio/webhooks/inbound-sms`;

async function post(params: Record<string, string>, signature?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (signature !== undefined) headers['X-Twilio-Signature'] = signature;
  return fetch(webhookUrl(), {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  });
}

describe('POST /api/twilio/webhooks/inbound-sms', () => {
  it('accepts a valid Twilio-signed request with 200 and enqueues an inbound_sms job', async () => {
    const sig = computeSignature(webhookUrl(), BASE_PARAMS);
    const res = await post(BASE_PARAMS, sig);

    expect(res.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: 'inbound_sms',
      payload: expect.objectContaining({
        From: BASE_PARAMS.From,
        To: BASE_PARAMS.To,
        Body: BASE_PARAMS.Body,
        MessageSid: BASE_PARAMS.MessageSid,
        AccountSid: BASE_PARAMS.AccountSid,
        Channel: 'sms',
      }),
    });
  });

  it('accepts a whatsapp-prefixed From, keeps the raw address, and enqueues with Channel=whatsapp', async () => {
    const whatsappParams = {
      ...BASE_PARAMS,
      From: 'whatsapp:+8801712345678',
      To: 'whatsapp:+8809612345678',
    };
    const sig = computeSignature(webhookUrl(), whatsappParams);
    const res = await post(whatsappParams, sig);

    expect(res.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenCalledWith({
      type: 'inbound_sms',
      payload: expect.objectContaining({
        // Raw address preserved for the job — the worker re-normalizes (T17).
        From: 'whatsapp:+8801712345678',
        To: 'whatsapp:+8809612345678',
        MessageSid: BASE_PARAMS.MessageSid,
        AccountSid: BASE_PARAMS.AccountSid,
        Channel: 'whatsapp',
      }),
    });
  });

  it('rejects a whatsapp-prefixed non-E.164 From with 400 INVALID_PHONE (normalized first)', async () => {
    const sent = { ...BASE_PARAMS, From: 'whatsapp:not-a-phone' };
    const sig = computeSignature(webhookUrl(), sent);
    const res = await post(sent, sig);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('INVALID_PHONE');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('returns 500 when enqueue fails but never leaks signature semantics', async () => {
    mocks.enqueue.mockRejectedValue(new Error('queue down'));
    const sig = computeSignature(webhookUrl(), BASE_PARAMS);
    const res = await post(BASE_PARAMS, sig);

    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('queue_unavailable');
  });

  it('rejects a tampered body with 401', async () => {
    // Signed for Body=CONFIRM, but the actual payload says R → signature mismatch.
    const sig = computeSignature(webhookUrl(), { ...BASE_PARAMS, Body: 'CONFIRM' });
    const res = await post({ ...BASE_PARAMS, Body: 'R' }, sig);
    expect(res.status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a request with no signature header with 401', async () => {
    const res = await post(BASE_PARAMS);
    expect(res.status).toBe(401);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('rejects missing required fields with 400 (after valid signature)', async () => {
    const sent: Record<string, string> = {
      To: BASE_PARAMS.To,
      Body: BASE_PARAMS.Body,
      MessageSid: BASE_PARAMS.MessageSid,
    };
    const sig = computeSignature(webhookUrl(), sent);
    const res = await post(sent, sig);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; fields: string[] };
    expect(json.error).toBe('missing_fields');
    expect(json.fields).toContain('From');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a non-E.164 From with 400 INVALID_PHONE (before enqueue)', async () => {
    const sent = { ...BASE_PARAMS, From: 'not-a-phone' };
    const sig = computeSignature(webhookUrl(), sent);
    const res = await post(sent, sig);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('INVALID_PHONE');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('rejects an over-long From with 400 INVALID_PHONE', async () => {
    // 16 digits exceeds the E.164 max of 15.
    const sent = { ...BASE_PARAMS, From: '+1555123456789012' };
    const sig = computeSignature(webhookUrl(), sent);
    const res = await post(sent, sig);

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('INVALID_PHONE');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('rejects with 401 when TWILIO_AUTH_TOKEN is not configured (fails closed)', async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    try {
      const sig = computeSignature(webhookUrl(), BASE_PARAMS);
      const res = await post(BASE_PARAMS, sig);
      expect(res.status).toBe(401);
      expect(mocks.enqueue).not.toHaveBeenCalled();
    } finally {
      process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
    }
  });
});
