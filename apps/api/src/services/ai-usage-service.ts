/**
 * AI usage + cost ledger (Checkpoint 01 §3).
 *
 * Persists one row per LLM call — request_id, provider, model, token counts
 * and an estimated USD cost — so the observability checkpoint (P0.9) and cost
 * tracking have real numbers to work with. Recording only: nothing in this
 * file decides whether an LLM is called (that is classifyStep's job), and no
 * production wiring exists yet — the worker will call recordAiUsage() next to
 * classifyStep once Checkpoint 03+ hooks land.
 *
 * Follows the same env-free lazy-pool pattern as queue-service.ts.
 */
import { Pool } from 'pg';

export type AiUsageSource = 'llm' | 'merged';

export interface RecordAiUsageInput {
  requestId: string;
  provider: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  /** Optional precomputed estimate. When omitted, estimateCostUsd() is used. */
  estimatedCostUsd?: number | null;
  /** classifyStep source label that produced this usage: 'llm' or 'merged'. */
  source?: AiUsageSource;
}

export interface AiUsageRecord {
  id: string;
  requestId: string;
  provider: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  estimatedCostUsd: number;
  source: AiUsageSource;
  createdAt: string;
}

/** USD cost per 1M tokens, keyed by provider string. gpt-4o-mini rates are
 *  the wired default (see .env.example); unknown providers cost 0 until a
 *  rate is added here. */
const INPUT_RATE_PER_1M: Record<string, number> = { openai: 0.15 };
const OUTPUT_RATE_PER_1M: Record<string, number> = { openai: 0.6 };

/** Estimate the USD cost of one LLM call from token counts. Rounds to 6
 *  decimals (microdollars), matching numeric(10,6) in the table. */
export function estimateCostUsd(provider: string, tokensInput: number, tokensOutput: number): number {
  const inputCost = tokensInput * (INPUT_RATE_PER_1M[provider] ?? 0);
  const outputCost = tokensOutput * (OUTPUT_RATE_PER_1M[provider] ?? 0);
  return Math.round(((inputCost + outputCost) / 1_000_000) * 1_000_000) / 1_000_000;
}

/** Table name honors the muhai-shared project prefix convention: rl_ai_usage. */
function aiUsageTable(): string {
  return process.env.AI_USAGE_TABLE ?? 'rl_ai_usage';
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not configured');
    }
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

interface AiUsageRow {
  id: string;
  request_id: string;
  provider: string;
  model: string;
  tokens_input: number;
  tokens_output: number;
  estimated_cost_usd: number | string;
  source: AiUsageSource;
  created_at: Date;
}

/**
 * Insert one AI usage row for a single LLM call. Returns the full record.
 * Throws when the insert returns no row (should never happen against Postgres).
 */
export async function recordAiUsage(input: RecordAiUsageInput): Promise<AiUsageRecord> {
  const tableName = aiUsageTable();
  const cost =
    input.estimatedCostUsd != null
      ? input.estimatedCostUsd
      : estimateCostUsd(input.provider, input.tokensInput, input.tokensOutput);
  const source = input.source ?? 'llm';

  const { rows } = await getPool().query<AiUsageRow>(
    `insert into ${tableName}
       (request_id, provider, model, tokens_input, tokens_output, estimated_cost_usd, source)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id, request_id, provider, model, tokens_input, tokens_output,
               estimated_cost_usd, source, created_at`,
    [input.requestId, input.provider, input.model, input.tokensInput, input.tokensOutput, cost, source],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('recordAiUsage: insert returned no row');
  }

  return {
    id: row.id,
    requestId: row.request_id,
    provider: row.provider,
    model: row.model,
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
    estimatedCostUsd: typeof row.estimated_cost_usd === 'string' ? Number(row.estimated_cost_usd) : row.estimated_cost_usd,
    source: row.source,
    createdAt: row.created_at.toISOString(),
  };
}
