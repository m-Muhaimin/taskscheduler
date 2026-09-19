import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('pg', () => ({ Pool: class MockPool { query = mocks.query; } }));

async function loadService() {
  return await import('./organization-service.js');
}

beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  mocks.query.mockReset();
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