import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const roles = readFileSync('src/features/admin/pages/RolesTab.tsx', 'utf8');

describe('role cards and permission editor modal', () => {
  it('lists roles as accessible cards with a role-specific editor action', () => {
    expect(roles).toContain('data-testid="roles-grid"');
    expect(roles).toContain('roles.map((role) => {');
    expect(roles).toContain("setSelectedRole(role);");
    expect(roles).toContain('setRoleEditorOpen(true);');
    expect(roles).toContain('عرض الصلاحيات');
  });

  it('edits existing permissions in a wide modal instead of an inline panel', () => {
    expect(roles).toContain('open={roleEditorOpen}');
    expect(roles).toContain('onClose={closeRoleEditor}');
    expect(roles).toContain('size="2xl"');
    expect(roles).toContain('data-testid="role-permissions-editor"');
    expect(roles).toContain('OPERATIONAL_PERMISSION_SECTIONS.map');
    expect(roles).toContain('setGroup(currentRole, group.permissions, !groupAll)');
    expect(roles).toContain('toggle(currentRole, permission)');
    expect(roles).toContain('save(currentRole)');
  });

  it('guards against accidentally discarding unsaved role edits', () => {
    expect(roles).toContain('if (hasUnsavedChanges)');
    expect(roles).toContain('window.confirm(');
    expect(roles).toContain('resetDraft();');
    expect(roles).toContain('if (savingRole) return;');
  });

  it('retains fine grained POS permissions and server role grant constraints', () => {
    expect(roles).toContain('canGrantPermission(permission)');
    expect(roles).toContain('expandPermissionDependencies');
    expect(roles).toContain('missingPermissionDependencies');
    expect(roles).toContain('POS_PERMISSION_PRESETS');
    expect(roles).toContain('const canEditCurrent = mayEditRole(currentRole) && !currentHasUnownedPermissions');
  });
});
