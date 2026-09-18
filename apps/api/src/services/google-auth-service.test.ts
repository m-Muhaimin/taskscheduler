import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * google-auth-service tests: consent URL building, credential store CRUD and
 * the one-time consent state, all with a mocked pg Pool (house pattern:
 * auth-service.test.ts / queue-service.test.ts). Network calls are never hit —
 * exchangeCodeForTokens is exercised only for its config guard (it throws
 * before any HTTP request when Google env is missing).
 */
const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
  },
}));

const DATABASE_URL = 'postgres://user:pass@localhost:5432/tradescheduler_test';

const GOOGLE_ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: '__VG_CLIENT_ID_00000__',
  GOOGLE_CLIENT_SECRET: '__VG_CLIENT_SECRET_00000__',
  GOOGLE_REDIRECT_URI: 'http://localhost:3001/api/auth/google/callback',
};

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

async function loadAuthService() {
  return await import('./google-auth-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  Object.assign(process.env, GOOGLE_ENV);
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
  delete process.env.GOOGLE_CREDENTIALS_TABLE;
  delete process.env.GOOGLE_OAUTH_STATES_TABLE;
  vi.resetModules();
});

describe('consent URL', () => {
  it('builds a consent URL with offline+consent+calendar scope+state', async () => {
    const { generateAuthUrl } = await loadAuthService();
    const url = generateAuthUrl('state-abc123');
    expect(url).toContain('accounts.google.com/o/oauth2/v2/auth');
    expect(url).toContain('access_type=offline');
    expect(url).toContain('prompt=consent');
    expect(url).toContain(encodeURIComponent(CALENDAR_SCOPE));
    expect(url).toContain('state=state-abc123');
    expect(url).toContain(encodeURIComponent(GOOGLE_ENV.GOOGLE_REDIRECT_URI));
  });

  it('throws a clear error when Google env is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { generateAuthUrl } = await loadAuthService();
    expect(() => generateAuthUrl('state-abc')).toThrow(/Google OAuth is not configured/);
  });

  it('guards the token exchange with the same config check', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const { exchangeCodeForTokens } = await loadAuthService();
    await expect(exchangeCodeForTokens('code-abc')).rejects.toThrow(/not configured/);
  });
});

describe('credential store', () => {
  it('saveCredentials upserts all fields', async () => {
    const { saveCredentials } = await loadAuthService();
    mocks.query.mockResolvedValueOnce({ rowCount: 1 });
    await saveCredentials('user-1', {
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      tokenExpiry: '2026-09-20T00:00:00.000Z',
      scope: CALENDAR_SCOPE,
      calendarId: 'primary',
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('on conflict (user_id) do update'),
      ['user-1', 'at-1', 'rt-1', '2026-09-20T00:00:00.000Z', CALENDAR_SCOPE, 'primary'],
    );
  });

  it('loadCredentials maps a stored row (timestamptz Date → ISO string)', async () => {
    const { loadCredentials } = await loadAuthService();
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          user_id: 'user-1',
          access_token: 'at-1',
          refresh_token: 'rt-1',
          token_expiry: new Date('2026-09-20T00:00:00Z'),
          scope: CALENDAR_SCOPE,
          calendar_id: 'primary',
        },
      ],
    });
    const creds = await loadCredentials('user-1');
    expect(creds).toEqual({
      userId: 'user-1',
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      tokenExpiry: '2026-09-20T00:00:00.000Z',
      scope: CALENDAR_SCOPE,
      calendarId: 'primary',
    });
  });

  it('loadCredentials returns null with no row (keeps null expiry)', async () => {
    const { loadCredentials } = await loadAuthService();
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          user_id: 'user-1',
          access_token: 'at-1',
          refresh_token: 'rt-1',
          token_expiry: null,
          scope: null,
          calendar_id: null,
        },
      ],
    });
    const creds = await loadCredentials('user-1');
    expect(creds?.tokenExpiry).toBeNull();
    expect(creds?.calendarId).toBeNull();

    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(loadCredentials('nobody')).resolves.toBeNull();
  });

  it('deleteCredentials removes the row for the user', async () => {
    const { deleteCredentials } = await loadAuthService();
    mocks.query.mockResolvedValueOnce({ rowCount: 1 });
    await deleteCredentials('user-1');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('delete from public.ts_google_credentials'),
      ['user-1'],
    );
  });

  it('honors the GOOGLE_CREDENTIALS_TABLE override', async () => {
    process.env.GOOGLE_CREDENTIALS_TABLE = 'ts_gc_test';
    const { loadCredentials } = await loadAuthService();
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await loadCredentials('user-1');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from public.ts_gc_test'),
      ['user-1'],
    );
  });
});

describe('one-time consent state', () => {
  it('creates a 48-hex state and inserts it with a 10-minute TTL', async () => {
    const { createOauthState } = await loadAuthService();
    mocks.query.mockResolvedValueOnce({ rowCount: 1 });
    const state = await createOauthState('user-1');
    expect(state).toMatch(/^[0-9a-f]{48}$/);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("interval '10 minutes'"),
      [state, 'user-1'],
    );
  });

  it('consumeOauthState returns the owner and deletes the row atomically', async () => {
    const { consumeOauthState } = await loadAuthService();
    mocks.query.mockResolvedValueOnce({ rows: [{ user_id: 'user-1' }] });
    await expect(consumeOauthState('state-x')).resolves.toBe('user-1');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('delete from'),
      ['state-x'],
    );
  });

  it('consumeOauthState returns null for unknown or expired state', async () => {
    const { consumeOauthState } = await loadAuthService();
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(consumeOauthState('gone')).resolves.toBeNull();
  });

  it('honors the GOOGLE_OAUTH_STATES_TABLE override', async () => {
    process.env.GOOGLE_OAUTH_STATES_TABLE = 'ts_states_test';
    const { createOauthState } = await loadAuthService();
    mocks.query.mockResolvedValueOnce({ rowCount: 1 });
    await createOauthState('user-1');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('into public.ts_states_test'),
      expect.anything(),
    );
  });
});
