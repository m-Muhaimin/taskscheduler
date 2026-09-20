import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';
import type { DashboardApiErrorResponse, EscalationListResponse } from '@tradescheduler/shared';

/**
 * HTTP-level tests for T20 GET /api/dashboard/escalations:
 * organization-service and escalation-service are fully mocked — the org-scope
 * SQL itself is covered by escalation-service.test.ts.
 */
const mocks = vi.hoisted(() => ({
  getOrgContextByUserId: vi.fn(),
  getEscalations: vi.fn(),
}));

vi.mock('../../services/organization-service.js', () => mocks);
vi.mock('../../services/escalation-service.js', () => mocks);

const JWT_SECRET = 'test_jwt_secret_000_secret_000';
const USER_ID = '__VG_UUID_f4a3b2c1d0e9__';
const ORG_ID = 'a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007';
const TZ = 'America/New_York';

const AUTHORIZED = {
  authorization: `Bearer ${jwt.sign({ sub: USER_ID }, JWT_SECRET, { issuer: 'tradescheduler' })}`,
};

/** A display-ready mocked response the route should echo verbatim. */
const MOCK_RESPONSE: EscalationListResponse = {
  escalations: [
    {
      id: 'esc-staff-001',
      type: 'staff_sms',
      customerPhone: '+15551234567',
      content: 'Staff acknowledged the job',
      status: 'pending',
      createdAt: '2026-09-18T15:15:00.000Z',
      resolvedAt: null,
      typeLabel: 'Staff message',
      createdAtDisplay: 'Sep 18, 11:15 AM',
      resolvedAtDisplay: null,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
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
  mocks.getEscalations.mockReset().mockResolvedValue({ escalations: [], total: 0, page: 1, pageSize: 20 });
});

describe('GET /api/dashboard/escalations', () => {
  it('200 with defaults — passes page/pageSize/timezone and echoes the service response', async () => {
    mocks.getEscalations.mockResolvedValue(MOCK_RESPONSE);
    const res = await get('/api/dashboard/escalations', AUTHORIZED);

    expect(res.status).toBe(200);
    expect((await res.json()) as EscalationListResponse).toEqual(MOCK_RESPONSE);
    expect(mocks.getEscalations).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ page: 1, pageSize: 20, timezone: TZ }),
    );
  });

  it('200 passes ?status=pending through to the service', async () => {
    const res = await get('/api/dashboard/escalations?status=pending', AUTHORIZED);

    expect(res.status).toBe(200);
    expect(mocks.getEscalations).toHaveBeenCalledWith(
      ORG_ID,
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('200 treats an empty ?status= as no filter', async () => {
    const res = await get('/api/dashboard/escalations?status=', AUTHORIZED);

    expect(res.status).toBe(200);
    const [, opts] = mocks.getEscalations.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts).toEqual({ page: 1, pageSize: 20, timezone: TZ });
  });

  it('400 invalid_query for non-pending/resolved status values', async () => {
    for (const status of ['bogus', 'all']) {
      const res = await get(`/api/dashboard/escalations?status=${status}`, AUTHORIZED);
      expect(res.status).toBe(400);
      expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'invalid_query' });
    }
    expect(mocks.getEscalations).not.toHaveBeenCalled();
  });

  it('200 clamps page/pageSize (page 0 -> 1, pageSize 999 -> 100; page=abc -> 1)', async () => {
    const clamped = await get('/api/dashboard/escalations?page=0&pageSize=999', AUTHORIZED);
    expect(clamped.status).toBe(200);
    expect(mocks.getEscalations).toHaveBeenLastCalledWith(
      ORG_ID,
      expect.objectContaining({ page: 1, pageSize: 100 }),
    );

    const nonNumeric = await get('/api/dashboard/escalations?page=abc', AUTHORIZED);
    expect(nonNumeric.status).toBe(200);
    expect(mocks.getEscalations).toHaveBeenLastCalledWith(
      ORG_ID,
      expect.objectContaining({ page: 1 }),
    );
  });

  it('403 no_organization when the user has no org context', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    const res = await get('/api/dashboard/escalations', AUTHORIZED);

    expect(res.status).toBe(403);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'no_organization' });
    expect(mocks.getEscalations).not.toHaveBeenCalled();
  });

  it('401 missing_token without a bearer token', async () => {
    const res = await get('/api/dashboard/escalations');

    expect(res.status).toBe(401);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'missing_token' });
  });

  it('500 server_error when the service rejects', async () => {
    mocks.getEscalations.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('/api/dashboard/escalations', AUTHORIZED);

    expect(res.status).toBe(500);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'server_error' });
    errorSpy.mockRestore();
  });
});