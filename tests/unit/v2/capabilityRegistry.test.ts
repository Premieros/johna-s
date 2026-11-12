import { describe, expect, it } from 'vitest';
import { APP_ROUTES } from '@/core/navigation/routes';
import { getV2Module, V2_MODULES } from '@/v2/core/capabilityRegistry';

describe('V2 canonical workspace registry', () => {
  it('uses one real production route and one real view permission per module', () => {
    const expected = {
      pos: [APP_ROUTES.pos, 'pos.view'],
      shifts: [APP_ROUTES.shifts, 'shifts.view'],
      approvals: [APP_ROUTES.approvals, 'approvals.review'],
      waste: [APP_ROUTES.wasteCenter, 'waste.view'],
      inventory: [APP_ROUTES.inventoryCenter, 'inventory.view'],
      catalog: [APP_ROUTES.products, 'products.view'],
      procurement: [APP_ROUTES.procurementCenter, 'purchases.view'],
      sales: [APP_ROUTES.sales, 'sales.view'],
      accounting: [APP_ROUTES.accounts, 'accounts.view'],
      reports: [APP_ROUTES.reports, 'reports.view'],
      admin: [APP_ROUTES.users, 'users.view'],
    } as const;

    expect(V2_MODULES).toHaveLength(Object.keys(expected).length);

    for (const module of V2_MODULES) {
      const [route, permission] = expected[module.key];
      expect(module.route).toBe(route);
      expect(module.viewPermission).toBe(permission);
      expect(module.legacyViewPermission).toBe(permission);
      expect(module.targetViewPermission).toBe(permission);
      expect(module.status).toBe('ready');
    }
  });

  it('keeps granular POS action permissions separate from POS view', () => {
    const pos = getV2Module('pos');
    const actionPermissions = Object.fromEntries(pos.actions.map((action) => [action.key, action.permission]));

    expect(pos.viewPermission).toBe('pos.view');
    for (const type of ['dine_in', 'takeaway', 'drive_thru', 'delivery']) {
      expect(actionPermissions[`${type}_orders`]).toBe(`pos.order.${type}`);
    }
    expect(actionPermissions.create_order).toBeUndefined();
    expect(actionPermissions.edit_order).toBe('pos.order.edit');
    expect(actionPermissions.send_kitchen).toBeUndefined();
    expect(actionPermissions.pay).toBe('pos.payment.take');
    expect(actionPermissions.split_order).toBe('pos.order.split');
    expect(actionPermissions.transfer_order).toBe('pos.order.transfer');
    expect(actionPermissions.print).toBe('pos.receipt.print');
    expect(Object.values(actionPermissions)).not.toContain('pos.sell');
  });

  it('never uses settings permission to expose approvals', () => {
    const approvals = getV2Module('approvals');
    expect(approvals.viewPermission).toBe('approvals.review');
    expect(approvals.route).toBe(APP_ROUTES.approvals);
    expect(approvals.viewPermission).not.toBe('settings.manage');
  });
});
