/**
 * Outbound message ledger (T18 Phase C) — one rl_outbound_messages row per
 * tracked outbound SMS/WhatsApp message, updated by the Twilio StatusCallback
 * route (/api/twilio/webhooks/status) as delivery reports arrive.
 *
 * Follows the escalation-service conventions: lazy env-free singleton pool,
 * env-override table name (OUTBOUND_MESSAGES_TABLE, rl_ default), snake_case
 * rows mapped to camelCase domain rows.
 *
 * Status lifecycle (migration 014 CHECK):
 *   queued --insert--> queued (message_sid NULL)
 *   queued --markSent--> sent (+message_sid)
 *   sent  --status callback--> delivered | failed | (retried|escalated|blocked_optin)
 *
 * Terminal states — 'delivered' | 'retried' | 'escalated' — are write-once:
 * every UPDATE carries a `status <> all terminal states` guard, so a late or
 * duplicated Twilio callback is a no-op (idempotent; Twilio retries non-2xx
 * responses, and the route always answers 2xx, but duplicates can still
 * arrive out of band). 'blocked_optin' is intentionally NOT terminal: it is a
 * pre-delivery consent refusal, and a subsequent real delivery report for the
 * same SID (rare, contradictory) is still recorded.
 */
import { Pool } from 'pg';
import type { Channel, MessagingKind } from '../types.js';

export type OutboundStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'retried'
  | 'escalated'
  | 'blocked_optin';

/** Statuses an outbound row may never transition OUT of. */
export const TERMINAL_STATUSES: readonly OutboundStatus[] = [
  'delivered',
  'retried',
  'escalated',
];

/** Shared guard clause for every ledger UPDATE: no terminal state overwrite. */
const TERMINAL_GUARD =
  "status <> 'delivered' and status <> 'retried' and status <> 'escalated'";

export interface OutboundLedgerRow {
  id: string;
  organizationId: string;
  customerId: string | null;
  toPhone: string;
  body: string;
  channel: Channel;
  messageSid: string | null;
  kind: MessagingKind | null;
  status: OutboundStatus;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsertOutboundInput {
  organizationId: string;
  customerId: string | null;
  toPhone: string;
  body: string;
  channel: Channel;
  kind: MessagingKind | null;
}

interface OutboundRow {
  id: string;
  organization_id: string;
  customer_id: string | null;
  to_phone: string;
  body: string;
  channel: string;
  message_sid: string | null;
  kind: string | null;
  status: string;
  error_code: string | null;
  created_at: Date;
  updated_at: Date;
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

function tableName(): string {
  return process.env.OUTBOUND_MESSAGES_TABLE ?? 'rl_outbound_messages';
}

const RETURNING =
  'returning id, organization_id, customer_id, to_phone, body, channel, message_sid, kind, status, error_code, created_at, updated_at';

const SELECT_BY =
  'select id, organization_id, customer_id, to_phone, body, channel, message_sid, kind, status, error_code, created_at, updated_at';

function toRow(row: OutboundRow): OutboundLedgerRow {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    toPhone: row.to_phone,
    body: row.body,
    channel: row.channel as Channel,
    messageSid: row.message_sid,
    kind: row.kind as MessagingKind | null,
    status: row.status as OutboundStatus,
    errorCode: row.error_code,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Insert a ledger row for a tracked outbound message. Returns the row with
 * status 'queued' and message_sid null — the Twilio SID is written later by
 * markSent once the create succeeds (or the message stays queued/failed when
 * the create throws).
 */
export async function insertOutbound(input: InsertOutboundInput): Promise<OutboundLedgerRow> {
  const { rows } = await getPool().query<OutboundRow>(
    `insert into public.${tableName()} (organization_id, customer_id, to_phone, body, channel, kind)
     values ($1, $2, $3, $4, $5, $6)
     ${RETURNING}`,
    [
      input.organizationId,
      input.customerId,
      input.toPhone,
      input.body,
      input.channel,
      input.kind,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('insertOutbound: insert returned no row');
  }
  return toRow(row);
}

/**
 * Mark the row sent: records the Twilio MessageSid and moves queued → sent.
 * Keyed by the ledger row id (the SID is not yet in the row when this first
 * runs); the terminal-state guard makes a duplicate/raced mark a no-op.
 */
export async function markSent(sid: string, id: string): Promise<void> {
  await getPool().query(
    `update public.${tableName()}
        set status = 'sent',
            message_sid = $1,
            updated_at = now()
      where id = $2 and (message_sid is null or message_sid = $1)
        and ${TERMINAL_GUARD}`,
    [sid, id],
  );
}

/**
 * Mark the row failed (send-time throw: no SID exists, so `sid` may be null
 * and the existing message_sid is kept). Also carries the terminal guard.
 */
export async function markFailed(
  sid: string | null,
  id: string,
  errorCode: string | null,
): Promise<void> {
  await getPool().query(
    `update public.${tableName()}
        set status = 'failed',
            message_sid = coalesce($1, message_sid),
            error_code = coalesce($3, error_code),
            updated_at = now()
      where id = $2 and ${TERMINAL_GUARD}`,
    [sid, id, errorCode],
  );
}

/**
 * Apply a delivery-report status from a Twilio StatusCallback (or a fallback
 * outcome). Keyed by the ledger row id — every caller holds the row from
 * getByMessageSid/insertOutbound — with the terminal guard so delivered /
 * retried / escalated rows are never overwritten by a duplicate callback.
 */
export async function markStatus(
  id: string,
  status: OutboundStatus,
  errorCode: string | null = null,
): Promise<void> {
  await getPool().query(
    `update public.${tableName()}
        set status = $2,
            error_code = coalesce($3, error_code),
            updated_at = now()
      where id = $1 and ${TERMINAL_GUARD}`,
    [id, status, errorCode],
  );
}

/** Lookup by Twilio MessageSid (the StatusCallback payload's key). */
export async function getByMessageSid(sid: string): Promise<OutboundLedgerRow | null> {
  const { rows } = await getPool().query<OutboundRow>(
    `${SELECT_BY}
       from public.${tableName()}
      where message_sid = $1`,
    [sid],
  );
  return rows[0] ? toRow(rows[0]) : null;
}