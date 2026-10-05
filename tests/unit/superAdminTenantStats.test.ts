import { describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  organizations: [
    { id: 'org-a', name: 'A', slug: 'a', is_active: true, created_at: '2026-01-01' },
    { id: 'org-b', name: 'B', slug: 'b', is_active: true, created_at: '2026-01-01' },
  ],
  branches: [
    { id: 'branch-a', organization_id: 'org-a', is_active: true },
    { id: 'branch-b', organization_id: 'org-b', is_active: true },
  ],
  users: [
    { id: 'u1', branch_id: 'branch-a' },
    { id: 'u2', branch_id: 'branch-a' },
    { id: 'u3', branch_id: 'branch-b' },
    { id: 'u4', branch_id: null },
  ],
  members: [] as { user_id: string; organization_id: string; is_active: boolean }[],
  error: null as null | { message: string },
}));

vi.mock('@/api', () => ({
  admin: {},
  supabase: {
    from: (table: string) => {
      const data = table === 'organizations' ? fixtures.organizations : table === 'branches' ? fixtures.branches : table === 'users' ? fixtures.users : fixtures.members;
      const result = { data, error: fixtures.error };
      return { select: () => ({ ...result, order: () => result }) };
    },
  },
}));

import { fetchTenantStats } from '@/features/admin/services/superAdminConsoleData';

describe('tenant totals use the same existing-user association as Users tab', () => {
  it('counts branch-linked users even with no organization memberships', async () => {
    fixtures.members = [];
    const rows = await fetchTenantStats();
    expect(rows.map((row) => row.user_count)).toEqual([2, 1]);
    expect(rows[0].active_branches).toBe(1);
  });

  it('prioritizes active membership, ignores inactive membership and counts each user once', async () => {
    fixtures.members = [
      { user_id: 'u1', organization_id: 'org-b', is_active: true },
      { user_id: 'u2', organization_id: 'org-b', is_active: false },
      { user_id: 'u4', organization_id: 'org-a', is_active: true },
    ];
    expect((await fetchTenantStats()).map((row) => row.user_count)).toEqual([2, 2]);
  });

  it('does not turn a failed user read into a false zero count', async () => {
    fixtures.error = { message: 'connection unavailable' };
    try { await expect(fetchTenantStats()).rejects.toEqual(fixtures.error); }
    finally { fixtures.error = null; }
  });
});
