/**
 * T16 — staff-phone recognition.
 *
 * Resolves an inbound SMS `From` number to a tradesperson (staff) who is a
 * member of the resolved organization. One query, org-scoped: a staff member
 * of ANOTHER org texting this org's number is still a customer of this org,
 * so `resolveStaffByPhone` returns null for them by design.
 *
 * Same env-free lazy-pool singleton pattern as escalation-service.ts and
 * organization-service.ts (no module-scope env reads).
 */
import { Pool } from 'pg';

export interface ResolvedStaff {
  tradespersonId: string;
  email: string;
}

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not configured');
    }
    pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

/**
 * Returns the tradesperson whose phone matches AND who is a member of the
 * given organization, or null when the number is not a staff member of that
 * org. Uniqueness of phone is guaranteed by rl_tradespeople_phone_idx.
 */
export async function resolveStaffByPhone(
  phone: string,
  organizationId: string,
): Promise<ResolvedStaff | null> {
  const { rows } = await getPool().query<{ id: string; email: string }>(
    `select t.id, t.email
       from public.rl_tradespeople t
       join public.rl_organization_members m on m.user_id = t.id
      where t.phone = $1
        and m.organization_id = $2
      limit 1`,
    [phone, organizationId],
  );

  const row = rows[0];
  if (!row) return null;
  return { tradespersonId: row.id, email: row.email };
}
