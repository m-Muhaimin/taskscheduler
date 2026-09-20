import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
    connect = vi.fn().mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
  },
}));

async function loadService() {
  return await import('./outbound-ledger.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  mocks.query.mockReset();
  mocks.clientQuery.mockReset();
  mocks.release.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.OUTBOUND_MESSAGES_TABLE;
  vi.resetModules();
});

describe('getOutboundMessages (T21)', () => {
  it('default → org-scoped query, newest first, count(*)::int total, params [org-1, 20, 0]', async () => {
    const { getOutboundMessages } = await loadService();
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const { messages, total } = await getOutboundMessages('org-1', {
      timezone: 'America/New_York',
    });

    expect(total).toBe(0);
    expect(messages).toEqual([]);

    const [countSql, countParams] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('count(*)::int');
    expect(countSql).toContain('where organization_id = $1');
    expect(countParams).toEqual(['org-1']);

    const [sql, params] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('where organization_id = $1');
    expect(sql).toContain('order by created_at desc');
    expect(params).toEqual(['org-1', 20, 0]);
  });

  it('appends channel then status params when both filters are present', async () => {
    const { getOutboundMessages } = await loadService();
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await getOutboundMessages('org-1', {
      channel: 'whatsapp',
      status: 'failed',
      timezone: 'America/New_York',
    });

    const [countSql, countParams] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('count(*)::int');
    expect(countSql).toContain('and channel = $2');
    expect(countSql).toContain('and status = $3');
    expect(countParams).toEqual(['org-1', 'whatsapp', 'failed']);

    const [sql, params] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('and channel = $2');
    expect(sql).toContain('and status = $3');
    expect(sql).toContain('order by created_at desc');
    expect(params).toEqual(['org-1', 'whatsapp', 'failed', 20, 0]);
  });

  it('translates page/pageSize into limit/offset params', async () => {
    const { getOutboundMessages } = await loadService();
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await getOutboundMessages('org-1', {
      page: 2,
      pageSize: 5,
      timezone: 'America/New_York',
    });

    const [, params] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(['org-1', 5, 5]);
  });

  it('clamps page ≥ 1 and pageSize to 1..100 defensively', async () => {
    const { getOutboundMessages } = await loadService();
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await getOutboundMessages('org-1', {
      page: 0,
      pageSize: 999,
      timezone: 'America/New_York',
    });

    const [, params] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual(['org-1', 100, 0]);
  });

  it('maps rows to MessageRowDto: kind/status labels, errorCode/messageSid passthrough, createdAt preserved', async () => {
    const { getOutboundMessages } = await loadService();
    const smsRow = {
      id: 'msg-1',
      organization_id: 'org-1',
      customer_id: null,
      to_phone: '+8801700000001',
      body: 'Your appointment is confirmed for Tue 1:00 PM.',
      channel: 'sms',
      message_sid: 'SM123',
      kind: null,
      status: 'blocked_optin',
      error_code: '30007',
      created_at: new Date('2026-09-20T12:00:00.000Z'),
      updated_at: new Date('2026-09-20T12:00:00.000Z'),
    };
    const waRow = {
      ...smsRow,
      id: 'msg-2',
      to_phone: '+8801700000002',
      body: 'Ride is on its way.',
      channel: 'whatsapp',
      message_sid: 'SM456',
      kind: 'staff_ack',
      status: 'delivered',
      error_code: null,
      created_at: new Date('2026-09-20T11:00:00.000Z'),
      updated_at: new Date('2026-09-20T11:00:00.000Z'),
    };
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({ rows: [smsRow, waRow] });

    const { messages, total } = await getOutboundMessages('org-1', {
      timezone: 'America/New_York',
    });

    expect(total).toBe(2);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: 'msg-1',
      toPhone: '+8801700000001',
      body: 'Your appointment is confirmed for Tue 1:00 PM.',
      channel: 'sms',
      kindLabel: null,
      status: 'blocked_optin',
      statusLabel: 'Blocked (no opt-in)',
      errorCode: '30007',
      messageSid: 'SM123',
      createdAt: '2026-09-20T12:00:00.000Z',
    });
    expect(messages[1]).toMatchObject({
      id: 'msg-2',
      toPhone: '+8801700000002',
      channel: 'whatsapp',
      kindLabel: 'Staff ack',
      status: 'delivered',
      statusLabel: 'Delivered',
      errorCode: null,
      messageSid: 'SM456',
      createdAt: '2026-09-20T11:00:00.000Z',
    });
    expect(typeof messages[0].createdAtDisplay).toBe('string');
  });

  it('honors the OUTBOUND_MESSAGES_TABLE env override', async () => {
    process.env.OUTBOUND_MESSAGES_TABLE = 'x_outbound';
    const { getOutboundMessages } = await loadService();
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-1',
            organization_id: 'org-1',
            customer_id: null,
            to_phone: '+8801700000001',
            body: 'hi',
            channel: 'sms',
            message_sid: null,
            kind: null,
            status: 'queued',
            error_code: null,
            created_at: new Date('2026-09-20T12:00:00.000Z'),
            updated_at: new Date('2026-09-20T12:00:00.000Z'),
          },
        ],
      });

    const { messages, total } = await getOutboundMessages('org-1', {
      timezone: 'America/New_York',
    });

    expect(total).toBe(1);
    expect(messages).toHaveLength(1);
    const [countSql, selectSql] = mocks.query.mock.calls.map((c) => c[0] as string);
    expect(countSql).toContain('public.x_outbound');
    expect(selectSql).toContain('public.x_outbound');
  });
});

describe('formatRelativeDisplay (T21)', () => {
  const NOW_MS = new Date('2026-09-20T12:00:00Z').getTime();

  it('seconds/minutes/hours ago inside the first 24h', async () => {
    const { formatRelativeDisplay } = await loadService();
    expect(formatRelativeDisplay('2026-09-20T11:59:55Z', 'America/New_York', NOW_MS)).toBe('5s ago');
    expect(formatRelativeDisplay('2026-09-20T11:55:00Z', 'America/New_York', NOW_MS)).toBe('5m ago');
    expect(formatRelativeDisplay('2026-09-20T07:00:00Z', 'America/New_York', NOW_MS)).toBe('5h ago');
  });

  it('Yesterday within 48h', async () => {
    const { formatRelativeDisplay } = await loadService();
    expect(formatRelativeDisplay('2026-09-19T10:00:00Z', 'America/New_York', NOW_MS)).toBe('Yesterday');
  });

  it('org-tz short date beyond 48h', async () => {
    const { formatRelativeDisplay } = await loadService();
    const display = formatRelativeDisplay('2026-09-10T12:00:00Z', 'America/New_York', NOW_MS);
    expect(display).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
  });
});