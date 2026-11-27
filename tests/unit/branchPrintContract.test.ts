import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('printed document branch identity', () => {
  it('prints the actual POS branch on every receipt', () => {
    const printing = read('src/features/pos/utils/printing.ts');
    const renderer = read('src/features/pos/services/localPrintAgent.ts');
    const posOrderBase = read('src/features/pos/hooks/usePosOrderBase.ts');
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');

    expect(printing).toContain('branchName: string');
    expect(printing).toContain('branchName: safeThermalText(receipt.branchName)');
    expect(renderer).toContain('template.branchName');
    expect(renderer).toContain('class="branch"');
    expect(posOrderBase).toContain('branchName,');
    expect(workspace).toContain('branchName: currentBranchName');
  });

  it('keeps a completed sale successful while a reprint approval is pending', () => {
    const posOrderBase = read('src/features/pos/hooks/usePosOrderBase.ts');
    expect(posOrderBase).toContain("error.code === 'REPRINT_APPROVAL_PENDING'");
    expect(posOrderBase).toContain('showReceiptPrintError(error)');

    const saleSuccess = posOrderBase.indexOf("show(t('saleCompleted'), 'success')");
    const returnSuccess = posOrderBase.indexOf('return true;', saleSuccess);
    expect(saleSuccess).toBeGreaterThan(-1);
    expect(returnSuccess).toBeGreaterThan(saleSuccess);
    expect(posOrderBase.slice(saleSuccess, returnSuccess)).not.toContain('enqueueAutomaticReceiptPrint');
    const wrapper = read('src/features/pos/hooks/usePosOrder.ts');
    expect(wrapper).toContain('const printPaidReceipt = useCallback');
    expect(wrapper).toContain('await buildReceiptHtml(receipt');

  });

  it('keeps shift closing documents branch-labelled', () => {
    const shiftReport = read('src/features/trade/services/shiftClosingReport.ts');
    expect(shiftReport).toContain('branchName: string');
    expect(shiftReport).toContain('escapeHtml(summary.branchName)');
  });
});
