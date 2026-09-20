import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import type { AssistantChatResponse } from '@tradescheduler/shared';
import { createApp } from '../app.js';

/**
 * HTTP-level tests for POST /api/assistant (ridgeline-assistant-chat.md T4).
 *
 * Auth is OPTIONAL per the controller ruling (supersedes the doc's requireAuth
 * draft): no header → anonymous 200; presented-but-bad token → 401 invalid_token;
 * valid token → best-effort org context forwarded as organizationId.
 *
 * assistant.service and organization-service are mocked (vi.hoisted pattern);
 * @tradescheduler/ai (createProvider) is NOT mocked — with AI_PROVIDER unset
 * it builds the offline fallback-only provider, and the mocked service never
 * calls it. Same listen(0)+fetch integration style as twilio-webhooks.test.ts
 * and settings.test.ts.
 */
const mocks = vi.hoisted(() => ({
  handleAssistantTurn: vi.fn(),
  getOrgContextByUserId: vi.fn(),
}));

vi.mock('../services/assistant.service.js', () => ({
  handleAssistantTurn: mocks.handleAssistantTurn,
}));

vi.mock('../services/organization-service.js', () => ({
  getOrgContextByUserId: mocks.getOrgContextByUserId,
}));

// Same secret source the middleware's jwtSecret() reads at request time:
// process.env.JWT_SECRET (settings.test.ts pattern).
const JWT_SECRET = 'test_jwt_secret_000_secret_000';
const USER_ID = '__VG_UUID_assistant_user_000__';
const ORG_ID = '__VG_UUID_assistant_org_001__';
const TZ = 'America/New_York';

const MOCK_TURN: AssistantChatResponse = {
  reply: 'You can confirm by replying "yes" to the confirmation text.',
  action: 'none',
  escalated: false,
};

const VALID_BODY = {
  messages: [{ role: 'user', content: 'Is my appointment confirmed for tomorrow?' }],
};

const PREVIOUS_AI_PROVIDER = process.env.AI_PROVIDER;

let server: Server;
let baseUrl: string;

function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/assistant`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function authHeader(): Record<string, string> {
  return { authorization: `Bearer ${jwt.sign({ sub: USER_ID }, JWT_SECRET, { issuer: 'tradescheduler' })}` };
}

beforeAll(async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  // Guarantee createProvider() selects fallback-only (offline) regardless of
  // the dev machine's env — the mocked service never calls the provider anyway.
  delete process.env.AI_PROVIDER;
  const app = createApp();
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.JWT_SECRET;
  if (PREVIOUS_AI_PROVIDER !== undefined) {
    process.env.AI_PROVIDER = PREVIOUS_AI_PROVIDER;
  } else {
    delete process.env.AI_PROVIDER;
  }
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  mocks.handleAssistantTurn.mockReset().mockResolvedValue(MOCK_TURN);
  mocks.getOrgContextByUserId.mockReset().mockResolvedValue({ organizationId: ORG_ID, timezone: TZ });
});

describe('POST /api/assistant', () => {
  it('200 for an anonymous request — mocked reply echoed, no organizationId, no org lookup', async () => {
    const res = await post(VALID_BODY);

    expect(res.status).toBe(200);
    expect((await res.json()) as AssistantChatResponse).toEqual(MOCK_TURN);

    const call = mocks.handleAssistantTurn.mock.calls[0];
    expect(call).toBeDefined();
    const [input, provider] = call as [Record<string, unknown>, unknown];
    expect(input).toEqual(VALID_BODY);
    expect(input).not.toHaveProperty('organizationId');
    expect(provider).toBeDefined();
    expect(mocks.getOrgContextByUserId).not.toHaveBeenCalled();
  });

  it('200 for an authenticated request — organizationId from org context is forwarded', async () => {
    const res = await post(VALID_BODY, authHeader());

    expect(res.status).toBe(200);
    expect((await res.json()) as AssistantChatResponse).toEqual(MOCK_TURN);

    expect(mocks.getOrgContextByUserId).toHaveBeenCalledWith(USER_ID);
    expect(mocks.handleAssistantTurn).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID }),
      expect.anything(),
    );
  });

  it('200 for an authenticated request when org context resolves to null — no organizationId forwarded', async () => {
    mocks.getOrgContextByUserId.mockResolvedValue(null);
    const res = await post(VALID_BODY, authHeader());

    expect(res.status).toBe(200);
    expect((await res.json()) as AssistantChatResponse).toEqual(MOCK_TURN);

    const call = mocks.handleAssistantTurn.mock.calls[0];
    expect(call).toBeDefined();
    const [input] = call as [Record<string, unknown>, unknown];
    expect(input).toEqual(VALID_BODY);
    expect(input).not.toHaveProperty('organizationId');
  });

  it('400 invalid_body with zod issues for malformed bodies — service never called', async () => {
    const invalidBodies: unknown[] = [
      { messages: [] }, // empty messages
      { messages: [{ role: 'assistant', content: 'last turn is not the user' }] }, // last role must be user
      { messages: [{ role: 'user', content: '' }] }, // empty content
      { messages: [{ role: 'user', content: 'x'.repeat(4001) }] }, // content over 4000
      { messages: [{ role: 'user', content: 'hi' }], customerPhone: 'not-a-phone' }, // bad customerPhone
    ];

    for (const body of invalidBodies) {
      const res = await post(body);
      expect(res.status).toBe(400);
      const json = (await res.json()) as { code: string; issues: unknown[] };
      expect(json.code).toBe('invalid_body');
      expect(Array.isArray(json.issues)).toBe(true);
      expect(json.issues.length).toBeGreaterThan(0);
    }
    expect(mocks.handleAssistantTurn).not.toHaveBeenCalled();
  });

  it('401 invalid_token when a bad token is presented (wrong secret / garbage / expired) — never downgraded', async () => {
    const badTokens = [
      jwt.sign({ sub: USER_ID }, 'definitely-wrong-secret', { issuer: 'tradescheduler' }),
      'not-a-jwt',
      jwt.sign({ sub: USER_ID }, JWT_SECRET, { issuer: 'tradescheduler', expiresIn: -60 }),
    ];

    for (const token of badTokens) {
      const res = await post(VALID_BODY, { authorization: `Bearer ${token}` });
      expect(res.status).toBe(401);
      expect((await res.json()) as { code: string }).toEqual({ code: 'invalid_token' });
    }
    expect(mocks.handleAssistantTurn).not.toHaveBeenCalled();
    expect(mocks.getOrgContextByUserId).not.toHaveBeenCalled();
  });

  it('401 invalid_token when the Authorization header is present but not a Bearer token', async () => {
    const res = await post(VALID_BODY, { authorization: 'Basic dXNlcjpwYXNz' });

    expect(res.status).toBe(401);
    expect((await res.json()) as { code: string }).toEqual({ code: 'invalid_token' });
    expect(mocks.handleAssistantTurn).not.toHaveBeenCalled();
  });

  it('500 server_error when handleAssistantTurn throws', async () => {
    mocks.handleAssistantTurn.mockRejectedValue(new Error('assistant down'));
    const res = await post(VALID_BODY);

    expect(res.status).toBe(500);
    expect((await res.json()) as { code: string }).toEqual({ code: 'server_error' });
  });
});