import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const dbUrl=getDbUrl();
const local=!!dbUrl && ['localhost','127.0.0.1','[::1]'].includes(new URL(dbUrl).hostname);

// CI-only RLS impersonation; all fixture writes are inside a transaction
// rolled back on completion. No branch printer or production database involved.
describe.skipIf(!local)('owner secondary-branch recipe consumption and sale-line isolation',()=>{
  let db:pg.Client;
  let ids:RlsIds;
  const rawA=randomUUID(),rawB=randomUUID();
  const prefix='RECIPE-RLS-'+randomUUID().slice(0,8);

  beforeAll(async()=>{
    db=openDb(dbUrl!);
    await db.connect();
    await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='10s'");
    if(!await canImpersonate(db)) throw new Error('Requires isolated CI auth stub');
    ids=await seedRlsFixture(db);

    await db.query(`UPDATE public.roles
      SET permissions=COALESCE(permissions,'[]'::jsonb)
        || '["reports.view","reports.costing","history.unlimited","sales.view","products.view"]'::jsonb
      WHERE role='owner'`);
    await db.query(`INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost)
      VALUES($1,$2,$3,$4,0),($5,$6,$7,$8,0)`,[
      rawA,randomUUID(),prefix+' raw A',ids.branchA,
      rawB,randomUUID(),prefix+' raw B',ids.branchB
    ]);
    await db.query(`INSERT INTO public.raw_material_price_events(
        raw_material_id,branch_id,unit_cost,reference_number,priced_at)
      VALUES($1,$2,80,'RECIPE-RLS-A',now()),($3,$4,100,'RECIPE-RLS-B',now())`,
      [rawA,ids.branchA,rawB,ids.branchB]);
    await db.query(`INSERT INTO public.recipe_items(recipe_id,raw_material_id,quantity,wastage_percent)
      VALUES($1,$2,0.25,0),($3,$4,0.5,0)`,
      [ids.rows.recipes.own,rawA,ids.rows.recipes.other,rawB]);
    await db.query('DELETE FROM public.user_branch_access WHERE user_id=$1 AND branch_id=$2',
      [ids.users.owner,ids.branchB]);
  });

  afterAll(async()=>{
    if(db){
      await db.query('ROLLBACK').catch(()=>{});
      await db.end();
    }
  });

  async function lines(user:string,branch:string){
    const result=await runAs(db,user,`SELECT i.id FROM public.sale_items i
      JOIN public.sales s ON s.id=i.sale_id WHERE s.branch_id=$1 ORDER BY i.id`,[branch]);
    expect(result.error).toBeUndefined();
    return result.rows.map(r=>r.id);
  }

  async function recipeCost(user:string,branch:string){
    const result=await runAs(db,user,`SELECT public.get_sold_recipe_consumption_report(
      $1, CURRENT_DATE-2,CURRENT_DATE+2,'material','',0,1
    ) AS report`,[branch]);
    expect(result.error).toBeUndefined();
    return (result.rows[0].report as {summary:{total:number;count:number;complete:boolean;missing_recipe_count:number}}).summary;
  }

  it('keeps the primary branch and denies an ungranted foreign branch even with full-history permissions',async()=>{
    const permissions=await runAs(db,ids.users.owner,`SELECT
       public.can_permission('reports.costing') AS costing,
       public.can_permission('history.unlimited') AS history,
       public.user_may_access_branch($1) AS foreign_access`,[ids.branchB]);
    expect(permissions.rows[0]).toEqual({costing:true,history:true,foreign_access:false});
    expect(await lines(ids.users.owner,ids.branchA)).toContain(ids.rows.sale_items.own);
    expect(await lines(ids.users.owner,ids.branchB)).toEqual([]);
    expect((await recipeCost(ids.users.owner,ids.branchA)).total).toBe(20);
    const foreign=await runAs(db,ids.users.owner,`SELECT public.get_sold_recipe_consumption_report(
      $1,CURRENT_DATE-2,CURRENT_DATE+2,'material','',0,1) AS report`,[ids.branchB]);
    expect(foreign.error).toContain('BRANCH_ACCESS_DENIED');
  });

  it('reads secondary-branch sold recipe quantities without exposing other branches or voided lines',async()=>{
    await db.query(`INSERT INTO public.user_branch_access(user_id,branch_id)
      VALUES($1,$2) ON CONFLICT(user_id,branch_id) DO NOTHING`,
      [ids.users.owner,ids.branchB]);
    expect(await lines(ids.users.owner,ids.branchB)).toContain(ids.rows.sale_items.other);
    const owner=await recipeCost(ids.users.owner,ids.branchB);
    const admin=await recipeCost(ids.users.super_admin,ids.branchB);
    expect(owner).toEqual(admin);
    // The shared fixture also contains a zero-cost ingredient line. Assert
    // the actual recipe cost and completeness, not the number of fixture rows.
    expect(owner).toMatchObject({total:50,complete:true,missing_recipe_count:0});
    expect(owner.count).toBeGreaterThan(0);
    const detail=await runAs(db,ids.users.owner,`SELECT public.get_sold_recipe_consumption_report(
      $1,CURRENT_DATE-2,CURRENT_DATE+2,'material','',0,100) AS report`,[ids.branchB]);
    expect(detail.error).toBeUndefined();
    expect((detail.rows[0].report as {rows:Array<Record<string,unknown>>}).rows).toContainEqual(
      expect.objectContaining({raw_material_id:rawB,net_quantity:0.5,unit_price:100,consumption_value:50})
    );
    expect(await lines(ids.users.cashier,ids.branchB)).toEqual([]);

    await db.query('SAVEPOINT recipe_refund');
    try{
      await db.query('UPDATE public.sale_items SET refunded_quantity=0.5 WHERE id=$1',[ids.rows.sale_items.other]);
      expect((await recipeCost(ids.users.owner,ids.branchB)).total).toBe(25);
    }finally{await db.query('ROLLBACK TO SAVEPOINT recipe_refund');}
  });

  it('requires the report and historical permissions even if another user is granted that branch',async()=>{
    await db.query(`INSERT INTO public.user_branch_access(user_id,branch_id)
      VALUES($1,$2) ON CONFLICT(user_id,branch_id) DO NOTHING`,
      [ids.users.cashier,ids.branchB]);
    expect(await lines(ids.users.cashier,ids.branchB)).toEqual([]);
    await db.query('DELETE FROM public.user_branch_access WHERE user_id=$1 AND branch_id=$2',
      [ids.users.owner,ids.branchB]);
    expect(await lines(ids.users.owner,ids.branchB)).toEqual([]);
  });

  it('preserves the restrictive historical policy and all sale-item write policies',async()=>{
    const p=await db.query(`SELECT policyname,cmd,permissive
      FROM pg_policies WHERE schemaname='public' AND tablename='sale_items'
        AND policyname IN ('auth_select_sale_items','financial_visibility_sale_items',
          'auth_insert_sale_items','auth_update_sale_items','auth_delete_sale_items')
      ORDER BY policyname`);
    expect(p.rows).toEqual([
      {policyname:'auth_delete_sale_items',cmd:'DELETE',permissive:'PERMISSIVE'},
      {policyname:'auth_insert_sale_items',cmd:'INSERT',permissive:'PERMISSIVE'},
      {policyname:'auth_select_sale_items',cmd:'SELECT',permissive:'PERMISSIVE'},
      {policyname:'auth_update_sale_items',cmd:'UPDATE',permissive:'PERMISSIVE'},
      {policyname:'financial_visibility_sale_items',cmd:'SELECT',permissive:'RESTRICTIVE'},
    ]);
  });
});
