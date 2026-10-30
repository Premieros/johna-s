import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const url = getDbUrl();
describe.skipIf(!url)('monthly costing source aggregation at production-sized cardinality', () => {
  let db: pg.Client;
  const org = randomUUID(), branch = randomUUID(), warehouse = randomUUID();
  const product = randomUUID(), actor = randomUUID();
  const readerRole = `month_reader_${org.slice(0,8)}`;
  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='8s'");
    await db.query("SET LOCAL lock_timeout='2s'");
    await db.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await db.query(`INSERT INTO public.organizations(id,name,slug) VALUES($1,'Month scale',$2)`,[org,`month-${org}`]);
    await db.query(`INSERT INTO public.branches(id,name,organization_id) VALUES($1,'Monthly scale',$2)`,[branch,org]);
    await db.query(`INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES($1,'Monthly WH',$2,true)`,[warehouse,branch]);
    await db.query(`INSERT INTO public.roles(role,name_ar,name_en,permissions,is_active) VALUES($1,'قارئ التكلفة','Cost reader','["reports.costing","sales.view","raw_materials.view","history.unlimited"]',true)`,[readerRole]);
    await db.query(`INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,'Monthly actor',$4,$3,true)`,[actor,`${actor}@test.local`,branch,readerRole]);
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
      expect((await db.query(`SELECT public.can_permission('history.unlimited') allowed`)).rows[0].allowed).toBe(true);
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

  it('skips priced raw issues through the partial index without changing supplemental costs',async()=>{
    await db.query('SAVEPOINT zero_issue_index_proof');
    try {
      // The2500-invoice cardinality is covered above. Isolate this index proof
      // to its one target sale; unrelated parents add no coverage of index reads.
      await db.query(`UPDATE public.sales SET created_at=now()-interval '10 days' WHERE branch_id=$1 AND id<>md5($1::text||':sale:1')::uuid`,[branch]);
      const raw=randomUUID();
      const unit=(await db.query(`SELECT id FROM public.measurement_units WHERE code='KG' LIMIT 1`)).rows[0].id;
      await db.query(`INSERT INTO public.raw_materials(id,code,name,unit_id,branch_id,default_cost,is_active) VALUES($1,$2,'Index raw',$3,$4,5,true)`,[raw,`IDX-${raw}`,unit,branch]);
      await db.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,priced_at,reference_number) VALUES($1,$2,5,'pricing',now(),'ZERO-ISSUE-INDEX')`,[raw,branch]);
      const event=(await db.query(`SELECT md5($1::text||':event:1')::uuid id`,[branch])).rows[0].id;
      await db.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id)
        SELECT $1::uuid,$2::uuid,$3::uuid,-1,CASE WHEN i%10<3 THEN 0 ELSE 5 END,-CASE WHEN i%10<3 THEN 0 ELSE 5 END,
          'kitchen_send','kitchen_send',$4::uuid FROM generate_series(1,1000) i`,[raw,branch,warehouse,event]);
      const movementSql=`SELECT il.id FROM public.inventory_ledger il
        WHERE il.reference_type='kitchen_send' AND il.reference_id=$1 AND il.branch_id=$2
          AND il.entry_type='kitchen_send' AND il.raw_material_id IS NOT NULL AND il.quantity<0
          AND COALESCE(il.unit_cost,0)=0 AND COALESCE(il.total_cost,0)=0
          AND private.financial_reference_visible(il.reference_type,il.reference_id,(md5(il.id::text))::uuid,il.branch_id,il.created_at)`;
      const definition=(await db.query(`SELECT pg_get_functiondef('public.get_historical_sale_cost_estimates(uuid,date,date)'::regprocedure) definition`)).rows[0].definition as string;
      const historicalBody=definition.slice(definition.indexOf('  WITH history_bounds'),definition.indexOf('  RETURN result;'))
        .replace(/\bINTO result\b/,'').trim().replace(/;$/,'')
        .replace(/\bp_branch_id\b/g,'$1::uuid').replace(/\bp_from\b/g,'$2::date').replace(/\bp_to\b/g,'$3::date');
      const dates=(await db.query(`SELECT (CURRENT_DATE-1)::text a,(CURRENT_DATE+1)::text b`)).rows[0];
      // Numeric +0 preserves the zero predicate but prevents use of the partial
      // index in the baseline plan. Never DROP an index on a shared fixture table.
      const withoutPartial=(sql:string)=>sql.replace(/COALESCE\(il\.unit_cost,\s*0\)\s*=\s*0/g,'(COALESCE(il.unit_cost,0)+0)=0');
      expect(withoutPartial(historicalBody)).toContain('+0');
      const read=async(baseline:boolean)=>{
        await db.query(`SELECT set_config('app.user_id',$1,true),set_config('request.jwt.claim.sub',$1,true)`,[actor]);
        await db.query('SET LOCAL ROLE authenticated');
        const sql=baseline?withoutPartial(movementSql):movementSql;
        const rows=(await db.query(sql+' ORDER BY il.id',[event,branch])).rows;
        const plan=(await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,[event,branch])).rows;
        const historical=(await db.query(baseline?`WITH report(result) AS MATERIALIZED (${withoutPartial(historicalBody)}) SELECT result FROM report`:
          `SELECT public.get_historical_sale_cost_estimates($1,$2,$3) result`,[branch,dates.a,dates.b])).rows[0].result;
        await db.query('RESET ROLE');
        await db.query(`SELECT set_config('app.user_id','',true),set_config('request.jwt.claim.sub','',true)`);
        return {rows,plan,historical};
      };
      const before=await read(true),after=await read(false);
      expect(after.rows).toHaveLength(300);expect(after.rows).toEqual(before.rows);
      expect(after.historical).toEqual(before.historical);expect(after.historical).toHaveLength(1);
      expect(Number(after.historical[0].estimated_cost)).toBe(750);
      expect(JSON.stringify(before.plan)).not.toContain('idx_inventory_ledger_zero_raw_issue_ref');
      expect(JSON.stringify(after.plan)).toContain('idx_inventory_ledger_zero_raw_issue_ref');
      const root=(value:{[key:string]:unknown}[]) => (value[0]['QUERY PLAN'] as {Plan:Record<string,unknown>}[])[0].Plan;
      expect(Number(root(after.plan)['Shared Hit Blocks'])).toBeLessThan(Number(root(before.plan)['Shared Hit Blocks']));
      // Measure incremental index WAL on a private, trigger-free clone with the
      // real column/index definitions. This is not whole operational-write latency.
      await db.query('CREATE TABLE public.qa_costing_issue_write_probe (LIKE public.inventory_ledger INCLUDING ALL)');
      await db.query('ALTER TABLE public.qa_costing_issue_write_probe ENABLE ROW LEVEL SECURITY');
      await db.query('REVOKE ALL ON public.qa_costing_issue_write_probe FROM PUBLIC,anon,authenticated');
      await db.query('INSERT INTO public.qa_costing_issue_write_probe SELECT * FROM public.inventory_ledger WHERE raw_material_id=$1',[raw]);
      const cloned=(await db.query(`SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
        WHERE i.indrelid='public.qa_costing_issue_write_probe'::regclass AND pg_get_expr(i.indpred,i.indrelid) LIKE '%COALESCE(total_cost%'`)).rows;
      expect(cloned).toHaveLength(1);
      const insertCost=async(cost:number)=>{
        await db.query('SAVEPOINT index_write_probe');
        try {
          const plan=(await db.query(`EXPLAIN (ANALYZE, WAL, FORMAT JSON) INSERT INTO public.qa_costing_issue_write_probe(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id)
            SELECT $1::uuid,$2::uuid,$3::uuid,-1,$5::numeric,-$5::numeric,'kitchen_send','kitchen_send',$4::uuid FROM generate_series(1,10)`,[raw,branch,warehouse,event,cost])).rows;
          const p=(plan[0]['QUERY PLAN'] as {Plan:Record<string,unknown>;'Execution Time':number}[])[0];
          return {ms:p['Execution Time'],walBytes:p.Plan['WAL Bytes'],sharedHits:p.Plan['Shared Hit Blocks']};
        } finally {await db.query('ROLLBACK TO SAVEPOINT index_write_probe');}
      };
      const pricedWith=await insertCost(5),unpricedWith=await insertCost(0);
      await db.query('DROP INDEX public."'+String(cloned[0].relname).replace(/"/g,'""')+'"');
      const pricedWithout=await insertCost(5),unpricedWithout=await insertCost(0);
      console.log('ZERO_ISSUE_PARTIAL_INDEX',JSON.stringify({source:'owned localhost; isolated clone WAL, not whole-writer latency',rows:300,
        beforeHits:root(before.plan)['Shared Hit Blocks'],afterHits:root(after.plan)['Shared Hit Blocks'],writes:{pricedWith,pricedWithout,unpricedWith,unpricedWithout}}));
    } finally { await db.query('ROLLBACK TO SAVEPOINT zero_issue_index_proof'); }
  });

  it('retains an invoker function and refuses anonymous execution',async()=>{
    const row=(await db.query(`SELECT p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon_access FROM pg_proc p WHERE p.oid='public.get_costing_sales_summary(uuid,date,date)'::regprocedure`)).rows[0];
    expect(row).toEqual({prosecdef:false,anon_access:false});
  });
});
