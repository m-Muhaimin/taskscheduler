import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
  },
}));

async function loadService() {
  return await import('./escalation-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.ESCALATIONS_TABLE;
  delete process.env.CUSTOMERS_TABLE;
  delete process.env.TRADESPEOPLE_TABLE;
  delete process.env.ORGANIZATION_MEMBERS_TABLE;
  vi.resetModules();
});

describe('getEscalations (T20)', () => {
  it('scopes via both EXISTS arms (customers OR staff memberships) and sorts pending first, newest first', async () => {
    const { getEscalations } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await getEscalations('org-1', { timezone: 'America/New_York' });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('rl_customers');
    expect(sql).toContain('rl_tradespeople');
    expect(sql).toContain('rl_organization_members');
    expect(sql).toContain(
      "order by case when e.status = 'pending' then 0 else 1 end, e.created_at desc",
    );
    expect(params).toEqual(['org-1', 20, 0]);
  });

  it('applies the optional status filter with $2', async () => {
    const { getEscalations } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await getEscalations('org-1', { status: 'resolved', timezone: 'America/New_York' });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('and e.status = $2');
    expect(params).toEqual(['org-1', 'resolved', 20, 0]);

    // The count query carries the same filter but no pagination params.
    const [countSql, countParams] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(countSql).toContain('and e.status = $2');
    expect(countParams).toEqual(['org-1', 'resolved']);
  });

  it('honors custom table env names in the SQL', async () => {
    process.env.ESCALATIONS_TABLE = 'x_escalations';
    process.env.CUSTOMERS_TABLE = 'x_customers';
    process.env.TRADESPEOPLE_TABLE = 'x_tradespeople';
    process.env.ORGANIZATION_MEMBERS_TABLE = 'x_org_members';
    const { getEscalations } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await getEscalations('org-1', { timezone: 'UTC' });

    const [sql] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('from public.x_escalations');
    expect(sql).toContain('public.x_customers');
    expect(sql).toContain('public.x_tradespeople');
    expect(sql).toContain('public.x_org_members');
  });

  it('maps rows to display-ready DTOs and runs the count(*)::int query', async () => {
    const { getEscalations } = await loadService();
    const created = new Date('2026-09-18T15:15:00.000Z');
    const resolved = new Date('2026-09-19T09:30:00.000Z');
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'e1',
            type: 'staff_sms',
            customer_phone: '+15551234567',
            content: 'Staff ack',
            status: 'pending',
            created_at: created,
            resolved_at: null,
          },
          {
            id: 'e2',
            type: 'customer_escalation',
            customer_phone: '+15557654321',
            content: 'Customer asked to talk to a human',
            status: 'resolved',
            created_at: created,
            resolved_at: resolved,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: 2 }] });

    const result = await getEscalations('org-1', { timezone: 'America/New_York' });

    expect(result.total).toBe(2);
    expect(result.escalations[0]).toMatchObject({
      typeLabel: 'Staff message',
      resolvedAt: null,
      resolvedAtDisplay: null,
    });
    expect(result.escalations[1]).toMatchObject({ typeLabel: 'Customer escalation' });
    expect(result.escalations[1].createdAt).toBe(created.toISOString());

    const [countSql, countParams] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(countSql).toContain('select count(*)::int as total');
    expect(countParams).toEqual(['org-1']);
  });

  it('returns an empty page when no rows match', async () => {
    const { getEscalations } = await loadService();
    // Both the data query and the count query come back empty / zero.
    mocks.query.mockResolvedValue({ rows: [] });

    const result = await getEscalations('org-1', { timezone: 'America/New_York' });

    expect(result).toEqual({ escalations: [], total: 0, page: 1, pageSize: 20 });
  });
});