import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('Z-report cashier routing + tender detail contract', () => {
  it('queues thermal Z-reports to the cashier station through the durable cloud queue', () => {
    const migration = read('supabase/migrations/20260918162000_financial_day_tenders_zreport_cashier.sql');
    const page = read('src/features/trade/pages/ShiftsPage.tsx');
    const cloud = read('src/features/pos/services/cloudPrint.ts');

    expect(migration).toContain("kind IN ('kitchen','receipt','test','report')");
    expect(migration).toContain("'report','cashier'");
    expect(migration).toContain("public.can_permission('shifts.report.shift')");
    expect(page).toContain('enqueueCloudReportPrint');
    expect(page).toContain('تم إرسال Z-Report إلى محطة طباعة الكاشير');
    expect(cloud).toContain("kind: 'kitchen' | 'receipt' | 'test' | 'report'");
    expect(cloud).toContain("supabase.rpc('enqueue_cloud_report_print'");
  });

  it('uses actual sale tender rows and renders each tender per invoice', () => {
    const migration = read('supabase/migrations/20260918162000_financial_day_tenders_zreport_cashier.sql');
    const financials = read('src/features/trade/services/shiftClosingFinancials.ts');
    const report = read('src/features/trade/services/shiftClosingReport.ts');

    expect(migration).toContain('FROM public.sale_payments sp');
    expect(migration).toContain("'payments'");
    expect(financials).toContain("supabase.rpc('get_shift_sale_tenders'");
    expect(financials).toContain('tenderBySale');
    expect(report).toContain('sale.payments.map');
    expect(report).toContain('الفواتير وطرق الدفع');
    expect(report).toContain('الفواتير ودفعات كل فاتورة');
  });
});
