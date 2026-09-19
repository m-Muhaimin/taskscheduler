import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the AI usage ledger with a mocked `pg` Pool — same approach
 * as queue-service.test.ts (vi.hoisted mock + vi.resetModules so the lazy
 * pool singleton never leaks between tests).
 */
const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
  },
}));

const DATABASE_URL = 'postgres://user:pass@localhost:5432/tradescheduler_test';

async function loadService() {
  return await import('./ai-usage-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  mocks.query.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.AI_USAGE_TABLE;
  vi.resetModules();
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'usage-1',
    request_id: 'req-1',
    provider: 'openai',
    model: 'gpt-4o-mini',
    tokens_input: 1000,
    tokens_output: 500,
    estimated_cost_usd: '0.00045',
    source: 'llm',
    organization_id: null,
    created_at: new Date('2026-09-18T10:00:00Z'),
    ...overrides,
  };
}

describe('recordAiUsage', () => {
  it('inserts a usage row into rl_ai_usage with caller-provided cost', async () => {
    const { recordAiUsage } = await loadService();
    mocks.query.mockResolvedValue({ rows: [row()] });

    const record = await recordAiUsage({
      requestId: 'req-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokensInput: 1000,
      tokensOutput: 500,
      estimatedCostUsd: 0.00045,
    });

    expect(record).toMatchObject({
      id: 'usage-1',
      requestId: 'req-1',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokensInput: 1000,
      tokensOutput: 500,
      estimatedCostUsd: 0.00045,
      source: 'llm',
      organizationId: null,
      createdAt: '2026-09-18T10:00:00.000Z',
    });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into rl_ai_usage');
    expect(sql).toContain('organization_id');
    expect(sql).toContain('returning');
    expect(params).toEqual(['req-1', 'openai', 'gpt-4o-mini', 1000, 500, 0.00045, 'llm', null]);
  });

  it('inserts the owning organization when organizationId is provided', async () => {
    const { recordAiUsage } = await loadService();
    const orgId = 'a18c3a2a-dbb2-43cd-a4ac-9aa7cc3f2007';
    mocks.query.mockResolvedValue({ rows: [row({ organization_id: orgId })] });

    const record = await recordAiUsage({
      requestId: 'req-org',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokensInput: 10,
      tokensOutput: 5,
      organizationId: orgId,
    });

    expect(record.organizationId).toBe(orgId);
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('organization_id');
    // cost for 10/5 tokens is computed by the service (0.0000045 → rounded 0.000005)
    expect(params).toEqual(['req-org', 'openai', 'gpt-4o-mini', 10, 5, 0.000005, 'llm', orgId]);
  });

  it('computes the cost with estimateCostUsd when none is provided', async () => {
    const { recordAiUsage } = await loadService();
    mocks.query.mockResolvedValue({ rows: [row({ estimated_cost_usd: '0.00045' })] });

    await recordAiUsage({
      requestId: 'req-2',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokensInput: 1000,
      tokensOutput: 500,
    });

    // 1000 * 0.15/1M + 500 * 0.6/1M = 0.00015 + 0.0003 = 0.00045
    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into rl_ai_usage');
    expect(params).toEqual(['req-2', 'openai', 'gpt-4o-mini', 1000, 500, 0.00045, 'llm', null]);
  });

  it('records source merged when the superset path produced the usage', async () => {
    const { recordAiUsage } = await loadService();
    mocks.query.mockResolvedValue({ rows: [row({ source: 'merged' })] });

    await recordAiUsage({
      requestId: 'req-3',
      provider: 'census',
      model: 'census/llama-4-scout',
      tokensInput: 10,
      tokensOutput: 5,
      source: 'merged',
    });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['req-3', 'census', 'census/llama-4-scout', 10, 5, 0, 'merged', null]);
  });

  it('honors the AI_USAGE_TABLE override', async () => {
    process.env.AI_USAGE_TABLE = 'rl_ai_usage_test';
    const { recordAiUsage } = await loadService();
    mocks.query.mockResolvedValue({ rows: [row()] });

    await recordAiUsage({
      requestId: 'req-4',
      provider: 'openai',
      model: 'gpt-4o-mini',
      tokensInput: 1,
      tokensOutput: 1,
      estimatedCostUsd: 0,
    });

    const [sql] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into rl_ai_usage_test');
  });

  it('throws when the insert returns no row', async () => {
    const { recordAiUsage } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });

    await expect(
      recordAiUsage({
        requestId: 'req-5',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokensInput: 1,
        tokensOutput: 1,
      }),
    ).rejects.toThrow('recordAiUsage: insert returned no row');
  });

  it('throws when DATABASE_URL is not configured', async () => {
    delete process.env.DATABASE_URL;
    const { recordAiUsage } = await loadService();

    await expect(
      recordAiUsage({
        requestId: 'req-6',
        provider: 'openai',
        model: 'gpt-4o-mini',
        tokensInput: 1,
        tokensOutput: 1,
      }),
    ).rejects.toThrow('DATABASE_URL not configured');
  });
});

describe('estimateCostUsd', () => {
  it('returns 0 for providers without a documented rate', async () => {
    const { estimateCostUsd } = await loadService();
    expect(estimateCostUsd('census', 1000, 500)).toBe(0);
  });

  it('rounds to 6 decimals (microdollars)', async () => {
    const { estimateCostUsd } = await loadService();
    expect(estimateCostUsd('openai', 1000, 500)).toBe(0.00045);
  });
});
