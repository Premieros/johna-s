import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

const header = read('src/features/pos/components/order/PosOrderHeaderBar.tsx');
const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');
const active = read('src/features/pos/pages/ActiveOrdersPage.tsx');

describe('POS UI guard permission contract', () => {
  it('uses create-or-edit authority for customer controls', () => {
    expect(header).toContain('canModifyOrder: boolean');
    expect(header).toContain('perms.canManageCustomer && canModifyOrder');
    expect(header).not.toContain('perms.canManageCustomer && perms.canEditOrder');
    expect(workspace).toContain('canModifyOrder={canModifyCurrentOrder}');
  });

  it('guards active-order actions with their exact permissions', () => {
    expect(active).toContain("const canCreateOrder = can('pos.order.create')");
    expect(active).toContain("const canPayOrder = can('pos.payment.take')");
    expect(active).toContain("const canCancelOrder = can('pos.cancel_order')");
    expect(active).toContain("const canReassignCashier = can('pos.order.transfer')");
  });

  it('uses the dedicated operator-transfer RPC without broad user-management coupling', () => {
    expect(active).toContain('api.floorPlan.transferOrderOperator({');
    expect(active).toContain('api.pos.listOrderTransferTargets({ p_order_id: sourceOrder.id })');
    expect(active).not.toContain("supabase.from('orders').update({ cashier_id:");
    expect(active).not.toContain("supabase.from('users')");
    expect(active).not.toContain("can('users.manage')");
  });

  it('keeps payment, cancel and new-order controls permission gated', () => {
    expect(active).toContain('{canPayOrder && <Button');
    expect(active).toContain('{canCancelOrder && <Button');
    expect(active).toContain('{canCreateOrder && <Button');
  });
});
