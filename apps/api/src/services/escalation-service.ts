/**
 * Escalation creation (build-sequence.md Step 6).
 *
 * Wraps the shared `Escalation` type into a Postgres-backed create.
 * Follows the same env-free lazy-pool pattern as queue-service.ts.
 */
import { Pool } from 'pg';
import type { Escalation, EscalationType } from '@tradescheduler/shared';

export interface CreateEscalationInput {
  type: EscalationType;
  customerPhone: string;
  content: string | null;
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not configured');
    }
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  }
  return pool;
}

/**
 * Insert a new escalation row. Returns the full Escalation shape
 * (id, type, customerPhone, content, status, createdAt, resolvedAt).
 *
 * The table is `ts_escalations` by default (matches the shared-project
 * `TS_` prefix convention) and can be overridden with
 * `ESCALATIONS_TABLE`.
 */
export async function createEscalation(
  input: CreateEscalationInput,
): Promise<Escalation> {
  const tableName = process.env.ESCALATIONS_TABLE ?? 'ts_escalations';
  const { type, customerPhone, content } = input;

  const { rows } = await getPool().query<{
    id: string;
    type: EscalationType;
    customer_phone: string;
    content: string | null;
    status: 'pending' | 'resolved';
    created_at: Date;
    resolved_at: Date | null;
  }>(
    `insert into ${tableName} (type, customer_phone, content)
     values ($1, $2, $3)
     returning id, type, customer_phone, content, status, created_at, resolved_at`,
    [type, customerPhone, content],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('createEscalation: insert returned no row');
  }

  return {
    id: row.id,
    type: row.type,
    customerPhone: row.customer_phone,
    content: row.content,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
  };
}
