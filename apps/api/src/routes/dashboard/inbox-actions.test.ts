import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from '../../app.js';
import type { DashboardApiErrorResponse, InboxActionResponse } from '@tradescheduler/shared';

/**
 * HTTP-level tests for inbox actions (T10):
 *  - POST /api/dashboard/inbox/:conversationId/reply
 *  - POST /api/dashboard/inbox/:conversationId/approve
 * Services are fully mocked (organization/dashboard/inbox) — the SQL layer is
 * covered by inbox-service.test.ts and dashboard-service.test.ts.
 */
const mocks = vi.hoisted(() => ({
  getOrgContextByUserId: vi.fn(),
  getInboxItems: vi.fn(),
  deriveInboxSuggestion: vi.fn(),
  getInboxConversation: vi.fn(),
  enqueueOutboundReply: vi.fn(),
  closeConversation: vi.fn(),
}));

vi.mock('../../services/organization-service.js', () => mocks);
vi.mock('../../services/dashboard-service.js', () => mocks);
vi.mock('../../services/inbox-service.js', () => mocks);

const JWT_SECRET = 'test_jwt_secret_000_secret_000';
const USER_ID = '__VG_UUID_f4a3b2c1d0e9__';
const ORG_ID = 'a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007';
const TZ = 'America/New_York';
const CONV_ID = '__VG_UUID_conv_t10_0001__';

const AUTHORIZED = {
  authorization: `Bearer ${jwt.sign({ sub: USER_ID }, JWT_SECRET, { issuer: 'tradescheduler' })}`,
};

const CONVERSATION = {
  id: CONV_ID,
  status: 'open',
  outboundBody: null,
  state: null,
  offeredSlots: null,
  escalationReason: null,
};

let server: Server;
let baseUrl: string;

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
  mocks.getOrgContextByUserId.mockReset().mockResolvedValue({ organizationId: ORG_ID, timezone: TZ });
  mocks.getInboxItems.mockReset().mockResolvedValue([]);
  mocks.getInboxConversation.mockReset().mockResolvedValue(CONVERSATION);
  mocks.deriveInboxSuggestion.mockReset().mockReturnValue('Offer slots: Mon 9:00, Tue 1:30');
  mocks.enqueueOutboundReply.mockReset().mockResolvedValue(undefined);
  mocks.closeConversation.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/dashboard/inbox/:conversationId/reply', () => {
  it('200 {ok:true} — trims the body, queues the outbound message, closes the conversation', async () => {
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/reply`, { body: '  Sure, Tuesday works.  ' }, AUTHORIZED);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true } satisfies InboxActionResponse);
    expect(mocks.getInboxConversation).toHaveBeenCalledWith(CONV_ID, ORG_ID);
    expect(mocks.enqueueOutboundReply).toHaveBeenCalledWith(CONV_ID, 'Sure, Tuesday works.', ORG_ID);
    expect(mocks.closeConversation).toHaveBeenCalledWith(CONV_ID, ORG_ID);
  });

  it('200 when the trimmed body is exactly 2000 characters (the max)', async () => {
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/reply`, { body: 'x'.repeat(2000) }, AUTHORIZED);
    expect(res.status).toBe(200);
    expect(mocks.enqueueOutboundReply).toHaveBeenCalledWith(CONV_ID, 'x'.repeat(2000), ORG_ID);
  });

  it('400 invalid_body when body is missing', async () => {
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/reply`, {}, AUTHORIZED);
    expect(res.status).toBe(400);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'invalid_body' });
    expect(mocks.enqueueOutboundReply).not.toHaveBeenCalled();
  });

  it('400 invalid_body when body is empty or whitespace-only', async () => {
    for (const body of ['', '   ']) {
      const res = await post(`/api/dashboard/inbox/${CONV_ID}/reply`, { body }, AUTHORIZED);
      expect(res.status).toBe(400);
      expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'invalid_body' });
    }
  });

  it('400 invalid_body when body exceeds 2000 characters or is not a string', async () => {
    for (const body of ['x'.repeat(2001), 123, null, { text: 'hi' }]) {
      const res = await post(`/api/dashboard/inbox/${CONV_ID}/reply`, { body }, AUTHORIZED);
      expect(res.status).toBe(400);
    }
    expect(mocks.enqueueOutboundReply).not.toHaveBeenCalled();
  });

  it('404 conversation_not_found when the conversation is missing or other-org', async () => {
    mocks.getInboxConversation.mockResolvedValue(null);
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/reply`, { body: 'Sure.' }, AUTHORIZED);
    expect(res.status).toBe(404);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'conversation_not_found' });
    expect(mocks.enqueueOutboundReply).not.toHaveBeenCalled();
    expect(mocks.closeConversation).not.toHaveBeenCalled();
  });

  it('403 no_organization when the user has no org membership', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/reply`, { body: 'Sure.' }, AUTHORIZED);
    expect(res.status).toBe(403);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'no_organization' });
  });

  it('401 missing_token without a bearer token', async () => {
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/reply`, { body: 'Sure.' });
    expect(res.status).toBe(401);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'missing_token' });
  });
});

describe('POST /api/dashboard/inbox/:conversationId/approve', () => {
  it('200 {ok:true} — derives the body from the conversation and queues it', async () => {
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/approve`, {}, AUTHORIZED);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true } satisfies InboxActionResponse);
    expect(mocks.deriveInboxSuggestion).toHaveBeenCalledWith({
      outboundBody: null,
      state: null,
      offeredSlots: null,
      escalationReason: null,
      tz: TZ,
    });
    expect(mocks.enqueueOutboundReply).toHaveBeenCalledWith(CONV_ID, 'Offer slots: Mon 9:00, Tue 1:30', ORG_ID);
    expect(mocks.closeConversation).toHaveBeenCalledWith(CONV_ID, ORG_ID);
  });

  it('400 no_suggestion when nothing can be derived', async () => {
    mocks.deriveInboxSuggestion.mockReturnValue('');
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/approve`, {}, AUTHORIZED);
    expect(res.status).toBe(400);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'no_suggestion' });
    expect(mocks.enqueueOutboundReply).not.toHaveBeenCalled();
    expect(mocks.closeConversation).not.toHaveBeenCalled();
  });

  it('404 conversation_not_found when the conversation is missing or other-org', async () => {
    mocks.getInboxConversation.mockResolvedValue(null);
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/approve`, {}, AUTHORIZED);
    expect(res.status).toBe(404);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'conversation_not_found' });
  });

  it('403 no_organization when the user has no org membership', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/approve`, {}, AUTHORIZED);
    expect(res.status).toBe(403);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'no_organization' });
  });

  it('401 missing_token without a bearer token', async () => {
    const res = await post(`/api/dashboard/inbox/${CONV_ID}/approve`, {});
    expect(res.status).toBe(401);
    expect((await res.json()) as DashboardApiErrorResponse).toEqual({ error: 'missing_token' });
  });
});