import { Pool } from 'pg';

/**
 * Durable Postgres-backed job queue (build-sequence.md Step 4).
 * enqueue → dequeue (atomic claim, FOR UPDATE SKIP LOCKED) → complete/fail.
 *
 * Rules honored:
 * - Env-free boot: DATABASE_URL is read on first use, never at module scope;
 *   the pool is a lazy singleton per process.
 * - dequeue() claims at most one job atomically — no lost updates under
 *   concurrency, never blocks on a locked row (SKIP LOCKED).
 */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface QueueJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  lockedAt: Date | string | null;
  lockedBy: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface EnqueueInput {
  type: string;
  payload: Record<string, unknown>;
}

interface JobRow {
  id: string;
  type: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  locked_at: Date | string | null;
  locked_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/** Table name honors the muhai-shared project prefix convention: ts_jobs (TS). */
function jobTable(): string {
  return process.env.QUEUE_JOBS_TABLE ?? 'ts_jobs';
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

function toJob(row: JobRow): QueueJob {
  return {
    id: row.id,
    type: row.type,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status,
    attempts: row.attempts,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function enqueue(input: EnqueueInput): Promise<QueueJob> {
  const { rows } = await getPool().query<JobRow>(
    `insert into ${jobTable()} (type, payload)
     values ($1, $2)
     returning id, type, payload, status, attempts, locked_at, locked_by, created_at, updated_at`,
    [input.type, input.payload],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('enqueue: insert returned no row');
  }
  return toJob(row);
}

export async function dequeue(workerId: string): Promise<QueueJob | null> {
  const { rows } = await getPool().query<JobRow>(
    `update ${jobTable()}
        set status = 'processing',
            attempts = attempts + 1,
            locked_at = now(),
            locked_by = $1,
            updated_at = now()
      where id = (
        select id
          from ${jobTable()}
         where status = 'pending'
         order by created_at
         limit 1
           for update skip locked
      )
      returning id, type, payload, status, attempts, locked_at, locked_by, created_at, updated_at`,
    [workerId],
  );
  return rows[0] ? toJob(rows[0]) : null;
}

export async function complete(jobId: string): Promise<void> {
  await getPool().query(
    `update ${jobTable()}
        set status = 'completed', locked_at = null, locked_by = null, updated_at = now()
      where id = $1`,
    [jobId],
  );
}

export async function fail(jobId: string, error: unknown): Promise<void> {
  console.error('[queue] job failed', JSON.stringify({ jobId, error: String(error) }));
  await getPool().query(
    `update ${jobTable()}
        set status = 'failed', locked_at = null, locked_by = null, updated_at = now()
      where id = $1`,
    [jobId],
  );
}
