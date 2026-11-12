import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const url=getDbUrl();
const local=!!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('secondary-branch nested manufactured recipe costing under RLS',()=>{
  let db:pg.Client;
  let ids:RlsIds;
  const materialA=randomUUID(),materialB=randomUUID();
  const unitA=randomUUID(),parentB=randomUUID(),childB=randomUUID();
  const prefix='RECIPE-MFG-RLS-'+randomUUID().slice(0,8);

  beforeAll(async()=>{
    db=openDb(url!);await db.connect();await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='10s'");
    if(!await canImpersonate(db)) throw new Error('Requires local CI auth stub');
    ids=await seedRlsFixture(db);
    await db.query(`UPDATE public.roles
      SET permissions=COALESCE(permissions,'[]'::jsonb) ||
      '["reports.view","reports.costing","sales.view","history.unlimited","products.view"]'::jsonb
      WHERE role='owner'`);
    await db.query(`INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost)
      VALUES($1,$2,$3,$4,0),($5,$6,$7,$8,0)`,
      [materialA,randomUUID(),prefix+' A',ids.branchA,materialB,randomUUID(),prefix+' B',ids.branchB]);
    await db.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,reference_number,priced_at)
      VALUES($1,$2,80,'RECIPE-OWNER-A',now()),($3,$4,100,'RECIPE-OWNER-B',now())`,
      [materialA,ids.branchA,materialB,ids.branchB]);
    await db.query(`INSERT INTO public.inventory_units(id,code,name,branch_id,unit_type,is_active)
      VALUES($1,$2,$3,$4,'manufactured',true),
            ($5,$6,$7,$8,'manufactured',true),
            ($9,$10,$11,$8,'manufactured',true)`,
      [unitA,randomUUID(),prefix+' A unit',ids.branchA,
        parentB,randomUUID(),prefix+' B parent',ids.branchB,
        childB,randomUUID(),prefix+' B child']);
    await db.query(`INSERT INTO public.product_unit_links(product_id,unit_id,quantity)
      VALUES($1,$2,1),($3,$4,2)`,[ids.prodA,unitA,ids.prodB,parentB]);
    await db.query(`INSERT INTO public.inventory_unit_recipes(unit_id,raw_material_id,quantity,wastage_percent)
      VALUES($1,$2,0.2,0),($3,$4,0.2,0),($5,$4,0.1,0)`,
      [unitA,materialA,parentB,materialB,childB]);
    await db.query(`INSERT INTO public.inventory_unit_recipe_units(unit_id,component_unit_id,quantity,wastage_percent)
      VALUES($1,$2,0.5,0)`,[parentB,childB]);
    await db.query('DELETE FROM public.user_branch_access WHERE user_id=$1 AND branch_id=$2',
      [ids.users.owner,ids.branchB]);
  });

  afterAll(async()=>{
    if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}
  });

  async function totals(user:string,branch:string) {
    const res=await runAs(db,user,`SELECT public.get_sold_recipe_consumption_report(
      $1,CURRENT_DATE-1,CURRENT_DATE+1,'material','',0,100) AS report`,[branch]);
    expect(res.error).toBeUndefined();
    return res.rows[0].report as {summary:{total:number;count:number;complete:boolean;missing_recipe_count:number};
      rows:Array<{raw_material_id:string;net_quantity:number;unit_price:number;consumption_value:number}>};
  }

  async function count(user:string,table:'product_unit_links'|'inventory_units'|'inventory_unit_recipes'|'inventory_unit_recipe_units',branch:string) {
    const q={
      product_unit_links:`SELECT count(*)::integer AS count FROM public.product_unit_links l JOIN public.products p ON p.id=l.product_id WHERE p.branch_id=$1`,
      inventory_units:`SELECT count(*)::integer AS count FROM public.inventory_units WHERE branch_id=$1`,
      inventory_unit_recipes:`SELECT count(*)::integer AS count FROM public.inventory_unit_recipes i JOIN public.inventory_units u ON u.id=i.unit_id WHERE u.branch_id=$1`,
      inventory_unit_recipe_units:`SELECT count(*)::integer AS count FROM public.inventory_unit_recipe_units l JOIN public.inventory_units u ON u.id=l.unit_id WHERE u.branch_id=$1`,
    }[table];
    const res=await runAs(db,user,q,[branch]);
    expect(res.error).toBeUndefined();
    return Number(res.rows[0].count);
  }

  it('keeps valid primary-branch recipe costing and denies an ungranted secondary branch',async()=>{
    expect((await totals(ids.users.owner,ids.branchA)).summary).toMatchObject({total:16,complete:true});
    expect(await count(ids.users.owner,'inventory_units',ids.branchB)).toBe(0);
    expect(await count(ids.users.owner,'product_unit_links',ids.branchB)).toBe(0);
    const result=await runAs(db,ids.users.owner,`SELECT public.get_sold_recipe_consumption_report(
      $1,CURRENT_DATE-1,CURRENT_DATE+1,'material','',0,1) AS report`,[ids.branchB]);
    expect(result.error).toContain('BRANCH_ACCESS_DENIED');
  });

  it('calculates full nested recipe cost after explicit grant without changing stock',async()=>{
    await db.query(`INSERT INTO public.user_branch_access(user_id,branch_id)
      VALUES($1,$2) ON CONFLICT(user_id,branch_id) DO NOTHING`,
      [ids.users.owner,ids.branchB]);
    for(const [table,expected] of [
      ['product_unit_links',1],['inventory_units',2],['inventory_unit_recipes',2],['inventory_unit_recipe_units',1],
    ] as const)expect(await count(ids.users.owner,table,ids.branchB)).toBe(expected);
    const owner=await totals(ids.users.owner,ids.branchB);
    const admin=await totals(ids.users.super_admin,ids.branchB);
    expect(owner.summary).toEqual(admin.summary);
    expect(owner.summary).toMatchObject({total:50,complete:true,missing_recipe_count:0});
    expect(owner.rows).toContainEqual(expect.objectContaining({
      raw_material_id:materialB,net_quantity:0.5,unit_price:100,consumption_value:50,
    }));
  });

  it('does not expose recipe components to a cashier even after an explicit branch grant',async()=>{
    await db.query(`INSERT INTO public.user_branch_access(user_id,branch_id)
      VALUES($1,$2) ON CONFLICT(user_id,branch_id) DO NOTHING`,
      [ids.users.cashier,ids.branchB]);
    for(const table of ['product_unit_links','inventory_units','inventory_unit_recipes','inventory_unit_recipe_units'] as const)
      expect(await count(ids.users.cashier,table,ids.branchB)).toBe(0);
    const denied=await runAs(db,ids.users.cashier,`SELECT public.get_sold_recipe_consumption_report(
      $1,CURRENT_DATE-1,CURRENT_DATE+1,'material','',0,1) AS report`,[ids.branchB]);
    expect(denied.error).toContain('PERMISSION_DENIED');
  });

  it('removes all secondary-branch component visibility on permission revocation',async()=>{
    await db.query('DELETE FROM public.user_branch_access WHERE user_id=$1 AND branch_id=$2',
      [ids.users.owner,ids.branchB]);
    for(const table of ['product_unit_links','inventory_units','inventory_unit_recipes','inventory_unit_recipe_units'] as const)
      expect(await count(ids.users.owner,table,ids.branchB)).toBe(0);
  });

  it('preserves original branch-select and write policies on each table',async()=>{
    const policies=await db.query(`SELECT tablename,
      count(*) FILTER (WHERE policyname='report_costing_secondary_branch_select' AND cmd='SELECT') AS added,
      count(*) FILTER (WHERE policyname IN('pul_branch_read','inventory_units_branch_read','iur_branch_read','iuru_branch_read')) AS original
      FROM pg_policies WHERE schemaname='public' AND tablename IN
      ('product_unit_links','inventory_units','inventory_unit_recipes','inventory_unit_recipe_units')
      GROUP BY tablename ORDER BY tablename`);
    expect(policies.rows).toHaveLength(4);
    for(const row of policies.rows) {
      expect(Number(row.added)).toBe(1);
      expect(Number(row.original)).toBe(1);
    }
  });
});
