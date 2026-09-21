import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const permissions = readFileSync('src/features/pos/hooks/usePosPermissions.ts', 'utf8');
const panel = readFileSync('src/features/pos/components/order/CurrentOrderPanel.tsx', 'utf8');
const workspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const voidModal = readFileSync('src/features/pos/components/order/VoidItemModal.tsx', 'utf8');

describe('POS Void / approval UI contract', () => {
  it('separates unsent removal from direct sent-item Void', () => {
    expect(permissions).toContain("canDeleteItem: can('pos.order.edit')");
    expect(permissions).toContain("canVoidSentItem: can('pos.void')");
    expect(workspace).toContain('canDeleteItem={canModifyCurrentOrder}');
  });

  it('keeps the sent-item approval path reachable without direct pos.void', () => {
    expect(panel).toContain('selectedCanRemoveOrVoid');
    expect(panel).toContain('selectedSentQty > 0');
    expect(panel).toContain('!!activeOrderId && !!onVoidItem');
    expect(panel).toContain("perms.canVoidSentItem ? 'Void'");
    expect(panel).toContain("'طلب إلغاء'");
  });

  it('uses the controlled Void callback for a fully sent quantity even without edit authority', () => {
    expect(panel).toContain('const requiresVoid = sent.sentQty > 0 && item.quantity <= sent.sentQty;');
    expect(panel).toContain('const canDecreaseQuantity = requiresVoid');
    expect(panel).toContain('? !!activeOrderId && !!onVoidItem');
    expect(panel).toContain('onClick={() => requiresVoid && onVoidItem ? onVoidItem(item, sent.sentQty) : onUpdateQty(lineKey, -1)}');
  });

  it('tells the operator whether the action is direct or requires manager approval', () => {
    expect(workspace).toContain('canDirectVoid={perms.canVoidSentItem}');
    expect(voidModal).toContain('canDirectVoid: boolean');
    expect(voidModal).toContain('طلب موافقة على الإلغاء');
    expect(voidModal).toContain('لن يتم إلغاء الصنف أو رد المخزون قبل اعتماد الطلب');
  });
});
