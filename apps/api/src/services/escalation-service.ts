/**
 * Escalation creation (build-sequence.md Step 6).
 *
 * Wraps the shared `Escalation` type into a Postgres-backed create.
 * Follows the same env-free lazy-pool pattern as queue-service.ts.
 */
import { Pool } from 'pg';
import type {
  Escalation,
  EscalationDto,
  EscalationListResponse,
  EscalationStatus,
  EscalationType,
} from '@tradescheduler/shared';

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
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

/**
 * Insert a new escalation row. Returns the full Escalation shape
 * (id, type, customerPhone, content, status, createdAt, resolvedAt).
 *
 * The table is `rl_escalations` by default (matches the shared-project
 * `RL_` prefix convention) and can be overridden with
 * `ESCALATIONS_TABLE`.
 */
export async function createEscalation(
  input: CreateEscalationInput,
): Promise<Escalation> {
  const tableName = process.env.ESCALATIONS_TABLE ?? 'rl_escalations';
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

// ---------------------------------------------------------------------------
// Escalation read path (T20) — org-scoped GET /api/dashboard/escalations.
// rl_escalations has no org column; rows are attributed to an org via the
// two-arm phone rule: the escalation's customer_phone must match either a
// customer row of the org, or a tradesperson row whose user is an org member.
// ---------------------------------------------------------------------------

/** Human label per escalation type (mock had only 5 — all 7 now covered). */
export const ESCALATION_LABEL: Record<string, string> = {
  ambiguous_intent: 'Ambiguous intent',
  no_availability: 'No availability',
  calendar_api_failure: 'Calendar API failure',
  sms_delivery_failure: 'SMS delivery failure',
  processing_error: 'Processing error',
  customer_escalation: 'Customer escalation',
  staff_sms: 'Staff message',
};

/** Org-tz absolute timestamp "Sep 18, 3:15 PM" (en-US, 12h). */
export function formatAbsoluteDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

// Table helpers (env override, rl_ default) — mirrors dashboard-service.ts.
function escalationsTable(): string {
  return process.env.ESCALATIONS_TABLE ?? 'rl_escalations';
}
function customersTable(): string {
  return process.env.CUSTOMERS_TABLE ?? 'rl_customers';
}
function tradespeopleTable(): string {
  return process.env.TRADESPEOPLE_TABLE ?? 'rl_tradespeople';
}
function organizationMembersTable(): string {
  return process.env.ORGANIZATION_MEMBERS_TABLE ?? 'rl_organization_members';
}

/** Org-scope predicate (the two-arm phone rule — pinned literally): an
 *  escalation surfaces when its customer_phone belongs to an org customer OR
 *  to a staff member (tradesperson joined to the org's memberships). */
function orgScopePredicate(): string {
  return `
  (
    exists (select 1 from public.${customersTable()} cu
             where cu.organization_id = $1 and cu.phone = e.customer_phone)
    or exists (select 1 from public.${tradespeopleTable()} tp
               join public.${organizationMembersTable()} om on om.user_id = tp.id
               where om.organization_id = $1 and tp.phone = e.customer_phone)
  )`;
}

/** Defensive clamp; the route already guards NaN, but page/pageSize are
 *  clamped here too so callers can never produce a bogus LIMIT/OFFSET. */
function clampInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

type EscalationRow = {
  id: string;
  type: EscalationType;
  customer_phone: string;
  content: string | null;
  status: EscalationStatus;
  created_at: Date;
  resolved_at: Date | null;
};

function toEscalationDto(row: EscalationRow, tz: string): EscalationDto {
  return {
    id: row.id,
    type: row.type,
    customerPhone: row.customer_phone,
    content: row.content,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    typeLabel: ESCALATION_LABEL[row.type] ?? row.type,
    createdAtDisplay: formatAbsoluteDate(row.created_at.toISOString(), tz),
    resolvedAtDisplay: row.resolved_at ? formatAbsoluteDate(row.resolved_at.toISOString(), tz) : null,
  };
}

export interface GetEscalationsOptions {
  status?: EscalationStatus;
  page?: number;
  pageSize?: number;
  timezone: string;
}

export async function getEscalations(
  orgId: string,
  opts: GetEscalationsOptions,
): Promise<EscalationListResponse> {
  const page = clampInt(Number(opts.page ?? 1), 1, 1, Number.MAX_SAFE_INTEGER);
  const pageSize = clampInt(Number(opts.pageSize ?? 20), 20, 1, 100);
  const offset = (page - 1) * pageSize;

  const params: unknown[] = [orgId];
  if (opts.status) params.push(opts.status);
  params.push(pageSize, offset);

  const statusClause = opts.status ? `and e.status = $2` : '';

  const { rows } = await getPool().query<EscalationRow>(
    `select e.id, e.type, e.customer_phone, e.content, e.status, e.created_at, e.resolved_at
       from public.${escalationsTable()} e
      where ${orgScopePredicate()}
      ${statusClause}
      order by case when e.status = 'pending' then 0 else 1 end, e.created_at desc
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );

  const countParams: unknown[] = [orgId];
  if (opts.status) countParams.push(opts.status);

  const { rows: countRows } = await getPool().query<{ total: number }>(
    `select count(*)::int as total
       from public.${escalationsTable()} e
      where ${orgScopePredicate()}
      ${statusClause}`,
    countParams,
  );

  return {
    escalations: rows.map((row) => toEscalationDto(row, opts.timezone)),
    total: countRows[0]?.total ?? 0,
    page,
    pageSize,
  };
}
