import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';
import type {
  CreateWorkspaceResponse,
  DashboardApiErrorResponse,
  WorkspaceStatusResponse,
} from '@tradescheduler/shared';

/**
 * HTTP-level tests for:
 *  - GET  /api/workspace/status
 *  - POST /api/workspace
 * organization-service is fully mocked — createOrganization's own SQL/
 * transaction behavior (slug collisions, atomicity) is covered by
 * organization-service.test.ts.
 */
const mocks = vi.hoisted(() => ({
  getOrgContextByUserId: vi.fn(),
  createOrganization: vi.fn(),
}));

vi.mock('../services/organization-service.js', () => mocks);

const JWT_SECRET = 'test_jwt_secret_000_secret_000';
const USER_ID = '__VG_UUID_f4a3b2c1d0e9__';
const ORG_ID = 'a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007';

const AUTHORIZED = {
  authorization: `Bearer ${jwt.sign({ sub: USER_ID }, JWT_SECRET, { issuer: 'tradescheduler' })}`,
};

let server: Server;
let baseUrl: string;

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
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
  mocks.getOrgContextByUserId.mockReset();
  mocks.createOrganization.mockReset();
});

describe('GET /api/workspace/status', () => {
  it('401s with no Authorization header', async () => {
    const res = await get('/api/workspace/status');
    expect(res.status).toBe(401);
  });

  it('returns hasOrganization:false for a user with no membership row', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    const res = await get('/api/workspace/status', AUTHORIZED);
    expect(res.status).toBe(200);
    expect((await res.json()) as WorkspaceStatusResponse).toEqual({ hasOrganization: false });
  });

  it('returns hasOrganization:true once the user belongs to an org', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue({ organizationId: ORG_ID, timezone: 'America/New_York' });
    const res = await get('/api/workspace/status', AUTHORIZED);
    expect(res.status).toBe(200);
    expect((await res.json()) as WorkspaceStatusResponse).toEqual({ hasOrganization: true });
  });
});

describe('POST /api/workspace', () => {
  it('401s with no Authorization header', async () => {
    const res = await post('/api/workspace', { name: 'Acme Plumbing' });
    expect(res.status).toBe(401);
  });

  it('400s on an empty name', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    const res = await post('/api/workspace', { name: '' }, AUTHORIZED);
    expect(res.status).toBe(400);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'invalid_body' });
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });

  it('409s when the caller already belongs to an organization', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue({ organizationId: ORG_ID, timezone: 'America/New_York' });
    const res = await post('/api/workspace', { name: 'Acme Plumbing' }, AUTHORIZED);
    expect(res.status).toBe(409);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'already_has_organization' });
    expect(mocks.createOrganization).not.toHaveBeenCalled();
  });

  it('creates the organization and returns 201 for a first-time user', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    mocks.createOrganization.mockResolvedValue({
      id: ORG_ID,
      name: 'Acme Plumbing',
      slug: 'acme-plumbing',
      timezone: 'America/Chicago',
      status: 'active',
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
    });

    const res = await post('/api/workspace', { name: 'Acme Plumbing', timezone: 'America/Chicago' }, AUTHORIZED);

    expect(res.status).toBe(201);
    expect((await res.json()) as CreateWorkspaceResponse).toEqual({
      organization: { id: ORG_ID, name: 'Acme Plumbing', slug: 'acme-plumbing', timezone: 'America/Chicago' },
    });
    expect(mocks.createOrganization).toHaveBeenCalledWith({
      name: 'Acme Plumbing',
      timezone: 'America/Chicago',
      ownerId: USER_ID,
    });
  });

  it('defaults the timezone when omitted', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    mocks.createOrganization.mockResolvedValue({
      id: ORG_ID,
      name: 'Acme Plumbing',
      slug: 'acme-plumbing',
      timezone: 'America/New_York',
      status: 'active',
      createdAt: '2026-09-20T00:00:00.000Z',
      updatedAt: '2026-09-20T00:00:00.000Z',
    });

    await post('/api/workspace', { name: 'Acme Plumbing' }, AUTHORIZED);

    expect(mocks.createOrganization).toHaveBeenCalledWith({
      name: 'Acme Plumbing',
      timezone: 'America/New_York',
      ownerId: USER_ID,
    });
  });
});
