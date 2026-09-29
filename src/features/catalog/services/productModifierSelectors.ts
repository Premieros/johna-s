import { supabase } from '@/api';
import type { Category, Product } from '@/lib/types';

export async function loadProductModifierSelectors(branchId: string): Promise<{
  products: Product[];
  categories: Category[];
}> {
  const [productsResult, categoriesResult] = await Promise.all([
    supabase.from('products').select('*').eq('branch_id', branchId).eq('is_active', true).order('name'),
    supabase.from('categories').select('*').eq('branch_id', branchId).order('name'),
  ]);

  if (productsResult.error) throw productsResult.error;
  if (categoriesResult.error) throw categoriesResult.error;

  return {
    products: (productsResult.data || []) as Product[],
    categories: (categoriesResult.data || []) as Category[],
  };
}
