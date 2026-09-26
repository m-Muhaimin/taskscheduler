import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Consent service tests with a mocked `pg` Pool. The service keeps a lazy
 * singleton pool in module state, so each test loads a FRESH module instance
 * (vi.resetModules + dynamic import) — same pattern as queue-service.test.ts.
 */
const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
  },
}));

const DATABASE_URL = 'postgres://user:pass@localhost:5432/tradescheduler_test';

async function loadService() {
  return await import('./consent-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.CUSTOMERS_TABLE;
  vi.resetModules();
});

describe('consent-service', () => {
  it('hasSmsOptIn returns true/false from the customer flag', async () => {
    mocks.query.mockResolvedValue({ rows: [{ sms_opted_in: true }] });
    await expect((await loadService()).hasSmsOptIn('cust-1')).resolves.toBe(true);

    mocks.query.mockResolvedValue({ rows: [{ sms_opted_in: false }] });
    await expect((await loadService()).hasSmsOptIn('cust-1')).resolves.toBe(false);
  });

  it('hasSmsOptIn returns false when no customer row exists', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect((await loadService()).hasSmsOptIn('nope')).resolves.toBe(false);
  });

  it('recordSmsOptIn is one idempotent update setting the flag AND the timestamp', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await (await loadService()).recordSmsOptIn('cust-1');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('update public.rl_customers');
    expect(sql).toContain('sms_opted_in = true');
    expect(sql).toContain('sms_opted_in_at = now()');
    expect(sql).toContain('where id = $1');
    // Exactly one statement — no read-then-write, no upsert, no second query.
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(params).toEqual(['cust-1']);
  });

  it('honors the CUSTOMERS_TABLE env override in both functions (bare name, public. interpolated)', async () => {
    process.env.CUSTOMERS_TABLE = 'other_prefix_customers';
    mocks.query.mockResolvedValue({ rows: [{ sms_opted_in: true }] });

    const svc = await loadService();
    await svc.hasSmsOptIn('cust-1');
    await svc.recordSmsOptIn('cust-1');

    const [readSql] = mocks.query.mock.calls[0] as [string];
    const [writeSql, writeParams] = mocks.query.mock.calls[1] as [string, unknown[]];
    // Repo convention (dashboard/escalation/inbox/process-outbound-sms): the
    // env var is a BARE name and this module interpolates the public schema.
    expect(readSql).toContain('from public.other_prefix_customers');
    expect(writeSql).toContain('update public.other_prefix_customers');
    expect(writeParams).toEqual(['cust-1']);
  });

  it('defaults to the bare rl_customers with the public schema interpolated', async () => {
    mocks.query.mockResolvedValue({ rows: [{ sms_opted_in: false }] });

    const { hasSmsOptIn } = await loadService();
    await hasSmsOptIn('cust-1');

    const [sql] = mocks.query.mock.calls[0] as [string];
    expect(sql).toContain('from public.rl_customers');
  });

  it('accepts a public.-qualified CUSTOMERS_TABLE without double-qualifying it', async () => {
    // A deployer copying this module's own default into the env must not end
    // up with `public.public.rl_customers` in the query.
    process.env.CUSTOMERS_TABLE = 'public.rl_customers';
    mocks.query.mockResolvedValue({ rows: [{ sms_opted_in: true }] });

    const svc = await loadService();
    await svc.hasSmsOptIn('cust-1');
    await svc.recordSmsOptIn('cust-1');

    const [readSql] = mocks.query.mock.calls[0] as [string];
    const [writeSql] = mocks.query.mock.calls[1] as [string];
    expect(readSql).toContain('from public.rl_customers');
    expect(writeSql).toContain('update public.rl_customers');
    expect(readSql).not.toContain('public.public');
    expect(writeSql).not.toContain('public.public');
  });

  it('rejects a CUSTOMERS_TABLE that is not a SQL identifier, before any query', async () => {
    // Interpolated into SQL, so it is validated. No query may be attempted.
    for (const bad of ['rl_customers; drop table bookings', 'a b', "cust'omers", '1customers']) {
      process.env.CUSTOMERS_TABLE = bad;

      const { hasSmsOptIn, recordSmsOptIn } = await loadService();
      await expect(hasSmsOptIn('cust-1')).rejects.toThrow(
        /CUSTOMERS_TABLE must be a bare or schema-qualified SQL identifier/,
      );
      await expect(recordSmsOptIn('cust-1')).rejects.toThrow(
        /CUSTOMERS_TABLE must be a bare or schema-qualified SQL identifier/,
      );
    }
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('throws when DATABASE_URL is missing (env-free boot guard)', async () => {
    delete process.env.DATABASE_URL;

    const { hasSmsOptIn } = await loadService();
    await expect(hasSmsOptIn('cust-1')).rejects.toThrow(
      /DATABASE_URL not configured/,
    );
    expect(mocks.query).not.toHaveBeenCalled();
  });
});