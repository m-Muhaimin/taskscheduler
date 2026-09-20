/** Conversation domain service — customers, conversations, messages.
 *
 *  Checkpoint 03: the first genuinely new business entities in this repo.
 *  Wired into process-inbound-sms.ts so every inbound SMS creates or matches
 *  a customer + conversation + message before the existing intent dispatch.
 *
 *  Env-free boot: DATABASE_URL read on first use, never at module scope.
 *  Lazy singleton pool per process (same pattern as conversation-service.ts).
 */

import { Pool } from 'pg';

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
// Types — matching the new tables
// ---------------------------------------------------------------------------

export interface Customer {
  id: string;
  organizationId: string;
  name: string | null;
  phone: string;
  email: string | null;
  // T14 device-verification state (migration 010); null phoneVerifiedAt = unverified.
  phoneVerifiedAt: string | null;
  verificationCode: string | null;
  verificationCodeExpiresAt: string | null;
  verificationAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerAddress {
  id: string;
  customerId: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  organizationId: string;
  customerId: string;
  channel: 'sms' | 'voice' | 'web';
  status: 'open' | 'closed' | 'escalated';
  intent: string | null;
  currentState: string;
  assignedUserId: string | null;
  missingInformation: string[]; // jsonb → parsed array
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  provider: 'twilio' | 'manual';
  providerMessageId: string | null;
  direction: 'inbound' | 'outbound';
  body: string | null;
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'received';
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// ApiError — error contract for all public functions
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | 'ORG_NOT_FOUND'
  | 'INVALID_PHONE'
  | 'DB_ERROR'
  | 'CUSTOMER_NOT_FOUND'
  | 'INVALID_CHANNEL'
  | 'CONVERSATION_NOT_FOUND'
  | 'CONVERSATION_CLOSED'
  | 'INVALID_DIRECTION'
  | 'MISSING_BODY';

export interface ApiError {
  type: 'bad_request' | 'not_found' | 'server_error';
  message: string;
  code: ApiErrorCode;
}

// ---------------------------------------------------------------------------
// Row → domain type helpers
// ---------------------------------------------------------------------------

interface CustomerRow {
  id: string;
  organization_id: string;
  name: string | null;
  phone: string;
  email: string | null;
  phone_verified_at: Date | null;
  verification_code: string | null;
  verification_code_expires_at: Date | null;
  verification_attempts: number;
  created_at: Date;
  updated_at: Date;
}

interface ConversationRow {
  id: string;
  organization_id: string;
  customer_id: string;
  channel: string;
  status: string;
  intent: string | null;
  current_state: string;
  assigned_user_id: string | null;
  missing_information: unknown; // jsonb
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  provider: string;
  provider_message_id: string | null;
  direction: string;
  body: string | null;
  status: string;
  metadata: unknown; // jsonb
  created_at: Date;
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    // Defensive ?./?? — rows written before migration 010 (or mocked rows)
    // may lack the verification columns; treat them as unverified.
    phoneVerifiedAt: row.phone_verified_at?.toISOString() ?? null,
    verificationCode: row.verification_code ?? null,
    verificationCodeExpiresAt: row.verification_code_expires_at?.toISOString() ?? null,
    verificationAttempts: row.verification_attempts ?? 0,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    customerId: row.customer_id,
    channel: row.channel as Conversation['channel'],
    status: row.status as Conversation['status'],
    intent: row.intent,
    currentState: row.current_state,
    assignedUserId: row.assigned_user_id,
    missingInformation: Array.isArray(row.missing_information)
      ? row.missing_information
      : [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    closedAt: row.closed_at?.toISOString() ?? null,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    provider: row.provider as Message['provider'],
    providerMessageId: row.provider_message_id,
    direction: row.direction as Message['direction'],
    body: row.body,
    status: row.status as Message['status'],
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// findOrCreateCustomer — upsert with race-condition tie-breaking
// ---------------------------------------------------------------------------

export async function findOrCreateCustomer(
  organizationId: string,
  phone: string,
): Promise<Customer> {
  // Validate org exists and is active.
  const org = await getPool().query<{ id: string; status: string }>(
    `select id, status from public.rl_organizations where id = $1`,
    [organizationId],
  );
  if (org.rows.length === 0) {
    throw makeApiError('not_found', 'Organization not found', 'ORG_NOT_FOUND');
  }
  if (org.rows[0].status !== 'active') {
    throw makeApiError('not_found', 'Organization not found', 'ORG_NOT_FOUND');
  }

  // Validate E.164.
  if (!isValidE164(phone)) {
    throw makeApiError('bad_request', 'Invalid phone format', 'INVALID_PHONE');
  }

  try {
    const { rows } = await getPool().query<CustomerRow>(
      `insert into public.rl_customers (organization_id, phone, name, email, updated_at)
       values ($1, $2, null, null, now())
       on conflict on constraint rl_customers_org_phone_key
       do update set updated_at = now()
       returning id, organization_id, name, phone, email, created_at, updated_at,
                phone_verified_at, verification_code, verification_code_expires_at,
                verification_attempts`,
      [organizationId, phone],
    );

    const row = rows[0];
    if (!row) {
      throw new Error('findOrCreateCustomer: upsert returned no row');
    }
    return toCustomer(row);
  } catch (err) {
    if (isApiError(err)) throw err;
    throw makeApiError('server_error', `findOrCreateCustomer failed: ${String(err)}`, 'DB_ERROR');
  }
}

// ---------------------------------------------------------------------------
// findOrCreateConversation — "already open" = status=open AND updated_at within window
// ---------------------------------------------------------------------------

const CONVERSATION_OPEN_WINDOW_HOURS = 48;

export async function findOrCreateConversation(
  customerId: string,
  channel: 'sms' | 'voice' | 'web',
): Promise<Conversation> {
  // Validate customer exists.
  const customer = await getPool().query<{ id: string; organization_id: string }>(
    `select id, organization_id from public.rl_customers where id = $1`,
    [customerId],
  );
  if (customer.rows.length === 0) {
    throw makeApiError('not_found', 'Customer not found', 'CUSTOMER_NOT_FOUND');
  }
  const organizationId = customer.rows[0].organization_id;

  // Validate channel.
  if (!['sms', 'voice', 'web'].includes(channel)) {
    throw makeApiError('bad_request', 'Invalid channel', 'INVALID_CHANNEL');
  }

  try {
    // Look for an already-open conversation for this customer + channel.
    const existing = await getPool().query<ConversationRow>(
      `select id, organization_id, customer_id, channel, status, intent, current_state,
              assigned_user_id, missing_information, created_at, updated_at, closed_at
       from public.rl_conversations
       where customer_id = $1
         and channel = $2
         and status = 'open'
         and updated_at >= now() - interval '${CONVERSATION_OPEN_WINDOW_HOURS} hours'
       order by updated_at desc
       limit 1`,
      [customerId, channel],
    );

    if (existing.rows.length > 0) {
      // Refresh updated_at on the found conversation.
      const { rows: [refreshed] } = await getPool().query<ConversationRow>(
        `update public.rl_conversations set updated_at = now() where id = $1 returning id, organization_id, customer_id, channel, status, intent, current_state, assigned_user_id, missing_information, created_at, updated_at, closed_at`,
        [existing.rows[0].id],
      );
      if (!refreshed) {
        throw new Error('findOrCreateConversation: refresh returned no row');
      }
      return toConversation(refreshed);
    }

    // No open conversation — create one.
    const { rows: [created] } = await getPool().query<ConversationRow>(
      `insert into public.rl_conversations (organization_id, customer_id, channel, current_state, missing_information)
       values ($1, $2, $3, 'new', '[]'::jsonb)
       returning id, organization_id, customer_id, channel, status, intent, current_state, assigned_user_id, missing_information, created_at, updated_at, closed_at`,
      [organizationId, customerId, channel],
    );

    if (!created) {
      throw new Error('findOrCreateConversation: insert returned no row');
    }
    return toConversation(created);
  } catch (err) {
    if (isApiError(err)) throw err;
    throw makeApiError('server_error', `findOrCreateConversation failed: ${String(err)}`, 'DB_ERROR');
  }
}

// ---------------------------------------------------------------------------
// appendMessage
// ---------------------------------------------------------------------------

export async function appendMessage(
  conversationId: string,
  direction: 'inbound' | 'outbound',
  body: string | null,
  providerMessageId: string | null = null,
  metadata: Record<string, unknown> = {},
): Promise<Message> {
  // Validate conversation exists and is open.
  const conv = await getPool().query<ConversationRow>(
    `select id, status, channel from public.rl_conversations where id = $1`,
    [conversationId],
  );
  if (conv.rows.length === 0) {
    throw makeApiError('not_found', 'Conversation not found', 'CONVERSATION_NOT_FOUND');
  }
  if (conv.rows[0].status !== 'open') {
    throw makeApiError('bad_request', 'Conversation is closed', 'CONVERSATION_CLOSED');
  }

  // Validate direction.
  if (!['inbound', 'outbound'].includes(direction)) {
    throw makeApiError('bad_request', 'Invalid direction', 'INVALID_DIRECTION');
  }

  // Inbound non-voice messages must have a body.
  if (direction === 'inbound' && conv.rows[0].channel !== 'voice' && (body == null || body.trim() === '')) {
    throw makeApiError('bad_request', 'Inbound message body is required for non-voice channels', 'MISSING_BODY');
  }

  try {
    const { rows: [created] } = await getPool().query<MessageRow>(
      `insert into public.rl_messages (conversation_id, provider, provider_message_id, direction, body, status, metadata)
       values ($1, $2, $3, $4, $5, 'received', $6::jsonb)
       returning id, conversation_id, provider, provider_message_id, direction, body, status, metadata, created_at`,
      [
        conversationId,
        'twilio', // process-inbound-sms.ts always calls this for Twilio inbound; manual provider used for outbound/test
        providerMessageId,
        direction,
        body,
        JSON.stringify(metadata),
      ],
    );

    if (!created) {
      throw new Error('appendMessage: insert returned no row');
    }

    // Refresh conversation's updated_at.
    await getPool().query(
      `update public.rl_conversations set updated_at = now() where id = $1`,
      [conversationId],
    );

    return toMessage(created);
  } catch (err) {
    if (isApiError(err)) throw err;
    throw makeApiError('server_error', `appendMessage failed: ${String(err)}`, 'DB_ERROR');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidE164(phone: string): boolean {
  return /^\+?[1-9]\d{1,14}$/.test(phone);
}

function makeApiError(type: 'bad_request' | 'not_found' | 'server_error', message: string, code: ApiErrorCode): ApiError {
  return { type, message, code };
}

function isApiError(err: unknown): err is ApiError {
  return typeof err === 'object' && err !== null && 'type' in err && 'code' in err && 'message' in err;
}
