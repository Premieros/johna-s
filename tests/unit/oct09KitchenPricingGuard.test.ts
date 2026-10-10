import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regression guard for #487 until a benchmarked DB-atomic batching replacement exists.
// Static checks are *not* a substitute for fresh-DB permission/stock/printing tests.
const kitchenMigration = readFileSync(
  'supabase/migrations/20261009143000_kitchen_sale_known_price_snapshot.sql',
  'utf8',
);

describe('October 9 kitchen send-time pricing safety contract', () => {
  it('keeps price capture on kitchen inventory event insertion, not payment', () => {
    expect(kitchenMigration).toMatch(/BEFORE INSERT ON public\.order_kitchen_inventory_events/i);
    expect(kitchenMigration).toMatch(/WHEN \(NEW\.snapshot_version >= 2\)/i);
    expect(kitchenMigration).toMatch(/get_raw_material_current_prices\(NEW\.branch_id, v_raw_ids\)/);
  });

  it('only accepts approved positive sources captured no later than kitchen send', () => {
    expect(kitchenMigration).toContain("p.price_source IN ('purchase','pricing','stock_count')");
    expect(kitchenMigration).toMatch(/p\.unit_cost\s*>\s*0/);
    expect(kitchenMigration).toMatch(/p\.priced_at\s*<=\s*COALESCE\(NEW\.created_at, now\(\)\)/);
    expect(kitchenMigration).toMatch(/'unit_cost',NULL/);
  });

  it('retains invoker security and explicit public access restrictions', () => {
    expect(kitchenMigration).toMatch(/SECURITY INVOKER/i);
    expect(kitchenMigration).toMatch(/REVOKE ALL ON FUNCTION public\._capture_kitchen_ingredient_prices\(\) FROM PUBLIC, anon/i);
  });
});
