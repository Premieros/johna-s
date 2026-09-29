import { supabase } from '@/api';
import type { TreasuryAccount } from '@/lib/types';

export async function fetchActiveTreasuryAccounts(branchId: string): Promise<TreasuryAccount[]> {
  const { data } = await supabase
    .from('treasury_accounts')
    .select('*')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('account_type');

  return (data as TreasuryAccount[] | null) || [];
}
