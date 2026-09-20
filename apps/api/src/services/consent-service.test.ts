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

const CONSENT_ROW = {
  id: 'cust-1',
  phone_verified_at: new Date('2026-09-01T00:00:00Z'),
  whatsapp_opted_in: true,
};

describe('consent-service', () => {
  it('getCustomerByPhone is a READ-ONLY select on rl_customers (id, phone_verified_at, whatsapp_opted_in)', async () => {
    mocks.query.mockResolvedValue({ rows: [CONSENT_ROW] });

    const customer = await (await loadService()).getCustomerByPhone('org-1', '+8801712345678');

    expect(customer).toEqual({
      id: 'cust-1',
      phoneVerifiedAt: '2026-09-01T00:00:00.000Z',
      whatsappOptedIn: true,
    });
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('select id, phone_verified_at, whatsapp_opted_in');
    expect(sql).toContain('from public.rl_customers');
    // Read-only: NO insert/update/create anywhere in the statement.
    expect(/\b(insert|update|create)\b/i.test(sql)).toBe(false);
    expect(params).toEqual(['org-1', '+8801712345678']);
  });

  it('getCustomerByPhone returns null when no customer row exists', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(
      (await loadService()).getCustomerByPhone('org-1', '+8801712345678'),
    ).resolves.toBeNull();
  });

  it('getCustomerByPhone maps a null phone_verified_at (unverified customer)', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ ...CONSENT_ROW, phone_verified_at: null, whatsapp_opted_in: false }],
    });

    const customer = await (await loadService()).getCustomerByPhone('org-1', '+8801712345678');
    expect(customer).toEqual({
      id: 'cust-1',
      phoneVerifiedAt: null,
      whatsappOptedIn: false,
    });
  });

  it('recordWhatsAppOptIn is an idempotent update setting the flag true with now()', async () => {
    mocks.query.mockResolvedValue({ rows: [] });

    await (await loadService()).recordWhatsAppOptIn('cust-1');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('update public.rl_customers');
    expect(sql).toContain('whatsapp_opted_in = true');
    expect(sql).toContain('whatsapp_opted_in_at = now()');
    expect(sql).toContain('where id = $1');
    expect(params).toEqual(['cust-1']);
  });

  it('hasWhatsAppOptIn returns true/false from the customer flag', async () => {
    mocks.query.mockResolvedValue({ rows: [{ whatsapp_opted_in: true }] });
    await expect((await loadService()).hasWhatsAppOptIn('cust-1')).resolves.toBe(true);

    mocks.query.mockResolvedValue({ rows: [{ whatsapp_opted_in: false }] });
    await expect((await loadService()).hasWhatsAppOptIn('cust-1')).resolves.toBe(false);
  });

  it('hasWhatsAppOptIn returns false when no customer row exists', async () => {
    mocks.query.mockResolvedValue({ rows: [] });
    await expect((await loadService()).hasWhatsAppOptIn('nope')).resolves.toBe(false);
  });

  it('honors the CUSTOMERS_TABLE env override', async () => {
    process.env.CUSTOMERS_TABLE = 'other_prefix_customers';
    mocks.query.mockResolvedValue({ rows: [] });

    await (await loadService()).getCustomerByPhone('org-1', '+8801712345678');

    const [sql] = mocks.query.mock.calls[0] as [string];
    expect(sql).toContain('from public.other_prefix_customers');
  });

  it('throws when DATABASE_URL is missing (env-free boot guard)', async () => {
    delete process.env.DATABASE_URL;

    const { getCustomerByPhone } = await loadService();
    await expect(getCustomerByPhone('org-1', '+8801712345678')).rejects.toThrow(
      /DATABASE_URL not configured/,
    );
    expect(mocks.query).not.toHaveBeenCalled();
  });
});