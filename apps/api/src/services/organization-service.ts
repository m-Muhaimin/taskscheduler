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
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

function organizationsTable(): string {
  return process.env.ORGANIZATIONS_TABLE ?? 'rl_organizations';
}

function organizationMembersTable(): string {
  return process.env.ORGANIZATION_MEMBERS_TABLE ?? 'rl_organization_members';
}

function twilioNumbersTable(): string {
  return process.env.TWILIO_NUMBERS_TABLE ?? 'rl_twilio_numbers';
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
 * Minimal org context the dashboard routes need to scope every query:
 * the org the user belongs to plus its IANA timezone.
 */
export interface OrgContext {
  organizationId: string;
  timezone: string;
}

/**
 * Resolve the owning organization for an authenticated tradesperson (T2+T3).
 * Returns null when the user is not an active member of any org.
 */
export async function getOrgContextByUserId(userId: string): Promise<OrgContext | null> {
  const { rows } = await getPool().query<{ organization_id: string; timezone: string }>(
    `select m.organization_id, o.timezone
     from public.${organizationMembersTable()} m
     join public.${organizationsTable()} o on o.id = m.organization_id
     where m.user_id = $1 and o.status = 'active'
     limit 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return { organizationId: row.organization_id, timezone: row.timezone || 'America/New_York' };
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

// ---------------------------------------------------------------------------
// Per-org settings (T11) — rl_organizations.settings jsonb (default '{}').
// The dashboard automation toggles are stored under settings.automation;
// every OTHER key in the jsonb is preserved untouched by updates.
// ---------------------------------------------------------------------------

/** Full settings jsonb of an org, or null when the org row is missing. */
export async function getOrganizationSettings(orgId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await getPool().query<{ settings: unknown }>(
    `select settings from public.${organizationsTable()}
     where id = $1`,
    [orgId],
  );
  const row = rows[0];
  if (!row) return null;
  return (row.settings as Record<string, unknown>) ?? {};
}

/**
 * Merge `patch` into `settings.automation` (org-scoped UPDATE … WHERE id —
 * orgId always comes from the caller's membership-resolved org context) and
 * return the full updated settings jsonb. Other settings keys (brand, …) are
 * preserved: jsonb_set only touches the '{automation}' path, and the
 * automation object itself is merged (coalesce + ||) so unknown automation
 * keys in storage also survive. Returns null when the org row is missing.
 */
export async function updateOrganizationSettings(
  orgId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const { rows } = await getPool().query<{ settings: unknown }>(
    `update public.${organizationsTable()}
     set settings = jsonb_set(
           settings,
           '{automation}',
           coalesce(settings -> 'automation', '{}'::jsonb) || $2::jsonb
         ),
         updated_at = now()
     where id = $1
     returning settings`,
    [orgId, JSON.stringify(patch)],
  );
  const row = rows[0];
  if (!row) return null;
  return (row.settings as Record<string, unknown>) ?? {};
}

// ---------------------------------------------------------------------------
// Creation (workspace setup) — no INSERT existed anywhere before this; the
// signup form has always collected a business name and, per the T4 brief's
// explicit ruling ("keep business field in UI, do NOT send to API"),
// deliberately dropped it rather than half-wire it before this org-creation
// path existed. This is that path: org + owner membership in one
// transaction, with slug collision retry.
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'workspace';
}

function isSlugUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.message.includes('duplicate key') &&
    err.message.includes('rl_organizations_slug_idx')
  );
}

export interface CreateOrganizationInput {
  name: string;
  timezone: string;
  ownerId: string;
}

/**
 * Creates the organization + its OWNER membership row as one transaction —
 * a user should never end up with an org and no membership, or vice versa.
 * Slug is derived from `name`; on a collision (another org already has that
 * slug) it retries with `-2`, `-3`, ... rather than failing the whole signup
 * over a cosmetic URL fragment.
 */
export async function createOrganization(input: CreateOrganizationInput): Promise<OrganizationRow> {
  const client = await getPool().connect();
  try {
    const baseSlug = slugify(input.name);
    let slug = baseSlug;

    // 25 is a generous bound for realistic collision rates (two businesses
    // slugifying to the exact same name 24 times over); exhausting it throws
    // rather than looping forever.
    for (let attempt = 0; attempt < 25; attempt++) {
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{
          id: string;
          name: string;
          slug: string;
          timezone: string;
          status: string;
          created_at: Date;
          updated_at: Date;
        }>(
          `insert into public.${organizationsTable()} (name, slug, timezone)
           values ($1, $2, $3)
           returning id, name, slug, timezone, status, created_at, updated_at`,
          [input.name, slug, input.timezone],
        );
        const org = rows[0];
        await client.query(
          `insert into public.${organizationMembersTable()} (organization_id, user_id, role)
           values ($1, $2, 'OWNER')`,
          [org.id, input.ownerId],
        );
        await client.query('COMMIT');
        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          timezone: org.timezone,
          status: org.status as 'active' | 'suspended',
          createdAt: org.created_at.toISOString(),
          updatedAt: org.updated_at.toISOString(),
        };
      } catch (err) {
        await client.query('ROLLBACK');
        if (isSlugUniqueViolation(err)) {
          slug = `${baseSlug}-${attempt + 2}`; // -2, -3, ... (baseSlug itself was attempt 0)
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Could not generate a unique workspace slug from "${input.name}"`);
  } finally {
    client.release();
  }
}
