import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workspace = fs.readFileSync(path.join(root, 'src/features/pos/pages/PosWorkspacePage.tsx'), 'utf8');
const header = fs.readFileSync(path.join(root, 'src/features/pos/components/order/PosOrderHeaderBar.tsx'), 'utf8');
const printing = fs.readFileSync(path.join(root, 'src/features/pos/utils/printing.ts'), 'utf8');

describe('POS customer receipt print contract', () => {
  it('routes sale-screen print actions to the customer receipt, not the kitchen ticket', () => {
    expect(workspace).not.toContain('onPrint={pos.printKitchenTicket}');
    expect(workspace).toContain('onPrint={() => void pos.printReceipt()}');
    expect(workspace).toContain('perms.canPrint && pos.lastReceipt && pos.cart.length === 0');
  });

  it('gates the visible print action with pos.receipt.print and first kitchen send', () => {
    expect(header).toContain('{perms.canPrint && (');
    expect(header).toContain('const canPrintSentReceipt = hasSent && canPrintReceipt;');
    expect(header).toContain('disabled={!canPrintSentReceipt}');
    expect(workspace).toContain('canPrintReceipt={pos.cart.length > 0 || !!pos.lastReceipt}');
    expect(header).not.toContain('perms.canPrint && canPrintReceipt');
    expect(header).not.toContain('perms.canPrintKitchen && itemsCount > 0');
    expect(workspace).toContain('data-testid="pos-receipt-print"');
    expect(workspace).toContain('{perms.canPrint && (');
  });

  it('exposes an explicit permission checkbox label for the sale receipt print button', () => {
    const defs = fs.readFileSync(path.join(root, 'src/lib/permissionDefs.ts'), 'utf8');
    expect(defs).toContain("'pos.receipt.print'");
    expect(defs).toContain('إظهار زر طباعة إيصال البيع (أول مرة)');
    expect(defs).toContain("permissions: ['pos.view', 'pos.order.create', 'pos.order.edit', 'pos.payment.take', 'pos.order.split', 'pos.order.transfer', 'pos.receipt.print'");
  });

  it('prints the current open table order as a customer check before payment', () => {
    const hook = fs.readFileSync(path.join(root, 'src/features/pos/hooks/usePosOrderBase.ts'), 'utf8');
    expect(hook).toContain('if (cart.length > 0)');
    expect(hook).toContain('isOpenOrder: true');
    expect(hook).toContain('buildReceiptHtml(openOrderReceipt, effSettings, lang, isAr, { authorize: false })');
    expect(printing).toContain('options?: { authorize?: boolean }');
    expect(printing).toContain('حساب مبدئي – غير مدفوع');
  });

  it('keeps the existing single-print and manager-approved reprint authorization', () => {
    expect(printing).toContain("supabase.rpc('authorize_sale_print'");
    expect(printing).toContain("initial.error !== 'MANAGER_APPROVAL_REQUIRED'");
    expect(printing).toContain("p_action_type: 'reprint'");
    expect(printing).toContain("supabase.rpc('record_sale_print'");
  });
});
