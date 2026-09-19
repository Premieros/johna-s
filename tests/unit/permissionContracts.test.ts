import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, type Permission } from '@/lib/permissionDefs';
import {
  expandPermissionDependencies,
  missingPermissionDependencies,
  permissionContract,
  POS_INTERACTIVE_PRESET_SCOPE,
  POS_PERMISSION_PRESETS,
  removePermissionWithDependents,
} from '@/lib/permissionContracts';

describe('permission operational contracts', () => {
  it('covers every canonical permission exactly through the contract registry', () => {
    for (const permission of ALL_PERMISSIONS) {
      const contract = permissionContract(permission);
      expect(contract.permission).toBe(permission);
      expect(contract.effectAr.length).toBeGreaterThan(0);
      expect(contract.effectEn.length).toBeGreaterThan(0);
      for (const required of contract.requires) {
        expect(ALL_PERMISSIONS).toContain(required);
      }
    }
  });

  it('adds POS screen access for interactive payment but keeps print-agent capabilities independent', () => {
    expect(expandPermissionDependencies(['pos.payment.take'])).toEqual(
      expect.arrayContaining(['pos.view', 'pos.payment.take']),
    );
    expect(permissionContract('pos.receipt.print').requires).not.toContain('pos.view');
    expect(permissionContract('pos.print_kitchen').requires).not.toContain('pos.view');
  });

  it('removes dependent POS actions when their prerequisite is removed', () => {
    const input: Permission[] = [
      'pos.view',
      'pos.order.create',
      'pos.payment.take',
      'pos.discount',
      'pos.receipt.print',
    ];
    const next = removePermissionWithDependents(input, 'pos.view');
    expect(next).not.toContain('pos.order.create');
    expect(next).not.toContain('pos.payment.take');
    expect(next).not.toContain('pos.discount');
    expect(next).toContain('pos.receipt.print');
  });

  it('models close-with-open-orders as a two-step protected capability', () => {
    const expanded = expandPermissionDependencies(['shifts.close_with_open_orders']);
    expect(expanded).toEqual(
      expect.arrayContaining([
        'shifts.view',
        'shifts.close',
        'shifts.close_with_open_orders',
      ]),
    );
    expect(missingPermissionDependencies(['shifts.close_with_open_orders'])).toEqual([
      {
        permission: 'shifts.close_with_open_orders',
        missing: ['shifts.view', 'shifts.close'],
      },
    ]);
  });

  it('keeps view-only and payment-only POS presets narrow', () => {
    expect(POS_PERMISSION_PRESETS.view_only.permissions).toEqual(['pos.view']);
    expect(POS_PERMISSION_PRESETS.payment_only.permissions).toEqual([
      'pos.view',
      'pos.payment.take',
    ]);
    expect(POS_INTERACTIVE_PRESET_SCOPE).not.toContain('pos.receipt.print');
    expect(POS_INTERACTIVE_PRESET_SCOPE).not.toContain('pos.print_kitchen');
  });

  it('does not expose the obsolete pos.refund alias', () => {
    expect(ALL_PERMISSIONS).not.toContain('pos.refund' as Permission);
    expect(ALL_PERMISSIONS).toContain('sales.refund.create');
    expect(ALL_PERMISSIONS).toContain('refunds.approve');
  });
});
