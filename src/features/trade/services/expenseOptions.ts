import { supabase } from '@/api';

export type ExpenseAccountOption = {
  id: string;
  code: string;
  name: string;
  name_en: string | null;
};

export type TreasuryOption = {
  id: string;
  account_name: string;
  account_type: string;
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
    supabase
      .from('treasury_accounts')
      .select('id,account_name,account_type')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('account_type'),
  ]);

  return {
    expenseAccounts: (accountsRes.data as ExpenseAccountOption[] | null) || [],
    treasuryAccounts: (treasuryRes.data as TreasuryOption[] | null) || [],
  };
}
