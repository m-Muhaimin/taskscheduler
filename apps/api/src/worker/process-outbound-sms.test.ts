import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Worker handler tests for processOutboundSms (T13): a queued manual outbound
 * reply is delivered via sendSms and its rl_messages row transitions
 * 'queued' → 'sent' (+ Twilio SID) or 'queued' → 'failed' on send error.
 */
const m = vi.hoisted(() => ({
  query: vi.fn(),
  sendSms: vi.fn(),
}));

vi.mock('pg', () => ({ Pool: class MockPool { query = m.query; } }));
vi.mock('../services/sms-service.js', () => ({ sendSms: m.sendSms }));

async function loadWorker() {
  return await import('./process-outbound-sms.js');
}

function job(payload: Record<string, unknown>): import('../services/queue-service.js').QueueJob {
  return {
    id: 'job-1',
    type: 'outbound_sms',
    payload,
    status: 'pending',
    attempts: 0,
    lockedAt: null,
    lockedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const QUEUED_ROW = {
  id: 'msg-1',
  body: 'Sure, Tuesday works.',
  status: 'queued',
  phone: '+15551234567',
};

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  m.query.mockReset();
  m.sendSms.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.MESSAGES_TABLE;
  delete process.env.CONVERSATIONS_TABLE;
  delete process.env.CUSTOMERS_TABLE;
  vi.resetModules();
});

describe('processOutboundSms (T13 delivery)', () => {
  it('happy path: sends to the customer phone, persists sent + Twilio SID', async () => {
    const worker = await loadWorker();
    m.query.mockResolvedValueOnce({ rows: [QUEUED_ROW] }).mockResolvedValueOnce({ rows: [] });
    m.sendSms.mockResolvedValue({ messageSid: 'SM1234567890', status: 'sent' });

    await worker.processOutboundSms(job({ messageId: 'msg-1' }));

    // Delivered with the customer's phone + the queued reply body.
    expect(m.sendSms).toHaveBeenCalledTimes(1);
    expect(m.sendSms).toHaveBeenCalledWith({ to: '+15551234567', body: 'Sure, Tuesday works.' });

    // Load query: single join-scoped read, guarded to a queued outbound row.
    const [selectSql, selectParams] = m.query.mock.calls[0] as [string, unknown[]];
    expect(selectSql).toContain('from public.rl_messages m');
    expect(selectSql).toContain('join public.rl_conversations c on c.id = m.conversation_id');
    expect(selectSql).toContain('join public.rl_customers cu on cu.id = c.customer_id');
    expect(selectSql).toContain(`m.direction = 'outbound'`);
    expect(selectSql).toContain(`m.status = 'queued'`);
    expect(selectParams).toEqual(['msg-1']);

    // Persist: status 'sent' + the returned SID.
    const [updateSql, updateParams] = m.query.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain(`status = 'sent'`);
    expect(updateSql).toContain('provider_message_id = $2');
    expect(updateParams).toEqual(['msg-1', 'SM1234567890']);
  });

  it('sendSms rejection marks the row failed and rethrows (job fails)', async () => {
    const worker = await loadWorker();
    m.query.mockResolvedValueOnce({ rows: [QUEUED_ROW] }).mockResolvedValueOnce({ rows: [] });
    m.sendSms.mockRejectedValue(new Error('twilio down'));

    await expect(worker.processOutboundSms(job({ messageId: 'msg-1' }))).rejects.toThrow('twilio down');

    // The row is marked 'failed' — never silently stuck 'queued'.
    const [updateSql, updateParams] = m.query.mock.calls[1] as [string, unknown[]];
    expect(updateSql).toContain(`status = 'failed'`);
    expect(updateParams).toEqual(['msg-1']);
    expect(m.sendSms).toHaveBeenCalledTimes(1);
  });

  it('message not found or not queued (e.g. already sent) throws, no send attempted', async () => {
    const worker = await loadWorker();
    m.query.mockResolvedValue({ rows: [] });

    await expect(
      worker.processOutboundSms(job({ messageId: 'msg-missing' })),
    ).rejects.toThrow('not found or not queued');
    expect(m.sendSms).not.toHaveBeenCalled();
  });

  it('malformed job without messageId throws immediately', async () => {
    const worker = await loadWorker();

    await expect(worker.processOutboundSms(job({}))).rejects.toThrow('missing messageId');
    expect(m.query).not.toHaveBeenCalled();
    expect(m.sendSms).not.toHaveBeenCalled();
  });
});