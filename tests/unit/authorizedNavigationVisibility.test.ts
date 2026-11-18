import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const menu = readFileSync('src/core/navigation/menu.config.ts', 'utf8');
const layout = readFileSync('src/components/Layout.tsx', 'utf8');
const routes = readFileSync('src/app/routes.tsx', 'utf8');

describe('authorized navigation visibility', () => {
  it('exposes existing protected operational routes in sidebar with their actual permission gates', () => {
    const entries: Array<[string, string]> = [
      ['floorPlan', 'floor_plan.view'], ['inventory', 'inventory.view'],
      ['warehouses', 'warehouses.view'], ['transfers', 'inventory.view'],
      ['inventoryLedger', 'inventory.ledger.view'], ['stockCounts', 'inventory.view'],
      ['inventoryBatches', 'inventory.view'], ['stockValuation', 'inventory.ledger.view'],
      ['lowStockAlerts', 'inventory.view'], ['purchases', 'purchases.view'],
      ['purchaseRequests', 'purchases.requests'], ['rfqs', 'purchases.rfq'],
      ['receiving', 'purchases.receiving'], ['systemHealth', 'settings.manage'],
    ];
    for (const [route, permission] of entries) {
      expect(menu).toMatch(new RegExp(`route: APP_ROUTES\\.${route}[^\\n]*permission: '${permission}'`));
      expect(routes).toContain(`APP_ROUTES.${route}`);
    }
  });

  it('keeps server-backed permission filtering and platform-only safeguards intact', () => {
    expect(layout).toContain('can(item.permission)');
    expect(layout).toContain('item.permissionsAny.some((permission) => can(permission))');
    expect(layout).toContain("user?.role === 'super_admin'");
    expect(menu).toContain('superAdminOnly: true');
  });

  it('lets users reveal permitted sections without overwriting saved preferences on initial load', () => {
    expect(layout).toContain('data-testid="navigation-expand-all"');
    expect(layout).toContain("premier:nav-collapsed-groups");
    expect(layout).toContain('[group, false]');
    expect(layout).toContain('b.route.length - a.route.length');
  });
});
