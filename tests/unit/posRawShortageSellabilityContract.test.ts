import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const hook = read('src/features/pos/hooks/usePosOrderBase.ts');
const wrapper = read('src/features/pos/hooks/usePosOrder.ts');
const browser = read('src/features/pos/components/catalog/ProductBrowser.tsx');
const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');
const migration = read('supabase/migrations/20260912075859_pos_availability_permission_and_recipe_guard.sql');
const cartMigration = read('supabase/migrations/20260912113000_pos_cart_negative_raw_sellthrough.sql');

describe('POS sell-through staged-retirement contract', () => {
  it('makes every visible POS product quantity-eligible while server deduction remains authoritative', () => {
    expect(hook).toContain('if (!isNegativeEligible(product.id) && totalProductQty + quantity > stock)');
    expect(wrapper).toContain('POS wrapper for unconditional quantity sell-through.');
    expect(wrapper).toContain('rawShortageOnly: Object.fromEntries(input.products.map((product) => [product.id, true]))');
    expect(wrapper).toContain('Physical raw-material deduction remains server-owned at send_to_kitchen');
  });

  it('does not query legacy sellability or recipe composition while opening the POS workspace', () => {
    expect(workspace).not.toContain("supabase.rpc('get_pos_product_sellability'");
    expect(workspace).not.toContain("supabase.rpc('get_pos_product_availability'");
    expect(workspace).not.toContain("from('product_components')");
    expect(browser).not.toContain('availabilityErrors');
    expect(browser).not.toContain('recipeMap');
    expect(browser).toContain('const gated = !canAddToCart;');
  });

  it('keeps old database availability contracts intact only as compatibility until later retirement phases', () => {
    expect(cartMigration).toContain("<> 'INSUFFICIENT_RAW_MATERIAL_STOCK'");
    expect(cartMigration).toContain('public.check_product_availability(');
    expect(migration).toContain("public.can_permission('pos.view')");
    expect(migration).toContain('public.user_may_access_branch(branch_id)');
    expect(migration).toContain('is_active = true');
  });

  it('preserves warehouse-scoped negative raw balances in the existing server contract', () => {
    expect(migration).toContain('FROM public.raw_material_batches b');
    expect(migration).toContain('AND b.warehouse_id = p_warehouse_id');
    expect(migration).not.toContain('FROM public.raw_material_inventory rmi');
    expect(migration).not.toContain('AND b.quantity > 0');
  });
});
