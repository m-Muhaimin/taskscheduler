import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the queue service with a mocked `pg` Pool.
 * Each test loads a fresh module instance (vi.resetModules + dynamic import)
 * so the lazy pool singleton never leaks between tests.
 */
const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
  },
}));

const DATABASE_URL = 'postgres://user:pass@localhost:5432/tradescheduler_test';

async function loadQueue() {
  return await import('./queue-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.QUEUE_JOBS_TABLE;
  vi.resetModules();
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '0579b20a-6a5d-4ea6-93f6-2b24d7f0a001',
    type: 'inbound_sms',
    payload: { From: '+15551234567' },
    status: 'pending',
    attempts: 0,
    locked_at: null,
    locked_by: null,
    created_at: new Date('2026-09-18T00:00:00Z'),
    updated_at: new Date('2026-09-18T00:00:00Z'),
    ...overrides,
  };
}

describe('queue-service', () => {
  it('enqueue inserts a pending job into ts_jobs and returns the mapped job', async () => {
    const qs = await loadQueue();
    mocks.query.mockResolvedValue({ rows: [row({ id: 'job-enqueue-1' })] });

    const job = await qs.enqueue({ type: 'inbound_sms', payload: { From: '+15551234567' } });

    expect(job).toMatchObject({ id: 'job-enqueue-1', type: 'inbound_sms', status: 'pending' });
    expect(job.payload).toEqual({ From: '+15551234567' });
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into ts_jobs');
    expect(sql).toContain('returning');
    expect(params).toHaveLength(2);
    expect(params[0]).toBe('inbound_sms');
  });

  it('honors the QUEUE_JOBS_TABLE override', async () => {
    process.env.QUEUE_JOBS_TABLE = 'other_prefix_jobs';
    const qs = await loadQueue();
    mocks.query.mockResolvedValue({ rows: [row()] });

    await qs.enqueue({ type: 'inbound_sms', payload: {} });

    const [sql] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into other_prefix_jobs');
  });

  it('dequeue claims one pending job with FOR UPDATE SKIP LOCKED', async () => {
    const qs = await loadQueue();
    mocks.query.mockResolvedValue({
      rows: [row({ status: 'processing', attempts: 1, locked_by: 'worker-1' })],
    });

    const job = await qs.dequeue('worker-1');

    expect(job).toMatchObject({ status: 'processing', attempts: 1, lockedBy: 'worker-1' });
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain('status = \'pending\'');
    expect(sql).toContain('update ts_jobs');
    expect(params).toEqual(['worker-1']);
  });

  it('dequeue returns null when no pending job exists', async () => {
    const qs = await loadQueue();
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(qs.dequeue('worker-1')).resolves.toBeNull();
  });

  it('complete marks the job completed and clears lock fields', async () => {
    const qs = await loadQueue();
    mocks.query.mockResolvedValue({ rows: [] });

    await qs.complete('job-1');

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('update ts_jobs');
    expect(sql).toContain("status = 'completed'");
    expect(sql).toContain('locked_by = null');
    expect(params).toEqual(['job-1']);
  });

  it('fail marks the job failed and logs the error', async () => {
    const qs = await loadQueue();
    mocks.query.mockResolvedValue({ rows: [] });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await qs.fail('job-1', new Error('boom'));

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('update ts_jobs');
    expect(sql).toContain("status = 'failed'");
    expect(params).toEqual(['job-1']);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('throws when DATABASE_URL is missing (env-free boot guard)', async () => {
    delete process.env.DATABASE_URL;
    const qs = await loadQueue();

    await expect(qs.enqueue({ type: 'inbound_sms', payload: {} })).rejects.toThrow(
      /DATABASE_URL not configured/,
    );
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
