import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(p, 'utf8');

describe('history-scoped business metrics surfaces', () => {
  it('discloses limited history on reports, finance, purchases and inventory ledger', () => {
    const reports = read('src/features/reporting/pages/ReportsPage.tsx');
    const finance = read('src/features/accounting/pages/FinancialReportsPage.tsx');
    const purchases = read('src/features/trade/pages/PurchasesPage.tsx');
    const ledger = read('src/features/inventory/pages/InventoryLedgerPage.tsx');

    expect(reports).toContain('آخر 7 أيام تظهر كاملة');
    expect(reports).toContain('الإجماليات والتصدير تشمل فقط البيانات المسموح لك برؤيتها');

    expect(finance).toContain('الأرقام المالية المعروضة مقيدة بصلاحية التاريخ');
    expect(finance).toContain('إجمالي الفرع الكامل');

    expect(purchases).toContain('سجل المشتريات التاريخي مقيد حسب صلاحية العرض');
    expect(purchases).toContain('المستحق الظاهر لكل فاتورة صحيح');

    expect(ledger).toContain('آخر 7 أيام كاملة، وما قبلها حسب صلاحية العرض التاريخي');
  });
});
