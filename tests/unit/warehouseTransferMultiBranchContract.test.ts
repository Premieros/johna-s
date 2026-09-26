import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const page = readFileSync(resolve(root, 'src/features/inventory/pages/TransfersPage.tsx'), 'utf8');
const api = readFileSync(resolve(root, 'src/api/domains/inventory.ts'), 'utf8');
const crossBranchMigration = readFileSync(resolve(root, 'supabase/migrations/20260911004000_cross_branch_inventory_transfers.sql'), 'utf8');
const warehouseRawMigration = readFileSync(resolve(root, 'supabase/migrations/20260911150000_raw_material_warehouse_stage_b.sql'), 'utf8');

describe('warehouse transfer current operating contract', () => {
  it('shows RLS-visible source/destination branches and raw materials only', () => {
    expect(page).toContain("supabase.from('branches').select('*')");
    expect(page).toContain("supabase.from('raw_materials').select('id,name,branch_id,unit_id,default_cost')");
    expect(page).toContain('source_branch_id');
    expect(page).toContain('destination_branch_id');
    expect(page).toContain("item_type: 'raw_material'");
    expect(page).toContain('sourceRawMaterials');
    expect(page).not.toContain("supabase.from('products')");
    expect(page).not.toContain("value=\"product\"");
    expect(page).not.toContain("type TransferItemType = 'product' | 'raw_material'");
  });

  it('uses a raw-material-only application payload while keeping destination identity internal', () => {
    expect(api).toContain("item_type: 'raw_material'");
    expect(api).not.toContain("item_type: 'product' | 'raw_material'");
    expect(api).toContain('item_id: string');
    expect(api).toContain('destination_item_id: string');
    expect(page).toContain("item_type: 'raw_material'");
    expect(page).toContain('destination_item_id: l.destination_item_id');
  });

  it('keeps only one user-facing raw-material selector and resolves the destination deterministically', () => {
    expect(page).toContain('resolveDestinationRawId');
    expect(page).toContain('normalizeRawName(raw.name) === normalizeRawName(source.name)');
    expect(page).toContain('raw.unit_id === source.unit_id');
    expect(page).toContain('matches.length === 1 ? matches[0].id :');
    expect(page).not.toContain('اختر المقابل بفرع الوجهة');
    expect(page).not.toContain('Select destination item');
  });

  it('fails closed when the destination branch lacks one unique matching raw definition', () => {
    expect(page).toContain('توجد خامة غير معرفة بشكل مطابق في فرع الوجهة');
    expect(page).toContain('same name and unit before transferring');
    expect(crossBranchMigration).toContain("'DESTINATION_ITEM_REQUIRED'");
    expect(crossBranchMigration).toContain("'DESTINATION_ITEM_BRANCH_MISMATCH'");
  });

  it('requires access to both branches before a cross-branch stock mutation', () => {
    expect(crossBranchMigration).toContain('public.user_may_access_branch(p_branch_id)');
    expect(crossBranchMigration).toContain('public.user_may_access_branch(v_to_branch_id)');
    expect(crossBranchMigration).toContain("public.can_permission('inventory.transfer.create')");
    expect(crossBranchMigration).toContain("public.can_permission('inventory.transfer.approve')");
  });

  it('validates every line before inserting the transfer header', () => {
    const validation = crossBranchMigration.indexOf('FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)');
    const headerInsert = crossBranchMigration.indexOf('INSERT INTO public.warehouse_transfers (transfer_number');
    expect(validation).toBeGreaterThan(-1);
    expect(headerInsert).toBeGreaterThan(validation);
    expect(crossBranchMigration).toContain("v_validated_items jsonb := '[]'::jsonb");
  });

  it('uses the later warehouse-aware raw contract for same-branch warehouse transfers', () => {
    expect(warehouseRawMigration).toContain('raw_material_warehouse_inventory');
    expect(warehouseRawMigration).toContain('Allow same-branch raw transfer identity');
    expect(warehouseRawMigration).toContain('v_requested_destination_id := v_source_id');
    expect(warehouseRawMigration).toContain('v_transfer.from_warehouse_id');
    expect(warehouseRawMigration).toContain('v_transfer.to_warehouse_id');
    expect(warehouseRawMigration).toContain('public._raw_remove_fifo(v_item.raw_material_id, v_transfer.branch_id, v_transfer.from_warehouse_id');
    expect(warehouseRawMigration).toContain('public._raw_add(v_item.raw_material_id, v_transfer.branch_id, v_transfer.to_warehouse_id');
  });

  it('prices the transfer preview from the source warehouse raw-material view', () => {
    expect(page).toContain("supabase.from('raw_material_warehouse_inventory')");
    expect(page).toContain(".eq('warehouse_id', form.from_warehouse_id)");
    expect(page).not.toContain("supabase.from('inventory_batches')");
  });

  it('keeps historical database item identities explicit and mutually exclusive', () => {
    expect(crossBranchMigration).toContain('warehouse_transfer_items_source_kind_check');
    expect(crossBranchMigration).toContain('destination_product_id');
    expect(crossBranchMigration).toContain('destination_raw_material_id');
    expect(crossBranchMigration).toContain('to_branch_id');
    expect(crossBranchMigration).toContain('warehouse_transfers_branch_read');
    expect(crossBranchMigration).toContain('warehouse_transfer_items_branch_read');
    expect(crossBranchMigration).toContain('warehouse_transfers_rpc_only_update');
    expect(crossBranchMigration).toContain('warehouse_transfer_items_rpc_only_update');
  });
});
