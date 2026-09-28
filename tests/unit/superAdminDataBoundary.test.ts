import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(path, 'utf8').split(String.fromCharCode(13, 10)).join('\n');

describe('super admin data-access containment', () => {
  it('keeps heavy read orchestration out of SuperAdminConsolePage', () => {
    const page = read('src/features/admin/pages/SuperAdminConsolePage.tsx');

    expect(page).toContain('fetchUserCreationControl');
    expect(page).toContain('fetchTenantStats');
    expect(page).toContain('fetchUsersAndAudit');

    expect(page).not.toContain("supabase.from('system_settings').select('config')");
    expect(page).not.toContain("supabase.from('organization_members').select('organization_id, user_id, is_active')");
    expect(page).not.toContain("supabase.from('users').select('id, email, username, full_name, role, is_active, branch_id, created_at')");
    expect((page.match(/supabase\.from\(/g) || []).length).toBeLessThanOrEqual(3);
  });

  it('keeps the extracted service read-only', () => {
    const service = read('src/features/admin/services/superAdminConsoleData.ts');

    expect(service).toContain("supabase.from('organizations')");
    expect(service).toContain("supabase.from('users')");
    expect(service).toContain("supabase.from('audit_log')");
    expect(service).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });
});
