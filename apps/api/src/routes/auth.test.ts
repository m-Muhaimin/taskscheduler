import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';

/**
 * HTTP-level tests for /api/auth/* with auth-service fully mocked (the scrypt
 * + pg layer is covered by auth-service.test.ts). JWT_SECRET is set so login
 * / register can sign real tokens; middleware paths (missing secret, bad
 * token) are exercised directly.
 */
const mocks = vi.hoisted(() => ({
  findTradespersonByEmail: vi.fn(),
  findTradespersonById: vi.fn(),
  createTradesperson: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  toAuthUser: vi.fn(),
  updateTradespersonProfile: vi.fn(),
  updateTradespersonPassword: vi.fn(),
}));

vi.mock('../services/auth-service.js', () => mocks);

const JWT_SECRET = 'test_jwt_secret_000_secret_000';
const USER_ID = '__VG_UUID_f4a3b2c1d0e9__';
const EMAIL = 'sam@solo-sam.test'; // fixture emails in routes are opaque tokens; zod .email() needs a real shape
const DISPLAY_NAME = 'Sam';
const AUTH_USER = { id: USER_ID, email: EMAIL, displayName: DISPLAY_NAME, phoneNumber: null };

let server: Server;
let baseUrl: string;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
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
  mocks.findTradespersonByEmail.mockReset();
  mocks.findTradespersonById.mockReset();
  mocks.createTradesperson.mockReset();
  mocks.hashPassword.mockReset();
  mocks.verifyPassword.mockReset();
  mocks.updateTradespersonProfile.mockReset();
  mocks.updateTradespersonPassword.mockReset();
  mocks.toAuthUser.mockImplementation((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    phoneNumber: row.phone_number ?? null,
  }));
});

describe('POST /api/auth/register', () => {
  it('201 with token + user for valid input', async () => {
    const stored = 'scrypt$16384$8$1$…';
    const row = { id: USER_ID, email: EMAIL, password_hash: stored, display_name: DISPLAY_NAME };
    mocks.findTradespersonByEmail.mockResolvedValueOnce(null);
    mocks.hashPassword.mockResolvedValueOnce(stored);
    mocks.createTradesperson.mockResolvedValueOnce(row);

    const res = await post('/api/auth/register', {
      displayName: DISPLAY_NAME,
      email: EMAIL,
      password: 's3cret-pass-123',
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; user: Record<string, unknown> };
    expect(body.user).toEqual(AUTH_USER);
    expect(typeof body.token).toBe('string');
    const payload = jwt.verify(body.token, JWT_SECRET) as jwt.JwtPayload;
    expect(payload.sub).toBe(USER_ID);
    expect(payload.iss).toBe('tradescheduler');
    expect(payload.exp).toBeGreaterThan(Date.now() / 1000);
    expect(mocks.findTradespersonByEmail).toHaveBeenCalledWith(EMAIL.toLowerCase());
  });

  it('400 invalid_body for missing fields', async () => {
    const res = await post('/api/auth/register', { email: EMAIL });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_body' });
  });

  it('400 invalid_body for short password', async () => {
    const res = await post('/api/auth/register', {
      displayName: DISPLAY_NAME,
      email: EMAIL,
      password: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('400 invalid_body for malformed email', async () => {
    const res = await post('/api/auth/register', {
      displayName: DISPLAY_NAME,
      email: 'not-an-email',
      password: 's3cret-pass-123',
    });
    expect(res.status).toBe(400);
  });

  it('409 email_taken when the email already exists', async () => {
    mocks.findTradespersonByEmail.mockResolvedValueOnce({
      id: USER_ID,
      email: EMAIL,
      password_hash: 'scrypt$…',
      display_name: DISPLAY_NAME,
    });
    const res = await post('/api/auth/register', {
      displayName: DISPLAY_NAME,
      email: EMAIL,
      password: 's3cret-pass-123',
    });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'email_taken' });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it('503 server_not_configured when DATABASE_URL is missing', async () => {
    mocks.findTradespersonByEmail.mockRejectedValueOnce(new Error('DATABASE_URL not configured'));
    const res = await post('/api/auth/register', {
      displayName: DISPLAY_NAME,
      email: EMAIL,
      password: 's3cret-pass-123',
    });
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'server_not_configured' });
  });

  it('500 server_not_configured when JWT_SECRET is missing', async () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      mocks.findTradespersonByEmail.mockResolvedValueOnce(null);
      mocks.hashPassword.mockResolvedValueOnce('scrypt$…');
      mocks.createTradesperson.mockResolvedValueOnce({
        id: USER_ID,
        email: EMAIL,
        password_hash: 'scrypt$…',
        display_name: DISPLAY_NAME,
      });
      const res = await post('/api/auth/register', {
        displayName: DISPLAY_NAME,
        email: EMAIL,
        password: 's3cret-pass-123',
      });
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: 'server_not_configured' });
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });
});

describe('POST /api/auth/login', () => {
  const stored = 'scrypt$16384$8$1$…';
  const row = { id: USER_ID, email: EMAIL, password_hash: stored, display_name: DISPLAY_NAME };

  it('200 with token + user for valid credentials', async () => {
    mocks.findTradespersonByEmail.mockResolvedValueOnce(row);
    mocks.verifyPassword.mockResolvedValueOnce(true);

    const res = await post('/api/auth/login', { email: EMAIL, password: 's3cret-pass-123' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user: Record<string, unknown> };
    expect(body.user).toEqual(AUTH_USER);
    const payload = jwt.verify(body.token, JWT_SECRET) as jwt.JwtPayload;
    expect(payload.sub).toBe(USER_ID);
    expect(payload.iss).toBe('tradescheduler');
  });

  it('401 invalid_credentials for wrong password', async () => {
    mocks.findTradespersonByEmail.mockResolvedValueOnce(row);
    mocks.verifyPassword.mockResolvedValueOnce(false);
    const res = await post('/api/auth/login', { email: EMAIL, password: 'wrong-password' });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_credentials' });
  });

  it('401 invalid_credentials for unknown email (no enumeration — same body)', async () => {
    mocks.findTradespersonByEmail.mockResolvedValueOnce(null);
    const res = await post('/api/auth/login', { email: 'nobody@solo-sam.test', password: 'x' });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_credentials' });
  });

  it('400 invalid_body for empty password', async () => {
    const res = await post('/api/auth/login', { email: EMAIL, password: '' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  function validToken(): string {
    return jwt.sign({ sub: USER_ID, email: EMAIL }, JWT_SECRET, { issuer: 'tradescheduler' });
  }

  it('200 with the current user for a valid token', async () => {
    mocks.findTradespersonById.mockResolvedValueOnce({
      id: USER_ID,
      email: EMAIL,
      password_hash: 'scrypt$…',
      display_name: DISPLAY_NAME,
    });
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${validToken()}` },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ user: AUTH_USER });
    expect(mocks.findTradespersonById).toHaveBeenCalledWith(USER_ID);
  });

  it('401 missing_token without an Authorization header', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'missing_token' });
  });

  it('401 missing_token for a non-Bearer header', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: 'Basic abc123' },
    });
    expect(res.status).toBe(401);
  });

  it('401 invalid_token for a tampered token', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${validToken()}tampered` },
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_token' });
  });

  it('401 invalid_token for a token signed with the wrong secret', async () => {
    const wrong = jwt.sign({ sub: USER_ID }, 'other_secret', { issuer: 'tradescheduler' });
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${wrong}` },
    });
    expect(res.status).toBe(401);
  });

  it('500 server_not_configured when JWT_SECRET is unset', async () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { authorization: `Bearer ${validToken()}` },
      });
      expect(res.status).toBe(500);
      await expect(res.json()).resolves.toEqual({ error: 'server_not_configured' });
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });
});

describe('PATCH /api/auth/profile', () => {
  function validToken(): string {
    return jwt.sign({ sub: USER_ID, email: EMAIL }, JWT_SECRET, { issuer: 'tradescheduler' });
  }

  function authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${validToken()}` };
  }

  it('200 with the updated user when changing displayName', async () => {
    const row = {
      id: USER_ID,
      email: EMAIL,
      password_hash: 'scrypt$…',
      display_name: 'Sam Jr',
      phone_number: null,
    };
    mocks.updateTradespersonProfile.mockResolvedValueOnce(row);
    const res = await patch('/api/auth/profile', { displayName: 'Sam Jr' }, authHeaders());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      user: { id: USER_ID, email: EMAIL, displayName: 'Sam Jr', phoneNumber: null },
    });
    expect(mocks.updateTradespersonProfile).toHaveBeenCalledWith(USER_ID, { displayName: 'Sam Jr' });
    expect(mocks.findTradespersonByEmail).not.toHaveBeenCalled();
  });

  it('200 with the updated user when setting phoneNumber', async () => {
    const row = {
      id: USER_ID,
      email: EMAIL,
      password_hash: 'scrypt$…',
      display_name: DISPLAY_NAME,
      phone_number: '+15551234567',
    };
    mocks.updateTradespersonProfile.mockResolvedValueOnce(row);
    const res = await patch('/api/auth/profile', { phoneNumber: '+15551234567' }, authHeaders());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user.phoneNumber).toBe('+15551234567');
  });

  it('200 clearing phoneNumber with null', async () => {
    const row = {
      id: USER_ID,
      email: EMAIL,
      password_hash: 'scrypt$…',
      display_name: DISPLAY_NAME,
      phone_number: null,
    };
    mocks.updateTradespersonProfile.mockResolvedValueOnce(row);
    const res = await patch('/api/auth/profile', { phoneNumber: null }, authHeaders());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user.phoneNumber).toBeNull();
    expect(mocks.updateTradespersonProfile).toHaveBeenCalledWith(USER_ID, { phoneNumber: null });
  });

  it('200 clearing phoneNumber with empty string', async () => {
    const row = {
      id: USER_ID,
      email: EMAIL,
      password_hash: 'scrypt$…',
      display_name: DISPLAY_NAME,
      phone_number: null,
    };
    mocks.updateTradespersonProfile.mockResolvedValueOnce(row);
    const res = await patch('/api/auth/profile', { phoneNumber: '' }, authHeaders());
    expect(res.status).toBe(200);
    expect(mocks.updateTradespersonProfile).toHaveBeenCalledWith(USER_ID, { phoneNumber: null });
  });

  it('200 with the updated user when changing email (lowercased)', async () => {
    const sentEmail = `${EMAIL.toLowerCase().replace('@', '+new@')}`; // derived valid email
    const existingEmail = sentEmail.toUpperCase(); // zod lowercases on parse
    mocks.findTradespersonByEmail.mockResolvedValueOnce(null);
    const row = {
      id: USER_ID,
      email: sentEmail,
      password_hash: 'scrypt$…',
      display_name: DISPLAY_NAME,
      phone_number: null,
    };
    mocks.updateTradespersonProfile.mockResolvedValueOnce(row);
    const res = await patch('/api/auth/profile', { email: existingEmail }, authHeaders());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body.user.email).toBe(sentEmail);
    expect(mocks.findTradespersonByEmail).toHaveBeenCalledWith(sentEmail);
    expect(mocks.updateTradespersonProfile).toHaveBeenCalledWith(USER_ID, {
      email: sentEmail,
    });
  });

  it('200 no-op when the email already belongs to self', async () => {
    const self = {
      id: USER_ID,
      email: EMAIL,
      password_hash: 'scrypt$…',
      display_name: DISPLAY_NAME,
      phone_number: null,
    };
    mocks.findTradespersonByEmail.mockResolvedValueOnce(self);
    mocks.updateTradespersonProfile.mockResolvedValueOnce(self);
    const res = await patch('/api/auth/profile', { email: EMAIL }, authHeaders());
    expect(res.status).toBe(200);
    expect(mocks.updateTradespersonProfile).toHaveBeenCalled();
  });

  it('409 email_taken when another tradesperson holds the email', async () => {
    const other = {
      id: '__VG_UUID_a1b2c3d4e5f6__',
      email: EMAIL,
      password_hash: 'scrypt$…',
      display_name: 'Someone Else',
      phone_number: null,
    };
    mocks.findTradespersonByEmail.mockResolvedValueOnce(other);
    const res = await patch('/api/auth/profile', { email: EMAIL }, authHeaders());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ error: 'email_taken' });
    expect(mocks.updateTradespersonProfile).not.toHaveBeenCalled();
  });

  it('400 invalid_body for an empty body', async () => {
    const res = await patch('/api/auth/profile', {}, authHeaders());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_body' });
  });

  it('400 invalid_body for a malformed phoneNumber', async () => {
    const res = await patch('/api/auth/profile', { phoneNumber: 'not-a-phone' }, authHeaders());
    expect(res.status).toBe(400);
  });

  it('400 invalid_body for an over-long displayName', async () => {
    const res = await patch(
      '/api/auth/profile',
      { displayName: 'x'.repeat(81) },
      authHeaders(),
    );
    expect(res.status).toBe(400);
  });

  it('401 missing_token without an Authorization header', async () => {
    const res = await patch('/api/auth/profile', { displayName: 'Sam Jr' });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'missing_token' });
  });
});

describe('POST /api/auth/change-password', () => {
  const stored = 'scrypt$16384$8$1$…';
  const row = {
    id: USER_ID,
    email: EMAIL,
    password_hash: stored,
    display_name: DISPLAY_NAME,
    phone_number: null,
  };

  function validToken(): string {
    return jwt.sign({ sub: USER_ID, email: EMAIL }, JWT_SECRET, { issuer: 'tradescheduler' });
  }

  it('200 { ok: true } when the current password verifies', async () => {
    mocks.findTradespersonById.mockResolvedValueOnce(row);
    mocks.verifyPassword.mockResolvedValueOnce(true);
    mocks.hashPassword.mockResolvedValueOnce('scrypt$16384$8$1$new$hash');
    mocks.updateTradespersonPassword.mockResolvedValueOnce(undefined);
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: 's3cret-pass-123', newPassword: 'new-pass-4567' },
      { authorization: `Bearer ${validToken()}` },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(mocks.verifyPassword).toHaveBeenCalledWith('s3cret-pass-123', stored);
    expect(mocks.updateTradespersonPassword).toHaveBeenCalledWith(USER_ID, 'scrypt$16384$8$1$new$hash');
  });

  it('401 invalid_credentials when the current password is wrong', async () => {
    mocks.findTradespersonById.mockResolvedValueOnce(row);
    mocks.verifyPassword.mockResolvedValueOnce(false);
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: 'wrong-password', newPassword: 'new-pass-4567' },
      { authorization: `Bearer ${validToken()}` },
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_credentials' });
    expect(mocks.updateTradespersonPassword).not.toHaveBeenCalled();
  });

  it('400 invalid_body for a short new password', async () => {
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: 's3cret-pass-123', newPassword: 'short' },
      { authorization: `Bearer ${validToken()}` },
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_body' });
  });

  it('400 invalid_body when fields are missing', async () => {
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: 's3cret-pass-123' },
      { authorization: `Bearer ${validToken()}` },
    );
    expect(res.status).toBe(400);
  });

  it('404 invalid_token for a token of a deleted account', async () => {
    mocks.findTradespersonById.mockResolvedValueOnce(null);
    const res = await post(
      '/api/auth/change-password',
      { currentPassword: 's3cret-pass-123', newPassword: 'new-pass-4567' },
      { authorization: `Bearer ${validToken()}` },
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_token' });
  });

  it('401 missing_token without an Authorization header', async () => {
    const res = await post('/api/auth/change-password', {
      currentPassword: 's3cret-pass-123',
      newPassword: 'new-pass-4567',
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'missing_token' });
  });
});
