import { describe, expect, it } from 'vitest';
import {
  buildEmployeeReceivablePeriod,
  createCurrentMonthEmployeeReceivablePeriod,
  getEmployeeReceivableMinimumDate,
  type EmployeeReceivableStatementRow,
} from '@/features/accounting/services/employeeReceivablePeriod';

const row = (
  id: string,
  date: string,
  kind: EmployeeReceivableStatementRow['kind'],
  debit: number,
  credit: number,
): EmployeeReceivableStatementRow => ({
  id,
  occurred_at: `${date}T12:00:00+03:00`,
  kind,
  reference: id,
  description: id,
  source: null,
  debit,
  credit,
  balance: 0,
});

describe('employee receivables period view', () => {
  it('defaults to the current month while respecting the available history window', () => {
    expect(createCurrentMonthEmployeeReceivablePeriod('2026-11-02', '2026-10-27')).toEqual({
      from: '2026-11-01',
      to: '2026-11-02',
    });
    expect(createCurrentMonthEmployeeReceivablePeriod('2026-11-02', '2026-11-01')).toEqual({
      from: '2026-11-01',
      to: '2026-11-02',
    });
  });

  it('keeps the opening-balance cutover and seven-day history boundary', () => {
    expect(getEmployeeReceivableMinimumDate('2026-11-02', '2026-09-16', false)).toBe('2026-10-27');
    expect(getEmployeeReceivableMinimumDate('2026-11-02', '2026-09-16', true)).toBe('2026-09-16');
    expect(getEmployeeReceivableMinimumDate('2026-09-20', '2026-09-16', false)).toBe('2026-09-16');
  });

  it('calculates opening, debit, credit and closing only for the selected period', () => {
    const allRows = [
      row('opening', '2026-09-16', 'opening', 0, 0),
      { ...row('before-sale', '2026-10-29', 'sale', 20, 0), balance: 100 },
      row('before-payment', '2026-10-30', 'payment', 0, 5),
      row('period-sale', '2026-11-01', 'sale', 30, 0),
      row('period-payment', '2026-11-02', 'payment', 0, 10),
      row('after-sale', '2026-11-03', 'sale', 50, 0),
    ];

    const result = buildEmployeeReceivablePeriod(allRows, {
      from: '2026-11-01',
      to: '2026-11-02',
    });

    expect(result.openingBalance).toBe(115);
    expect(result.debit).toBe(30);
    expect(result.credit).toBe(10);
    expect(result.closingBalance).toBe(135);
    expect(result.rows.map((item) => item.id)).toEqual([
      'period-opening-2026-11-01',
      'period-sale',
      'period-payment',
    ]);
    expect(result.rows.map((item) => item.balance)).toEqual([115, 145, 135]);
  });

  it('includes both endpoints and shows no future movements', () => {
    const result = buildEmployeeReceivablePeriod([
      { ...row('opening', '2026-09-16', 'opening', 0, 0), balance: 25 },
      row('from', '2026-11-01', 'sale', 10, 0),
      row('to', '2026-11-02', 'payment', 0, 5),
      row('future', '2026-11-03', 'sale', 100, 0),
    ], { from: '2026-11-01', to: '2026-11-02' });

    expect(result.openingBalance).toBe(25);
    expect(result.debit).toBe(10);
    expect(result.credit).toBe(5);
    expect(result.closingBalance).toBe(30);
    expect(result.rows).toHaveLength(3);
  });
});
