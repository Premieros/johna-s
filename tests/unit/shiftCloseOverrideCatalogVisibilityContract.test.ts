import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260922002500_restore_shift_open_order_override.sql');
const shifts = read('src/features/trade/pages/ShiftsPage.tsx');
const products = read('src/features/catalog/pages/ProductsPage.tsx');
const raw = read('src/features/manufacturing/pages/RawMaterialsPage.tsx');
const pricing = read('src/features/catalog/pages/PricingPage.tsx');

describe('shift override and catalog visibility repair contract', () => {
  it('keeps close-with-open-orders permission-first and preserves operational orders', () => {
    expect(migration).toContain("can_permission('shifts.close')");
    expect(migration).toContain("can_permission('shifts.close_with_open_orders')");
    expect(migration).toContain("SET status='closed'");
    expect(migration).toContain("'open_orders_preserved',v_open_order_count>0");
    expect(migration).not.toMatch(/UPDATE\s+public\.orders/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.dining_tables/i);
  });

  it('exposes the override only when both permissions are present', () => {
    expect(shifts).toContain("api.shifts.closeWithOpenOrders");
    expect(shifts).toContain("can('shifts.close_with_open_orders')");
    expect(shifts).toContain('إغلاق الوردية مع إبقاء الطلبات المفتوحة');
  });

  it('loads primary product and raw-material rows without fragile embedded relations', () => {
    expect(products).toContain("table: 'products'");
    expect(products).toContain("select: '*'");
    expect(products).toContain('productCategoryName');
    expect(raw).toContain("table: 'raw_materials'");
    expect(raw).toContain("select: '*'");
    expect(raw).not.toContain("unit:units(*)");
  });

  it('reloads pricing rows when permissions hydrate after branch context', () => {
    expect(pricing).toContain('[branchId, canRawView, canProductsView]');
    expect(pricing).toContain('void load();');
  });
});
