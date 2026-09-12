import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

const hook = read('src/features/pos/hooks/usePosOrderBase.ts');
const wrapper = read('src/features/pos/hooks/usePosOrder.ts');
const browser = read('src/features/pos/components/catalog/ProductBrowser.tsx');
const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');
const offline = read('src/context/OfflineContext.tsx');
const migration = read('supabase/migrations/20260912075859_pos_availability_permission_and_recipe_guard.sql');
const cartMigration = read('supabase/migrations/20260912113000_pos_cart_negative_raw_sellthrough.sql');

describe('POS raw-shortage and verified-availability contract', () => {
  it('keeps same-branch raw shortages exempt from every client stock guard', () => {
    expect(hook).toContain('if (!isNegativeEligible(product.id) && totalProductQty + quantity > stock)');
    expect(hook).toContain('if (!isNegativeEligible(target.product.id) && totalProductQty + delta > stock)');
    expect(hook).toContain('const maxForLine = isNegativeEligible(target.product.id)');
    expect(wrapper).toContain('(productId: string) => input.rawShortageOnly?.[productId] === true');
    expect(wrapper).toContain('if (!isRawShortageOnly(product.id) && currentQty + quantity > physicalStock)');
    expect(wrapper).toContain('if (!isRawShortageOnly(target.product.id) && currentQty + delta > physicalStock)');
    expect(wrapper).toContain('if (!isRawShortageOnly(target.product.id) && otherQty + Number(qty) > physicalStock)');
    expect(wrapper).toContain('if (!isRawShortageOnly(nextItem.product.id) && otherQty + nextItem.quantity > physicalStock)');
    expect(wrapper).toContain('input.rawShortageOnly?.[item.product.id] === true');
    expect(browser).toContain('const isRawShortageOnly = (product: Product) => rawShortageOnly[product.id] === true;');
    expect(browser).toContain('if (isRawShortageOnly(product)) {\n      return true;\n    }');
  });

  it('keeps cart aggregate availability permissive only for raw shortage', () => {
    expect(cartMigration).toContain("<> 'INSUFFICIENT_RAW_MATERIAL_STOCK'");
    expect(cartMigration).toContain("v_error <> 'INSUFFICIENT_RAW_MATERIAL_STOCK'");
    expect(cartMigration).toContain('public.check_product_availability(');
    expect(cartMigration).toContain("'mode', 'cart_aggregate_raw_shortage_sellthrough'");
    expect(cartMigration).toContain("'raw_shortage_only', true");
    expect(cartMigration).not.toContain("'INSUFFICIENT_PRODUCT_STOCK' THEN RETURN jsonb_build_object('success', true");
  });

  it('loads and caches the server raw-shortage signal without inventing success', () => {
    expect(workspace).toContain("await supabase.rpc('get_pos_product_availability'");
    expect(workspace).toContain('if (row.raw_shortage_only) rawShortage[row.product_id] = true;');
    expect(workspace).toContain('if (row.availability_error) availabilityErrors[row.product_id] = row.availability_error;');
    expect(workspace).toContain('setStockMap({});\n      setRawShortageMap({});\n      setAvailabilityErrorMap({});');
    expect(offline).toContain('rawShortageOnly: data.rawShortageOnly?.[productId] === true');
  });

  it('makes pos.view a branch-scoped active-catalog permission, not a role bypass', () => {
    expect(migration).toContain("public.can_permission('pos.view')");
    expect(migration).toContain('public.user_may_access_branch(branch_id)');
    expect(migration).toContain('is_active = true');
    expect(migration).not.toContain("role = 'cashier'");
  });

  it('preserves warehouse-scoped net raw balances including negative debt', () => {
    expect(migration).toContain('FROM public.raw_material_batches b');
    expect(migration).toContain('AND b.warehouse_id = p_warehouse_id');
    expect(migration).not.toContain('FROM public.raw_material_inventory rmi');
    expect(migration).not.toContain('AND b.quantity > 0');
  });

  it('returns invalid recipes as explicit blocked rows', () => {
    expect(migration).toContain('CREATE TRIGGER trg_00_validate_recipe_item_branch');
    expect(migration).toContain("RAISE EXCEPTION 'RAW_MATERIAL_BRANCH_MISMATCH'");
    expect(migration).toContain("public.can_permission('recipes.manage')");
    expect(migration).toContain('AND rm.branch_id = r.branch_id');
    expect(migration).toContain("'error', 'RAW_MATERIAL_NOT_IN_BRANCH'");
    expect(migration).toContain('availability_error := v_error;');
    expect(migration).toContain('raw_shortage_only := false;');
    expect(browser).toContain("code === 'RAW_MATERIAL_NOT_IN_BRANCH'");
    expect(browser).toContain('const blocked = unavailable || unknownAvailability || !!availabilityError || !canAddToCart;');
  });
});
