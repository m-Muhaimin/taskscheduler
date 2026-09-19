import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({ Pool: class MockPool { query = mocks.query; } }));

async function loadService() {
  return await import('./inbox-service.js');
}

async function loadDashboardService() {
  return await import('./dashboard-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.CONVERSATIONS_TABLE;
  delete process.env.CUSTOMERS_TABLE;
  delete process.env.MESSAGES_TABLE;
  delete process.env.CONVERSATION_STATES_TABLE;
  vi.resetModules();
});

describe('getInboxConversation (T10 org-scoped lookup)', () => {
  it('loads the module without touching pg at import time (lazy pool)', async () => {
    // Preserves the "env-free boot" rule — nothing in this file connects.
    await loadDashboardService();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('maps the lateral-subquery row and scopes by conversation + org', async () => {
    const { getInboxConversation } = await loadService();
    mocks.query.mockResolvedValue({
      rows: [
        {
          id: 'conv-1',
          status: 'open',
          outbound_body: 'We can fit you in Tuesday.',
          state: 'offering_slots',
          offered_slots: [
            { optionNumber: 1, startTime: '2026-09-14T13:00:00.000Z', endTime: '2026-09-14T14:00:00.000Z' },
          ],
          escalation_reason: null,
        },
      ],
    });

    const conversation = await getInboxConversation('conv-1', 'org-1');

    expect(conversation).toEqual({
      id: 'conv-1',
      status: 'open',
      outboundBody: 'We can fit you in Tuesday.',
      state: 'offering_slots',
      offeredSlots: [
        { optionNumber: 1, startTime: '2026-09-14T13:00:00.000Z', endTime: '2026-09-14T14:00:00.000Z' },
      ],
      escalationReason: null,
    });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('where c.id = $1 and c.organization_id = $2');
    expect(sql).toContain('rl_conversations');
    expect(params).toEqual(['conv-1', 'org-1']);
  });

  it('coerces a non-array offered_slots value to null', async () => {
    const { getInboxConversation } = await loadService();
    mocks.query.mockResolvedValue({
      rows: [{ id: 'conv-1', status: 'open', outbound_body: null, state: null, offered_slots: {}, escalation_reason: null }],
    });

    const conversation = await getInboxConversation('conv-1', 'org-1');
    expect(conversation?.offeredSlots).toBeNull();
  });

  it('returns null when no row matches (missing or other-org conversation)', async () => {
    const { getInboxConversation } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await getInboxConversation('conv-missing', 'org-1')).toBeNull();
  });
});

describe('enqueueOutboundReply (T10)', () => {
  it('inserts a queued manual outbound message org-guarded via EXISTS', async () => {
    const { enqueueOutboundReply } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await enqueueOutboundReply('conv-1', 'Sure, Tuesday works.', 'org-1');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into public.rl_messages');
    expect(sql).toContain(`provider, direction, body, status`);
    expect(sql).toContain(`'manual', 'outbound', $2, 'queued'`);
    expect(sql).toContain('where exists');
    expect(sql).toContain(`c.id = $1 and c.organization_id = $3`);
    expect(params).toEqual(['conv-1', 'Sure, Tuesday works.', 'org-1']);
  });
});

describe('closeConversation (T10)', () => {
  it('org-scoped UPDATE to closed + closed_at now()', async () => {
    const { closeConversation } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await closeConversation('conv-1', 'org-1');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain(`update public.rl_conversations`);
    expect(sql).toContain(`status = 'closed', closed_at = now(), updated_at = now()`);
    expect(sql).toContain('where id = $1 and organization_id = $2');
    expect(params).toEqual(['conv-1', 'org-1']);
  });
});

describe('lazy pool guard (env-free boot)', () => {
  it('throws a clear error when DATABASE_URL is missing and a query runs', async () => {
    delete process.env.DATABASE_URL;
    const { getInboxConversation } = await loadService();
    await expect(getInboxConversation('conv-1', 'org-1')).rejects.toThrow('DATABASE_URL not configured');
  });
});