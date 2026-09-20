import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('POS multi-item table transfer and Captain Order target contract', () => {
  it('keeps order-line selection multi-select in the current order panel', () => {
    const panel = read('src/features/pos/components/order/CurrentOrderPanel.tsx');

    expect(panel).toContain('selectedLineKeys');
    expect(panel).toContain('toggleSelectedLine');
    expect(panel).toContain('selectedItems.length');
    expect(panel).toContain('pos-selected-transfer-items');
    expect(panel).not.toContain("(sent?.sentQty || 0) > 0");
    expect(panel).toContain('<TransferItemsModal');
    expect(panel).not.toMatch(/\bselectedLineKey\b/);
  });

  it('uses the dedicated atomic multi-item table-transfer RPC', () => {
    const api = read('src/api/domains/pos.ts');
    const modal = read('src/features/pos/components/tables/TransferItemsModal.tsx');
    const migration = read('supabase/migrations/20260920114500_multi_item_table_transfer_captain_targets.sql');

    expect(api).toContain("rpc('transfer_order_items_to_table'");
    expect(modal).toContain('transferOrderItemsToTable');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.transfer_order_items_to_table');
    expect(migration).toContain("can_permission('pos.order.transfer')");
    expect(migration).toContain("UPDATE public.order_kitchen_sends");
    expect(migration).toContain("UPDATE public.order_kitchen_inventory_events");
    expect(migration).toContain("'inventory_changed',false");
    expect(migration).toContain("'kds_reassigned',v_moved_sent_count>0");
    expect(migration).toContain("'kds_resent',false");
    expect(migration).toContain("kitchen_status = CASE");
    expect(migration).toContain("SET kitchen_status='pending'");
  });

  it('routes the legacy single-item UI and RPC through the canonical multi-item transfer path', () => {
    const hook = read('src/features/pos/hooks/usePosOrderBase.ts');
    const compatibility = read('supabase/migrations/20260920150000_align_single_item_table_transfer.sql');

    expect(hook).toContain('transferOrderItemsToTable');
    expect(hook).toContain('p_order_item_ids: [matches[0].id]');
    expect(hook).not.toContain('api.pos.transferOrderItemToTable({');

    expect(compatibility).toContain('CREATE OR REPLACE FUNCTION public.transfer_order_item_to_table');
    expect(compatibility).toContain('public.transfer_order_items_to_table(');
    expect(compatibility).toContain('ARRAY[p_order_item_id]::uuid[]');
    expect(compatibility).not.toContain('ITEM_ALREADY_SENT');
    expect(compatibility).not.toContain('UPDATE public.order_kitchen_sends');
    expect(compatibility).not.toContain('UPDATE public.order_kitchen_inventory_events');
  });

  it('limits operator transfer targets to Captain Order users whose home branch matches the order branch', () => {
    const migration = read('supabase/migrations/20260920114500_multi_item_table_transfer_captain_targets.sql');

    expect(migration).toContain('CREATE OR REPLACE FUNCTION public._is_branch_captain_order_user');
    expect(migration).toContain('u.branch_id = p_branch_id');
    expect(migration).toContain("r.scope = 'branch'");
    expect(migration).toContain('r.branch_id = p_branch_id');
    expect(migration).toContain('كابتن اوردر');
    expect(migration).toContain("'TARGET_USER_NOT_BRANCH_CAPTAIN'");
    expect(migration).not.toContain("UPDATE public.roles SET permissions");
  });
});
