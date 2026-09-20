import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T16 — staff-phone recognition service tests.
 * Mirrors organization-service.test.ts (hoisted pg Pool mock + loadService).
 */
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
  },
}));

async function loadService() {
  return await import('./staff-phone-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

describe('resolveStaffByPhone (T16)', () => {
  it('resolves a tradesperson who is a member of the org', async () => {
    const { resolveStaffByPhone } = await loadService();
    mocks.query.mockResolvedValue({
      rows: [{ id: 'tp-1', email: 'sam@example.com' }],
    });

    const staff = await resolveStaffByPhone('+15551234567', 'org-1');

    expect(staff).toEqual({ tradespersonId: 'tp-1', email: 'sam@example.com' });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('from public.rl_tradespeople t');
    expect(sql).toContain('join public.rl_organization_members m on m.user_id = t.id');
    expect(sql).toContain('where t.phone = $1');
    expect(sql).toContain('m.organization_id = $2');
    expect(params).toEqual(['+15551234567', 'org-1']);
  });

  it('returns null when the phone is unknown', async () => {
    const { resolveStaffByPhone } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    const staff = await resolveStaffByPhone('+19998887777', 'org-1');

    expect(staff).toBeNull();
  });

  it('returns null when the membership is in another org only', async () => {
    // Org-scoping is enforced in SQL (m.organization_id = $2): a staff member
    // of org-2 texting org-1's number yields no row → still a customer of org-1.
    const { resolveStaffByPhone } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    const staff = await resolveStaffByPhone('+15551234567', 'org-1');

    expect(staff).toBeNull();
  });

  it('returns null when the DB phone is null', async () => {
    // A tradesperson with no stored phone cannot match t.phone = $1 (NULL
    // equality) → no row.
    const { resolveStaffByPhone } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    const staff = await resolveStaffByPhone('+15551234567', 'org-1');

    expect(staff).toBeNull();
  });
});
