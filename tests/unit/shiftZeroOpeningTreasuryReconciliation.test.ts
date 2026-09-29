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
const historicalSequenceMigration = fs.readFileSync(
  'supabase/migrations/20260927215500_treasury_historical_opening_sequence.sql',
  'utf8',
);
const handoverMigration = fs.readFileSync(\n  'supabase/migrations/20260929233500_cash_handover_single_source_reconciliation.sql',\n  'utf8',\n);\nconst migration = `${baseMigration}\\n${reconciliationMigration}\\n${historicalSequenceMigration}\\n${handoverMigration}`;
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
    expect(treasuryPage).toContain('يومية الخزينة');
    expect(treasuryPage).toContain("isAr ? 'نقدي مرحّل' : 'Cash carried'");
    expect(treasuryPage).toContain("isAr ? 'بنك مرحّل' : 'Bank carried'");
    expect(treasuryPage).toContain("isAr ? 'إجمالي آخر اليوم' : 'Day closing total'");
    expect(treasuryPage).toContain("isAr ? 'تفاصيل' : 'Details'");
    expect(treasuryPage).toContain("isAr ? 'تقرير' : 'Report'");
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
      'نقدي مرحّل',
      'بنك مرحّل',
      'بيع نقدي',
      'بيع بنك/كارت',
      'آجل',
      'مصروفات',
      'مشتريات',
      'تحويل وارد',
      'تحويل صادر',
      'صافي نقدي الشفتات',\n      'حركات نقدية خارج الشفتات',\n      'صافي نقدي اليوم',\n      'رصيد نقدي فعلي',
      'رصيد بنك فعلي',
      'إجمالي آخر اليوم',
      'تفاصيل',
      'تقرير',
    ]) {
      expect(treasuryPage).toContain(label);
    }
    expect(treasuryPage).toContain('dayCloses.map((row)');
    expect(treasuryPage).not.toContain('row.movement_details.map((movement)');
  });

  it('uses the canonical server opening/day/closing sequence instead of browser reconstruction', () => {
    expect(treasuryPage).toContain('opening_balance: Number(row.opening_balance || 0)');
    expect(treasuryPage).toContain('day_net: Number(row.day_net || 0)');
    expect(treasuryPage).toContain('closing_balance: Number(row.closing_balance || 0)');
    expect(treasuryPage).not.toContain('const previousClose = dayCloses[index + 1]');
    expect(treasuryPage).not.toContain('const closingBalance = row.is_latest');
  });

  it('offers branch and main treasury movement views without changing the day-report action', () => {
    expect(treasuryPage).toContain("type TreasuryScopeView = 'branch' | 'main'");
    expect(treasuryPage).toContain('خزنة الفرع');
    expect(treasuryPage).toContain('الخزنة الرئيسية');
    expect(treasuryPage).toContain('حركة الخزنة الرئيسية');
    expect(treasuryPage).toContain('fetchDayClosingReportServer(effectiveBranchFilter, row.business_date)');
  });
});


describe('treasury historical opening sequence contract', () => {
  it('anchors historical imports by source sale date and folds pre-anchor treasury activity into the first row', () => {
    expect(historicalSequenceMigration).toContain("AT TIME ZONE 'Africa/Cairo'");
    expect(historicalSequenceMigration).toContain("s.invoice_number LIKE 'HIST-%'");
    expect(historicalSequenceMigration).toContain("s.invoice_number LIKE 'IMP-%HIST%'");
    expect(historicalSequenceMigration).toContain('GREATEST(ab.resolved_date, v_start_date)');
  });

  it('builds a continuous daily carry-forward from opening to closing balance', () => {
    expect(historicalSequenceMigration).toContain('cash_opening_balance');
    expect(historicalSequenceMigration).toContain('bank_opening_balance');
    expect(historicalSequenceMigration).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING');
    expect(historicalSequenceMigration).toContain('ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
    expect(historicalSequenceMigration).toContain("'opening_balance'");
    expect(historicalSequenceMigration).toContain("'closing_balance'");
  });

  it('is read-only and preserves the existing permission boundary', () => {
    expect(historicalSequenceMigration).toContain("public.can_permission('accounts.view')");
    expect(historicalSequenceMigration).toContain("public.can_permission('reports.view')");
    expect(historicalSequenceMigration).not.toContain('INSERT INTO ');
    expect(historicalSequenceMigration).not.toContain('UPDATE public.');
    expect(historicalSequenceMigration).not.toContain('DELETE FROM ');
  });
});


describe('treasury UUID aggregate regression', () => {
  const uuidFixMigration = fs.readFileSync(
    'supabase/migrations/20260927224500_fix_treasury_sequence_uuid_aggregate.sql',
    'utf8',
  );

  it('never applies min directly to UUID reference ids', () => {
    expect(uuidFixMigration).toContain('min(a.reference_id::text)::uuid AS reference_id');
    expect(uuidFixMigration).not.toContain('min(a.reference_id) AS reference_id');
  });
});


describe('treasury transfer visibility and main bank contract', () => {
  const transferMigration = fs.readFileSync(
    'supabase/migrations/20260927233000_treasury_transfer_visibility_main_bank.sql',
    'utf8',
  );

  it('creates an organization-scoped main bank without touching branch bank accounts', () => {
    expect(transferMigration).toContain("'1030', 'البنك الرئيسي', 'Main Bank'");
    expect(transferMigration).toContain("'bank', 'البنك الرئيسي', 'organization', 'bank'");
    expect(transferMigration).toContain('uq_treasury_main_bank_org');
  });

  it('exposes incoming and outgoing treasury transfers per business day', () => {
    expect(transferMigration).toContain("'transfer_in'");
    expect(transferMigration).toContain("'transfer_out'");
    expect(treasuryPage).toContain("isAr ? 'تحويل وارد' : 'Transfer in'");
    expect(treasuryPage).toContain("isAr ? 'تحويل صادر' : 'Transfer out'");
  });

  it('shows all organization treasury accounts in the main treasury view', () => {
    expect(treasuryPage).toContain("balances.filter((b) => b.scope === 'organization')");
    expect(treasuryPage).toContain('mainTreasuryAccounts');
    expect(treasuryPage).toContain("from_account_id.in.(");
    expect(treasuryPage).toContain("to_account_id.in.(");
  });
});


describe('treasury daily journal configurable columns', () => {
  it('shows carried cash/bank, actual cash/bank and lets the user choose visible columns', () => {
    expect(treasuryPage).toContain("isAr ? 'يومية الخزينة' : 'Treasury Daily Journal'");
    expect(treasuryPage).toContain("isAr ? 'نقدي مرحّل' : 'Cash carried'");
    expect(treasuryPage).toContain("isAr ? 'بنك مرحّل' : 'Bank carried'");
    expect(treasuryPage).toContain("isAr ? 'بيع نقدي' : 'Cash sales'");
    expect(treasuryPage).toContain("isAr ? 'بيع بنك/كارت' : 'Bank/Card sales'");
    expect(treasuryPage).toContain("isAr ? 'رصيد نقدي فعلي' : 'Actual cash balance'");
    expect(treasuryPage).toContain("isAr ? 'رصيد بنك فعلي' : 'Actual bank balance'");
    expect(treasuryPage).toContain("isAr ? 'تحديد الأعمدة' : 'Choose columns'");
    expect(treasuryPage).toContain("treasury.dailyJournal.columns.v2");\n    expect(treasuryPage).toContain("isAr ? 'صافي نقدي الشفتات' : 'Shift cash net'");\n    expect(treasuryPage).toContain("isAr ? 'حركات نقدية خارج الشفتات' : 'Cash outside shifts'");\n    expect(treasuryPage).toContain("isAr ? 'صافي نقدي اليوم' : 'Daily cash net'");
  });
});


describe('treasury journal totals and inline day detail', () => {
  it('shows period totals and inline day breakdown without extra accounting writes', () => {
    expect(treasuryPage).toContain("isAr ? 'إجمالي بيع نقدي' : 'Cash sales total'");
    expect(treasuryPage).toContain("isAr ? 'إجمالي بيع بنك/كارت' : 'Bank/Card sales total'");
    expect(treasuryPage).toContain("isAr ? 'تفاصيل يوم' : 'Day details'");
    expect(treasuryPage).toContain("isAr ? 'البيع والتحصيل' : 'Sales & collection'");
    expect(treasuryPage).toContain("isAr ? 'المنصرف والتحويلات' : 'Outflows & transfers'");
  });
});


describe('cash handover single-source reconciliation', () => {
  it('recalculates shift handover from the canonical shift calculator', () => {
    expect(handoverMigration).toContain('public._compute_shift_expected_cash(sh.id)');
    expect(handoverMigration).toContain("'shift_cash_net'");
  });

  it('makes daily cash net the exact treasury cash movement and exposes outside-shift differences', () => {
    expect(handoverMigration).toContain("'cash_day_net', round(l.cash_effect, 2)");
    expect(handoverMigration).toContain("'cash_outside_shifts', round(l.cash_effect - l.shift_cash_net, 2)");
    expect(handoverMigration).toContain('cash_closing_balance');
    expect(treasuryPage).toContain('cash_day_net: Number(row.cash_day_net || 0)');
  });

  it('keeps the reconciliation read-only', () => {
    expect(handoverMigration).not.toContain('INSERT INTO public.journal_entries');
    expect(handoverMigration).not.toContain('UPDATE public.shifts');
    expect(handoverMigration).not.toContain('DELETE FROM ');
  });
});
