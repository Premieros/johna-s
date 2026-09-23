import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260923170000_finance_treasury_model_and_query_stabilization.sql',
  'utf8',
);
const payments = fs.readFileSync(
  'src/features/accounting/pages/PaymentsPage.tsx',
  'utf8',
);
const treasury = fs.readFileSync(
  'src/features/accounting/pages/TreasuryPage.tsx',
  'utf8',
);
const reports = fs.readFileSync(
  'src/features/accounting/pages/FinancialReportsPage.tsx',
  'utf8',
);
const accountingApi = fs.readFileSync(
  'src/api/domains/accounting.ts',
  'utf8',
);

describe('finance treasury model and query stabilization contract', () => {
  it('models branch cash, bank, and one organization main treasury', () => {
    expect(migration).toContain("'branch_cash'");
    expect(migration).toContain("'main_cash'");
    expect(migration).toContain("'bank'");
    expect(migration).toContain('uq_treasury_main_cash_org');
    expect(migration).toContain('uq_treasury_branch_cash');
    expect(migration).toContain("'treasury_clearing','1190'");
  });

  it('keeps legacy treasury account inserts backward compatible', () => {
    expect(migration).toContain('treasury_accounts_fill_model_defaults');
    expect(migration).toContain("WHEN NEW.account_type = 'bank' THEN 'bank'");
    expect(migration).toContain("ELSE 'branch_cash'");
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF branch_id, account_type');
  });

  it('funds supplier payments from a real locked treasury account', () => {
    expect(migration).toContain('pay_supplier_from_treasury');
    expect(migration).toContain('p_treasury_account_id uuid');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('INSUFFICIENT_TREASURY_BALANCE');
    expect(migration).toContain('treasury_account_id');
    expect(migration).toContain('treasury_transaction_id');
    expect(migration).toContain("'supplier_payment'");
    expect(accountingApi).toContain("rpc('pay_supplier_from_treasury'");
    expect(payments).toContain('p_treasury_account_id: apForm.treasury_account_id');
  });

  it('supports main/branch and cross-branch treasury transfers without revenue or expense', () => {
    expect(migration).toContain('process_treasury_transfer_v2');
    expect(migration).toContain("'treasury_transfer_out'");
    expect(migration).toContain("'treasury_transfer_in'");
    expect(migration).toContain("'treasury_clearing'");
    expect(migration).not.toContain("'other_income', round(p_amount");
    expect(migration).not.toContain("'expense_default', round(p_amount");
    expect(accountingApi).toContain("rpc('process_treasury_transfer_v2'");
    expect(treasury).toContain('processTreasuryTransferV2');
  });

  it('keeps treasury access permission-first and branch-aware', () => {
    expect(migration).toContain("public.can_permission('accounting.treasury.transfer')");
    expect(migration).toContain('public.user_may_access_branch');
    expect(migration).toContain('auth_select_organization_treasury_accounts');
    expect(migration).toContain('FROM PUBLIC, anon');
    expect(migration).toContain('TO authenticated, service_role');
  });

  it('loads only the visible payment tab', () => {
    expect(payments).toContain("enabled: !!effectiveBranchFilter && tab === 'ar'");
    expect(payments).toContain("enabled: !!effectiveBranchFilter && tab === 'ap'");
    expect(payments).toContain("if (tab === 'ar')");
    expect(payments).toContain('getAccessibleTreasuryAccounts');
  });

  it('removes the duplicate trial-balance summary request and lazy-loads helpers', () => {
    expect(reports).not.toContain('getTrialBalanceSummary(');
    expect(reports).toContain('const totals = rows.reduce');
    expect(reports).toContain("view === 'ledger'");
    expect(reports).toContain("view === 'party_statement'");
    expect(reports).toContain('getTrialBalance({');
  });

  it('evaluates trial-balance history bound once per RPC call', () => {
    const section = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.get_trial_balance'),
    );
    expect(section).toContain('history_bound AS MATERIALIZED');
    expect((section.match(/history_clamp_as_of/g) || []).length).toBe(1);
    expect(section).toContain('j.entry_date <= hb.to_date');
  });
});
