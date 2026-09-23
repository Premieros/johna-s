import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260923213000_core_reports_statements.sql',
  'utf8',
).replace(/\r\n/g, '\n');

const page = readFileSync(
  'src/features/accounting/pages/FinancialReportsPage.tsx',
  'utf8',
).replace(/\r\n/g, '\n');

describe('core reports reconciliation contract', () => {
  it('keeps day-close drawer expenses aligned with branch cash only', () => {
    expect(migration).toContain('private.normalize_day_close_cash');
    expect(migration).toContain('private.treasury_affects_shift_cash(e.treasury_account_id,e.branch_id)');
    expect(migration).toContain("'cash_source_rule','branch_cash_only'");
    expect(migration).toContain("v_report:=private.normalize_day_close_cash");
  });

  it('builds treasury summaries from journal truth rather than treasury transfer rows only', () => {
    const cashFlow = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.get_cash_flow'));
    expect(cashFlow).toContain('public.journal_entry_lines');
    expect(cashFlow).toContain('public.journal_entries');
    expect(cashFlow).not.toContain('public.treasury_transactions');
  });

  it('does not present the legacy cash-flow label as a standalone cash-flow statement', () => {
    expect(page).toContain("ملخص حركة الخزائن والبنوك");
    expect(page).toContain('Treasury & Bank Movement Summary');
  });
});
