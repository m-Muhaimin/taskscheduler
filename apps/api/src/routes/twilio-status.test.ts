import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { Server } from 'node:http';

const mocks = vi.hoisted(() => ({
  getByMessageSid: vi.fn(),
  markStatus: vi.fn(),
  handleFailedSms: vi.fn(),
}));

vi.mock('../services/outbound-ledger.js', () => ({
  getByMessageSid: mocks.getByMessageSid,
  markStatus: mocks.markStatus,
  TERMINAL_STATUSES: ['delivered', 'retried', 'escalated'],
}));

vi.mock('../services/fallback-service.js', () => ({
  handleFailedSms: mocks.handleFailedSms,
}));

import { createApp } from '../app.js';
import type { OutboundLedgerRow } from '../services/outbound-ledger.js';

const AUTH_TOKEN = 'test_twilio_auth_token_000';

let baseUrl = '';
let server: Server | null = null;

function ledgerRow(overrides: Partial<OutboundLedgerRow> = {}): OutboundLedgerRow {
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

function computeSignature(url: string, params: Record<string, string>): string {
  const sorted = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v}`)
    .join('');
  return crypto.createHmac('sha1', AUTH_TOKEN).update(url + sorted).digest('base64');
}

async function postStatus(params: Record<string, string>, signature?: string) {
  const url = `${baseUrl}/api/twilio/webhooks/status`;
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (signature !== undefined) {
    headers['X-Twilio-Signature'] = signature;
  }
  const res = await fetch(url, { method: 'POST', headers, body });
  return res;
}

const BASE_PARAMS: Record<string, string> = {
  MessageSid: 'SM123',
  MessageStatus: 'delivered',
  ErrorCode: '',
  To: '+8801712345678',
  From: '+8809612345678',
  AccountSid: 'AC1234567890',
};

async function callback(status: string, overrides: Record<string, string> = {}) {
  const params = { ...BASE_PARAMS, MessageStatus: status, ...overrides };
  return postStatus(params, computeSignature(`${baseUrl}/api/twilio/webhooks/status`, params));
}

beforeAll(async () => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.TWILIO_ACCOUNT_SID = 'AC_test_sid';
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server!.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((err) => (err ? reject(err) : resolve()));
  });
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_ACCOUNT_SID;
});

beforeEach(() => {
  mocks.getByMessageSid.mockReset();
  mocks.markStatus.mockReset();
  mocks.handleFailedSms.mockReset();
  mocks.getByMessageSid.mockResolvedValue(ledgerRow());
  mocks.markStatus.mockResolvedValue(undefined);
  mocks.handleFailedSms.mockResolvedValue({ outcome: 'no_fallback', detail: 'mock' });
});

describe('POST /api/twilio/webhooks/status — T18 delivery reports', () => {
  it('rejects a request with an invalid signature (401) before touching state', async () => {
    const tampered = { ...BASE_PARAMS, MessageStatus: 'failed' };
    const valid = computeSignature(`${baseUrl}/api/twilio/webhooks/status`, BASE_PARAMS);

    const res = await postStatus(tampered, valid);

    expect(res.status).toBe(401);
    expect(mocks.getByMessageSid).not.toHaveBeenCalled();
    expect(mocks.markStatus).not.toHaveBeenCalled();
  });

  it('rejects a request with NO signature (401)', async () => {
    const res = await postStatus(BASE_PARAMS);

    expect(res.status).toBe(401);
    expect(mocks.markStatus).not.toHaveBeenCalled();
  });

  it('unknown MessageSid → 200 no-op', async () => {
    mocks.getByMessageSid.mockResolvedValue(null);

    const res = await callback('delivered');

    expect(res.status).toBe(200);
    expect(mocks.markStatus).not.toHaveBeenCalled();
  });

  it('queued → 200 no-op (row is already queued)', async () => {
    const res = await callback('queued');

    expect(res.status).toBe(200);
    expect(mocks.markStatus).not.toHaveBeenCalled();
  });

  it('sent → marks the ledger sent', async () => {
    const res = await callback('sent');

    expect(res.status).toBe(200);
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'sent');
  });

  it('delivered → marks the ledger delivered (terminal)', async () => {
    const res = await callback('delivered');

    expect(res.status).toBe(200);
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'delivered');
    expect(mocks.handleFailedSms).not.toHaveBeenCalled();
  });

  it('failed (sms) → marks failed, runs the fallback engine, and re-marks retried | escalated | blocked_optin outcomes', async () => {
    mocks.handleFailedSms.mockResolvedValue({ outcome: 'retried', detail: 'whatsapp accepted' });

    const res = await callback('failed', { ErrorCode: '30007' });

    expect(res.status).toBe(200);
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'failed', '30007');
    expect(mocks.handleFailedSms).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ledger-1', messageSid: 'SM123', channel: 'sms' }),
    );
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'retried'); // re-mark outcome

    mocks.markStatus.mockClear();
    mocks.handleFailedSms.mockResolvedValue({ outcome: 'escalated', detail: 'whatsapp threw' });
    await callback('undelivered');
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'escalated');

    mocks.markStatus.mockClear();
    mocks.handleFailedSms.mockResolvedValue({ outcome: 'blocked_optin', detail: 'not opted in' });
    await callback('failed', { ErrorCode: '30007' });
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'blocked_optin');
  });

  it('failed (sms) with no_fallback | no_template outcome → row stays failed (no re-mark)', async () => {
    mocks.handleFailedSms.mockResolvedValue({ outcome: 'no_fallback', detail: 'country miss' });

    await callback('failed', { ErrorCode: '30007' });

    expect(mocks.handleFailedSms).toHaveBeenCalled();
    // Exactly one markStatus call (failed + error code); NO outcome re-mark.
    expect(mocks.markStatus).toHaveBeenCalledTimes(1);
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'failed', '30007');
    expect(mocks.markStatus).not.toHaveBeenCalledWith('ledger-1', 'no_fallback');
  });

  it('failed on a whatsapp-channel row → NO fallback re-try (this is the fallback channel)', async () => {
    mocks.getByMessageSid.mockResolvedValue(ledgerRow({ channel: 'whatsapp' }));

    await callback('failed', { ErrorCode: '30007' });

    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'failed', '30007');
    expect(mocks.handleFailedSms).not.toHaveBeenCalled();
  });

  it('terminal row (already delivered/retried/escalated) → 200 idempotent no-op', async () => {
    mocks.getByMessageSid.mockResolvedValue(ledgerRow({ status: 'delivered' }));

    const res = await callback('failed', { ErrorCode: '30007' });

    expect(res.status).toBe(200);
    expect(mocks.markStatus).not.toHaveBeenCalled();
    expect(mocks.handleFailedSms).not.toHaveBeenCalled();
  });

  it('unmapped Twilio statuses (accepted/scheduled/canceled/…) → 200 no-op', async () => {
    const res = await callback('accepted');

    expect(res.status).toBe(200);
    expect(mocks.markStatus).not.toHaveBeenCalled();
  });

  it('empty ErrorCode is treated as null (no error_code written)', async () => {
    await callback('failed');

    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'failed', null);
  });
});