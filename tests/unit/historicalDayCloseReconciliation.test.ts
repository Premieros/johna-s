import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260923221500_historical_day_close_reconciliation_metadata.sql',
  'utf8',
).replace(/\r\n/g, '\n');

const service = readFileSync(
  'src/features/trade/services/dayClosingReport.ts',
  'utf8',
).replace(/\r\n/g, '\n');

describe('historical day-close reconciliation metadata', () => {
  it('keeps immutable snapshots but exposes normalized cash deltas', () => {
    expect(migration).toContain("'historical_reconciled'");
    expect(migration).toContain("'snapshot_cash_expenses'");
    expect(migration).toContain("'snapshot_cash_after_outflows'");
    expect(migration).toContain("'reconciliation_cash_expense_delta'");
    expect(migration).toContain("'reconciliation_cash_after_delta'");
  });

  it('shows reconciliation explicitly in the day-close report', () => {
    expect(service).toContain('historicalReconciled');
    expect(service).toContain('تمت مصالحة هذا الإغلاق التاريخي مع حركة الخزنة الفعلية.');
    expect(service).toContain('snapshotCashExpenses');
    expect(service).toContain('snapshotCashAfterOutflows');
  });
});
