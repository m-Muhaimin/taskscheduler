/**
 * Handler for `type = 'outbound_sms'` (T13): deliver a queued manual outbound
 * reply row (created by inbox-service.enqueueOutboundReply) via sendSms.
 *
 * Env-free boot: DATABASE_URL read on first use, never at module scope.
 * Lazy singleton pool per process (same pattern as inbox-service/queue-service).
 * Table names honor the env-override helpers used across services
 * (MESSAGES_TABLE / CONVERSATIONS_TABLE / CUSTOMERS_TABLE, rl_ default).
 *
 * State transitions (rl_messages): 'queued' --sendSms--> 'sent' (+SID) on
 * success, or 'queued' --sendSms throws--> 'failed' then the error rethrows so
 * the job fails visibly in rl_jobs. A row is never silently left 'queued'.
 */
import { Pool } from 'pg';
import type { QueueJob } from '../services/queue-service.js';
import { sendSms } from '../services/sms-service.js';

// ---------------------------------------------------------------------------
// Lazy pool
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Table helpers (env override, rl_ default)
// ---------------------------------------------------------------------------

function messagesTable(): string {
  return process.env.MESSAGES_TABLE ?? 'rl_messages';
}
function conversationsTable(): string {
  return process.env.CONVERSATIONS_TABLE ?? 'rl_conversations';
}
function customersTable(): string {
  return process.env.CUSTOMERS_TABLE ?? 'rl_customers';
}

interface OutboundMessageRow {
  id: string;
  body: string | null;
  status: string;
  phone: string | null;
}

/** Handler for `type = 'outbound_sms'`: deliver a queued manual outbound reply. */
export async function processOutboundSms(job: QueueJob): Promise<void> {
  const { messageId } = job.payload as { messageId?: string };
  if (!messageId) {
    throw new Error('outbound_sms job missing messageId');
  }

  // Load message + conversation + customer phone in ONE query. The WHERE
  // clause is the delivery guard: only a still-'queued' outbound row matches,
  // so an already-sent/failed row is treated as not-found (throw → job fails).
  const { rows } = await getPool().query<OutboundMessageRow>(
    `select m.id, m.body, m.status, cu.phone
     from public.${messagesTable()} m
     join public.${conversationsTable()} c on c.id = m.conversation_id
     join public.${customersTable()} cu on cu.id = c.customer_id
     where m.id = $1 and m.direction = 'outbound' and m.status = 'queued'`,
    [messageId],
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`outbound_sms: message ${messageId} not found or not queued`);
  }
  if (!row.body || !row.phone) {
    throw new Error(`outbound_sms: message ${messageId} is missing a body or customer phone`);
  }

  let messageSid: string;
  try {
    const result = await sendSms({ to: row.phone, body: row.body });
    messageSid = result.messageSid;
  } catch (err) {
    // Twilio refused/rejected: mark the row 'failed' so it is visible and
    // never silently stuck 'queued', then rethrow (job fails in rl_jobs).
    try {
      await getPool().query(
        `update public.${messagesTable()} set status = 'failed' where id = $1`,
        [messageId],
      );
    } catch (updateErr) {
      console.error('[worker] outbound_sms failed-status update failed', updateErr);
    }
    throw err;
  }

  // Persist the delivery: status 'sent' + the Twilio SID. If this UPDATE
  // fails, log + rethrow — the job fails and the row stays 'queued'
  // (retryable), never silently marked sent.
  try {
    await getPool().query(
      `update public.${messagesTable()} set status = 'sent', provider_message_id = $2 where id = $1`,
      [messageId, messageSid],
    );
  } catch (err) {
    console.error('[worker] outbound_sms status update failed', err);
    throw err;
  }
}