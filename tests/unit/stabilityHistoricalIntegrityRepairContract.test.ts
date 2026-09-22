import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260922065000_stability_historical_integrity_repair.sql',
  'utf8',
);

describe('historical stability integrity repair contract', () => {
  it('repairs only the audited cross-branch purchase headers and never stock quantities', () => {
    expect(migration).toContain("'19c3fd23-d784-455b-8840-f4f2ac619651'");
    expect(migration).toContain("'94d6d447-b910-43d5-b525-87814dd905e1'");
    expect(migration).toContain("'04348dcc-d24c-4b77-99e5-5c6e29551eec'");
    expect(migration).toContain('HISTORICAL_PURCHASE_REPAIR_STOCK_EFFECT_FOUND');
    expect(migration).toContain('COALESCE(pi.received_quantity,0) <> 0');
    expect(migration).toContain('UPDATE public.purchases');
    expect(migration).toContain('SET warehouse_id = v_target_warehouse');
    expect(migration).not.toMatch(/UPDATE\s+public\.raw_material_(?:warehouse_)?inventory/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.raw_material_batches/i);
    expect(migration).not.toMatch(/UPDATE\s+public\.inventory_unit_entries/i);
  });

  it('retires only fully voided unpaid empty order shells with zero net kitchen inventory', () => {
    expect(migration).toContain('STALE_EMPTY_ORDER_REPAIR_PAYMENT_ACTIVITY_FOUND');
    expect(migration).toContain('STALE_EMPTY_ORDER_REPAIR_EFFECTIVE_ITEM_FOUND');
    expect(migration).toContain('STALE_EMPTY_ORDER_REPAIR_NONZERO_OR_SETTLED_KITCHEN_EFFECT_FOUND');
    expect(migration).toContain("status = 'cancelled'");
    expect(migration).toContain("kitchen_status = 'cancelled'");
    expect(migration).toContain('[SYSTEM] STALE_EMPTY_ORDER_RETIRED_2026-09-22');
    expect(migration).toContain("live.status IN ('open','held')");
  });

  it('is safe on fresh or already-repaired databases', () => {
    expect(migration.match(/IF v_count = 0 THEN[\s\S]*?RETURN;/g)?.length).toBe(2);
    expect(migration).toContain('HISTORICAL_PURCHASE_REPAIR_PARTIAL_MATCH');
    expect(migration).toContain('STALE_EMPTY_ORDER_REPAIR_PARTIAL_MATCH');
  });
});
