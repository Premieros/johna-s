import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const page = readFileSync(resolve(root, 'src/features/inventory/pages/TransfersPage.tsx'), 'utf8');
const api = readFileSync(resolve(root, 'src/api/domains/inventory.ts'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20260911004000_cross_branch_inventory_transfers.sql'), 'utf8');

describe('multi-branch warehouse transfer contract', () => {
  it('shows RLS-visible source/destination branches and raw materials in the transfer UI', () => {
    expect(page).toContain("supabase.from('branches').select('*')");
    expect(page).toContain("supabase.from('raw_materials').select('id,name,branch_id,default_cost')");
    expect(page).toContain("source_branch_id");
    expect(page).toContain("destination_branch_id");
    expect(page).toContain("item_type: 'raw_material'");
    expect(page).toContain("sourceRawMaterials");
    expect(page).not.toContain("user?.branch_id || branchFilter");
  });

  it('uses a mixed typed transfer payload instead of product-only items', () => {
    expect(api).toContain("item_type: 'product' | 'raw_material'");
    expect(api).toContain('item_id: string');
    expect(page).toContain("item_type: l.item_type, item_id: l.item_id");
  });

  it('requires access to both branches before a cross-branch stock mutation', () => {
    expect(migration).toContain('public.user_may_access_branch(p_branch_id)');
    expect(migration).toContain('public.user_may_access_branch(v_to_branch_id)');
    expect(migration).toContain("public.can_permission('inventory.transfer.create')");
    expect(migration).toContain("public.can_permission('inventory.transfer.approve')");
  });

  it('moves product inventory warehouse-to-warehouse and raw inventory branch-to-branch', () => {
    expect(migration).toContain('public._product_inv_remove_fifo(');
    expect(migration).toContain('public._product_inv_add(');
    expect(migration).toContain('public._raw_remove_fifo(');
    expect(migration).toContain('public._raw_add(');
    expect(migration).toContain('RAW_MATERIAL_SAME_BRANCH_WAREHOUSE_TRANSFER_UNSUPPORTED');
  });

  it('keeps source/destination item identities explicit and mutually exclusive', () => {
    expect(migration).toContain('warehouse_transfer_items_source_kind_check');
    expect(migration).toContain('destination_product_id');
    expect(migration).toContain('destination_raw_material_id');
    expect(migration).toContain('to_branch_id');
  });
});
