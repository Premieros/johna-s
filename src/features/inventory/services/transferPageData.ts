import { supabase } from '@/api';
import type { Branch, Warehouse } from '@/lib/types';

export interface TransferRawMaterialChoice {
  id: string;
  name: string;
  branch_id: string;
  unit_id: string | null;
  default_cost: number;
}

export async function loadTransferMeta(): Promise<{
  warehouses: Warehouse[];
  rawMaterials: TransferRawMaterialChoice[];
  branches: Branch[];
}> {
  const [warehousesResult, rawMaterialsResult, branchesResult] = await Promise.all([
    supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
    supabase.from('raw_materials').select('id,name,branch_id,unit_id,default_cost').eq('is_active', true).order('name'),
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
  ]);

  if ([warehousesResult, rawMaterialsResult, branchesResult].some(result => result.error || !Array.isArray(result.data))) throw new Error('TRANSFER_META_UNAVAILABLE');
  return {
    warehouses: (warehousesResult.data as Warehouse[]) || [],
    rawMaterials: (rawMaterialsResult.data as TransferRawMaterialChoice[]) || [],
    branches: (branchesResult.data as Branch[]) || [],
  };
}

export async function loadTransferAverageCost(params: {
  rawMaterialId: string;
  branchId: string;
  warehouseId: string;
}): Promise<number> {
  const { data, error } = await supabase
    .from('raw_material_warehouse_inventory')
    .select('avg_cost')
    .eq('raw_material_id', params.rawMaterialId)
    .eq('branch_id', params.branchId)
    .eq('warehouse_id', params.warehouseId)
    .maybeSingle();

  if (error) throw new Error('TRANSFER_COST_UNAVAILABLE');
  const cost = Number((data as { avg_cost?: number } | null)?.avg_cost ?? 0);
  if (!Number.isFinite(cost) || cost < 0) throw new Error('TRANSFER_COST_UNAVAILABLE');
  return cost;
}
