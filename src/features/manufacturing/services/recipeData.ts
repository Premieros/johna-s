import { loadRawCurrentPrices, rawCurrentPriceMap } from '@/features/costing/services/rawCurrentPriceData';
import { supabase } from '@/api';
import type { Branch, Product, RawMaterial, Recipe, RecipeItem, RecipeItemInput, Unit } from '@/lib/types';

export interface RecipeManufacturedUnitOption {
  id: string;
  name: string;
  branch_id: string | null;
  cost_price: number;
}

export interface RecipeMutationResult {
  success?: boolean;
  error?: string;
  detail?: string;
}

export async function loadRecipeMeta(branchId: string | null): Promise<{
  products: Product[];
  branches: Branch[];
  units: Unit[];
}> {
  let productQuery = supabase.from('products').select('*').eq('is_active', true);
  if (branchId) productQuery = productQuery.eq('branch_id', branchId);
  let branchQuery = supabase.from('branches').select('*').eq('is_active', true);
  if (branchId) branchQuery = branchQuery.eq('id', branchId);

  const [productsResult, branchesResult, unitsResult] = await Promise.all([
    productQuery.order('name'),
    branchQuery.order('name'),
    supabase.from('measurement_units').select('*').eq('is_active', true).order('name'),
  ]);

  const error = productsResult.error || branchesResult.error || unitsResult.error;
  if (error) throw error;

  return {
    products: (productsResult.data as Product[]) || [],
    branches: (branchesResult.data as Branch[]) || [],
    units: (unitsResult.data as Unit[]) || [],
  };
}

export async function loadRecipeComponents(branchId: string): Promise<{
  materials: RawMaterial[];
  materialCosts: Record<string, number>;
  manufacturedUnits: RecipeManufacturedUnitOption[];
}> {
  const [materialsResult, priceRows, manufacturedResult] = await Promise.all([
    supabase.from('raw_materials').select('*').eq('is_active', true).eq('branch_id', branchId).order('name'),
    loadRawCurrentPrices(branchId),
    supabase.from('inventory_units').select('id,name,branch_id,cost_price').eq('branch_id', branchId).eq('unit_type', 'manufactured').eq('is_active', true).order('name'),
  ]);

  const error = materialsResult.error || manufacturedResult.error;
  if (error) throw error;

  const materials = (materialsResult.data as RawMaterial[]) || [];
  const costs = rawCurrentPriceMap(priceRows);
  const materialCosts = Object.fromEntries(materials.map((material) => [material.id, costs[material.id] ?? 0]));

  return {
    materials,
    materialCosts,
    manufacturedUnits: ((manufacturedResult.data || []) as RecipeManufacturedUnitOption[]).map((row) => ({
      ...row,
      cost_price: Number(row.cost_price || 0),
    })),
  };
}

export async function loadRecipeManufacturedLinks(productId: string): Promise<Array<{ unit_id: string; quantity: number }>> {
  const { data, error } = await supabase
    .from('product_unit_links')
    .select('unit_id,quantity')
    .eq('product_id', productId);
  if (error) throw error;
  return ((data || []) as { unit_id: string; quantity: number }[]).map((row) => ({
    unit_id: row.unit_id,
    quantity: Number(row.quantity) || 1,
  }));
}

export async function loadRecipeItems(recipeId: string): Promise<RecipeItem[]> {
  const { data, error } = await supabase.from('recipe_items').select('*').eq('recipe_id', recipeId).order('created_at');
  if (error) throw error;
  return (data as RecipeItem[]) || [];
}

export async function updateRecipeWithItems(params: {
  recipeId: string;
  name: string;
  yieldQuantity: number;
  notes: string;
  isActive: boolean;
  items: RecipeItemInput[];
}): Promise<RecipeMutationResult> {
  const { data, error } = await supabase.rpc('update_recipe_with_items', {
    p_recipe_id: params.recipeId,
    p_name: params.name,
    p_yield_quantity: params.yieldQuantity,
    p_notes: params.notes,
    p_is_active: params.isActive,
    p_items: params.items,
  });
  if (error) throw error;
  return (data || {}) as RecipeMutationResult;
}

export async function createRecipeWithItems(params: {
  payload: Record<string, unknown>;
  items: RecipeItemInput[];
}): Promise<string> {
  const { data, error } = await supabase.from('recipes').insert(params.payload).select().single();
  if (error || !data) throw error || new Error('Failed to create recipe');

  const recipeId = (data as Recipe).id;
  const { error: itemsError } = await supabase
    .from('recipe_items')
    .insert(params.items.map((item) => ({ ...item, recipe_id: recipeId })));
  if (itemsError) throw itemsError;
  return recipeId;
}

export async function deleteRecipeControlled(recipeId: string): Promise<RecipeMutationResult> {
  const { data, error } = await supabase.rpc('delete_recipe_controlled', { p_recipe_id: recipeId });
  if (error) throw error;
  return (data || {}) as RecipeMutationResult;
}
