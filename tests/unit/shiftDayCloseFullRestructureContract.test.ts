import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260918043000_shift_day_close_full_restructure.sql');
const shiftReport = read('src/features/trade/services/shiftClosingReport.ts');
const dayReport = read('src/features/trade/services/dayClosingReport.ts');
const shiftsPage = read('src/features/trade/pages/ShiftsPage.tsx');
const api = read('src/api/domains/shifts.ts');

describe('full shift and day close restructuring contract', () => {
  it('uses one authoritative expected-cash equation for shift close and shift report', () => {
    expect(migration).toContain('public._compute_shift_expected_cash');
    expect(migration).toContain("operation_type IN ('refund','expense','cash_out')");
    expect(migration).toContain("e.shift_id IS NULL");
    expect(migration).toContain('v_expected:=public._compute_shift_expected_cash(p_shift_id);');
    expect(migration.match(/v_expected:=public\._compute_shift_expected_cash\(p_shift_id\);/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps full shift expense and user detail visible in closing documents', () => {
    expect(migration).toContain("'expense_details',v_expense_details");
    expect(migration).toContain("'sales_details',v_sales_details");
    expect(migration).toContain("'users',v_users");
    expect(shiftReport).toContain('summary.expenseDetails');
    expect(shiftReport).toContain('summary.userReports');
    expect(shiftReport).toContain('المصروفات بالتفصيل');
    expect(shiftReport).toContain('تفاصيل كل مستخدم');
  });

  it('subtracts cash purchases from the day close while preserving their full detail', () => {
    expect(migration).toContain("'cash_purchases',round(v_cash_purchases,2)");
    expect(migration).toContain("'net_after_expenses_and_cash_purchases'");
    expect(migration).toContain("'cash_purchase_details',v_purchases");
    expect(dayReport).toContain('Cash purchases');
    expect(dayReport).toContain('مشتريات الكاش');
    expect(dayReport).toContain('cashPurchaseDetails');
  });

  it('stores an immutable day-close snapshot and returns it after close', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS report_snapshot jsonb');
    expect(migration).toContain('v_report:=public._build_day_closing_report');
    expect(migration).toContain('report_snapshot');
    expect(migration).toContain("'snapshot',true");
  });

  it('shows FIFO raw consumption with actual and unresolved-negative costs separated', () => {
    expect(dayReport).toContain("get_raw_consumption_cost_breakdown");
    expect(dayReport).toContain("actualCost");
    expect(dayReport).toContain("estimatedCost");
    expect(dayReport).toContain("displayedCost");
    expect(dayReport).toContain("المواد الخام المستهلكة");
    expect(dayReport).toContain("السالب التقديري");
  });

  it('wires full day report and actual day close into the shifts page', () => {
    expect(api).toContain("getDayClosingReport");
    expect(api).toContain("get_day_closing_report");
    expect(shiftsPage).toContain('fetchDayClosingReportServer');
    expect(shiftsPage).toContain('api.shifts.dayClose');
    expect(shiftsPage).toContain('تقرير اليومية الكامل');
    expect(shiftsPage).toContain('إغلاق اليوم');
  });
});
