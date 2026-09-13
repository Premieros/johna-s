import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('reusable modifier groups contract', () => {
  it('manages modifier groups centrally and links many products to one group', () => {
    const page = read('src/features/catalog/pages/ProductModifiersPage.tsx');
    const api = read('src/api/domains/catalog.ts');
    const migration = read('supabase/migrations/20260913160000_reusable_modifier_groups.sql');

    expect(page).toContain("api.catalog.listModifierGroupsAdmin(branchFilter)");
    expect(page).toContain('api.catalog.saveModifierGroup');
    expect(page).toContain('product_ids: string[]');
    expect(page).toContain('toggleProduct');
    expect(page).toContain("can('products.modifiers.manage')");
    expect(page).not.toContain('setProductId');

    expect(api).toContain("supabase.rpc('list_modifier_groups_admin'");
    expect(api).toContain("supabase.rpc('save_modifier_group'");
    expect(api).toContain("supabase.rpc('archive_modifier_group'");

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.product_modifier_group_products');
    expect(migration).toContain("public.can_permission('products.modifiers.manage')");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.save_modifier_group');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.archive_modifier_group');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.save_product_modifiers');
  });

  it('keeps POS modifier reads resolved through reusable group assignments', () => {
    const migration = read('supabase/migrations/20260913160000_reusable_modifier_groups.sql');

    expect(migration).toContain('JOIN public.product_modifier_group_products gp');
    expect(migration).toContain('gp.product_id = p_product_id');
    expect(migration).toContain('gp.branch_id = p_branch_id');
    expect(migration).toContain("'INVALID_MODIFIER_OPTION'");
  });
});

describe('legacy manufacturing-category migration contract', () => {
  it('moves legacy manufacturing-category products into manufactured inventory items without deleting history', () => {
    const migration = read('supabase/migrations/20260913160200_move_legacy_manufactured_category_products.sql');

    expect(migration).toContain("lower(btrim(c.name)) = lower('تصنيعات')");
    expect(migration).toContain("p.product_type = 'manufactured'");
    expect(migration).toContain("'MFG-PRODUCT-' || replace(p.id::text, '-', '')");
    expect(migration).toContain('INSERT INTO public.inventory_unit_recipes');
    expect(migration).toContain('INSERT INTO public.inventory_unit_recipe_units');
    expect(migration).toContain('ri.quantity / COALESCE(lr.yield_quantity, 1)');
    expect(migration).toContain('SET is_active = false');
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.products/i);
    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.recipes/i);
  });

  it('aborts instead of guessing when active operations or unsupported legacy composition exist', () => {
    const migration = read('supabase/migrations/20260913160200_move_legacy_manufactured_category_products.sql');

    expect(migration).toContain("o.status IN ('open', 'held')");
    expect(migration).toContain('LEGACY_MANUFACTURED_PRODUCTS_HAVE_OPEN_ORDERS');
    expect(migration).toContain('pc.component_product_id = p.id');
    expect(migration).toContain('LEGACY_MANUFACTURED_PRODUCTS_USED_AS_PRODUCT_COMPONENTS');
    expect(migration).toContain('LEGACY_MANUFACTURED_PRODUCT_MIGRATION_INCOMPLETE');
  });
});
