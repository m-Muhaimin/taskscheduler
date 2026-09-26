import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the conversation domain (CP03) with a mocked `pg` Pool �
 * same pattern as queue-service.test.ts (vi.hoisted mock + vi.resetModules
 * so the lazy pool singleton never leaks between tests).
 */
const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
  },
}));

const DATABASE_URL = 'postgres://user:pass@localhost:5432/tradescheduler_test';

async function loadDomain() {
  return await import('./conversation-domain.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  vi.resetModules();
});

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cust-1',
    organization_id: 'org-1',
    name: null,
    phone: '+15551234567',
    email: null,
    created_at: new Date('2026-09-18T00:00:00Z'),
    updated_at: new Date('2026-09-18T00:00:00Z'),
    ...overrides,
  };
}

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    organization_id: 'org-1',
    customer_id: 'cust-1',
    channel: 'sms',
    status: 'open',
    intent: null,
    current_state: 'new',
    assigned_user_id: null,
    missing_information: [],
    created_at: new Date('2026-09-18T00:00:00Z'),
    updated_at: new Date('2026-09-18T00:00:00Z'),
    closed_at: null,
    ...overrides,
  };
}

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    conversation_id: 'conv-1',
    provider: 'twilio',
    provider_message_id: 'SM123',
    direction: 'inbound',
    body: 'I need my AC fixed',
    status: 'received',
    metadata: {},
    created_at: new Date('2026-09-18T00:00:00Z'),
    ...overrides,
  };
}

describe('conversation-domain', () => {
  describe('findOrCreateCustomer', () => {
    it('creates a customer via upsert on first contact and returns it', async () => {
      const domain = await loadDomain();
      mocks.query
        .mockResolvedValueOnce({ rows: [{ id: 'org-1', status: 'active' }] }) // org check
        .mockResolvedValueOnce({ rows: [customerRow()] }); // upsert

      const customer = await domain.findOrCreateCustomer('org-1', '+15551234567');

      expect(customer).toMatchObject({ id: 'cust-1', phone: '+15551234567', organizationId: 'org-1' });
      const [sql, params] = mocks.query.mock.calls[1] as [string, unknown[]];
      expect(sql).toContain('insert into public.rl_customers');
      expect(sql).toContain('on conflict on constraint rl_customers_org_phone_key');
      expect(params).toEqual(['org-1', '+15551234567']);
    });

    it('rejects a non-E.164 phone before any insert', async () => {
      const domain = await loadDomain();
      mocks.query.mockResolvedValueOnce({ rows: [{ id: 'org-1', status: 'active' }] });

      await expect(domain.findOrCreateCustomer('org-1', 'not-a-phone')).rejects.toMatchObject({
        code: 'INVALID_PHONE',
      });
      expect(mocks.query).toHaveBeenCalledTimes(1); // org check only � no insert
    });

    it('throws ORG_NOT_FOUND for a missing or inactive org', async () => {
      const domain = await loadDomain();
      mocks.query.mockResolvedValueOnce({ rows: [{ id: 'org-1', status: 'suspended' }] });

      await expect(domain.findOrCreateCustomer('org-1', '+15551234567')).rejects.toMatchObject({
        code: 'ORG_NOT_FOUND',
      });
    });

    it('wraps DB errors as DB_ERROR', async () => {
      const domain = await loadDomain();
      mocks.query
        .mockResolvedValueOnce({ rows: [{ id: 'org-1', status: 'active' }] })
        .mockRejectedValueOnce(new Error('connection refused'));

      await expect(domain.findOrCreateCustomer('org-1', '+15551234567')).rejects.toMatchObject({
        code: 'DB_ERROR',
      });
    });
  });

  describe('findOrCreateConversation', () => {
    it('reuses an open conversation and refreshes updated_at', async () => {
      const domain = await loadDomain();
      mocks.query
        .mockResolvedValueOnce({ rows: [{ id: 'cust-1', organization_id: 'org-1' }] }) // customer check
        .mockResolvedValueOnce({ rows: [conversationRow({ id: 'conv-open' })] }) // open found
        .mockResolvedValueOnce({ rows: [conversationRow({ id: 'conv-open' })] }); // refresh

      const conv = await domain.findOrCreateConversation('cust-1', 'sms');

      expect(conv.id).toBe('conv-open');
      const refreshSql = mocks.query.mock.calls[2][0] as string;
      expect(refreshSql).toContain('update public.rl_conversations set updated_at = now()');
      expect(refreshSql).toContain('where id =');
    });

    it('creates a new conversation when none is open', async () => {
      const domain = await loadDomain();
      mocks.query
        .mockResolvedValueOnce({ rows: [{ id: 'cust-1', organization_id: 'org-1' }] }) // customer check
        .mockResolvedValueOnce({ rows: [] }) // none open
        .mockResolvedValueOnce({ rows: [conversationRow({ id: 'conv-new' })] }); // insert

      const conv = await domain.findOrCreateConversation('cust-1', 'sms');

      expect(conv.id).toBe('conv-new');
      const insertSql = mocks.query.mock.calls[2][0] as string;
      expect(insertSql).toContain('insert into public.rl_conversations');
      expect(mocks.query.mock.calls[2][1]).toEqual(['org-1', 'cust-1', 'sms']);
    });

    it('rejects an invalid channel (sms|voice|web only)', async () => {
      const domain = await loadDomain();
      // The customer lookup runs before the channel guard, so it needs a row.
      mocks.query.mockResolvedValueOnce({ rows: [{ id: 'cust-1', organization_id: 'org-1' }] });

      // 'carrier' is not in the valid set — reject. The cast is the point: the
      // runtime guard must reject a value the type system already excludes.
      await expect(
        domain.findOrCreateConversation('cust-1', 'carrier' as unknown as 'sms' | 'voice' | 'web'),
      ).rejects.toMatchObject({
        code: 'INVALID_CHANNEL',
      });
    });
  });

  describe('appendMessage', () => {
    it('appends an SMS message and refreshes the conversation', async () => {
      const domain = await loadDomain();
      mocks.query
        .mockResolvedValueOnce({ rows: [{ id: 'conv-1', status: 'open', channel: 'sms' }] }) // conv check
        .mockResolvedValueOnce({ rows: [messageRow()] }) // insert
        .mockResolvedValueOnce({ rows: [] }); // conversation refresh

      const msg = await domain.appendMessage('conv-1', 'inbound', 'I need my AC fixed');

      expect(msg).toMatchObject({ id: 'msg-1', body: 'I need my AC fixed', direction: 'inbound' });
      const [sql] = mocks.query.mock.calls[1] as [string];
      expect(sql).toContain('insert into public.rl_messages');
      expect(sql).toContain('received');
    });

    it('allows a null body for voice conversations (C6)', async () => {
      const domain = await loadDomain();
      mocks.query
        .mockResolvedValueOnce({ rows: [{ id: 'conv-1', status: 'open', channel: 'voice' }] })
        .mockResolvedValueOnce({ rows: [messageRow({ body: null })] })
        .mockResolvedValueOnce({ rows: [] });

      const msg = await domain.appendMessage('conv-1', 'inbound', null, 'CA1234567890');

      expect(msg.body).toBeNull();
    });

    it('rejects a missing body for SMS (non-voice) inbound (MISSING_BODY)', async () => {
      const domain = await loadDomain();
      mocks.query.mockResolvedValueOnce({ rows: [{ id: 'conv-1', status: 'open', channel: 'sms' }] });

      await expect(domain.appendMessage('conv-1', 'inbound', '  ')).rejects.toMatchObject({
        code: 'MISSING_BODY',
      });
    });

    it('rejects appending to a closed conversation (CONVERSATION_CLOSED)', async () => {
      const domain = await loadDomain();
      mocks.query.mockResolvedValueOnce({ rows: [{ id: 'conv-1', status: 'closed', channel: 'sms' }] });

      await expect(domain.appendMessage('conv-1', 'inbound', 'hello')).rejects.toMatchObject({
        code: 'CONVERSATION_CLOSED',
      });
    });
  });
});
