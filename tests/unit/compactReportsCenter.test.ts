import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const center = readFileSync('src/features/reporting/pages/ReportsCenterPage.tsx', 'utf8');
const sales = readFileSync('src/features/reporting/pages/ReportsPage.tsx', 'utf8');

describe('compact reports center', () => {
  it('uses seven primary reports with one view selector', () => {
    expect(center).not.toContain('ReportCard');
    expect(center).not.toContain('ReportingShell');
    expect(center).toContain('data-report-primary');
    expect(center).toContain('Report view');
  });

  it('keeps financial and operational reports in the same list surface', () => {
    expect(center).toContain('permittedBasicReports');
    expect(center).toContain('view.financial');
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
