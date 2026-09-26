import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';
import type { DashboardApiErrorResponse, MessagesListResponse } from '@tradescheduler/shared';

/**
 * HTTP-level tests for T22 GET /api/dashboard/messages:
 * organization-service and outbound-ledger are fully mocked — the org-scope
 * ledger SQL itself is covered by outbound-ledger.test.ts.
 */
const mocks = vi.hoisted(() => ({
  getOrgContextByUserId: vi.fn(),
  getOutboundMessages: vi.fn(),
}));

vi.mock('../../services/organization-service.js', () => mocks);
vi.mock('../../services/outbound-ledger.js', () => mocks);

const JWT_SECRET = 'test_jwt_secret_000_secret_000';
const USER_ID = '__VG_UUID_f4a3b2c1d0e9__';
const ORG_ID = 'a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007';
const TZ = 'America/New_York';

const AUTHORIZED = {
  authorization: `Bearer ${jwt.sign({ sub: USER_ID }, JWT_SECRET, { issuer: 'tradescheduler' })}`,
};

let server: Server;
let baseUrl: string;

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers });
}

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.JWT_SECRET;
  server?.close();
});

beforeEach(() => {
  mocks.getOrgContextByUserId.mockReset().mockResolvedValue({ organizationId: ORG_ID, timezone: TZ });
  mocks.getOutboundMessages.mockReset().mockResolvedValue({ messages: [], total: 0 });
});

describe('GET /api/dashboard/messages', () => {
  it('200 with defaults — passes page/pageSize/timezone and echoes the service response', async () => {
    const res = await get('/api/dashboard/messages', AUTHORIZED);

    expect(res.status).toBe(200);
    expect((await res.json()) as MessagesListResponse).toEqual({ messages: [], total: 0, page: 1, pageSize: 20 });
    expect(mocks.getOutboundMessages).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ page: 1, pageSize: 20, timezone: TZ }),
    );
  });

  it('200 passes ?channel=sms&status=failed&page=2&pageSize=5 through to the service', async () => {
    const res = await get('/api/dashboard/messages?channel=sms&status=failed&page=2&pageSize=5', AUTHORIZED);

    expect(res.status).toBe(200);
    expect(mocks.getOutboundMessages).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ channel: 'sms', status: 'failed', page: 2, pageSize: 5 }),
    );
  });

  it('200 treats empty ?channel=&status= as no filter', async () => {
    const res = await get('/api/dashboard/messages?channel=&status=', AUTHORIZED);

    expect(res.status).toBe(200);
    const [, opts] = mocks.getOutboundMessages.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts).toEqual({ page: 1, pageSize: 20, timezone: TZ });
  });

  it('400 invalid_query for unknown channel/status values (service never called)', async () => {
    for (const qs of ['channel=voice', 'status=deliverd', 'status=all']) {
      const res = await get(`/api/dashboard/messages?${qs}`, AUTHORIZED);
      expect(res.status).toBe(400);
      expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'invalid_query' });
    }
    expect(mocks.getOutboundMessages).not.toHaveBeenCalled();
  });

  it('200 clamps page/pageSize (page 0 -> 1, pageSize 999 -> 100; page=abc -> 1)', async () => {
    const clamped = await get('/api/dashboard/messages?page=0&pageSize=999', AUTHORIZED);
    expect(clamped.status).toBe(200);
    expect(mocks.getOutboundMessages).toHaveBeenLastCalledWith(
      ORG_ID,
      expect.objectContaining({ page: 1, pageSize: 100 }),
    );

    const nonNumeric = await get('/api/dashboard/messages?page=abc', AUTHORIZED);
    expect(nonNumeric.status).toBe(200);
    expect(mocks.getOutboundMessages).toHaveBeenLastCalledWith(
      ORG_ID,
      expect.objectContaining({ page: 1 }),
    );
  });

  it('403 no_organization when the user has no org context', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    const res = await get('/api/dashboard/messages', AUTHORIZED);

    expect(res.status).toBe(403);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'no_organization' });
    expect(mocks.getOutboundMessages).not.toHaveBeenCalled();
  });

  it('401 missing_token without a bearer token', async () => {
    const res = await get('/api/dashboard/messages');

    expect(res.status).toBe(401);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'missing_token' });
  });

  it('500 server_error when the service rejects', async () => {
    mocks.getOutboundMessages.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('/api/dashboard/messages', AUTHORIZED);

    expect(res.status).toBe(500);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'server_error' });
    errorSpy.mockRestore();
  });
});