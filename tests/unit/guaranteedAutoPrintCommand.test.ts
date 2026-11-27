import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const printing = fs.readFileSync('src/features/pos/utils/printing.ts', 'utf8');
const base = fs.readFileSync('src/features/pos/hooks/usePosOrderBase.ts', 'utf8');
const wrapper = fs.readFileSync('src/features/pos/hooks/usePosOrder.ts', 'utf8');
const shifts = fs.readFileSync('src/features/trade/pages/ShiftsPage.tsx', 'utf8');
const modal = fs.readFileSync('src/features/pos/components/shift/ShiftModal.tsx', 'utf8');
const autoZ = fs.readFileSync('src/features/trade/services/automaticShiftPrint.ts', 'utf8');

describe('guaranteed auto print command contract', () => {
  it('queues auto receipt directly with a stable sale idempotency key', () => {
    expect(printing).toContain('enqueueAutomaticReceiptPrint');
    expect(printing).toContain('receipt:auto:${saleId}:1');
    expect(printing).toContain('enqueueCloudReceiptPrint({');
  });

  it('does not enqueue or print receipts during either successful checkout path', () => {
    const direct = base.slice(base.indexOf('const completeSale = useCallback'), base.indexOf('const printReceipt = useCallback'));
    const settlement = wrapper.slice(wrapper.indexOf('const completeSale = useCallback'), wrapper.indexOf('const printPaidReceiptBusy'));
    for (const checkout of [direct, settlement]) {
      expect(checkout).not.toContain('enqueueAutomaticReceiptPrint');
      expect(checkout).not.toContain('openPrintWindow(');
      expect(checkout).not.toContain('buildReceiptHtml(');
    }
    expect(direct).toContain('setLastReceipt(receiptPayload)');
    expect(settlement).toContain('setSettlementReceipt(receipt)');
  });

  it('prints only on explicit action with existing authorization and supports skipping', () => {
    const paid = wrapper.slice(wrapper.indexOf('const printPaidReceipt ='), wrapper.indexOf('const printReceipt ='));
    const workspace = fs.readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
    expect(paid).toContain('!perms.canPrint');
    expect(paid).toContain('settlementReceiptSaleId ? settlementReceipt : base.receiptSaleId ? base.lastReceipt : null');
    expect(paid).toContain('await buildReceiptHtml(receipt');
    expect(paid).toContain('openPrintWindow(html');
    expect(workspace).toContain('onClick={() => void pos.printPaidReceipt()}');
    expect(workspace).toContain('data-testid="pos-receipt-skip" onClick={pos.closeReceipt}');
  });

  it('queues one deterministic Z command per closed shift', () => {
    expect(autoZ).toContain('enqueueAutomaticShiftZReport');
    expect(autoZ).toContain('zreport:auto:${params.shiftId}');
    expect(autoZ).toContain('enqueueCloudReportPrint({');
    expect(shifts).toContain('await enqueueAutomaticShiftZReport({');
    expect(modal).toContain('await enqueueAutomaticShiftZReport({');
  });

  it('keeps manual print controls and existing queue primitives intact', () => {
    expect(shifts).toContain('handlePrintZReport');
    expect(modal).toContain('handlePrintThermal');
    expect(printing).toContain('buildReceiptHtml');
    expect(printing).toContain('openPrintWindow');
  });
});
