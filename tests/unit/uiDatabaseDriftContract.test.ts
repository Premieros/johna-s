import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('UI and production database drift guards', () => {
  it('loads recipe products from the active branch without the removed manufactured-only filter', () => {
    const source = read('src/features/manufacturing/pages/RecipesPage.tsx');
    expect(source).not.toContain(".eq('product_type', 'manufactured')");
    expect(source).toContain("productQuery = productQuery.eq('branch_id', branchFilter)");
    expect(source).toContain(".from('raw_material_inventory')");
    expect(source).toContain('materialCosts[item.raw_material_id]');
  });

  it('does not expose the retired Components page from current navigation surfaces', () => {
    const menu = read('src/core/navigation/menu.config.ts');
    expect(menu).not.toContain("id: 'components'");
  });

  it('fails production parity when the kitchen inventory schema sentinel is absent or false', () => {
    const source = read('scripts/db/check-production-parity.js');
    const sentinel = read('supabase/migrations/20260905103000_production_schema_contract_sentinel.sql');

    expect(source).toContain("const SCHEMA_SENTINEL_RPC = '_production_schema_contract_kitchen_v1'");
    expect(source).toContain("return json === true ? 'present' : 'missing'");
    expect(source).toContain("schemaStatus === 'present'");
    expect(source).toContain("text.includes('PGRST202')");

    expect(sentinel).toContain("a.attname = 'inventory_warehouse_id'");
    expect(sentinel).toContain("to_regclass('public.order_kitchen_inventory_events') IS NOT NULL");
    expect(sentinel).toContain("to_regprocedure('public.send_to_kitchen(uuid,uuid)') IS NOT NULL");
    expect(sentinel).toContain("to_regprocedure('public.send_to_kitchen(uuid)') IS NULL");
  });
});
