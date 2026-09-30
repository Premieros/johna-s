import { supabase } from '@/api';
import type { Branch, Product, RawMaterial, Warehouse } from '@/lib/types';

export async function loadStockCountMetadata(): Promise<{
  branches: Branch[];
  warehouses: Warehouse[];
  products: Product[];
  rawMaterials: RawMaterial[];
}> {
  const [branchesRes, warehousesRes, productsRes, rawMaterialsRes] = await Promise.all([
    supabase.from('branches').select('*').eq('is_active', true).order('name'),
    supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
    supabase.from('products').select('*').eq('is_active', true).order('name'),
    supabase.from('raw_materials').select('*').eq('is_active', true).order('name'),
  ]);

  return {
    branches: (branchesRes.data as Branch[] | null) || [],
    warehouses: (warehousesRes.data as Warehouse[] | null) || [],
    products: (productsRes.data as Product[] | null) || [],
    rawMaterials: (rawMaterialsRes.data as RawMaterial[] | null) || [],
  };
}


export async function loadRawMaterialWarehouseSnapshot(
  branchId: string,
  warehouseId: string,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('raw_material_batches')
    .select('raw_material_id, quantity')
    .eq('branch_id', branchId)
    .eq('warehouse_id', warehouseId);

  if (error) throw error;

  const snapshot: Record<string, number> = {};
  for (const row of (data || []) as Array<{ raw_material_id: string | null; quantity: number | string | null }>) {
    if (!row.raw_material_id) continue;
    snapshot[row.raw_material_id] = (snapshot[row.raw_material_id] || 0) + Number(row.quantity || 0);
  }
  return snapshot;
}
