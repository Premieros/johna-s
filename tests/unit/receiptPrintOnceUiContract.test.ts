import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = readFileSync('src/features/pos/hooks/usePosOrderBase.ts', 'utf8');
const wrapper = readFileSync('src/features/pos/hooks/usePosOrder.ts', 'utf8');
const workspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const perms = readFileSync('src/features/pos/hooks/usePosPermissions.ts', 'utf8');

describe('receipt print-once UI guard', () => {
  it('locks completed receipt printing after the first accepted queue for non-reprinters', () => {
    expect(base).toContain('receiptPrintLocked');
    expect(base).toContain('setReceiptPrintLocked(true)');
    expect(wrapper).toContain('base.receiptPrintLocked && !perms.canReprint');
    expect(workspace).toContain('disabled={pos.receiptPrintLocked && !perms.canReprint}');
    expect(workspace).toContain("isAr ? 'تمت الطباعة' : 'Printed'");
    expect(base).toContain('openCheckPrintLocked');
    expect(wrapper).toContain('openCheckPrintLockedOrderId === base.activeOrderId && !perms.canReprint');
    expect(workspace).toContain('!pos.openCheckPrintLocked || perms.canReprint');
  });

  it('keeps checkout independent from the open-check print lock', () => {
    const checkoutStart = wrapper.indexOf('const setCheckoutOpen = useCallback');
    const completeStart = wrapper.indexOf('const completeSale = useCallback');
    const printStart = wrapper.indexOf('const printReceipt = useCallback');
    const checkoutSegment = wrapper.slice(checkoutStart, completeStart);
    const printSegment = wrapper.slice(printStart);

    expect(checkoutStart).toBeGreaterThanOrEqual(0);
    expect(completeStart).toBeGreaterThan(checkoutStart);
    expect(printStart).toBeGreaterThan(completeStart);
    expect(checkoutSegment).not.toContain('openCheckPrintLockedOrderId');
    expect(printSegment).toContain('openCheckPrintLockedOrderId === base.activeOrderId && !perms.canReprint');
  });

  it('keeps direct reprint permission-first', () => {
    expect(perms).toContain("canReprint: can('pos.reprint')");
    expect(workspace).not.toContain('branch_manager');
    expect(wrapper).not.toContain('branch_manager');
  });
});
