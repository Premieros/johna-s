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

  it('awaits the auto receipt command after both direct sale and order settlement', () => {
    expect(base).toContain('await enqueueAutomaticReceiptPrint({');
    expect(base).toContain('saleId,');
    expect(wrapper).toContain('await enqueueAutomaticReceiptPrint({');
    expect(wrapper).toContain("const saleId = extended.sale_id || '';");
  });

  it('does not route auto receipt through the browser print window', () => {
    const baseAuto = base.slice(base.indexOf("if (effSettings?.receipt_auto_print)"));
    expect(baseAuto.slice(0, 1200)).not.toContain('openPrintWindow(');
    const wrapperAuto = wrapper.slice(wrapper.indexOf("if (input.effSettings?.receipt_auto_print)"));
    expect(wrapperAuto.slice(0, 1200)).not.toContain('openPrintWindow(');
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
