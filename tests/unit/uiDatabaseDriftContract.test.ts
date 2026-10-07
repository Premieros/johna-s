import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('UI and production database drift guards', () => {
  it('loads recipe products from the active branch without the removed manufactured-only filter', () => {
    const source = read('src/features/manufacturing/pages/RecipesPage.tsx');
    const recipeData = read('src/features/manufacturing/services/recipeData.ts');
    expect(recipeData).not.toContain(".eq('product_type', 'manufactured')");
    expect(recipeData).toContain("productQuery = productQuery.eq('branch_id', branchId)");
    expect(recipeData).toContain('loadRawCurrentPrices(branchId)');
    expect(source).toContain('materialCosts[item.raw_material_id]');
  });

  it('does not expose retired component/production centers from current navigation surfaces', () => {
    const menu = read('src/core/navigation/menu.config.ts');
    const routes = read('src/app/routes.tsx');

    expect(menu).not.toContain("id: 'components'");
    expect(menu).not.toContain("id: 'production'");
    expect(menu).not.toContain("id: 'manufacturing-center'");
    expect(routes).toContain('APP_ROUTES.production} element={<Navigate to={APP_ROUTES.inventoryUnits} replace />');
    expect(routes).toContain('APP_ROUTES.manufacturingCenter} element={<Navigate to={APP_ROUTES.inventoryUnits} replace />');
    expect(routes).toContain('APP_ROUTES.recipes} element={<Navigate to={APP_ROUTES.products} replace />');
  });

  it('fails production parity when the kitchen inventory schema sentinel is absent or false', () => {
    const source = read('scripts/db/check-production-parity.js');
    const sentinel = read('supabase/migrations/20260905103000_production_schema_contract_sentinel.sql');

    expect(source).toContain("const SCHEMA_SENTINEL_RPC = '_production_schema_contract_kitchen_v1'");
    expect(source).toContain("if (schema !== true) throw new Error");
    expect(source).toContain('No operational probe fallback');

    expect(sentinel).toContain("a.attname = 'inventory_warehouse_id'");
    expect(sentinel).toContain("to_regclass('public.order_kitchen_inventory_events') IS NOT NULL");
    expect(sentinel).toContain("to_regprocedure('public.send_to_kitchen(uuid,uuid)') IS NOT NULL");
    expect(sentinel).toContain("to_regprocedure('public.send_to_kitchen(uuid)') IS NULL");
  });
});
