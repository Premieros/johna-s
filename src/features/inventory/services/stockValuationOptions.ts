import { supabase } from '@/api';
import type { Warehouse } from '@/lib/types';

export type StockValuationBranchOption = {
  id: string;
  name: string;
};

export type StockValuationOptions = {
  branches: StockValuationBranchOption[];
  warehouses: Warehouse[];
};

export async function fetchStockValuationOptions(): Promise<StockValuationOptions> {
  const [branchesRes, warehousesRes] = await Promise.all([
    supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
  ]);

  if (branchesRes.error) throw branchesRes.error;
  if (warehousesRes.error) throw warehousesRes.error;

  return {
    branches: (branchesRes.data as StockValuationBranchOption[] | null) || [],
    warehouses: (warehousesRes.data as Warehouse[] | null) || [],
  };
}
