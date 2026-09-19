import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';
import type { DashboardApiErrorResponse, DashboardAutomationResponse } from '@tradescheduler/shared';

/**
 * HTTP-level tests for T11 automation settings:
 *  - GET   /api/dashboard/settings/automation
 *  - PATCH /api/dashboard/settings/automation
 * organization-service is fully mocked; the jsonb_set SQL itself is covered
 * by organization-service.test.ts.
 */
const mocks = vi.hoisted(() => ({
  getOrgContextByUserId: vi.fn(),
  getOrganizationSettings: vi.fn(),
  updateOrganizationSettings: vi.fn(),
}));

vi.mock('../../services/organization-service.js', () => mocks);

const JWT_SECRET = 'test_jwt_secret_000_secret_000';
const USER_ID = '__VG_UUID_f4a3b2c1d0e9__';
const ORG_ID = 'a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007';
const TZ = 'America/New_York';

const AUTHORIZED = {
  authorization: `Bearer ${jwt.sign({ sub: USER_ID }, JWT_SECRET, { issuer: 'tradescheduler' })}`,
};

const DEFAULTS = { aiFrontDesk: true, reviewRequests: true, depositRequired: false };

let server: Server;
let baseUrl: string;

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers });
}

function patch(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
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
  mocks.getOrganizationSettings.mockReset().mockResolvedValue({});
  mocks.updateOrganizationSettings.mockReset().mockResolvedValue({});
});

describe('GET /api/dashboard/settings/automation', () => {
  it('200 defaults when the settings jsonb is empty', async () => {
    mocks.getOrganizationSettings.mockResolvedValue({});
    const res = await get('/api/dashboard/settings/automation', AUTHORIZED);
    expect(res.status).toBe(200);
    expect((await res.json()) as DashboardAutomationResponse).toEqual({ automation: DEFAULTS });
    expect(mocks.getOrganizationSettings).toHaveBeenCalledWith(ORG_ID);
  });

  it('200 defaults when the org row is missing (null settings)', async () => {
    mocks.getOrganizationSettings.mockResolvedValue(null);
    const res = await get('/api/dashboard/settings/automation', AUTHORIZED);
    expect(res.status).toBe(200);
    expect((await res.json()) as DashboardAutomationResponse).toEqual({ automation: DEFAULTS });
  });

  it('200 merges stored booleans over defaults, preserving other settings keys', async () => {
    mocks.getOrganizationSettings.mockResolvedValue({ automation: { aiFrontDesk: false }, brand: 'x' });
    const res = await get('/api/dashboard/settings/automation', AUTHORIZED);
    expect(res.status).toBe(200);
    expect((await res.json()) as DashboardAutomationResponse).toEqual({
      automation: { aiFrontDesk: false, reviewRequests: true, depositRequired: false },
    });
  });

  it('200 falls back to defaults for non-boolean stored values', async () => {
    mocks.getOrganizationSettings.mockResolvedValue({ automation: { depositRequired: 'yes', reviewRequests: 1 } });
    const res = await get('/api/dashboard/settings/automation', AUTHORIZED);
    expect((await res.json()) as DashboardAutomationResponse).toEqual({ automation: DEFAULTS });
  });

  it('403 no_organization when the user has no org membership', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    const res = await get('/api/dashboard/settings/automation', AUTHORIZED);
    expect(res.status).toBe(403);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'no_organization' });
  });

  it('401 missing_token without a bearer token', async () => {
    const res = await get('/api/dashboard/settings/automation');
    expect(res.status).toBe(401);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'missing_token' });
  });
});

describe('PATCH /api/dashboard/settings/automation', () => {
  it('200 merges the partial patch and returns the full merged settings', async () => {
    mocks.updateOrganizationSettings.mockResolvedValue({
      automation: { aiFrontDesk: false, depositRequired: true },
      brand: 'x',
    });
    const res = await patch('/api/dashboard/settings/automation', { automation: { aiFrontDesk: false } }, AUTHORIZED);

    expect(res.status).toBe(200);
    expect((await res.json()) as DashboardAutomationResponse).toEqual({
      automation: { aiFrontDesk: false, reviewRequests: true, depositRequired: true },
    });
    expect(mocks.updateOrganizationSettings).toHaveBeenCalledWith(ORG_ID, { aiFrontDesk: false });
  });

  it('200 accepts a full set of known keys', async () => {
    mocks.updateOrganizationSettings.mockResolvedValue({
      automation: { aiFrontDesk: true, reviewRequests: false, depositRequired: true },
    });
    const res = await patch(
      '/api/dashboard/settings/automation',
      { automation: { aiFrontDesk: true, reviewRequests: false, depositRequired: true } },
      AUTHORIZED,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as DashboardAutomationResponse).toEqual({
      automation: { aiFrontDesk: true, reviewRequests: false, depositRequired: true },
    });
    expect(mocks.updateOrganizationSettings).toHaveBeenCalledWith(ORG_ID, {
      aiFrontDesk: true,
      reviewRequests: false,
      depositRequired: true,
    });
  });

  it('200 accepts an empty automation object (no-op merge)', async () => {
    const res = await patch('/api/dashboard/settings/automation', { automation: {} }, AUTHORIZED);
    expect(res.status).toBe(200);
    expect(mocks.updateOrganizationSettings).toHaveBeenCalledWith(ORG_ID, {});
  });

  it('400 invalid_body for unknown automation keys', async () => {
    const res = await patch(
      '/api/dashboard/settings/automation',
      { automation: { aiFrontDesk: true, nope: false } },
      AUTHORIZED,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'invalid_body' });
    expect(mocks.updateOrganizationSettings).not.toHaveBeenCalled();
  });

  it('400 invalid_body for non-boolean values', async () => {
    for (const automation of [{ aiFrontDesk: 'yes' }, { aiFrontDesk: 1 }, { aiFrontDesk: null }, { aiFrontDesk: {} }]) {
      const res = await patch('/api/dashboard/settings/automation', { automation }, AUTHORIZED);
      expect(res.status).toBe(400);
    }
    expect(mocks.updateOrganizationSettings).not.toHaveBeenCalled();
  });

  it('400 invalid_body when automation is not an object', async () => {
    for (const automation of [null, true, 'all', [1]]) {
      const res = await patch('/api/dashboard/settings/automation', { automation }, AUTHORIZED);
      expect(res.status).toBe(400);
    }
  });

  it('400 invalid_body when automation is missing', async () => {
    for (const body of [{}, { automation: undefined }, { other: 1 }]) {
      const res = await patch('/api/dashboard/settings/automation', body, AUTHORIZED);
      expect(res.status).toBe(400);
    }
  });

  it('403 no_organization when the user has no org membership', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    const res = await patch('/api/dashboard/settings/automation', { automation: { aiFrontDesk: false } }, AUTHORIZED);
    expect(res.status).toBe(403);
  });

  it('401 missing_token without a bearer token', async () => {
    const res = await patch('/api/dashboard/settings/automation', { automation: { aiFrontDesk: false } });
    expect(res.status).toBe(401);
  });
});