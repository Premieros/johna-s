import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const url = getDbUrl();
describe.skipIf(!url)('monthly costing source aggregation at production-sized cardinality', () => {
  let db: pg.Client;
  const org = randomUUID(), branch = randomUUID(), warehouse = randomUUID();
  const product = randomUUID(), actor = randomUUID();
  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN');
    await db.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await db.query(`INSERT INTO public.organizations(id,name,slug) VALUES($1,'Month scale',$2)`,[org,`month-${org}`]);
    await db.query(`INSERT INTO public.branches(id,name,organization_id) VALUES($1,'Monthly scale',$2)`,[branch,org]);
    await db.query(`INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES($1,'Monthly WH',$2,true)`,[warehouse,branch]);
    await db.query(`INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,'Monthly actor','super_admin',$3,true)`,[actor,`${actor}@test.local`,branch]);
    await db.query(`INSERT INTO public.products(id,name,branch_id,sale_price,cost_price,is_active) VALUES($1,'Month product',$2,100,30,true)`,[product,branch]);
    await db.query('SELECT public.ensure_chart_of_accounts($1)',[branch]);
    await db.query('SELECT public.seed_account_mappings($1)',[branch]);
    // 2500 invoices exceed the larger observed branch month (2366). Every fourth
    // invoice has no cost; overlaps and real zero costs enforce source precedence.
    await db.query(`INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,status,created_at)
      SELECT md5($1||':sale:'||i)::uuid,'MONTH-'||i,$1::uuid,$2,100,100,100,'completed',now()
      FROM generate_series(1,2500) i`,[branch,warehouse]);
    await db.query(`INSERT INTO public.journal_entries(id,entry_number,branch_id,entry_date,reference_type,reference_id,description)
      SELECT md5($1||':je:'||i)::uuid,'MONTH-JE-'||$1||'-'||i,$1::uuid,CURRENT_DATE,'sale',md5($1||':sale:'||i)::uuid,'Cost fixture'
      FROM generate_series(1,2500) i WHERE i%4=0`,[branch]);
    await db.query(`INSERT INTO public.journal_entry_lines(journal_entry_id,account_id,debit,credit)
      SELECT md5($1||':je:'||i)::uuid,public.resolve_account_key($1::uuid,'cogs'),CASE WHEN i%8=4 THEN 5 ELSE 10 END,0
      FROM generate_series(1,2500) i WHERE i%4=0
      UNION ALL
      SELECT md5($1||':je:'||i)::uuid,public.resolve_account_key($1::uuid,CASE WHEN i%8=4 THEN 'cogs' ELSE 'inventory_fg' END),0,CASE WHEN i%8=4 THEN 5 ELSE 10 END
      FROM generate_series(1,2500) i WHERE i%4=0`,[branch]);
    await db.query(`INSERT INTO public.orders(id,order_number,branch_id,order_type,status,inventory_warehouse_id)
      SELECT md5($1||':order:'||i)::uuid,'MONTH-ORDER-'||i,$1::uuid,'takeaway','completed',$2
      FROM generate_series(1,2500) i WHERE i%4 IN(0,1)`,[branch,warehouse]);
    await db.query(`INSERT INTO public.order_items(id,order_id,product_id,unit_name,quantity,unit_price,total)
      SELECT md5($1||':item:'||i)::uuid,md5($1||':order:'||i)::uuid,$2,'piece',2,50,100
      FROM generate_series(1,2500) i WHERE i%4 IN(0,1)`,[branch,product]);
    await db.query(`INSERT INTO public.order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity,voided_quantity,total_cost,settled_sale_id)
      SELECT md5($1||':event:'||i)::uuid,$1::uuid,$2,md5($1||':order:'||i)::uuid,md5($1||':item:'||i)::uuid,2,1,
        CASE WHEN i%8=5 THEN 0 ELSE 40 END,md5($1||':sale:'||i)::uuid
      FROM generate_series(1,2500) i WHERE i%4 IN(0,1)`,[branch,warehouse]);
    await db.query(`INSERT INTO public.inventory_ledger(product_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id)
      SELECT $1::uuid,$2::uuid,$3::uuid,-1,CASE WHEN i%4=2 THEN 30 ELSE 999 END,-CASE WHEN i%4=2 THEN 30 ELSE 999 END,
        'sale','sale',md5($2::text||':sale:'||i)::uuid FROM generate_series(1,2500) i WHERE i%4<>3`,[product,branch,warehouse]);
  });
  afterAll(async () => { if(db){ await db.query('ROLLBACK').catch(()=>{});await db.end(); } });

  it('returns all2500 invoices under authenticated RLS and executes source aggregates once', async () => {
    await db.query('SAVEPOINT monthly_scale_read');
    try {
      await db.query(`SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true)`,[actor]);
      await db.query('SET LOCAL ROLE authenticated');
      const result = (await db.query(`SELECT public.get_costing_sales_summary($1,CURRENT_DATE-1,CURRENT_DATE+1) result`,[branch])).rows[0].result;
      expect(result).toEqual({sales_count:2500,net_sales:250000,cogs:28130,ratio:11.25});
      // Explain the exact body with only its three argument identifiers bound;
      // the function itself is not inlineable because its search_path is fixed.
      const definition = (await db.query(`SELECT pg_get_functiondef('public.get_costing_sales_summary(uuid,date,date)'::regprocedure) definition`)).rows[0].definition as string;
      const body = definition.split('AS $function$\n')[1].split('$function$')[0]
        .replace(/\bp_branch_id\b/g,'$1::uuid').replace(/\bp_from\b/g,'$2::date').replace(/\bp_to\b/g,'$3::date');
      const dates = (await db.query(`SELECT (CURRENT_DATE-1)::text a,(CURRENT_DATE+1)::text b`)).rows[0];
      const plan = (await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+body,[branch,dates.a,dates.b])).rows;
      const aggregateLoops: number[] = [];
      const visit = (value: unknown): void => {
        if(!value||typeof value!=='object')return;
        const node = value as Record<string,unknown>;
        if(node['Node Type']==='Aggregate' && /^CTE (journal_costs|kitchen_costs|legacy_costs|resolved_costs)$/.test(String(node['Subplan Name'])) && Number(node['Actual Loops'])>0)aggregateLoops.push(Number(node['Actual Loops']));
        Object.values(node).forEach(visit);
      };
      visit(plan);expect(aggregateLoops).toHaveLength(4);
      expect(Math.max(...aggregateLoops)).toBe(1);
      const root = (plan[0]['QUERY PLAN'] as {Plan: Record<string,unknown>; 'Execution Time':number}[])[0];
      console.log('MONTHLY_COSTING_2500',JSON.stringify({source:'owned localhost only; not production latency',aggregateLoops,executionMs:root['Execution Time'],sharedHits:root.Plan['Shared Hit Blocks']}));
    } finally { await db.query('ROLLBACK TO SAVEPOINT monthly_scale_read'); }
  });

  it('retains an invoker function and refuses anonymous execution',async()=>{
    const row=(await db.query(`SELECT p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon_access FROM pg_proc p WHERE p.oid='public.get_costing_sales_summary(uuid,date,date)'::regprocedure`)).rows[0];
    expect(row).toEqual({prosecdef:false,anon_access:false});
  });
});
