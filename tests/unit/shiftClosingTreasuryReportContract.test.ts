import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  averageShiftTicket,
  summarizeExpenseSources,
  summarizeShiftPayments,
} from '../../src/features/trade/services/shiftClosingReportMath';

describe('shift closing treasury presentation math', () => {
  it('keeps customer credit outside collected payments', () => {
    const summary = summarizeShiftPayments([
      { method: 'cash', label: 'Cash', count: 13, total: 3694 },
      { method: 'card', label: 'Card', count: 20, total: 9375 },
      { method: 'credit', label: 'Credit', count: 3, total: 352 },
    ]);

    expect(summary.collectedTotal).toBe(13069);
    expect(summary.receivableTotal).toBe(352);
    expect(summary.collected.map((row) => row.method)).toEqual(['cash', 'card']);
    expect(summary.receivables.map((row) => row.method)).toEqual(['credit']);
  });

  it('calculates average ticket from net sales before expenses', () => {
    expect(averageShiftTicket(13421, 35)).toBeCloseTo(383.4571428571, 8);
  });

  it('keeps main-treasury expenses outside the cashier drawer', () => {
    expect(summarizeExpenseSources(2000, [])).toEqual({
      drawerExpenses: 0,
      nonDrawerExpenses: 2000,
      drawerExpenseIds: [],
    });
  });

  it('identifies only cash expense operations as drawer expenses', () => {
    const result = summarizeExpenseSources(1000, [
      {
        operation_type: 'expense',
        payment_method: 'cash',
        reference_type: 'expense',
        reference_id: 'drawer-expense',
        amount: 250,
      },
      {
        operation_type: 'cash_out',
        payment_method: 'card',
        reference_type: 'expense',
        reference_id: 'bank-expense',
        amount: 100,
      },
    ]);

    expect(result).toEqual({
      drawerExpenses: 250,
      nonDrawerExpenses: 750,
      drawerExpenseIds: ['drawer-expense'],
    });
  });

  it('nets a reversed drawer expense back out of drawer-expense totals', () => {
    const result = summarizeExpenseSources(250, [
      {
        operation_type: 'expense',
        payment_method: 'cash',
        reference_type: 'expense',
        reference_id: 'reversed-expense',
        amount: 1000,
      },
      {
        operation_type: 'cash_in',
        payment_method: 'cash',
        reference_type: 'expense_reversal',
        reference_id: 'reversed-expense',
        amount: 1000,
      },
      {
        operation_type: 'expense',
        payment_method: 'cash',
        reference_type: 'expense',
        reference_id: 'active-expense',
        amount: 250,
      },
    ]);

    expect(result).toEqual({
      drawerExpenses: 250,
      nonDrawerExpenses: 0,
      drawerExpenseIds: ['active-expense'],
    });
  });
});

describe('shift closing report integration contract', () => {
  const financials = fs.readFileSync('src/features/trade/services/shiftClosingFinancials.ts', 'utf8');
  const report = fs.readFileSync('src/features/trade/services/shiftClosingReport.ts', 'utf8');

  it('uses shift operations for drawer-expense truth and net sales for average ticket', () => {
    expect(financials).toContain(".from('shift_operations')");
    expect(financials).toContain('summarizeExpenseSources(totalExpenses, shiftOperations)');
    expect(financials).toContain('avgTicket: averageShiftTicket(Number(raw.net_sales || 0)');
  });

  it('separates collected tenders, receivables and non-drawer expenses in A4 and thermal output', () => {
    expect(report).toContain('summarizeShiftPayments(summary.paymentMethods)');
    expect(report).toContain('إجمالي المحصل فعليًا');
    expect(report).toContain('آجل / ذمم غير محصلة');
    expect(report).toContain('مصروفات من درج الوردية');
    expect(report).toContain('مصروفات خارج الدرج');
    expect(report).toContain('صافي بعد المصروفات');
  });
});
