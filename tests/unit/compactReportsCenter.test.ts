import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const center = readFileSync('src/features/reporting/pages/ReportsCenterPage.tsx', 'utf8');
const sales = readFileSync('src/features/reporting/pages/ReportsPage.tsx', 'utf8');

describe('compact reports center', () => {
  it('uses one compact unified row list instead of report cards', () => {
    expect(center).not.toContain('ReportCard');
    expect(center).not.toContain('ReportingShell');
    expect(center).toContain('max-h-[calc(100vh-12rem)]');
    expect(center).toContain('min-h-9 w-full items-center border-b');
  });

  it('keeps financial and operational reports in the same list surface', () => {
    expect(center).toContain('filteredOperational.map');
    expect(center).toContain('filteredFinancial.map');
    expect(center).toContain('FinancialReportsPage hideViewPicker');
  });

  it('makes the sales report a broad master invoice report', () => {
    for (const label of [
      'قبل الخصم والضريبة',
      'الخصم',
      'الضريبة',
      'إجمالي الفاتورة',
      'المدفوع',
      'المرتجع',
      'صافي التحصيل',
      'طريقة الدفع',
      'المستخدم',
      'المخزن',
    ]) {
      expect(sales).toContain(label);
    }
  });
});
