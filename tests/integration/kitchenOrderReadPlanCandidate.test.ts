import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const local = !!dbUrl && ['localhost','127.0.0.1','[::1]'].includes(new URL(dbUrl).hostname);
type Component = { raw_material_id: string; quantity: number; unit_cost: number | null };
type Item = { order_item_id: string; delta_quantity: number; requires_canonical_fallback: boolean; components: Component[] };
type Plan = { success: boolean; error?: string; configuration_count: number; distinct_raw_count: number; items: Item[] };

describe.skipIf(!local)('read-only order-scoped kitchen read plan (unwired)', () => {
  let client: pg.Client;
  const branch=randomUUID(), foreign=randomUUID(), order=randomUUID(), raw=randomUUID();
  const a=randomUUID(), b=randomUUID(), noRecipe=randomUUID();
  const itemA=randomUUID(), itemA2=randomUUID(), itemB=randomUUID();
  const asOf=new Date();
  beforeAll(async () => {
    if (!local) throw new Error('Disposable loopback DB required');
    client=openDb(dbUrl!); await client.connect(); await client.query('BEGIN');
    await client.query(readFileSync('scripts/experiments/kitchen_order_read_plan_candidate_20261012.sql','utf8'));
    await client.query("INSERT INTO public.branches(id,name) VALUES($1,'Plan'),($2,'Foreign plan')",[branch,foreign]);
    await client.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Plan raw',$3,123,true)",[raw,'plan-'+raw,branch]);
    for (const [product,perSale] of [[a,1],[b,2],[noRecipe,0]] as const) {
      await client.query("INSERT INTO public.products(id,name,branch_id,sale_price,is_active) VALUES($1,$2,$3,10,true)",[product,'Plan '+product,branch]);
      if (perSale) {
        const recipe=randomUUID();
        await client.query("INSERT INTO public.recipes(id,product_id,branch_id,name,yield_quantity,is_active) VALUES($1,$2,$3,'Plan recipe',1,true)",[recipe,product,branch]);
        await client.query("INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent) VALUES($1,$2,$3,0)",[recipe,raw,perSale]);
      }
    }
    await client.query("INSERT INTO public.orders(id,order_number,branch_id,status) VALUES($1,$2,$3,'open')",[order,'PLAN-'+order,branch]);
    await client.query("INSERT INTO public.order_items(id,order_id,product_id,quantity,unit_price,total,notes) VALUES($1,$4,$5,2,10,20,'first'),($2,$4,$5,3,10,30,'second'),($3,$4,$6,4,10,40,NULL)",[itemA,itemA2,itemB,order,a,b]);
    await client.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,7,'pricing','PLAN-PAST',$3),($1,$2,99,'pricing','PLAN-FUTURE',$4)",[raw,branch,new Date(asOf.getTime()-3600000),new Date(asOf.getTime()+3600000)]);
  });
  afterAll(async () => { if(client){ await client.query('ROLLBACK'); await client.end(); } });
  async function plan(scope=branch,time: Date|null=asOf): Promise<Plan> {
    return (await client.query("SELECT public._kitchen_order_read_plan_candidate($1,$2,$3) result",[order,scope,time])).rows[0].result;
  }
  async function isolated(fn:()=>Promise<void>) {
    await client.query('SAVEPOINT plan_case');
    try { await fn(); } finally {
      await client.query('ROLLBACK TO SAVEPOINT plan_case');
      await client.query('RELEASE SAVEPOINT plan_case');
    }
  }
  it('resolves two configurations for three independent lines and one distinct raw',async()=>{
    const result=await plan();
    expect(result.success).toBe(true);
    expect(result.configuration_count).toBe(2);
    expect(result.distinct_raw_count).toBe(1);
    expect(result.items).toHaveLength(3);
    expect(result.items.map(i=>i.components[0].quantity).sort((x,y)=>x-y)).toEqual([2,3,8]);
    expect(new Set(result.items.map(i=>i.order_item_id)).size).toBe(3);
    expect(result.items.every(i=>i.components[0].unit_cost===7)).toBe(true);
    for (const item of result.items) {
      const r=await client.query("SELECT round(r.quantity_per_sale*oi.quantity,6)::float8 quantity FROM public.order_items oi CROSS JOIN LATERAL public.resolve_kitchen_item_raw_components(oi.product_id,$2,to_jsonb(oi.modifier_option_ids)) r WHERE oi.id=$1",[item.order_item_id,branch]);
      expect(item.components[0].quantity).toBe(r.rows[0].quantity);
    }
  });
  it('only plans the fresh delta and has no work on a complete resend',async()=>isolated(async()=>{
    await client.query("INSERT INTO public.order_kitchen_sends(branch_id,order_id,order_item_id,sent_quantity) VALUES($1,$2,$3,1)",[branch,order,itemA]);
    expect((await plan()).items.find(i=>i.order_item_id===itemA)?.components[0].quantity).toBe(1);
    await client.query("INSERT INTO public.order_kitchen_sends(branch_id,order_id,order_item_id,sent_quantity) SELECT $1,$2,id,quantity FROM public.order_items WHERE order_id=$2 ON CONFLICT(order_item_id) DO UPDATE SET sent_quantity=EXCLUDED.sent_quantity",[branch,order]);
    const result=await plan();
    expect(result.items).toEqual([]);
    expect(result.configuration_count).toBe(0);
    expect(result.distinct_raw_count).toBe(0);
  }));
  it('does not substitute a default price for unknown historical cost',async()=>{
    const result=await plan(branch,new Date(asOf.getTime()-7200000));
    expect(result.items.every(i=>i.components[0].unit_cost===null)).toBe(true);
  });
  it('marks an unconfigured product without creating fallback raws or stock',async()=>isolated(async()=>{
    const before=(await client.query("SELECT count(*)::int n FROM public.raw_materials WHERE branch_id=$1",[branch])).rows[0].n;
    const id=randomUUID();
    await client.query("INSERT INTO public.order_items(id,order_id,product_id,quantity) VALUES($1,$2,$3,1)",[id,order,noRecipe]);
    const result=await plan();
    expect(result.items.find(i=>i.order_item_id===id)).toMatchObject({requires_canonical_fallback:true,components:[]});
    expect((await client.query("SELECT count(*)::int n FROM public.raw_materials WHERE branch_id=$1",[branch])).rows[0].n).toBe(before);
  }));
  it('rejects a mismatched branch and a missing snapshot time',async()=>{
    expect(await plan(foreign)).toMatchObject({success:false,error:'ORDER_NOT_EDITABLE_OR_NOT_VISIBLE'});
    expect(await plan(branch,null)).toMatchObject({success:false,error:'AS_OF_REQUIRED'});
  });
});
