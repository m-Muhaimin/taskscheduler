import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';

/**
 * HTTP-level tests for /api/auth/google/* (same shape as auth.test.ts:
 * real Express app on an ephemeral port, services mocked). The callback is
 * public (Google redirects there); start/status/delete require a real JWT.
 */
const mocks = vi.hoisted(() => ({
  createOauthState: vi.fn(),
  consumeOauthState: vi.fn(),
  generateAuthUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  saveCredentials: vi.fn(),
  loadCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
  setUserGoogleCalendarId: vi.fn(),
}));

vi.mock('../services/google-auth-service.js', () => ({
  createOauthState: mocks.createOauthState,
  consumeOauthState: mocks.consumeOauthState,
  generateAuthUrl: mocks.generateAuthUrl,
  exchangeCodeForTokens: mocks.exchangeCodeForTokens,
  saveCredentials: mocks.saveCredentials,
  loadCredentials: mocks.loadCredentials,
  deleteCredentials: mocks.deleteCredentials,
}));

vi.mock('../services/booking-service.js', () => ({
  setUserGoogleCalendarId: mocks.setUserGoogleCalendarId,
}));

const JWT_SECRET = 'test_jwt_secret_000_secret_000';
const USER_ID = '__VG_UUID_google_oauth_01__';
const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth?state=state-zz';

function signToken(): string {
  return jwt.sign({ sub: USER_ID }, JWT_SECRET, { issuer: 'tradescheduler', expiresIn: '1h' });
}

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${signToken()}` };
}

let server: Server;
let baseUrl: string;

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
  for (const fn of Object.values(mocks)) fn.mockReset();
});

describe('GET /api/auth/google/start', () => {
  it('requires a valid JWT', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/start`);
    expect(res.status).toBe(401);
  });

  it('creates a state and returns the consent URL', async () => {
    mocks.createOauthState.mockResolvedValueOnce('state-zz');
    mocks.generateAuthUrl.mockReturnValueOnce(CONSENT_URL);
    const res = await fetch(`${baseUrl}/api/auth/google/start`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ url: CONSENT_URL });
    expect(mocks.createOauthState).toHaveBeenCalledWith(USER_ID);
    expect(mocks.generateAuthUrl).toHaveBeenCalledWith('state-zz');
  });

  it('maps missing Google config to 503 server_not_configured', async () => {
    mocks.createOauthState.mockResolvedValueOnce('state-zz');
    mocks.generateAuthUrl.mockImplementationOnce(() => {
      throw new Error(
        'Google OAuth is not configured (need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)',
      );
    });
    const res = await fetch(`${baseUrl}/api/auth/google/start`, { headers: authHeaders() });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'server_not_configured' });
  });
});

describe('GET /api/auth/google/callback (public)', () => {
  it('redirects to settings with google=denied when the user declines', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/callback?state=state-zz&error=access_denied`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/dashboard\/settings\?google=denied$/);
    expect(mocks.consumeOauthState).not.toHaveBeenCalled();
  });

  it('rejects an unknown or expired state', async () => {
    mocks.consumeOauthState.mockResolvedValueOnce(null);
    const res = await fetch(`${baseUrl}/api/auth/google/callback?state=stale&code=code-x`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_state' });
    expect(mocks.exchangeCodeForTokens).not.toHaveBeenCalled();
  });

  it('requires a code once the state is valid', async () => {
    mocks.consumeOauthState.mockResolvedValueOnce(USER_ID);
    const res = await fetch(`${baseUrl}/api/auth/google/callback?state=state-zz`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_body' });
  });

  it('exchanges the code, stores tokens as primary and redirects on success', async () => {
    mocks.consumeOauthState.mockResolvedValueOnce(USER_ID);
    mocks.exchangeCodeForTokens.mockResolvedValueOnce({
      accessToken: 'at-new',
      refreshToken: 'rt-new',
      tokenExpiry: '2026-09-20T00:00:00.000Z',
      scope: 'https://www.googleapis.com/auth/calendar',
    });
    mocks.saveCredentials.mockResolvedValueOnce(undefined);
    mocks.setUserGoogleCalendarId.mockResolvedValueOnce(true);

    const res = await fetch(
      `${baseUrl}/api/auth/google/callback?state=state-zz&code=code-new`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/\/dashboard\/settings\?google=connected$/);
    expect(mocks.saveCredentials).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ calendarId: 'primary', refreshToken: 'rt-new' }),
    );
    expect(mocks.setUserGoogleCalendarId).toHaveBeenCalledWith(USER_ID, 'primary');
  });
});

describe('GET /api/auth/google/status', () => {
  it('reports disconnected when no credentials are stored', async () => {
    mocks.loadCredentials.mockResolvedValueOnce(null);
    const res = await fetch(`${baseUrl}/api/auth/google/status`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ connected: false, calendarId: null });
  });

  it('reports connected with the calendar id', async () => {
    mocks.loadCredentials.mockResolvedValueOnce({
      userId: USER_ID,
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      tokenExpiry: null,
      scope: null,
      calendarId: 'primary',
    });
    const res = await fetch(`${baseUrl}/api/auth/google/status`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ connected: true, calendarId: 'primary' });
  });

  it('requires a valid JWT', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google/status`);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/auth/google', () => {
  it('drops the stored tokens and the profile calendar id', async () => {
    mocks.deleteCredentials.mockResolvedValueOnce(undefined);
    mocks.setUserGoogleCalendarId.mockResolvedValueOnce(true);
    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.deleteCredentials).toHaveBeenCalledWith(USER_ID);
    expect(mocks.setUserGoogleCalendarId).toHaveBeenCalledWith(USER_ID, null);
  });

  it('requires a valid JWT', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});
