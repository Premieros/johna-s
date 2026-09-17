import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const hook = fs.readFileSync(path.join(root, 'src/features/pos/hooks/usePosOrder.ts'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260917083000_atomic_transfer_order_to_table.sql'),
  'utf8',
);

describe('POS atomic full table transfer contract', () => {
  it('routes the public POS transfer action through one server RPC', () => {
    expect(hook).toContain("supabase.rpc('transfer_order_to_table'");
    expect(hook).toContain('p_order_id: targetOrderId');
    expect(hook).toContain('p_target_table_id: toTableId');
    expect(hook).toContain('transferOrderToTable,');
  });

  it('keeps permission, branch, ownership and live-order checks server-side', () => {
    expect(migration).toContain("can_permission('pos.order.transfer')");
    expect(migration).toContain('user_may_access_branch(v_order.branch_id)');
    expect(migration).toContain('can_manage_other_pos_orders()');
    expect(migration).toContain("v_order.status NOT IN ('open', 'held')");
    expect(migration).toContain("'TARGET_TABLE_OCCUPIED'");
  });

  it('locks state and updates order + both tables in one transaction scope', () => {
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('UPDATE public.orders');
    expect(migration).toContain("SET status = 'occupied'");
    expect(migration).toContain("THEN 'occupied' ELSE 'vacant' END");
    expect(migration).toContain("'ORDER_TABLE_TRANSFERRED'");
  });

  it('does not trust a client-provided source table id', () => {
    expect(migration).toContain('p_order_id uuid');
    expect(migration).toContain('p_target_table_id uuid');
    expect(migration).not.toContain('p_source_table_id');
  });
});
