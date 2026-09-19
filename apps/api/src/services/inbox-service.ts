/**
 * Inbox action layer (T10) — real reply/approve for dashboard inbox items.
 *
 * Distinct from conversation-service.ts (which owns rl_conversation_states,
 * the reschedule state machine). This service owns the conversation-domain
 * side: rl_conversations + rl_messages.
 *
 * Env-free boot: DATABASE_URL read on first use, never at module scope.
 * Lazy singleton pool per process (same pattern as queue-service.ts).
 * No SMS is sent here (dev rule): we only create the queued outbound message
 * row — the SMS worker/service delivers later (matches queue-service pattern).
 */
import { Pool } from 'pg';
import { enqueue } from './queue-service.js';
import type { InboxOfferedSlots } from './dashboard-service.js';

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

function conversationsTable(): string {
  return process.env.CONVERSATIONS_TABLE ?? 'rl_conversations';
}
function customersTable(): string {
  return process.env.CUSTOMERS_TABLE ?? 'rl_customers';
}
function messagesTable(): string {
  return process.env.MESSAGES_TABLE ?? 'rl_messages';
}
function conversationStatesTable(): string {
  return process.env.CONVERSATION_STATES_TABLE ?? 'rl_conversation_states';
}

// ---------------------------------------------------------------------------
// Conversation lookup
// ---------------------------------------------------------------------------

export interface InboxConversation {
  id: string;
  status: string;
  outboundBody: string | null;
  state: string | null;
  offeredSlots: InboxOfferedSlots | null;
  escalationReason: string | null;
}

/**
 * Org-scoped inbox conversation lookup — the input for reply/approve.
 * Subqueries mirror dashboard-service.getInboxItems exactly (latest outbound
 * body, latest state by customer phone) so the approve suggestion derivation
 * sees the same data the inbox list showed. Returns null when the
 * conversation is missing OR belongs to another org (404 source).
 */
export async function getInboxConversation(conversationId: string, orgId: string): Promise<InboxConversation | null> {
  const { rows } = await getPool().query<{
    id: string;
    status: string;
    outbound_body: string | null;
    state: string | null;
    offered_slots: unknown;
    escalation_reason: string | null;
  }>(
    `select c.id, c.status,
            om.body as outbound_body,
            st.state, st.offered_slots, st.escalation_reason
     from public.${conversationsTable()} c
     join public.${customersTable()} cu on cu.id = c.customer_id
     left join lateral (
       select m.body from public.${messagesTable()} m
       where m.conversation_id = c.id and m.direction = 'outbound' and m.body is not null
       order by m.created_at desc
       limit 1
     ) om on true
     left join lateral (
       select s.state, s.offered_slots, s.escalation_reason
       from public.${conversationStatesTable()} s
       where s.phone = cu.phone
       order by s.created_at desc
       limit 1
     ) st on true
     where c.id = $1 and c.organization_id = $2`,
    [conversationId, orgId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    outboundBody: row.outbound_body,
    state: row.state,
    offeredSlots: Array.isArray(row.offered_slots) ? (row.offered_slots as InboxOfferedSlots) : null,
    escalationReason: row.escalation_reason,
  };
}

// ---------------------------------------------------------------------------
// Reply / approve actions
// ---------------------------------------------------------------------------

/**
 * Create the queued outbound reply row (provider 'manual' = sent by a human or
 * approved suggestion; the SMS worker delivers it later — no SMS in dev).
 * The INSERT is org-guarded via EXISTS so a reply can never be queued against
 * a conversation belonging to another org, even if the route's pre-check and
 * this insert race. T13: the returned row id is handed to the job queue as an
 * `outbound_sms` job so the worker actually delivers the queued message.
 */
export async function enqueueOutboundReply(conversationId: string, body: string, orgId: string): Promise<void> {
  const { rows } = await getPool().query<{ id: string }>(
    `insert into public.${messagesTable()} (conversation_id, provider, direction, body, status)
     select $1, 'manual', 'outbound', $2, 'queued'
     where exists (
       select 1 from public.${conversationsTable()} c
       where c.id = $1 and c.organization_id = $3
     )
     returning id`,
    [conversationId, body, orgId],
  );
  const row = rows[0];
  if (!row) {
    // Org guard rejected the insert (other-org race): nothing was queued, so
    // nothing to deliver — same silent no-op as before T13.
    return;
  }
  // If the enqueue fails AFTER the row insert, rethrow: the route returns 500
  // and the caller sees the reply never completed (no swallow — a queued row
  // without a job is exactly the bug T13 closes).
  await enqueue({ type: 'outbound_sms', payload: { messageId: row.id } });
}

/**
 * Close the conversation (org-scoped UPDATE) — status 'closed' + closed_at
 * now(); the inbox item then renders 'handled' on the next fetch. Idempotent:
 * re-closing an already-closed conversation just refreshes closed_at.
 */
export async function closeConversation(conversationId: string, orgId: string): Promise<void> {
  await getPool().query(
    `update public.${conversationsTable()}
     set status = 'closed', closed_at = now(), updated_at = now()
     where id = $1 and organization_id = $2`,
    [conversationId, orgId],
  );
}