import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260926083000_shift_zero_opening_negative_close_treasury_reconciliation.sql',
  'utf8',
);
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
    expect(treasuryPage).toContain('مطابقة إغلاقات الأيام مع خزنة الفرع');
    expect(treasuryPage).toContain('لا تنشئ حركة محاسبية جديدة');
  });

  it('shows cash and bank balances after each day close plus movement since previous close', () => {
    for (const field of [
      'cash_balance_after_close',
      'bank_balance_after_close',
      'total_balance_after_close',
      'cash_movement_since_previous_close',
      'bank_movement_since_previous_close',
      'total_movement_since_previous_close',
    ]) {
      expect(migration).toContain(field);
      expect(treasuryPage).toContain(field);
    }
  });
});
