import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');
const dashboard = read('src/features/dashboard/pages/DashboardDataPage.tsx');
const customers = read('src/features/parties/pages/CustomersPage.tsx');
const suppliers = read('src/features/parties/pages/SuppliersPage.tsx');
const sql = read('supabase/migrations/20261119153000_income_statement_branches_set_based.sql');

describe('100-branch read scalability safeguards', () => {
  it('uses one set-based RPC for all authorized dashboard branches', () => {
    expect(dashboard).toContain('getIncomeStatementBranches({');
    expect(dashboard).toContain('p_branch_ids: targetBranches.map((branch) => branch.id)');
    expect(dashboard).toContain('INCOMPLETE_BRANCH_FINANCIAL_SUMMARY');
    expect(dashboard).not.toContain('Promise.all(targetBranches.map((branch) => reporting.getIncomeStatement');
  });

  it('does not fire one AR/AP aging RPC for each branch in customer and supplier lists', () => {
    expect(customers).toContain('getPartyOpenBalancesBranches({');
    expect(suppliers).toContain('getPartyOpenBalancesBranches({');
    expect(customers).not.toContain('branchIds.map((branchId) => api.accounting.getArAging');
    expect(suppliers).not.toContain('branchIds.map((branchId) => api.accounting.getApAging');
    expect(sql).toContain('JOIN scope b ON b.id');
  });

  it('checks every requested branch and keeps invoker permissions and date history rules', () => {
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('public.user_may_access_branch(b.id)');
    expect(sql).toContain('public.history_clamp_from(p_from_date)');
    expect(sql).toContain('public.history_clamp_to(p_to_date)');
    expect(sql).toContain('public.history_clamp_as_of(p_as_of)');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_income_statement_branches');
  });
});
