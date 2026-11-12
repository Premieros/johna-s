import { describe, expect, it } from 'vitest';
import { hasPermission, type Permission } from '@/lib/permissionDefs';

describe('granular POS permissions', () => {
  it('keeps cashier operational capabilities explicit and independent', () => {
    const permissions: Record<string, Permission[]> = {
      cashier: [
        'pos.view',
        'pos.order.dine_in',
        'pos.order.edit',
        'pos.hold',
        'pos.order.takeaway',
        'pos.kds_view',
        'pos.print_kitchen',
        'pos.payment.take',
        'pos.order.transfer',
        'pos.order.split',
        'pos.void',
      ],
    };

    for (const permission of permissions.cashier) {
      expect(hasPermission('cashier', permissions, permission)).toBe(true);
    }

    expect(hasPermission('cashier', permissions, 'pos.discount')).toBe(false);
    expect(hasPermission('cashier', permissions, 'pos.change_price')).toBe(false);
    expect(hasPermission('cashier', permissions, 'pos.reprint')).toBe(false);
    expect(hasPermission('cashier', permissions, 'pos.cancel_order')).toBe(false);
    expect(hasPermission('cashier', permissions, 'pos.change_branch')).toBe(false);
  });

  it('allows branch manager structural actions only when explicitly granted', () => {
    const permissions: Record<string, Permission[]> = {
      branch_manager: ['pos.void', 'pos.cancel_order', 'pos.order.transfer', 'pos.order.split'],
    };

    expect(hasPermission('branch_manager', permissions, 'pos.void')).toBe(true);
    expect(hasPermission('branch_manager', permissions, 'pos.cancel_order')).toBe(true);
    expect(hasPermission('branch_manager', permissions, 'pos.order.transfer')).toBe(true);
    expect(hasPermission('branch_manager', permissions, 'pos.order.split')).toBe(true);
    expect(hasPermission('branch_manager', permissions, 'pos.change_branch')).toBe(false);
  });

  it('honors DB-backed role permission overrides without legacy aliases', () => {
    const dbPermissions: Record<string, Permission[]> = {
      cashier: ['pos.view', 'pos.payment.take'],
    };

    expect(hasPermission('cashier', dbPermissions, 'pos.view')).toBe(true);
    expect(hasPermission('cashier', dbPermissions, 'pos.payment.take')).toBe(true);
    expect(hasPermission('cashier', dbPermissions, 'pos.order.dine_in')).toBe(false);
    expect(hasPermission('cashier', dbPermissions, 'pos.order.takeaway')).toBe(false);
  });
});
