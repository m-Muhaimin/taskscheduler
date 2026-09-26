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
      channel: 'sms',
      status: 'failed',
      timezone: 'America/New_York',
    });

    const [countSql, countParams] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(countSql).toContain('count(*)::int');
    expect(countSql).toContain('and channel = $2');
    expect(countSql).toContain('and status = $3');
    expect(countParams).toEqual(['org-1', 'sms', 'failed']);

    const [sql, params] = mocks.query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('and channel = $2');
    expect(sql).toContain('and status = $3');
    expect(sql).toContain('order by created_at desc');
    expect(params).toEqual(['org-1', 'sms', 'failed', 20, 0]);
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
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [smsRow] });

    const { messages, total } = await getOutboundMessages('org-1', {
      timezone: 'America/New_York',
    });

    expect(total).toBe(1);
    expect(messages).toHaveLength(1);
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

/**
 * The SMS-only round required preserving this guarantee: a Twilio `failed`
 * callback records the failure and STOPS, but the row must not be closed for
 * good — a later genuine `delivered` report has to be able to win. That is
 * exactly what makes `failed` absent from TERMINAL_STATUSES, so the set is
 * pinned here at the ledger itself (the route test mocks this module away and
 * therefore proves intent, not behavior).
 */
describe('terminal-status guard (I1) — a failed row must stay updatable', () => {
  /** The statuses a ledger UPDATE's guard clause refuses to overwrite. */
  function guardExcludedStatuses(sql: string): string[] {
    return [...sql.matchAll(/status <> '([^']+)'/g)].map((m) => m[1]).sort();
  }

  const EXPECTED_TERMINAL = ['delivered', 'escalated', 'retried'];

  it('TERMINAL_STATUSES is exactly delivered|retried|escalated — never failed', async () => {
    const { TERMINAL_STATUSES } = await loadService();
    expect([...TERMINAL_STATUSES].sort()).toEqual(EXPECTED_TERMINAL);
    expect(TERMINAL_STATUSES).not.toContain('failed');
  });

  it('markStatus excludes the three terminal statuses and does NOT exclude failed', async () => {
    const { markStatus } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await markStatus('ledger-1', 'delivered', '30007');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('update public.rl_outbound_messages');
    expect(sql).toContain('set status = $2');
    expect(sql).toContain('error_code = coalesce($3, error_code)');
    expect(sql).toContain('where id = $1');
    expect(sql).toContain("status <> 'delivered'");
    expect(sql).toContain("status <> 'retried'");
    expect(sql).toContain("status <> 'escalated'");
    expect(sql).not.toContain("status <> 'failed'");
    expect(params).toEqual(['ledger-1', 'delivered', '30007']);
  });

  it('the markStatus SQL guard and TERMINAL_STATUSES are the same set (drift either way fails)', async () => {
    const { markStatus, TERMINAL_STATUSES } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await markStatus('ledger-1', 'delivered');

    const [sql] = mocks.query.mock.calls[0] as [string, unknown[]];
    // Pinning only the SQL would miss a TERMINAL_STATUSES-only edit (which is
    // what the route actually reads); pinning only the array would miss a
    // guard-string edit. Comparing the two closes both holes.
    expect(guardExcludedStatuses(sql)).toEqual([...TERMINAL_STATUSES].sort());
  });

  it('a late delivered report over a failed row is expressible — no guard mentions failed', async () => {
    const { markStatus } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await markStatus('ledger-1', 'delivered');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    // No status literal other than the three terminals appears anywhere.
    expect(sql).not.toContain("'failed'");
    expect(params).toEqual(['ledger-1', 'delivered', null]);
  });

  it('markSent writes sent + the SID under the same guard, params [sid, id]', async () => {
    const { markSent } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await markSent('SM123', 'ledger-1');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('update public.rl_outbound_messages');
    expect(sql).toContain("set status = 'sent'");
    expect(sql).toContain('message_sid = $1');
    expect(sql).toContain('where id = $2');
    expect(sql).toContain('(message_sid is null or message_sid = $1)');
    expect(guardExcludedStatuses(sql)).toEqual(EXPECTED_TERMINAL);
    expect(sql).not.toContain("status <> 'failed'");
    expect(params).toEqual(['SM123', 'ledger-1']);
  });

  it('markFailed writes failed + coalesced SID/error under the same guard, params [sid, id, code]', async () => {
    const { markFailed } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await markFailed(null, 'ledger-1', '30007');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('update public.rl_outbound_messages');
    expect(sql).toContain("set status = 'failed'");
    expect(sql).toContain('message_sid = coalesce($1, message_sid)');
    expect(sql).toContain('error_code = coalesce($3, error_code)');
    expect(sql).toContain('where id = $2');
    // The write that RECORDS the failure must not itself be what closes the row.
    expect(guardExcludedStatuses(sql)).toEqual(EXPECTED_TERMINAL);
    expect(guardExcludedStatuses(sql)).not.toContain('failed');
    expect(params).toEqual([null, 'ledger-1', '30007']);
  });

  it('all three status writers emit the identical three-way guard clause', async () => {
    const { markSent, markFailed, markStatus } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await markSent('SM1', 'ledger-1');
    await markFailed('SM1', 'ledger-1', null);
    await markStatus('ledger-1', 'failed', '30007');

    const guards = mocks.query.mock.calls.map((c) => {
      const sql = c[0] as string;
      return sql.match(
        /and status <> '[^']+' and status <> '[^']+' and status <> '[^']+'$/,
      )?.[0] ?? null;
    });
    expect(guards).toEqual(Array(3).fill("and status <> 'delivered' and status <> 'retried' and status <> 'escalated'"));
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