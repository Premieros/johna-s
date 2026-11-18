import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, OPERATIONAL_PERMISSION_SECTIONS, DEFAULT_ROLE_PERMISSIONS } from '../../src/lib/permissionDefs';
import { permissionContract, missingPermissionDependencies } from '../../src/lib/permissionContracts';
import { permissionFeatureKey } from '../../src/lib/permissionFeatureKey';

describe('missing database-backed sales permission is catalogued safely', () => {
  it('adds the existing RLS permission without removing or duplicating other permissions', () => {
    expect(ALL_PERMISSIONS).toContain('sales.manage');
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    const sections = OPERATIONAL_PERMISSION_SECTIONS.flatMap(group => group.permissions);
    expect(sections.filter(x => x === 'sales.manage')).toHaveLength(1);
    expect([...sections].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('marks direct sales updates and deletes critical and requires sales viewing', () => {
    const contract = permissionContract('sales.manage');
    expect(contract.risk).toBe('critical');
    expect(contract.requires).toContain('sales.view');
    expect(permissionFeatureKey('sales.manage')).toBe('pos');
    expect(missingPermissionDependencies(['sales.manage'])).toEqual([
      { permission: 'sales.manage', missing: ['sales.view'] },
    ]);
  });

  it('never grants direct sales write permissions in default role templates', () => {
    for (const permissions of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      // Super-admin is the sole implicit bypass; the runtime does not depend on its stored array.
      if (permissions === DEFAULT_ROLE_PERMISSIONS.super_admin) continue;
      expect(permissions).not.toContain('sales.manage');
    }
  });
});
