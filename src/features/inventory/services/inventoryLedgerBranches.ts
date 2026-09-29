import { supabase } from '@/api';

export type InventoryLedgerBranchOption = {
  id: string;
  name: string;
};

export async function fetchActiveInventoryLedgerBranches(): Promise<InventoryLedgerBranchOption[]> {
  const { data } = await supabase
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  return (data as InventoryLedgerBranchOption[] | null) || [];
}
