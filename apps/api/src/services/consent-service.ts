/**
 * SMS consent service — opt-in tracking for the SMS pipeline.
 *
 * Rule: never send an SMS without a logged consent record.
 *
 * This module is the ONLY authority for the rl_customers.sms_opted_in /
 * sms_opted_in_at pair. Nothing else in the codebase reads or writes those
 * columns. The outbound gate lives in sms-service.ts (sendSms); the write
 * point lives in worker/process-inbound-sms.ts.
 */

import { Pool } from 'pg';

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
 * Customers table name — honors the CUSTOMERS_TABLE override used by local
 * prefixes, defaulting to the bare `rl_customers`.
 *
 * Repo convention (dashboard-service, escalation-service, inbox-service,
 * process-outbound-sms): the env var holds a BARE table name and the `public.`
 * schema is interpolated here. A `public.`-qualified value is accepted and
 * de-duplicated so a deployer who copies this module's own output doesn't
 * produce `public.public.x`; any other schema is honored verbatim.
 *
 * The value is interpolated into SQL, so it is validated as an identifier
 * first (env-only, but this is the consent authority — fail loudly, never
 * interpolate an arbitrary string into a query).
 */
const SQL_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*(?:\.[A-Za-z_][A-Za-z0-9_$]*)?$/;

function tableName(): string {
  const override = (process.env.CUSTOMERS_TABLE ?? '').trim();
  if (override === '') return 'public.rl_customers';
  if (!SQL_IDENTIFIER_RE.test(override)) {
    throw new Error(
      `consent-service: CUSTOMERS_TABLE must be a bare or schema-qualified SQL identifier, got ${JSON.stringify(override)}`,
    );
  }
  if (override.includes('.')) return override;
  return `public.${override}`;
}

/**
 * Check whether a customer has opted in to SMS messaging.
 */
export async function hasSmsOptIn(customerId: string): Promise<boolean> {
  const { rows } = await getPool().query(
    `select sms_opted_in from ${tableName()} where id = $1`,
    [customerId],
  );
  if (rows.length === 0) return false;
  return Boolean(rows[0].sms_opted_in);
}

/**
 * Record that a customer consented to SMS messaging.
 */
export async function recordSmsOptIn(customerId: string): Promise<void> {
  await getPool().query(
    `update ${tableName()}
        set sms_opted_in = true,
            sms_opted_in_at = now()
      where id = $1`,
    [customerId],
  );
}
