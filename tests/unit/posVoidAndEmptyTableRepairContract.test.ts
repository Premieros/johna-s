import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260919224500_pos_void_permission_and_empty_table_repair.sql',
  'utf8',
);
const activeOrders = readFileSync('src/features/pos/hooks/useActiveOrders.ts', 'utf8');
const workspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const drawer = readFileSync('src/features/pos/components/orders/ActiveOrdersDrawer.tsx', 'utf8');
const voidModal = readFileSync('src/features/pos/components/order/VoidItemModal.tsx', 'utf8');
const voidPrint = readFileSync(
  'supabase/migrations/20260919220500_kitchen_void_print_routing.sql',
  'utf8',
);

describe('POS void permission and empty-table repair contract', () => {
  it('treats pos.void as a direct server-side void capability', () => {
    expect(migration).toContain("can_permission(''pos.void'')");
    expect(migration).toContain("cancel_sent_order_item_exact");
    expect(migration).toContain("cancel_sent_order_item");
    expect(voidModal).toContain('pos.void');
  });

  it('keeps users without direct void capability on the existing approval path', () => {
    expect(migration).toContain("can_permission(''approvals.review'')");
    expect(migration).not.toContain('DROP TABLE public.approval_requests');
    expect(migration).not.toContain('DISABLE TRIGGER');
  });

  it('does not modify kitchen void print routing or the print queue', () => {
    expect(voidPrint).toContain('trg_enqueue_kitchen_void_print');
    expect(voidPrint).toContain("'kitchen-void:'");
    expect(migration).not.toContain('DROP TRIGGER IF EXISTS trg_enqueue_kitchen_void_print');
    expect(migration).not.toContain('DELETE FROM public.cloud_print_jobs');
    expect(migration).not.toContain('UPDATE public.cloud_print_jobs');
  });

  it('excludes empty order shells from active table/order UI', () => {
    expect(activeOrders).toContain('(itemsByOrder[order.id] || []).some');
    expect(activeOrders).toContain('Number(item.quantity || 0) > 0');
    expect(migration).toContain("o.status IN ('open','held')");
    expect(migration).toContain('COALESCE(oi.quantity, 0) > 0');
  });

  it('passes a required cancellation reason and exposes cancel on active orders', () => {
    expect(workspace).toContain('window.prompt(');
    expect(workspace).toContain('p_notes: reason');
    expect(workspace).toContain('reason.length < 3');
    expect(drawer).toContain('{perms.canCancelOrder && (');
    expect(drawer).not.toContain("order.status === 'held' && perms.canCancelOrder");
  });
});
