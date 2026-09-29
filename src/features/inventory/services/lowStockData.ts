import { supabase } from '@/api';
import type { Supplier, Warehouse } from '@/lib/types';

export type LowStockBranchOption = {
  id: string;
  name: string;
};

export type RawMaterialReorderRow = {
  raw_material_id: string;
  quantity: number;
  min_stock: number;
  raw_material: {
    id: string;
    name: string;
    code: string | null;
    min_stock: number;
    default_cost: number;
    is_active: boolean;
    unit: { name: string } | null;
  } | null;
};

export async function loadLowStockOptions(): Promise<{
  branches: LowStockBranchOption[];
  warehouses: Warehouse[];
  suppliers: Supplier[];
  branchError: Error | null;
}> {
  const [branchesRes, warehousesRes, suppliersRes] = await Promise.all([
    supabase.from('branches').select('id, name').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
    supabase.from('suppliers').select('*').order('name'),
  ]);

  return {
    branches: (branchesRes.data as LowStockBranchOption[] | null) || [],
    warehouses: (warehousesRes.data as Warehouse[] | null) || [],
    suppliers: (suppliersRes.data as Supplier[] | null) || [],
    branchError: branchesRes.error ? new Error(branchesRes.error.message) : null,
  };
}

export async function loadRawMaterialReorderRows(branchId: string): Promise<RawMaterialReorderRow[]> {
  const { data } = await supabase
    .from('raw_material_inventory')
    .select('raw_material_id, quantity, min_stock, raw_material:raw_materials(id, name, code, min_stock, default_cost, is_active, unit:units(name))')
    .eq('branch_id', branchId);

  return ((data || []) as unknown as RawMaterialReorderRow[]);
}

export async function loadProductCostMap(productIds: string[]): Promise<Record<string, number>> {
  if (productIds.length === 0) return {};

  const { data } = await supabase
    .from('products')
    .select('id, cost_price')
    .in('id', productIds);

  const costMap: Record<string, number> = {};
  for (const row of (data as { id: string; cost_price: number }[] | null) || []) {
    costMap[row.id] = Number(row.cost_price) || 0;
  }
  return costMap;
}
