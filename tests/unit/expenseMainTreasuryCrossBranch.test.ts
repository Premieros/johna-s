import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const service = fs.readFileSync('src/features/trade/services/expenseOptions.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260930002500_expense_main_treasury_cross_branch.sql', 'utf8');

describe('expense main treasury cross-branch contract', () => {
  it('loads authorized organization treasury sources instead of branch-only filtering', () => {
    expect(service).toContain("supabase.rpc('get_accessible_treasury_accounts'");
    expect(service).toContain("account.scope === 'organization' || account.branch_id === branchId");
    expect(service).not.toContain(".from('treasury_accounts')\n      .select('id,account_name,account_type')\n      .eq('branch_id', branchId)");
  });

  it('requires explicit main-treasury permission for organization funding', () => {
    expect(migration).toContain("accounting.treasury.main_cash.pay");
    expect(migration).toContain("MAIN_TREASURY_PAYMENT_PERMISSION_REQUIRED");
    expect(migration).toContain("TREASURY_ORGANIZATION_MISMATCH");
  });

  it('uses clearing entries when the expense branch differs from the funding treasury branch', () => {
    expect(migration).toContain("'treasury_clearing'");
    expect(migration).toContain("'expense_funding'");
    expect(migration).toContain("'expense_funding_reversal'");
  });

  it('does not charge the employee drawer when the main treasury funds the expense', () => {
    expect(migration).toContain('private.treasury_affects_shift_cash(p_treasury_account_id, p_branch_id)');
    expect(migration).toContain('IF v_affects_shift_cash THEN');
  });
});
