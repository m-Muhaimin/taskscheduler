/**
 * Organization domain — CP02 tenant model.
 *
 * Env-free boot: DATABASE_URL read on first use, never at module scope.
 * Lazy singleton pool per process (same pattern as conversation-service.ts).
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
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000 });
  }
  return pool;
}

function organizationsTable(): string {
  return process.env.ORGANIZATIONS_TABLE ?? 'ts_organizations';
}

function twilioNumbersTable(): string {
  return process.env.TWILIO_NUMBERS_TABLE ?? 'ts_twilio_numbers';
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export async function getOrganizationById(id: string): Promise<OrganizationRow | null> {
  const { rows } = await getPool().query<{
    id: string;
    name: string;
    slug: string;
    timezone: string;
    status: string;
    created_at: Date;
    updated_at: Date;
  }>(
    `select id, name, slug, timezone, status, created_at, updated_at
     from public.${organizationsTable()}
     where id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    timezone: row.timezone,
    status: row.status as 'active' | 'suspended',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Resolve the owning organization for an inbound Twilio number (CP03 spec H.2).
 * Returns null when the number is not registered to any org.
 */
export async function resolveOrganizationIdByTwilioNumber(
  phone: string,
): Promise<string | null> {
  const { rows } = await getPool().query<{ organization_id: string }>(
    `select organization_id from public.${twilioNumbersTable()}
     where phone = $1
     limit 1`,
    [phone],
  );
  return rows[0]?.organization_id ?? null;
}
