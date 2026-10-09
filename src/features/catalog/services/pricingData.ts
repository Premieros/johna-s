import { loadRawMaterialDisplayPrices, rawCurrentPriceMap } from '@/features/costing/services/rawCurrentPriceData';
import { supabase } from '@/api';
import { loadProductCurrentCosts } from '@/features/costing/services/productCurrentCostData';

export type RawPriceRow = {
  id: string;
  code: string | null;
  name: string;
  branch_id: string | null;
  default_cost: number | null;
  latest_cost: number | null;
  is_active: boolean;
};

export type ManufacturedPriceRow = {
  id: string;
  code: string | null;
  name: string;
  branch_id: string | null;
  cost_price: number | null;
  sale_price: number | null;
  is_active: boolean;
};

export type ProductPriceRow = {
  id: string;
  sku: string | null;
  name: string;
  branch_id: string | null;
  cost_price: number | null;
  sale_price: number | null;
  wholesale_price: number | null;
  is_active: boolean;
  current_cost?: number | null;
};

export async function loadPricingRows(params: {
  branchId: string;
  includeRaw: boolean;
  includeProducts: boolean;
  includeCurrentCosts?: boolean;
}): Promise<{
  rawRows: RawPriceRow[];
  manufacturedRows: ManufacturedPriceRow[];
  productRows: ProductPriceRow[];
}> {
  const [rawResult, manufacturedResult, productResult, priceRows, productCosts] = await Promise.all([
    params.includeRaw
      ? supabase
          .from('raw_materials')
          .select('id,code,name,branch_id,default_cost,is_active')
          .eq('branch_id', params.branchId)
          .order('name')
      : Promise.resolve({ data: [], error: null }),
    params.includeRaw
      ? supabase
          .from('inventory_units')
          .select('id,code,name,branch_id,cost_price,sale_price,is_active')
          .eq('branch_id', params.branchId)
          .eq('unit_type', 'manufactured')
          .order('name')
      : Promise.resolve({ data: [], error: null }),
    params.includeProducts
      ? supabase
          .from('products')
          .select('id,sku,name,branch_id,cost_price,sale_price,wholesale_price,is_active')
          .eq('branch_id', params.branchId)
          .order('name')
      : Promise.resolve({ data: [], error: null }),
    params.includeRaw ? loadRawMaterialDisplayPrices(params.branchId) : Promise.resolve([]),
    params.includeProducts && params.includeCurrentCosts ? loadProductCurrentCosts(params.branchId) : Promise.resolve({} as Record<string,number|null>),
  ]);

  const firstError = rawResult.error || manufacturedResult.error || productResult.error;
  if (firstError) throw firstError;

  const costs = rawCurrentPriceMap(priceRows);
  return {
    rawRows: ((rawResult.data || []) as Omit<RawPriceRow, 'latest_cost'>[]).map((row) => ({ ...row, latest_cost: costs[row.id] ?? null })),
    manufacturedRows: (manufacturedResult.data || []) as ManufacturedPriceRow[],
    productRows: ((productResult.data || []) as ProductPriceRow[]).map(row=>({...row,current_cost:productCosts[row.id]})),
  };
}

export async function updateManufacturedPricing(params: {
  id: string;
  branchId: string;
  costPrice: number;
  salePrice: number;
}): Promise<void> {
  const { error } = await supabase
    .from('inventory_units')
    .update({ cost_price: params.costPrice, sale_price: params.salePrice })
    .eq('id', params.id)
    .eq('branch_id', params.branchId)
    .eq('unit_type', 'manufactured');
  if (error) throw error;
}

export async function updateProductPricing(params: {
  id: string;
  branchId: string;
  costPrice: number;
  salePrice: number;
  wholesalePrice: number;
}): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({
      cost_price: params.costPrice,
      sale_price: params.salePrice,
      wholesale_price: params.wholesalePrice,
    })
    .eq('id', params.id)
    .eq('branch_id', params.branchId);
  if (error) throw error;
}
