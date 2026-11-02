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
    supabase.from('raw_materials').select('*, unit:measurement_units!raw_materials_unit_id_fkey(*)').eq('is_active', true).order('name'),
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

export async function loadStockCountReviewPrices(
  branchId: string,
  rawMaterialIds: string[],
): Promise<Record<string, { unit_cost: number | null; price_source: string }>> {
  if (rawMaterialIds.length === 0) return {};

  // Await the Supabase PromiseLike inside the service; callers receive a
  // native Promise and never depend on PostgREST's thenable exposing .catch().
  const { data, error } = await supabase.rpc('get_raw_material_current_prices', {
    p_branch_id: branchId,
    p_raw_material_ids: rawMaterialIds,
  });
  if (error) throw error;

  const prices: Record<string, { unit_cost: number | null; price_source: string }> = {};
  for (const row of (data || []) as Array<{
    raw_material_id: string;
    unit_cost: number | string | null;
    price_source: string | null;
  }>) {
    prices[row.raw_material_id] = {
      unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
      price_source: row.price_source || 'unpriced',
    };
  }
  return prices;
}
