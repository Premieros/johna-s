import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const header = readFileSync('src/features/pos/components/order/PosOrderHeaderBar.tsx', 'utf8');
const orders = readFileSync('src/features/pos/components/orders/ActiveOrdersDrawer.tsx', 'utf8');
const table = readFileSync('src/features/pos/components/tables/TableCard.tsx', 'utf8');

describe('POS hardening: permission-first sent actions', () => {
  it('shows Pay only after at least one kitchen send and keeps print permission-gated', () => {
    expect(header).toContain('const hasSent = kitchenSends.length > 0;');
    expect(header).toContain('const canPrintSentReceipt = hasSent && canPrintReceipt;');
    expect(header).toContain('{perms.canPay && hasSent && itemsCount > 0 && (');
    expect(header).toContain('{perms.canPrint && canPrintSentReceipt && (');
    expect(header).not.toContain('disabled={!canPrintSentReceipt}');
  });

  it('hides active-order Pay and Cancel actions without their permissions', () => {
    expect(orders).toContain('const perms = usePosPermissions();');
    expect(orders).toContain('const hasKitchenSend = (kitchenSendsByOrder[order.id]?.length || 0) > 0;');
    expect(orders).toContain('!ready && perms.canPay && hasKitchenSend');
    expect(orders).toContain("order.status === 'held' && perms.canCancelOrder");
  });

  it('hides table transfer entry point without pos.order.transfer', () => {
    expect(table).toContain('const perms = usePosPermissions();');
    expect(table).toContain('activeOrder && perms.canTransferOrder && onTransfer');
  });
});
