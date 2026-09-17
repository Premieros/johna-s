import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('permission UI wiring', () => {
  it('uses independent user action permissions', () => {
    const src = read('src/features/admin/pages/UsersPage.tsx');
    expect(src).toContain("can('users.create')");
    expect(src).toContain("can('users.manage')");
    expect(src).toContain("can('users.branches.manage')");
    expect(src).toContain('canCreateUsers ? <Button');
    expect(src).toContain('{canManageBranches && branchAccessPicker}');
  });

  it('gates role mutation controls with roles.permissions.manage', () => {
    const src = read('src/features/admin/pages/RolesTab.tsx');
    expect(src).toContain("can('roles.permissions.manage')");
    expect(src).toContain('const canEditCurrent = mayEditRole(currentRole)');
    expect(src).toContain('disabled={!canEditCurrent}');
  });

  it('does not treat owner as an implicit Super Admin in settings UI', () => {
    const src = read('src/features/admin/pages/SettingsControlCenterPage.tsx');
    expect(src).toContain("const isSuperAdmin = user?.role === 'super_admin';");
    expect(src).not.toContain("user?.role === 'super_admin' || user?.role === 'owner'");
  });
});
