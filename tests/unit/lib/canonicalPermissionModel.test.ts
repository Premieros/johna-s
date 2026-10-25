import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@/lib/permissionDefs';

const LEGACY_PERMISSIONS = [
  'pos.sell',
  'pos.order.create',
  'pos.order.quick_create',
  'pos.send_kitchen',
  'pos.pay',
  'pos.transfer_order',
  'pos.split_order',
  'products.manage',
  'inventory.manage',
  'inventory.transfers',
  'inventory.transfers.approve',
  'catalog.view',
  'procurement.view',
  'accounting.view',
  'admin.view',
] as const;

const CANONICAL_PERMISSIONS = [
  'pos.view',
  'pos.order.dine_in',
  'pos.order.takeaway',
  'pos.order.drive_thru',
  'pos.order.delivery',
  'pos.order.edit',
  'pos.payment.take',
  'pos.order.split',
  'pos.order.transfer',
  'pos.receipt.print',
  'products.create',
  'products.edit',
  'products.delete',
  'products.modifiers.manage',
  'inventory.count.create',
  'inventory.count.approve',
  'inventory.transfer.create',
  'inventory.transfer.approve',
] as const;

describe('canonical permission model', () => {
  it('exposes canonical permissions and never republishes legacy aliases', () => {
    const permissions = new Set<string>(ALL_PERMISSIONS);
    for (const permission of CANONICAL_PERMISSIONS) expect(permissions.has(permission)).toBe(true);
    for (const permission of LEGACY_PERMISSIONS) expect(permissions.has(permission)).toBe(false);
  });

  it('keeps dormant duplicate V2 operational implementations deleted', () => {
    for (const path of [
      'src/v2/pages/V2PosPage.tsx',
      'src/v2/pages/V2ShiftsPage.tsx',
      'src/v2/pages/V2HomePage.tsx',
      'src/v2/components/V2AppShell.tsx',
    ]) {
      expect(existsSync(resolve(process.cwd(), path)), path).toBe(false);
    }
  });

  it('uses granular permissions in the canonical product, count and transfer workspaces', () => {
    const sources = [
      'src/features/catalog/pages/ProductsPage.tsx',
      'src/features/inventory/pages/StockCountsPage.tsx',
      'src/features/inventory/pages/TransfersPage.tsx',
      'src/core/guard/useOperationalGuard.ts',
    ].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

    expect(sources).toContain("can('products.create')");
    expect(sources).toContain("can('products.edit')");
    expect(sources).toContain("can('products.delete')");
    expect(sources).toContain("can('inventory.count.create')");
    expect(sources).toContain("can('inventory.count.approve')");
    expect(sources).toContain("can('inventory.transfer.create')");
    expect(sources).toContain("can('inventory.transfer.approve')");

    for (const permission of LEGACY_PERMISSIONS) {
      expect(sources).not.toContain(`can('${permission}')`);
    }
  });
});
