import { describe, expect, it } from 'vitest';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('waste view RLS contract', () => {
  it('requires waste.view for authenticated waste reads', async () => {
    const client = openDb(dbUrl!);
    await client.connect();
    try {
      const { rows } = await client.query<{ policyname: string; qual: string | null; permissive: string }>(`
        SELECT policyname, qual, permissive
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'waste_entries'
          AND cmd = 'SELECT'
          AND 'authenticated' = ANY (roles)
        ORDER BY policyname
      `);

      expect(rows.map((row) => row.policyname)).toEqual([
        'financial_visibility_waste_entries',
        'waste_entries_select',
      ]);
      const permissionPolicy = rows.find((row) => row.policyname === 'waste_entries_select');
      const visibilityPolicy = rows.find((row) => row.policyname === 'financial_visibility_waste_entries');
      expect(permissionPolicy?.qual ?? '').toContain("can_permission('waste.view'::text)");
      expect(permissionPolicy?.qual ?? '').toContain('user_may_access_branch(branch_id)');
      expect(visibilityPolicy?.permissive).toBe('RESTRICTIVE');
      expect(visibilityPolicy?.qual ?? '').toContain('private.financial_row_visible');
    } finally {
      await client.end();
    }
  });
});
