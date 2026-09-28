import { supabase } from '@/api';
import type { ChartOfAccount } from '@/lib/types';

export async function fetchActiveJournalAccounts(branchId: string): Promise<ChartOfAccount[]> {
  const { data } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name, name_en')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('code');

  return (data as ChartOfAccount[] | null) || [];
}
