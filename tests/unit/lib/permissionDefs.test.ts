import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  hasPermission,
  isAdminRole,
  PERMISSION_GROUPS,
  ROLE_META,
  type Permission,
  type Role,
} from '@/lib/permissionDefs';

describe('isAdminRole', () => {
  it('treats only super_admin as implicit admin', () => {
    expect(isAdminRole('super_admin')).toBe(true);
    expect(isAdminRole('owner')).toBe(false);
  });

  it('treats other roles and undefined as non-admin', () => {
    expect(isAdminRole('cashier')).toBe(false);
    expect(isAdminRole('branch_manager')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe('hasPermission', () => {
  it('denies when no role', () => {
    expect(hasPermission(null, null, 'pos.view')).toBe(false);
    expect(hasPermission(undefined, undefined, 'pos.order.create')).toBe(false);
  });

  it('gives only super_admin an implicit permission bypass', () => {
    expect(hasPermission('super_admin', null, 'settings.manage')).toBe(true);
    expect(hasPermission('super_admin', {}, 'branches.manage')).toBe(true);
    expect(hasPermission('super_admin', null, 'pos.payment.take')).toBe(true);

    expect(hasPermission('owner', null, 'settings.manage')).toBe(false);
    expect(hasPermission('owner', {}, 'branches.manage')).toBe(false);
  });

  it('requires DB-backed permissions for every non-super-admin role', () => {
    expect(hasPermission('cashier', null, 'pos.view')).toBe(false);
    expect(hasPermission('accountant', null, 'reports.financial')).toBe(false);
    expect(hasPermission('branch_manager', {}, 'users.manage')).toBe(false);

    const map: Record<string, Permission[]> = {
      owner: ['branches.manage'],
      cashier: ['pos.view', 'pos.order.create'],
      accountant: ['reports.financial'],
      branch_manager: ['users.manage'],
    };

    expect(hasPermission('owner', map, 'branches.manage')).toBe(true);
    expect(hasPermission('owner', map, 'settings.manage')).toBe(false);
    expect(hasPermission('cashier', map, 'pos.view')).toBe(true);
    expect(hasPermission('cashier', map, 'pos.order.create')).toBe(true);
    expect(hasPermission('cashier', map, 'settings.manage')).toBe(false);
    expect(hasPermission('accountant', map, 'reports.financial')).toBe(true);
    expect(hasPermission('branch_manager', map, 'users.manage')).toBe(true);
  });

  it('POS action permissions are resolved independently from the DB map', () => {
    const map: Record<string, Permission[]> = {
      cashier: ['pos.view', 'pos.order.create', 'pos.send_kitchen', 'pos.kds_view', 'pos.payment.take'],
      branch_manager: ['pos.reprint', 'pos.discount', 'pos.change_price', 'pos.order.transfer', 'pos.order.split'],
    };

    expect(hasPermission('cashier', map, 'pos.reprint')).toBe(false);
    expect(hasPermission('cashier', map, 'pos.discount')).toBe(false);
    expect(hasPermission('cashier', map, 'pos.change_price')).toBe(false);
    expect(hasPermission('cashier', map, 'pos.send_kitchen')).toBe(true);
    expect(hasPermission('cashier', map, 'pos.kds_view')).toBe(true);
    expect(hasPermission('cashier', map, 'pos.payment.take')).toBe(true);
    expect(hasPermission('cashier', map, 'pos.order.transfer')).toBe(false);
    expect(hasPermission('branch_manager', map, 'pos.reprint')).toBe(true);
    expect(hasPermission('branch_manager', map, 'pos.discount')).toBe(true);
    expect(hasPermission('branch_manager', map, 'pos.change_price')).toBe(true);
    expect(hasPermission('branch_manager', map, 'pos.order.transfer')).toBe(true);
    expect(hasPermission('branch_manager', map, 'pos.order.split')).toBe(true);
    expect(hasPermission('super_admin', null, 'pos.discount')).toBe(true);
  });

  it('separates POS view, order mutation, payment and receipt capabilities', () => {
    const map: Record<string, Permission[]> = {
      cashier: ['pos.view', 'pos.payment.take', 'pos.receipt.print'],
      branch_manager: ['pos.view', 'pos.order.create', 'pos.order.edit'],
    };

    expect(hasPermission('cashier', map, 'pos.view')).toBe(true);
    expect(hasPermission('cashier', map, 'pos.payment.take')).toBe(true);
    expect(hasPermission('cashier', map, 'pos.receipt.print')).toBe(true);
    expect(hasPermission('cashier', map, 'pos.order.create')).toBe(false);
    expect(hasPermission('cashier', map, 'pos.order.edit')).toBe(false);
    expect(hasPermission('branch_manager', map, 'pos.order.create')).toBe(true);
    expect(hasPermission('branch_manager', map, 'pos.order.edit')).toBe(true);
    expect(hasPermission('branch_manager', map, 'pos.payment.take')).toBe(false);
  });

  it('print/export/import permissions are resolved from the DB map', () => {
    const map: Record<string, Permission[]> = {
      cashier: ['products.print'],
      warehouse_manager: ['products.export', 'products.import'],
      accountant: ['sales.export', 'reports.print'],
      branch_manager: ['reports.export'],
      production_manager: ['products.import'],
    };

    expect(hasPermission('cashier', map, 'products.print')).toBe(true);
    expect(hasPermission('cashier', map, 'products.export')).toBe(false);
    expect(hasPermission('warehouse_manager', map, 'products.export')).toBe(true);
    expect(hasPermission('warehouse_manager', map, 'products.import')).toBe(true);
    expect(hasPermission('accountant', map, 'sales.export')).toBe(true);
    expect(hasPermission('accountant', map, 'reports.print')).toBe(true);
    expect(hasPermission('branch_manager', map, 'reports.export')).toBe(true);
    expect(hasPermission('production_manager', map, 'products.import')).toBe(true);
  });

  it('DB map is authoritative instead of code defaults', () => {
    const map: Record<string, Permission[]> = { cashier: ['pos.view'] };
    expect(hasPermission('cashier', map, 'sales.view')).toBe(false);
    expect(hasPermission('cashier', map, 'pos.view')).toBe(true);
    expect(hasPermission('cashier', map, 'pos.order.create')).toBe(false);
  });
});

describe('permission model integrity', () => {
  it('all role defaults only reference known permissions', () => {
    const known = new Set<Permission>(ALL_PERMISSIONS);
    for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS) as Role[]) {
      for (const permission of DEFAULT_ROLE_PERMISSIONS[role]) {
        expect(known.has(permission), `${role} references unknown permission ${permission}`).toBe(true);
      }
    }
  });

  it('every role in ROLE_META has defaults', () => {
    for (const role of Object.keys(ROLE_META) as Role[]) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toBeDefined();
      expect(DEFAULT_ROLE_PERMISSIONS[role].length).toBeGreaterThan(0);
    }
  });

  it('every permission appears in a group (reviewable in the settings UI)', () => {
    const grouped = new Set<Permission>();
    for (const group of PERMISSION_GROUPS) {
      for (const permission of group.permissions) grouped.add(permission);
    }
    for (const permission of ALL_PERMISSIONS) {
      expect(grouped.has(permission), `${permission} missing from PERMISSION_GROUPS`).toBe(true);
    }
  });

  it('does not auto-grant the new history permission to existing role templates', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.super_admin).toHaveLength(ALL_PERMISSIONS.length);
    expect(DEFAULT_ROLE_PERMISSIONS.owner).toHaveLength(ALL_PERMISSIONS.length - 1);
    expect(DEFAULT_ROLE_PERMISSIONS.owner).not.toContain('history.unlimited');
    expect(DEFAULT_ROLE_PERMISSIONS.branch_manager).not.toContain('history.unlimited');
    expect(DEFAULT_ROLE_PERMISSIONS.accountant).not.toContain('history.unlimited');
  });
});
