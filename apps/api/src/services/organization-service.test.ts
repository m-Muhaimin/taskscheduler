import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.query;
    connect = vi.fn().mockResolvedValue({ query: mocks.clientQuery, release: mocks.release });
  },
}));

async function loadService() {
  return await import('./organization-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  mocks.query.mockReset();
  mocks.clientQuery.mockReset();
  mocks.release.mockReset();
});

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.ORGANIZATIONS_TABLE;
  delete process.env.MEMBERSHIPS_TABLE;
  delete process.env.TWILIO_NUMBERS_TABLE;
  vi.resetModules();
});

describe('getOrganizationSettings (T11)', () => {
  it('returns the settings jsonb when the org row exists', async () => {
    const { getOrganizationSettings } = await loadService();
    mocks.query.mockResolvedValue({ rows: [{ settings: { automation: { aiFrontDesk: false }, brand: 'x' } }] });

    const settings = await getOrganizationSettings('org-1');
    expect(settings).toEqual({ automation: { aiFrontDesk: false }, brand: 'x' });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('select settings from public.rl_organizations');
    expect(sql).toContain('where id = $1');
    expect(params).toEqual(['org-1']);
  });

  it('treats a NULL settings column as {}', async () => {
    const { getOrganizationSettings } = await loadService();
    mocks.query.mockResolvedValue({ rows: [{ settings: null }] });
    expect(await getOrganizationSettings('org-1')).toEqual({});
  });

  it('returns null when the org row is missing', async () => {
    const { getOrganizationSettings } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await getOrganizationSettings('org-1')).toBeNull();
  });
});

describe('updateOrganizationSettings (T11)', () => {
  it('merges patch into settings->automation and preserves other keys', async () => {
    const { updateOrganizationSettings } = await loadService();
    mocks.query.mockResolvedValue({
      rows: [{ settings: { automation: { aiFrontDesk: false, depositRequired: true }, brand: 'x' } }],
    });

    const updated = await updateOrganizationSettings('org-1', { aiFrontDesk: false });

    expect(updated).toEqual({ automation: { aiFrontDesk: false, depositRequired: true }, brand: 'x' });

    const [sql, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('update public.rl_organizations');
    expect(sql).toContain('jsonb_set(');
    expect(sql).toContain('{automation}');
    expect(sql).toContain(`coalesce(settings -> 'automation', '{}'::jsonb) || $2::jsonb`);
    expect(sql).toContain('where id = $1');
    expect(sql).toContain('returning settings');
    expect(params).toEqual(['org-1', JSON.stringify({ aiFrontDesk: false })]);
  });

  it('returns null when the org row is missing', async () => {
    const { updateOrganizationSettings } = await loadService();
    mocks.query.mockResolvedValue({ rows: [] });
    expect(await updateOrganizationSettings('org-1', { aiFrontDesk: true })).toBeNull();
  });
});
describe('createOrganization (workspace setup)', () => {
  const NOW = new Date('2026-09-20T12:00:00.000Z');
  const ORG_ROW = {
    id: 'org-1',
    name: "Marcus's Plumbing",
    slug: 'marcus-s-plumbing',
    timezone: 'America/New_York',
    status: 'active',
    created_at: NOW,
    updated_at: NOW,
  };

  it('inserts the org + an OWNER membership row inside one transaction', async () => {
    const { createOrganization } = await loadService();
    mocks.clientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ORG_ROW] }) // insert organizations
      .mockResolvedValueOnce(undefined) // insert organization_members
      .mockResolvedValueOnce(undefined); // COMMIT

    const org = await createOrganization({
      name: "Marcus's Plumbing",
      timezone: 'America/New_York',
      ownerId: 'user-1',
    });

    expect(org).toEqual({
      id: 'org-1',
      name: "Marcus's Plumbing",
      slug: 'marcus-s-plumbing',
      timezone: 'America/New_York',
      status: 'active',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    const calls = mocks.clientQuery.mock.calls.map((c) => c[0] as string);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toContain('insert into public.rl_organizations');
    expect(calls[2]).toContain('insert into public.rl_organization_members');
    expect(calls[2]).toContain(`values ($1, $2, 'OWNER')`);
    expect(calls[3]).toBe('COMMIT');

    const memberParams = mocks.clientQuery.mock.calls[2][1] as unknown[];
    expect(memberParams).toEqual(['org-1', 'user-1']);

    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('derives the slug from the name (lowercase, hyphenated, trimmed)', async () => {
    const { createOrganization } = await loadService();
    mocks.clientQuery
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ ...ORG_ROW, slug: 'ridgeline-plumbing-hvac' }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await createOrganization({ name: '  Ridgeline Plumbing & HVAC!! ', timezone: 'America/New_York', ownerId: 'user-1' });

    const insertParams = mocks.clientQuery.mock.calls[1][1] as unknown[];
    expect(insertParams[1]).toBe('ridgeline-plumbing-hvac');
  });

  it('retries with a numeric suffix on a slug collision, then succeeds', async () => {
    const { createOrganization } = await loadService();
    const slugCollision = new Error(
      'duplicate key value violates unique constraint "rl_organizations_slug_idx"',
    );

    mocks.clientQuery
      .mockResolvedValueOnce(undefined) // BEGIN (attempt 1)
      .mockRejectedValueOnce(slugCollision) // insert fails: slug taken
      .mockResolvedValueOnce(undefined) // ROLLBACK
      .mockResolvedValueOnce(undefined) // BEGIN (attempt 2)
      .mockResolvedValueOnce({ rows: [{ ...ORG_ROW, slug: 'marcus-s-plumbing-2' }] }) // insert succeeds
      .mockResolvedValueOnce(undefined) // insert membership
      .mockResolvedValueOnce(undefined); // COMMIT

    const org = await createOrganization({
      name: "Marcus's Plumbing",
      timezone: 'America/New_York',
      ownerId: 'user-1',
    });

    expect(org.slug).toBe('marcus-s-plumbing-2');
    const secondInsertParams = mocks.clientQuery.mock.calls[4][1] as unknown[];
    expect(secondInsertParams[1]).toBe('marcus-s-plumbing-2');
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('always releases the client, even when the insert fails for a non-collision reason', async () => {
    const { createOrganization } = await loadService();
    mocks.clientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('connection reset')) // insert fails, not a slug collision
      .mockResolvedValueOnce(undefined); // ROLLBACK

    await expect(
      createOrganization({ name: 'X', timezone: 'America/New_York', ownerId: 'user-1' }),
    ).rejects.toThrow('connection reset');

    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
