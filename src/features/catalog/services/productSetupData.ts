import { loadRawMaterialDisplayPrices, rawCurrentPriceMap } from '@/features/costing/services/rawCurrentPriceData';
import { supabase } from '@/api';
import type { Category, InventoryUnit } from '@/lib/types';

export type ProductSetupRawMaterial = {
  id: string;
  name: string;
  branch_id: string | null;
  is_active: boolean;
  default_cost?: number;
  unit_id: string | null;
  measurement_unit?: { id: string; name: string; symbol?: string | null; code?: string | null } | null;
};

export async function loadProductSetupChoices(branchId: string): Promise<{
  categories: Category[];
  manufacturedItems: InventoryUnit[];
  rawMaterials: ProductSetupRawMaterial[];
  errors: string[];
}> {
  const [categoriesResult, manufacturedResult, rawMaterialsResult, prices] = await Promise.all([
    supabase.from('categories').select('*').eq('branch_id', branchId).order('name'),
    supabase.from('inventory_units').select('*').eq('branch_id', branchId).eq('unit_type', 'manufactured').eq('is_active', true).order('name'),
    supabase.from('raw_materials')
      .select('id,name,branch_id,is_active,default_cost,unit_id,measurement_unit:measurement_units!raw_materials_unit_id_fkey(id,name,symbol,code)')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('name'),
    loadRawMaterialDisplayPrices(branchId),
  ]);

  const costs = rawCurrentPriceMap(prices);
  return {
    categories: (categoriesResult.data as Category[]) || [],
    manufacturedItems: (manufacturedResult.data as InventoryUnit[]) || [],
    rawMaterials: ((rawMaterialsResult.data as unknown as ProductSetupRawMaterial[]) || []).map(raw => ({ ...raw, default_cost: costs[raw.id] ?? 0 })),
    errors: [categoriesResult.error?.message, manufacturedResult.error?.message, rawMaterialsResult.error?.message].filter(Boolean) as string[],
  };
}

export async function deleteProductSetupRollback(productId: string): Promise<void> {
  const { error } = await supabase.from('products').delete().eq('id', productId);
  if (error) throw error;
}
