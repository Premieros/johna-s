import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = readFileSync('src/features/pos/hooks/usePosOrderBase.ts', 'utf8');
const wrapper = readFileSync('src/features/pos/hooks/usePosOrder.ts', 'utf8');
const workspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const perms = readFileSync('src/features/pos/hooks/usePosPermissions.ts', 'utf8');

describe('open-check print-once UI guard', () => {
  it('locks only the pre-payment Open Check for non-reprinters', () => {
    expect(base).toContain('openCheckPrintLocked');
    expect(wrapper).toContain('openCheckPrintLockedOrderId === base.activeOrderId && !perms.canReprint');
    expect(workspace).toContain('!pos.openCheckPrintLocked || perms.canReprint');
    expect(base).not.toContain('receiptPrintLocked');
    expect(wrapper).not.toContain('settlementReceiptPrintLocked');
    expect(workspace).not.toContain('pos.receiptPrintLocked');
  });

  it('keeps checkout and payment receipt independent from the Open Check lock', () => {
    const checkoutStart = wrapper.indexOf('const setCheckoutOpen = useCallback');
    const completeStart = wrapper.indexOf('const completeSale = useCallback');
    const printStart = wrapper.indexOf('const printReceipt = useCallback');
    const checkoutSegment = wrapper.slice(checkoutStart, completeStart);
    const completeSegment = wrapper.slice(completeStart, printStart);

    expect(checkoutSegment).not.toContain('openCheckPrintLockedOrderId');
    expect(completeSegment).toContain('enqueueAutomaticReceiptPrint');
    expect(completeSegment).not.toContain('openCheckPrintLockedOrderId');
  });

  it('keeps direct reprint permission-first', () => {
    expect(perms).toContain("canReprint: can('pos.reprint')");
    expect(workspace).not.toContain('branch_manager');
    expect(wrapper).not.toContain('branch_manager');
  });
});
