import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const baseMigration = fs.readFileSync(
  'supabase/migrations/20260926083000_shift_zero_opening_negative_close_treasury_reconciliation.sql',
  'utf8',
);
const reconciliationMigration = fs.readFileSync(
  'supabase/migrations/20260926133500_treasury_day_close_movement_reconciliation.sql',
  'utf8',
);
const migration = `${baseMigration}\n${reconciliationMigration}`;
const shiftsPage = fs.readFileSync('src/features/trade/pages/ShiftsPage.tsx', 'utf8');
const shiftModal = fs.readFileSync('src/features/pos/components/shift/ShiftModal.tsx', 'utf8');
const treasuryPage = fs.readFileSync('src/features/accounting/pages/TreasuryPage.tsx', 'utf8');

describe('shift zero-opening and treasury reconciliation contract', () => {
  it('forces every newly opened shift to zero opening', () => {
    expect(migration).toContain("VALUES (p_branch_id, v_uid, 0, p_notes)");
    expect(migration).toContain("v_shift_id, 'opening', 0, 'cash'");
    expect(shiftsPage).toContain('p_opening_amount: 0');
    expect(shiftsPage).toContain('رصيد بداية الشفت ثابت = 0');
  });

  it('removes the historical ban on negative expected and actual shift balances', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS shifts_nonnegative_amounts');
    expect(migration).toContain('CHECK (opening_amount >= 0)');
    expect(migration).not.toContain('expected_amount >= 0');
    expect(migration).not.toContain('actual_amount >= 0');
    expect(shiftModal).not.toContain('min={0}\n                  step="any"');
    expect(shiftsPage).toContain('صافي رصيد الشفت الفعلي (يسمح بالسالب)');
  });

  it('adds read-only day-close reconciliation without inserting accounting movement rows', () => {
    expect(migration).toContain('get_branch_treasury_day_close_reconciliation');
    expect(migration).toContain('FROM public.daily_closes dc');
    expect(migration).toContain('FROM public.journal_entry_lines l');
    expect(migration).not.toContain('INSERT INTO public.treasury_transactions');
    expect(migration).not.toContain('INSERT INTO public.journal_entries');
    expect(treasuryPage).toContain('ملخص الخزنة اليومي');
    expect(treasuryPage).toContain("isAr ? 'رصيد أول' : 'Opening'");
    expect(treasuryPage).toContain("isAr ? 'رصيد آخر' : 'Closing'");
    expect(treasuryPage).toContain("isAr ? 'تقرير اليوم' : 'Day report'");
  });

  it('shows close balances, post-close movement, and the reconciled balance after movement', () => {
    for (const field of [
      'cash_balance_after_close',
      'bank_balance_after_close',
      'total_balance_after_close',
      'cash_movement_after_close',
      'bank_movement_after_close',
      'total_movement_after_close',
      'cash_balance_after_movement',
      'bank_balance_after_movement',
      'total_balance_after_movement',
      'movement_details',
    ]) {
      expect(migration).toContain(field);
      expect(treasuryPage).toContain(field);
    }
  });
});


describe('treasury daily single-row UI contract', () => {
  it('renders one compact financial row per business day with the approved columns', () => {
    for (const label of [
      'رصيد أول',
      'المبيعات',
      'الآجل',
      'المصروفات',
      'المشتريات',
      'صافي اليوم',
      'كاش',
      'بنك',
      'رصيد آخر',
      'تقرير اليوم',
    ]) {
      expect(treasuryPage).toContain(label);
    }
    expect(treasuryPage).toContain('dayCloses.map((row, index)');
    expect(treasuryPage).not.toContain('row.movement_details.map((movement)');
  });

  it('keeps the latest closing balance tied to the live branch treasury balance', () => {
    expect(treasuryPage).toContain("const closingBalance = row.is_latest");
    expect(treasuryPage).toContain('totalCash + totalBank');
    expect(treasuryPage).toContain('closing_balance: closingBalance');
  });

  it('offers branch and main treasury movement views without changing the day-report action', () => {
    expect(treasuryPage).toContain("type TreasuryScopeView = 'branch' | 'main'");
    expect(treasuryPage).toContain('خزنة الفرع');
    expect(treasuryPage).toContain('الخزنة الرئيسية');
    expect(treasuryPage).toContain('حركة الخزنة الرئيسية');
    expect(treasuryPage).toContain('fetchDayClosingReportServer(effectiveBranchFilter, row.business_date)');
  });
});
