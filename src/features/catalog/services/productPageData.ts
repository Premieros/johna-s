import { supabase } from '@/api';
import type { Category, ProductComponentInput, ProductUnit } from '@/lib/types';

export type ProductStockComponent = { product_id: string; name: string; total: number; cost_price: number };
export type ProductRawMaterialOption = { id: string; name: string; branch_id: string | null };
export type ProductLinkedInventoryUnit = { unit_id: string; quantity: number; unit?: { id: string; name: string; unit_type: 'ready' | 'manufactured'; cost_price: number } | null };
export type ProductManufacturedInventoryUnit = { id: string; name: string; unit_type: 'manufactured'; cost_price: number; branch_id: string | null };

export async function loadProductStockComponents(branchId: string | null): Promise<ProductStockComponent[]> {
  let inventoryQuery = supabase.from('inventory').select('product_id, quantity, product:products(id, name, cost_price, is_active)');
  if (branchId) {
    const { data: warehouses } = await supabase.from('warehouses').select('id').eq('branch_id', branchId).eq('is_active', true);
    const ids = ((warehouses as { id: string }[] | null) || []).map((warehouse) => warehouse.id);
    if (ids.length === 0) return [];
    inventoryQuery = inventoryQuery.in('warehouse_id', ids);
  }

  const { data } = await inventoryQuery;
  const totals: Record<string, { name: string; cost_price: number; total: number }> = {};
  for (const row of ((data || []) as unknown as { product_id: string; quantity: number; product: { id: string; name: string; cost_price: number; is_active: boolean } | null }[])) {
    if (!row.product || !row.product.is_active) continue;
    const total = totals[row.product_id] || { name: row.product.name, cost_price: row.product.cost_price, total: 0 };
    total.total += Number(row.quantity) || 0;
    totals[row.product_id] = total;
  }

  return Object.entries(totals)
    .filter(([, value]) => value.total > 0)
    .map(([product_id, value]) => ({ product_id, name: value.name, total: value.total, cost_price: value.cost_price }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadProductCategories(branchId: string | null): Promise<Category[]> {
  let query = supabase.from('categories').select('*');
  if (branchId) query = query.eq('branch_id', branchId);
  const { data } = await query.order('name');
  return (data as Category[]) || [];
}

export async function loadProductEditorData(params: {
  productId: string;
  branchId: string;
}): Promise<{
  units: ProductUnit[];
  components: ProductComponentInput[];
  rawMaterials: ProductRawMaterialOption[];
  inventoryLinks: ProductLinkedInventoryUnit[];
  manufacturedUnits: ProductManufacturedInventoryUnit[];
  rawMaterialError: string | null;
  manufacturedUnitsError: string | null;
}> {
  const [unitsResult, componentsResult, rawMaterialsResult, inventoryLinksResult, manufacturedUnitsResult] = await Promise.all([
    supabase.from('product_units').select('*').eq('product_id', params.productId),
    supabase.from('product_components').select('component_product_id, quantity').eq('product_id', params.productId),
    params.branchId
      ? supabase.from('raw_materials').select('id,name,branch_id').eq('branch_id', params.branchId).eq('is_active', true).order('name')
      : Promise.resolve({ data: [], error: null }),
    supabase.from('product_unit_links').select('unit_id,quantity,unit:inventory_units(id,name,unit_type,cost_price)').eq('product_id', params.productId),
    params.branchId
      ? supabase.from('inventory_units').select('id,name,unit_type,cost_price,branch_id').eq('branch_id', params.branchId).eq('unit_type', 'manufactured').eq('is_active', true).order('name')
      : Promise.resolve({ data: [], error: null }),
  ]);

  return {
    units: (unitsResult.data as ProductUnit[]) || [],
    components: (((componentsResult.data || []) as { component_product_id: string; quantity: number }[]).map((component) => ({
      component_product_id: component.component_product_id,
      quantity: Number(component.quantity) || 1,
    }))),
    rawMaterials: (rawMaterialsResult.data || []) as ProductRawMaterialOption[],
    inventoryLinks: (((inventoryLinksResult.data || []) as unknown as ProductLinkedInventoryUnit[]).map((row) => ({
      ...row,
      quantity: Number(row.quantity) || 0,
    }))),
    manufacturedUnits: (manufacturedUnitsResult.data || []) as unknown as ProductManufacturedInventoryUnit[],
    rawMaterialError: rawMaterialsResult.error?.message || null,
    manufacturedUnitsError: manufacturedUnitsResult.error?.message || null,
  };
}

export async function updateProductRecord(productId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('products').update(payload).eq('id', productId);
  if (error) throw error;
}

export async function replaceLegacyProductComponents(params: {
  productId: string;
  productType: 'ready' | 'manufactured';
  components: ProductComponentInput[];
}): Promise<void> {
  const { error: deleteError } = await supabase.from('product_components').delete().eq('product_id', params.productId);
  if (deleteError) throw deleteError;

  if (params.productType === 'manufactured' && params.components.length > 0) {
    const { error: insertError } = await supabase.from('product_components').insert(
      params.components.map((component) => ({
        product_id: params.productId,
        component_product_id: component.component_product_id,
        quantity: component.quantity,
      })),
    );
    if (insertError) throw insertError;
  }
}

export async function deleteProductRecord(productId: string): Promise<void> {
  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) throw error;
}

export async function importProductRecords(payload: Record<string, unknown>[]): Promise<void> {
  const { error } = await supabase.from('products').insert(payload);
  if (error) throw error;
}
