/**
 * WhatsApp consent storage (T18 Phase D) — reads the rl_customers
 * whatsapp_opted_in / whatsapp_opted_in_at columns (migration 014) and writes
 * opt-in at the worker's write points.
 *
 * Read-only customer lookup: NEVER creates a customer row — the fallback
 * engine consults consent for an EXISTING customer only. Opt-in is idempotent
 * (setting the flag true again is a no-op), so both the WA keyword branch and
 * the per-inbound auto opt-in can call it unconditionally.
 *
 * Env-free boot / lazy singleton pool (escalation-service convention).
 */
import { Pool } from 'pg';

export interface CustomerConsent {
  id: string;
  phoneVerifiedAt: string | null;
  whatsappOptedIn: boolean;
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

function customersTable(): string {
  return process.env.CUSTOMERS_TABLE ?? 'rl_customers';
}

interface ConsentRow {
  id: string;
  phone_verified_at: Date | null;
  whatsapp_opted_in: boolean;
}

function toConsent(row: ConsentRow): CustomerConsent {
  return {
    id: row.id,
    phoneVerifiedAt: row.phone_verified_at?.toISOString() ?? null,
    whatsappOptedIn: row.whatsapp_opted_in,
  };
}

/**
 * Read-only customer consent lookup by org + bare E.164 phone. Returns null
 * when no customer row exists — the caller decides (the fallback engine treats
 * a missing row as "no consent" → blocked_optin). No insert/create here.
 */
export async function getCustomerByPhone(
  organizationId: string,
  phone: string,
): Promise<CustomerConsent | null> {
  const { rows } = await getPool().query<ConsentRow>(
    `select id, phone_verified_at, whatsapp_opted_in
       from public.${customersTable()}
      where organization_id = $1 and phone = $2`,
    [organizationId, phone],
  );
  return rows[0] ? toConsent(rows[0]) : null;
}

/**
 * Record (or confirm) WhatsApp opt-in for a customer. Idempotent: re-running
 * on an already-opted-in customer just re-sets the same flag + timestamp.
 */
export async function recordWhatsAppOptIn(customerId: string): Promise<void> {
  await getPool().query(
    `update public.${customersTable()}
        set whatsapp_opted_in = true,
            whatsapp_opted_in_at = now()
      where id = $1`,
    [customerId],
  );
}

/** Consent flag lookup; false when the customer row is missing. */
export async function hasWhatsAppOptIn(customerId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ whatsapp_opted_in: boolean }>(
    `select whatsapp_opted_in
       from public.${customersTable()}
      where id = $1`,
    [customerId],
  );
  return rows[0]?.whatsapp_opted_in ?? false;
}