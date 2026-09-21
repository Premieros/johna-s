import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const salesPage = readFileSync('src/features/trade/pages/SalesPage.tsx', 'utf8');
const printing = readFileSync('src/features/pos/utils/printing.ts', 'utf8');

describe('sales invoice refund / preview / reprint contract', () => {
  it('keeps invoice preview non-authorizing and reprint on the existing protected receipt path', () => {
    expect(salesPage).toContain("buildReceiptHtml(");
    expect(salesPage).toContain("{ authorize: false }");
    expect(salesPage).toContain("openPrintWindow(html, APPROVED_FIXED_THERMAL_WIDTH_MM)");
    expect(salesPage).toContain("ReceiptPrintApprovalError");
    expect(salesPage).toContain("err.code === 'REPRINT_APPROVAL_PENDING'");
    expect(salesPage).toContain("can('pos.receipt.print')");
    expect(salesPage).toContain("can('pos.reprint')");
  });

  it('starts refund quantities at zero and requires an explicit full-refund action', () => {
    expect(salesPage).toContain("qty[item.id] = '0'");
    expect(salesPage).toContain('const fillFullRefund = () =>');
    expect(salesPage).toContain('Math.max(0, item.quantity - (item.refunded_quantity || 0))');
    expect(salesPage).toContain("إرجاع الفاتورة بالكامل");
    expect(salesPage).toContain('disabled={refunding || refundTotal() <= 0}');
  });

  it('uses the existing processRefund workflow for both item and full invoice refunds', () => {
    expect(salesPage).toContain('api.trade.processRefund({');
    expect(salesPage).toContain('p_sale_id: refundSale.id');
    expect(salesPage).toContain('p_items,');
    expect(salesPage).toContain("p_action_type: 'refund'");
    expect(salesPage).toContain("can('sales.refund.create')");
    expect(salesPage).toContain("can('refunds.approve')");
  });

  it('renders refund preview in the same receipt renderer without payment or print side effects', () => {
    expect(salesPage).toContain("documentTitle: isAr ? 'معاينة المرتجع' : 'REFUND PREVIEW'");
    expect(salesPage).toContain('hidePaymentSummary: true');
    expect(salesPage).toContain('srcDoc={receiptPreviewHtml}');
    expect(printing).toContain('documentTitle?: string');
    expect(printing).toContain('hidePaymentSummary?: boolean');
    expect(printing).toContain('!receipt.hidePaymentSummary');
  });

  it('gates editing by canonical permissions instead of UI role labels', () => {
    expect(salesPage).toContain("can('sales.payment.receive')");
    expect(salesPage).toContain("can('refunds.approve')");
    expect(salesPage).not.toContain('user?.role');
    expect(salesPage).not.toContain('useAuth');
  });
});
