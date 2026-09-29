import { supabase } from '@/api';

export type ExpenseAccountOption = {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
};

export type TreasuryOption = {
  id: string;
  branch_id?: string;
  account_name: string;
  account_type: string;
  scope?: 'branch' | 'organization';
  kind?: 'branch_cash' | 'main_cash' | 'bank';
};

export async function fetchExpensePostingOptions(branchId: string): Promise<{
  expenseAccounts: ExpenseAccountOption[];
  treasuryAccounts: TreasuryOption[];
}> {
  const [accountsRes, treasuryRes] = await Promise.all([
    supabase
      .from('chart_of_accounts')
      .select('id,code,name,name_en')
      .eq('branch_id', branchId)
      .eq('account_type', 'expense')
      .eq('is_active', true)
      .order('code'),
    supabase.rpc('get_accessible_treasury_accounts', { p_branch_id: branchId }),
  ]);

  return {
    expenseAccounts: (accountsRes.data as ExpenseAccountOption[] | null) || [],
    treasuryAccounts: ((treasuryRes.data as TreasuryOption[] | null) || []).filter(
      (account) => account.scope === 'organization' || account.branch_id === branchId,
    ),
  };
}
