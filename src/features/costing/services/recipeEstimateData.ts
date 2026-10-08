import { supabase } from '@/api';
import { estimateGroupCosts, type GroupCostLink, type RawCostLine } from '@/lib/recipeCosting';
import { loadRawCurrentPrices,rawCurrentPriceMap } from './rawCurrentPriceData';

export async function loadRecipeEstimateData(branchId:string) {
  const [priceRows,groupsResult]=await Promise.all([
    loadRawCurrentPrices(branchId),
    supabase.from('inventory_units').select('id').eq('branch_id',branchId).eq('unit_type','manufactured').eq('is_active',true),
  ]);
  if(groupsResult.error) throw groupsResult.error;
  const prices=Object.fromEntries(Object.entries(rawCurrentPriceMap(priceRows)).map(([id,cost])=>[id,cost??0]));
  const ids=((groupsResult.data||[]) as {id:string}[]).map(group=>group.id);
  const [rawResult,linksResult]=ids.length?await Promise.all([
    supabase.from('inventory_unit_recipes').select('unit_id,raw_material_id,quantity,wastage_percent').in('unit_id',ids),
    supabase.from('inventory_unit_recipe_units').select('unit_id,component_unit_id,quantity,wastage_percent').in('unit_id',ids),
  ]):[{data:[],error:null},{data:[],error:null}];
  if(rawResult.error||linksResult.error) throw rawResult.error||linksResult.error;
  return {prices,groupCosts:estimateGroupCosts(ids,
    (rawResult.data||[]) as (RawCostLine&{unit_id:string})[],
    (linksResult.data||[]) as GroupCostLink[],prices)};
}
