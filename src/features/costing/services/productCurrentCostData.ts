import { costing } from '@/api';

/** The same authoritative current unit estimate used by Costing Center. */
export async function loadProductCurrentCosts(branchId:string|null):Promise<Record<string,number|null>>{
  const result=await costing.getOverview({p_branch_id:branchId});
  if(result.error)throw result.error;
  return Object.fromEntries((result.data||[]).map(row=>[row.product_id,
    row.actual_cost==null?null:Number(row.actual_cost)]));
}
