import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import type { Server } from 'node:http';

const mocks = vi.hoisted(() => ({
  getByMessageSid: vi.fn(),
  markStatus: vi.fn(),
}));

// The ledger is MOCKED in this file, so everything here proves the ROUTE's
// behavior and intent only — not the ledger's SQL guard. The real
// terminal-status guarantee ('failed' must stay updatable, i.e. absent from
// TERMINAL_STATUSES) is asserted against the real module in
// src/services/outbound-ledger.test.ts. TERMINAL_STATUSES is the one value the
// route actually reads, so it is supplied from the real module rather than
// hardcoded here — a local copy would drift from production silently.
vi.mock('../services/outbound-ledger.js', async () => {
  const actual = await vi.importActual<typeof import('../services/outbound-ledger.js')>(
    '../services/outbound-ledger.js',
  );
  return {
    getByMessageSid: mocks.getByMessageSid,
    markStatus: mocks.markStatus,
    TERMINAL_STATUSES: actual.TERMINAL_STATUSES,
  };
});

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
  mocks.getByMessageSid.mockResolvedValue(ledgerRow());
  mocks.markStatus.mockResolvedValue(undefined);
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
  });

  it('failed / undelivered → marks the ledger failed once and stops (no retry engine)', async () => {
    const res = await callback('failed', { ErrorCode: '30007' });

    expect(res.status).toBe(200);
    // Exactly one ledger write: the failure. No retried/escalated/blocked_optin.
    expect(mocks.markStatus).toHaveBeenCalledTimes(1);
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'failed', '30007');

    const res2 = await callback('undelivered');
    expect(res2.status).toBe(200);
    expect(mocks.markStatus).toHaveBeenCalledTimes(2);
    expect(mocks.markStatus).toHaveBeenLastCalledWith('ledger-1', 'failed', null);
  });

  it('terminal row (already delivered/retried/escalated) → 200 idempotent no-op', async () => {
    mocks.getByMessageSid.mockResolvedValue(ledgerRow({ status: 'delivered' }));

    const res = await callback('failed', { ErrorCode: '30007' });

    expect(res.status).toBe(200);
    expect(mocks.markStatus).not.toHaveBeenCalled();
  });

  it('a failed row is NOT terminal — a later genuine delivered report still marks it delivered', async () => {
    // The SMS-only round keeps a later real delivery report honorable: 'failed'
    // records the failure and stops, but it must not close the row for good.
    mocks.getByMessageSid.mockResolvedValue(ledgerRow({ status: 'failed', errorCode: '30007' }));

    const res = await callback('delivered');

    expect(res.status).toBe(200);
    expect(mocks.markStatus).toHaveBeenCalledTimes(1);
    expect(mocks.markStatus).toHaveBeenCalledWith('ledger-1', 'delivered');
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