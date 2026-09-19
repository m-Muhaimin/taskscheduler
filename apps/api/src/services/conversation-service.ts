/**
 * Conversation state CRUD (build-sequence.md Step 7).
 *
 * Env-free boot: DATABASE_URL read on first use, never at module scope.
 * Lazy singleton pool per process (same pattern as queue-service.ts).
 */

import { Pool } from 'pg';
import type { ConversationState, ConversationStateValue, OfferedSlot } from '@tradescheduler/shared';

// ---------------------------------------------------------------------------
// Row type (matching rl_conversation_states columns)
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  phone: string;
  user_id: string;
  booking_id: string | null;
  state: string;
  offered_slots: unknown; // JSONB → comes back as object/array from pg
  selected_slot: unknown; // JSONB
  escalation_reason: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

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

function table(): string {
  return process.env.CONVERSATION_STATES_TABLE ?? 'rl_conversation_states';
}

// ---------------------------------------------------------------------------
// Row → ConversationState
// ---------------------------------------------------------------------------

function toState(row: ConversationRow): ConversationState {
  return {
    id: row.id,
    phone: row.phone,
    userId: row.user_id,
    bookingId: row.booking_id,
    state: row.state as ConversationStateValue,
    offeredSlots: (row.offered_slots as OfferedSlot[]) ?? null,
    selectedSlot: (row.selected_slot as OfferedSlot) ?? null,
    escalationReason: row.escalation_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateConversationInput {
  phone: string;
  userId: string;
  bookingId: string | null;
  state: ConversationStateValue;
  offeredSlots: OfferedSlot[] | null;
  escalationReason: string | null;
}

export async function createConversation(input: CreateConversationInput): Promise<ConversationState> {
  const tableName = table();
  const { rows } = await getPool().query<ConversationRow>(
    `insert into ${tableName} (phone, user_id, booking_id, state, offered_slots, escalation_reason)
     values ($1, $2, $3, $4, $5, $6)
     returning id, phone, user_id, booking_id, state, offered_slots, selected_slot, escalation_reason, created_at, updated_at, completed_at`,
    [
      input.phone,
      input.userId,
      input.bookingId,
      input.state,
      // pg serializes JS arrays as Postgres array literals ('{"...","..."}'),
      // NOT JSON — pre-stringify so the json column gets valid JSON.
      input.offeredSlots ? JSON.stringify(input.offeredSlots) : null,
      input.escalationReason,
    ],
  );

  const row = rows[0];
  if (!row) {
    throw new Error('createConversation: insert returned no row');
  }
  return toState(row);
}

export async function getConversation(id: string): Promise<ConversationState | null> {
  const tableName = table();
  const { rows } = await getPool().query<ConversationRow>(
    `select id, phone, user_id, booking_id, state, offered_slots, selected_slot, escalation_reason, created_at, updated_at, completed_at
     from ${tableName}
     where id = $1`,
    [id],
  );
  return rows[0] ? toState(rows[0]) : null;
}

export async function getConversationByPhone(phone: string): Promise<ConversationState | null> {
  const tableName = table();
  const { rows } = await getPool().query<ConversationRow>(
    `select id, phone, user_id, booking_id, state, offered_slots, selected_slot, escalation_reason, created_at, updated_at, completed_at
     from ${tableName}
     where phone = $1
     order by created_at desc
     limit 1`,
    [phone],
  );
  return rows[0] ? toState(rows[0]) : null;
}

export interface UpdateConversationInput {
  state?: ConversationStateValue;
  offeredSlots?: OfferedSlot[] | null;
  selectedSlot?: OfferedSlot | null;
  escalationReason?: string | null;
  completedAt?: string | null;
}

export async function updateConversation(
  id: string,
  input: UpdateConversationInput,
): Promise<ConversationState> {
  const tableName = table();

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.state !== undefined) {
    sets.push(`state = $${idx++}`);
    values.push(input.state);
  }
  if (input.offeredSlots !== undefined) {
    sets.push(`offered_slots = $${idx++}`);
    // Same pre-stringify as createConversation (pg array-literal trap).
    values.push(input.offeredSlots ? JSON.stringify(input.offeredSlots) : null);
  }
  if (input.selectedSlot !== undefined) {
    sets.push(`selected_slot = $${idx++}`);
    values.push(input.selectedSlot);
  }
  if (input.escalationReason !== undefined) {
    sets.push(`escalation_reason = $${idx++}`);
    values.push(input.escalationReason);
  }
  if (input.completedAt !== undefined) {
    sets.push(`completed_at = $${idx++}`);
    values.push(input.completedAt ? new Date(input.completedAt) : null);
  }

  if (sets.length === 0) {
    throw new Error('updateConversation: no fields to update');
  }

  sets.push(`updated_at = now()`);
  values.push(id);

  const { rows } = await getPool().query<ConversationRow>(
    `update ${tableName}
     set ${sets.join(', ')}
     where id = $${idx}
     returning id, phone, user_id, booking_id, state, offered_slots, selected_slot, escalation_reason, created_at, updated_at, completed_at`,
    values,
  );

  const row = rows[0];
  if (!row) {
    throw new Error(`updateConversation: no row found for id ${id}`);
  }
  return toState(row);
}
