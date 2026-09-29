import { supabase } from '@/api';
import type { WasteCategory, WasteEntry } from '@/lib/types';

export type WasteProductOption = { id: string; name: string; name_en?: string | null; sale_price?: number | null; cost_price?: number | null };
export type WasteUnitOption = { id: string; name: string; name_en?: string | null; cost_price?: number | null };
export type WasteWarehouseOption = { id: string; name: string };

export async function loadWasteCenterData(branchId: string | null): Promise<{
  categories: WasteCategory[];
  products: WasteProductOption[];
  inventoryUnits: WasteUnitOption[];
  warehouses: WasteWarehouseOption[];
  entries: WasteEntry[];
}> {
  const productQuery = supabase
    .from('products')
    .select('id,name,name_en,sale_price,cost_price')
    .eq('is_active', true)
    .order('name');
  if (branchId) productQuery.eq('branch_id', branchId);

  const entryQuery = supabase
    .from('waste_entries')
    .select('*, waste_category:waste_categories(*), product:products(id,name,name_en), inventory_unit:inventory_units(id,name,name_en), warehouse:warehouses(id,name)')
    .order('created_at', { ascending: false });
  if (branchId) entryQuery.eq('branch_id', branchId);

  let unitQuery = supabase.from('inventory_units').select('id,name,name_en,cost_price').eq('is_active', true).order('name');
  let warehouseQuery = supabase.from('warehouses').select('id,name').eq('is_active', true).order('name');
  if (branchId) {
    unitQuery = unitQuery.or(`branch_id.eq.${branchId},branch_id.is.null`);
    warehouseQuery = warehouseQuery.eq('branch_id', branchId);
  }

  const [catRes, productRes, unitRes, warehouseRes, entryRes] = await Promise.all([
    supabase.from('waste_categories').select('*').eq('is_active', true).order('name'),
    productQuery,
    unitQuery,
    warehouseQuery,
    entryQuery,
  ]);

  const error = catRes.error || productRes.error || unitRes.error || warehouseRes.error || entryRes.error;
  if (error) throw error;

  return {
    categories: (catRes.data || []) as WasteCategory[],
    products: (productRes.data || []) as WasteProductOption[],
    inventoryUnits: (unitRes.data || []) as WasteUnitOption[],
    warehouses: (warehouseRes.data || []) as WasteWarehouseOption[],
    entries: (entryRes.data || []) as unknown as WasteEntry[],
  };
}

export async function createWasteEntry(params: {
  branchId: string;
  wasteCategoryId: string;
  wasteType: string;
  quantity: number;
  unitCost: number;
  reason: string | null;
  productId: string | null;
  inventoryUnitId: string | null;
  warehouseId: string;
}): Promise<void> {
  const { error } = await supabase.rpc('create_waste_entry', {
    p_branch_id: params.branchId,
    p_waste_category_id: params.wasteCategoryId,
    p_waste_type: params.wasteType,
    p_quantity: params.quantity,
    p_unit_cost: params.unitCost,
    p_reason: params.reason,
    p_product_id: params.productId,
    p_inventory_unit_id: params.inventoryUnitId,
    p_warehouse_id: params.warehouseId,
  });
  if (error) throw error;
}

export async function decideWasteEntry(params: {
  wasteId: string;
  approve: boolean;
  rejectionReason: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('approve_waste', {
    p_waste_id: params.wasteId,
    p_approve: params.approve,
    ...(params.approve ? {} : { p_rejection_reason: params.rejectionReason }),
  });
  if (error) throw error;
}

export async function loadWasteReport(params: {
  branchId: string | null;
  fromDate: string;
  toDate: string;
}): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc('get_waste_report', {
    p_branch_id: params.branchId,
    p_from_date: params.fromDate,
    p_to_date: params.toDate,
  });
  if (error) throw error;
  return (data || []) as Record<string, unknown>[];
}
