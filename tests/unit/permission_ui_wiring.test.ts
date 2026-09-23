import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('permission UI wiring', () => {
  it('uses independent user action permissions', () => {
    const src = read('src/features/admin/pages/UsersPage.tsx');
    expect(src).toContain("can('users.create')");
    expect(src).toContain("can('users.manage')");
    expect(src).toContain("can('users.branches.manage')");
    expect(src).toContain('canCreateUsers ? <Button');
    expect(src).toContain('{canManageBranches && branchAccessPicker}');
  });

  it('gates role mutation controls with roles.permissions.manage and caller-owned permissions', () => {
    const src = read('src/features/admin/pages/RolesTab.tsx');
    expect(src).toContain("can('roles.permissions.manage')");
    expect(src).toContain('const canGrantPermission');
    expect(src).toContain('isPlatformAdmin || can(permission)');
    expect(src).toContain('const canOfferPermission');
    expect(src).toContain('expandPermissionDependencies([permission]).every((required) => canGrantPermission(required))');
    expect(src).toContain('const currentHasUnownedPermissions = unavailablePermissions.length > 0');
    expect(src).toContain('const canEditCurrent = mayEditRole(currentRole) && !currentHasUnownedPermissions');
    expect(src).toContain('.filter((permission) => canOfferPermission(permission))');
    expect(src).toContain("role.scope === 'branch' && branchIsVisible(role.branch_id)");
    expect(src).not.toContain('!canEditCurrent || (!checked && !grantable)');
  });

  it('wires every permission workspace control to an explicit action', () => {
    const src = read('src/features/admin/pages/RolesTab.tsx');
    expect(src).toContain('onClick={openCreate}');
    expect(src).toContain('setSelectedRole(role)');
    expect(src).toContain('setAll(currentRole, true)');
    expect(src).toContain('setAll(currentRole, false)');
    expect(src).toContain('onClick={resetDraft}');
    expect(src).toContain('onClick={() => save(currentRole)}');
    expect(src).toContain('onClick={() => setDeleting(currentRole)}');
    expect(src).toContain('onClick={() => applyPosPreset(key)}');
    expect(src).toContain('setGroup(currentRole, group.permissions, !groupAll)');
    expect(src).toContain('onChange={() => toggle(currentRole, permission)}');
    expect(src).toContain('onClick={submitCreate}');
    expect(src).toContain('onConfirm={confirmDelete}');
  });

  it('does not treat owner as an implicit Super Admin in settings UI', () => {
    const src = read('src/features/admin/pages/SettingsControlCenterPage.tsx');
    expect(src).toContain("const isSuperAdmin = user?.role === 'super_admin';");
    expect(src).not.toContain("user?.role === 'super_admin' || user?.role === 'owner'");
  });
});
