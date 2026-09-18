import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * auth-service tests: scrypt hashing (pure, no pool) + identity-row queries
 * with a mocked pg Pool (same lazy-module pattern as queue-service.test.ts).
 */
const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
  },
}));

const DATABASE_URL = 'postgres://user:pass@localhost:5432/tradescheduler_test';

async function loadAuth() {
  return await import('./auth-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.TRADESPEOPLE_TABLE;
  vi.resetModules();
});

describe('hashPassword / verifyPassword', () => {
  it('round-trips: hashed password verifies against the same plaintext', async () => {
    const { hashPassword, verifyPassword } = await loadAuth();
    const stored = await hashPassword('s3cret-pass-123');
    expect(stored.startsWith('scrypt$16384$8$1$')).toBe(true);
    await expect(verifyPassword('s3cret-pass-123', stored)).resolves.toBe(true);
  });

  it('rejects a wrong password (constant-time path, same hash)', async () => {
    const { hashPassword, verifyPassword } = await loadAuth();
    const stored = await hashPassword('s3cret-pass-123');
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false);
  });

  it('rejects malformed stored strings without throwing', async () => {
    const { verifyPassword } = await loadAuth();
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'bcrypt$10$abcdef')).resolves.toBe(false);
  });

  it('produces unique salts (two hashes of the same password differ)', async () => {
    const { hashPassword } = await loadAuth();
    const a = await hashPassword('same-pass-1');
    const b = await hashPassword('same-pass-1');
    expect(a).not.toBe(b);
  });
});

describe('tradesperson queries', () => {
  it('findTradespersonByEmail returns the row for an existing email (lowercased)', async () => {
    const { findTradespersonByEmail } = await loadAuth();
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: '__VG_UUID_9f3a1c2d5e6f__',
          email: 'sam@solosam.app',
          password_hash: 'scrypt$…',
          display_name: 'Sam',
          created_at: new Date('2026-09-18T00:00:00Z'),
        },
      ],
    });
    const row = await findTradespersonByEmail('Sam@SoloSam.APP');
    expect(row?.email).toBe('sam@solosam.app');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from ts_tradespeople'),
      ['sam@solosam.app'],
    );
  });

  it('findTradespersonByEmail returns null when no row matches', async () => {
    const { findTradespersonByEmail } = await loadAuth();
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(findTradespersonByEmail('nobody@example.com')).resolves.toBeNull();
  });

  it('findTradespersonById returns the row matching the id', async () => {
    const { findTradespersonById } = await loadAuth();
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: '__VG_UUID_9f3a1c2d5e6f__',
          email: 'sam@solosam.app',
          password_hash: 'scrypt$…',
          display_name: 'Sam',
          created_at: new Date('2026-09-18T00:00:00Z'),
        },
      ],
    });
    const row = await findTradespersonById('__VG_UUID_9f3a1c2d5e6f__');
    expect(row?.display_name).toBe('Sam');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from ts_tradespeople'),
      ['__VG_UUID_9f3a1c2d5e6f__'],
    );
  });

  it('honors the TRADESPEOPLE_TABLE override env', async () => {
    process.env.TRADESPEOPLE_TABLE = 'ts_tradespeople_test';
    const { findTradespersonByEmail } = await loadAuth();
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await findTradespersonByEmail('sam@solosam.app');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('from ts_tradespeople_test'),
      expect.anything(),
    );
  });

  it('createTradesperson inserts and returns the created row', async () => {
    const { createTradesperson } = await loadAuth();
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: '__VG_UUID_9f3a1c2d5e6f__',
          email: 'sam@solosam.app',
          password_hash: 'scrypt$…',
          display_name: 'Sam',
          created_at: new Date('2026-09-18T00:00:00Z'),
        },
      ],
    });
    const row = await createTradesperson({
      email: 'sam@solosam.app',
      displayName: 'Sam',
      passwordHash: 'scrypt$…',
    });
    expect(row.email).toBe('sam@solosam.app');
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('insert into ts_tradespeople'),
      ['sam@solosam.app', 'scrypt$…', 'Sam'],
    );
  });
});
