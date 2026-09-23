import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('stock count split permission contract', () => {
  it('exposes approve, reject, and apply as separate canonical permissions', () => {
    const defs = read('src/lib/permissionDefs.ts');
    expect(defs).toContain("'inventory.count.approve'");
    expect(defs).toContain("'inventory.count.reject'");
    expect(defs).toContain("'inventory.count.apply'");
    expect(defs).toContain("'inventory.count.approve': { ar: 'اعتماد الجرد'");
    expect(defs).toContain("'inventory.count.reject': { ar: 'رفض الجرد'");
    expect(defs).toContain("'inventory.count.apply': { ar: 'تطبيق الجرد على الرصيد'");
  });

  it('gates each stock-count button with its exact permission', () => {
    const page = read('src/features/inventory/pages/StockCountsPage.tsx');
    expect(page).toContain("can('inventory.count.approve')");
    expect(page).toContain("can('inventory.count.reject')");
    expect(page).toContain("can('inventory.count.apply')");
    expect(page).not.toContain("approve_apply");
    expect(page).not.toContain("const applyRes = await api.inventory.applyStockCount");
  });

  it('migrates backend action gates without weakening branch/RLS logic', () => {
    const migration = read('supabase/migrations/20260923193000_split_stock_count_permissions.sql');
    expect(migration).toContain("'public.reject_stock_count(uuid,text)'::regprocedure");
    expect(migration).toContain("'inventory.count.reject'");
    expect(migration).toContain("'public.apply_stock_count(uuid)'::regprocedure");
    expect(migration).toContain("'inventory.count.apply'");
    expect(migration).toContain('EXPECTED_PERMISSION_GATE_NOT_FOUND');
    expect(migration).toContain("COALESCE(permissions, '[]'::jsonb) ? 'inventory.count.approve'");
  });

  it('keeps capability registry one action per permission', () => {
    const registry = read('src/v2/core/capabilityRegistry.ts');
    expect(registry).toContain("permission: 'inventory.count.approve', backend: ['approve_stock_count']");
    expect(registry).toContain("permission: 'inventory.count.reject', backend: ['reject_stock_count']");
    expect(registry).toContain("permission: 'inventory.count.apply', backend: ['apply_stock_count']");
  });
});
