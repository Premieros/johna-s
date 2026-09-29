import { supabase } from '@/api';
import type { ChartOfAccount, Customer, Supplier } from '@/lib/types';

export type TreasuryAccountOption = {
  id: string;
  account_name: string;
  kind: string;
  scope: string;
};

export type NamedOption = {
  id: string;
  name: string;
};

export async function loadLedgerAccounts(branchId: string): Promise<ChartOfAccount[]> {
  const { data } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name, name_en, account_type')
    .eq('branch_id', branchId)
    .order('code');

  return (data as ChartOfAccount[] | null) || [];
}

export async function loadTreasuryAccounts(branchId: string): Promise<TreasuryAccountOption[]> {
  const { data } = await supabase
    .from('treasury_accounts')
    .select('id, account_name, kind, scope')
    .eq('branch_id', branchId)
    .eq('is_active', true)
    .order('account_name');

  return (data as TreasuryAccountOption[] | null) || [];
}

export async function loadInventoryStatementOptions(
  branchId: string,
  itemType: 'product' | 'raw_material',
): Promise<{ items: NamedOption[]; warehouses: NamedOption[] }> {
  const table = itemType === 'product' ? 'products' : 'raw_materials';
  const [items, warehouses] = await Promise.all([
    supabase.from(table).select('id, name').eq('branch_id', branchId).eq('is_active', true).order('name'),
    supabase.from('warehouses').select('id, name').eq('branch_id', branchId).eq('is_active', true).order('name'),
  ]);

  return {
    items: (items.data as NamedOption[] | null) || [],
    warehouses: (warehouses.data as NamedOption[] | null) || [],
  };
}

export async function loadPartyStatementOptions(
  branchId: string,
  side: 'ar' | 'ap',
): Promise<Customer[] | Supplier[]> {
  if (side === 'ar') {
    const { data } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('branch_id', branchId)
      .order('name');
    return (data as Customer[] | null) || [];
  }

  const { data } = await supabase
    .from('suppliers')
    .select('id, name, phone')
    .eq('branch_id', branchId)
    .order('name');
  return (data as Supplier[] | null) || [];
}
