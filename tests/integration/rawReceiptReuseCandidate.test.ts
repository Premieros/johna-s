import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';
const dbUrl=getDbUrl();
let local=false;
try {const u=new URL(dbUrl);local=['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&['postgres:','postgresql:'].includes(u.protocol);}catch{/* no disposable DB */}
const candidate=readFileSync('scripts/experiments/raw_fifo_receipt_reuse_candidate_20261013.sql','utf8');


describe.skipIf(!local)('unwired receipt write reuse, production-shaped estimates',()=>{
  let db:pg.Client;
  const branch=randomUUID(),wh=randomUUID(),otherWh=randomUUID();
  beforeAll(async()=>{
    db=openDb(dbUrl);await db.connect();await db.query('BEGIN');
    // These must come from restored canonical history; do not synthesize missing tables.
    for(const name of ['raw_fifo_price_fallback_runs','raw_fifo_price_fallback_plan','raw_fifo_debt_price_estimates']){
      expect((await db.query('SELECT to_regclass($1)::text relation',['public.'+name])).rows[0].relation).toBe(name);
    }
    await db.query(candidate);
    // Reverse only the receipt update transformation; all source/valuation logic matches live.
    const start=candidate.indexOf('    -- Defer only sale/kitchen sources');
    const end=candidate.indexOf('\n    UPDATE public.inventory_ledger',start);
    const final=candidate.indexOf('  -- Flush only successful');
    const ret=candidate.indexOf('  RETURN jsonb_build_object(',final);
    expect(start).toBeGreaterThan(0);expect(end).toBeGreaterThan(start);
    expect(final).toBeGreaterThan(end);expect(ret).toBeGreaterThan(final);
    let baseline=candidate.slice(0,final)+candidate.slice(ret);
    baseline=baseline.slice(0,start)+'    UPDATE public.raw_material_batches\n    SET quantity=GREATEST(quantity-v_take,0)\n    WHERE id=v_batch.id;\n'+baseline.slice(end);
    baseline=baseline.replace(/_raw_fifo_settle_receipt_reuse_candidate/g,'_raw_fifo_settle_receipt_baseline_test')
      .replace(/_raw_add_receipt_reuse_candidate/g,'_raw_add_receipt_baseline_test');
    await db.query(baseline);
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Receipt reuse QA')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Receipt QA',$3,true,true),($2,'Other QA',$3,true,false)",[wh,otherWh,branch]);
    await db.query('SELECT public.ensure_chart_of_accounts($1)',[branch]);await db.query('SELECT public.seed_account_mappings($1)',[branch]);
    await db.query('CREATE TEMP TABLE receipt_write_audit(raw_id uuid,quantity numeric) ON COMMIT DROP');
    await db.query("CREATE FUNCTION pg_temp.receipt_write_audit() RETURNS trigger LANGUAGE plpgsql AS $audit$ BEGIN IF NEW.source_type='receipt_reuse_qa' THEN INSERT INTO pg_temp.receipt_write_audit VALUES(NEW.raw_material_id,NEW.quantity); END IF; RETURN NEW; END $audit$");
    await db.query('CREATE TRIGGER receipt_write_audit AFTER UPDATE OF quantity ON public.raw_material_batches FOR EACH ROW EXECUTE FUNCTION pg_temp.receipt_write_audit()');
  },30000);
  afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
  async function fixture(count:number,estimated=false){
    const raw=randomUUID(),sale=randomUUID();
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Receipt raw',$3,0,true)",[raw,'RR-'+raw,branch]);
    await db.query("INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type) VALUES($1,$2,$3,$4,100,100,100,'cash','completed','takeaway')",[sale,'RR-'+sale,branch,wh]);
    for(let i=0;i<count;i++){
      const r=(await db.query("SELECT public._raw_remove_fifo($1,$2,$3,1,'sale','sale',$4,$5,NULL,true) r",[raw,branch,wh,sale,'RR-'+i])).rows[0].r;
      expect(r.success).toBe(true);
    }
    if(estimated){
      const run=randomUUID();
      await db.query("INSERT INTO public.raw_fifo_price_fallback_runs(id,branch_id,status) VALUES($1,$2,'applied')",[run,branch]);
      await db.query("INSERT INTO public.raw_fifo_debt_price_estimates(debt_id,source_ledger_id,run_id,branch_id,raw_material_id,estimated_unit_cost,original_estimated_quantity,remaining_estimated_quantity,candidate_source,candidate_event_id,candidate_at) SELECT id,source_ledger_id,$2,branch_id,raw_material_id,3,debt_quantity,debt_quantity,'pricing','qa',now() FROM public.raw_fifo_debts WHERE raw_material_id=$1",[raw,run]);
      await db.query('UPDATE public.inventory_ledger SET total_cost=quantity*3,unit_cost=3 WHERE raw_material_id=$1 AND quantity<0',[raw]);
      expect((await db.query('SELECT public._fifo_adjust_sale_cogs_delta($1,$2) r',[sale,count*3])).rows[0].r.success).toBe(true);
    }
    return {raw,sale};
  }
  async function state(raw:string,sale:string){
    const q=async(sql:string,args:unknown[]=[raw])=>(await db.query(sql,args)).rows;
    return {
      batches:await q('SELECT warehouse_id,quantity,unit_cost,source_type FROM public.raw_material_batches WHERE raw_material_id=$1 ORDER BY warehouse_id,source_type,quantity,unit_cost'),
      inventory:await q('SELECT quantity,avg_cost FROM public.raw_material_inventory WHERE raw_material_id=$1'),
      debts:await q('SELECT source_ledger_id,debt_quantity,settled_quantity FROM public.raw_fifo_debts WHERE raw_material_id=$1 ORDER BY source_ledger_id'),
      estimates:await q('SELECT source_ledger_id,remaining_estimated_quantity,replaced_quantity,zero_cost_finalized_quantity FROM public.raw_fifo_debt_price_estimates WHERE raw_material_id=$1 ORDER BY source_ledger_id'),
      sources:await q('SELECT id,quantity,total_cost,unit_cost,before_qty,after_qty FROM public.inventory_ledger WHERE raw_material_id=$1 AND quantity<0 ORDER BY id'),
      settlements:await q('SELECT d.source_ledger_id,s.quantity,s.unit_cost,s.total_cost,s.reconciliation_status,s.reconciliation_error FROM public.raw_fifo_settlements s JOIN public.raw_fifo_debts d ON d.id=s.debt_id WHERE d.raw_material_id=$1 ORDER BY d.source_ledger_id,s.unit_cost,s.quantity'),
      cogs:await q('SELECT exact_delta,posted_delta FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',[sale]),
      journal:await q("SELECT jl.account_id,sum(jl.debit)::text debit,sum(jl.credit)::text credit FROM public.journal_entries je JOIN public.journal_entry_lines jl ON jl.journal_entry_id=je.id WHERE je.reference_id=$1 AND je.reference_type='fifo_cogs_reconcile' GROUP BY jl.account_id ORDER BY jl.account_id",[sale]),
    };
  }
  type Variant='baseline'|'reuse';
  async function receipt(variant:Variant,raw:string,qty:number,cost:number,reference:string,warehouse=wh){
    const fn=variant==='baseline'?'_raw_add_receipt_baseline_test':'_raw_add_receipt_reuse_candidate';
    const r=(await db.query('SELECT public.'+fn+"($1,$2,$3,$4,$5,NULL,NULL,NULL,'purchase_receipt','receipt_reuse_qa',$6,'RR-RECEIPT',NULL) r",[raw,branch,warehouse,qty,cost,reference])).rows[0].r;
    expect(r.success,JSON.stringify(r)).toBe(true);
    return {settled:Number(r.fifo_settled_quantity),value:r.fifo_settled_value};
  }
  async function writes(raw:string){return Number((await db.query('SELECT count(*) n FROM pg_temp.receipt_write_audit WHERE raw_id=$1',[raw])).rows[0].n);}
  for(const estimated of [false,true]){
    it('matches partial, zero-cost, final receipts and retry; estimates='+estimated,async()=>{
      const {raw,sale}=await fixture(6,estimated),ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
      const run=async(variant:Variant)=>{
        expect((await receipt(variant,raw,4,11,ids[0],otherWh)).settled).toBe(0);
        const a=await receipt(variant,raw,2,0,ids[1]),b=await receipt(variant,raw,2,7,ids[2]),c=await receipt(variant,raw,4,9,ids[3]);
        expect([a.settled,b.settled,c.settled]).toEqual([2,2,2]);
        const before=await state(raw,sale);
        const entry=(await db.query('SELECT id FROM public.inventory_ledger WHERE raw_material_id=$1 AND reference_id=$2',[raw,ids[3]])).rows[0].id;
        const batch=(await db.query('SELECT id FROM public.raw_material_batches WHERE raw_material_id=$1 AND source_id=$2',[raw,ids[3]])).rows[0].id;
        const fn=variant==='baseline'?'_raw_fifo_settle_receipt_baseline_test':'_raw_fifo_settle_receipt_reuse_candidate';
        expect(Number((await db.query('SELECT public.'+fn+'($1,$2,NULL) r',[entry,batch])).rows[0].r.settled_quantity)).toBe(0);
        expect(await state(raw,sale)).toEqual(before);
        expect(before.journal).toHaveLength(2);
        expect(before.journal.reduce((s,r)=>s+Number(r.debit),0)).toBe(before.journal.reduce((s,r)=>s+Number(r.credit),0));
        expect(Number(before.inventory[0].quantity)).toBe(6);
        if(estimated){
          expect(before.estimates.reduce((s,r)=>s+Number(r.zero_cost_finalized_quantity),0)).toBe(2);
          expect(before.estimates.reduce((s,r)=>s+Number(r.replaced_quantity),0)).toBe(4);
        }
        return {result:before,writes:await writes(raw)};
      };
      await db.query('SAVEPOINT receipt_replay');const old=await run('baseline');await db.query('ROLLBACK TO receipt_replay');
      const next=await run('reuse');expect(next.result).toEqual(old.result);expect(old.writes).toBe(6);expect(next.writes).toBe(3);
      await db.query('RELEASE receipt_replay');
    },45000);
  }
  it('settles 100 sources with one receipt batch update and records actual isolated counters',async()=>{
    const {raw,sale}=await fixture(100),reference=randomUUID();
    const run=async(variant:Variant)=>{
      const fn=variant==='baseline'?'_raw_add_receipt_baseline_test':'_raw_add_receipt_reuse_candidate';
      const p=(await db.query('EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) SELECT public.'+fn+"($1,$2,$3,120,7,NULL,NULL,NULL,'purchase_receipt','receipt_reuse_qa',$4,'RR-BENCH',NULL)",[raw,branch,wh,reference])).rows[0]['QUERY PLAN'][0];
      const result=await state(raw,sale);
      expect(result.debts.reduce((s,r)=>s+Number(r.settled_quantity),0)).toBe(100);
      return {result,writes:await writes(raw),ms:p['Execution Time'],plan:p.Plan};
    };
    await db.query('SAVEPOINT receipt_bench');const old=await run('baseline');await db.query('ROLLBACK TO receipt_bench');
    const next=await run('reuse');expect(next.result).toEqual(old.result);expect(old.writes).toBe(100);expect(next.writes).toBe(1);
    console.info('RECEIPT_REUSE_100_SOURCE_LOCAL',JSON.stringify({baseline:{writes:old.writes,ms:old.ms,plan:old.plan},candidate:{writes:next.writes,ms:next.ms,plan:next.plan},scope:'same add/summary/estimate shape; update audit enabled both sides; one receipt sample, not production p95'}));
    await db.query('RELEASE receipt_bench');
  },90000);
  it('rolls back a later source failure and all deferred writes',async()=>{
    const {raw,sale}=await fixture(3);
    const source=Number((await db.query('SELECT source_ledger_id FROM public.raw_fifo_debts WHERE raw_material_id=$1 ORDER BY source_ledger_id OFFSET 1 LIMIT 1',[raw])).rows[0].source_ledger_id);
    await db.query("CREATE FUNCTION pg_temp.receipt_fail_source() RETURNS trigger LANGUAGE plpgsql AS $fail$ BEGIN IF NEW.id="+source+" THEN RAISE EXCEPTION 'QA_LATER_SOURCE_FAILURE'; END IF; RETURN NEW; END $fail$");
    await db.query('CREATE TRIGGER receipt_fail_source BEFORE UPDATE OF total_cost ON public.inventory_ledger FOR EACH ROW EXECUTE FUNCTION pg_temp.receipt_fail_source()');
    const initial=await state(raw,sale);
    for(const variant of ['baseline','reuse'] as const){
      await db.query('SAVEPOINT receipt_failure');
      await expect(receipt(variant,raw,5,7,randomUUID())).rejects.toThrow('QA_LATER_SOURCE_FAILURE');
      await db.query('ROLLBACK TO receipt_failure');await db.query('RELEASE receipt_failure');
      expect(await state(raw,sale)).toEqual(initial);expect(await writes(raw)).toBe(0);
    }
    await db.query('DROP TRIGGER receipt_fail_source ON public.inventory_ledger');
  });

  it('flushes accumulated receipt quantity before an unsupported propagation source',async()=>{
    const {raw,sale}=await fixture(3);
    const source=Number((await db.query('SELECT source_ledger_id FROM public.raw_fifo_debts WHERE raw_material_id=$1 ORDER BY source_ledger_id OFFSET 1 LIMIT 1',[raw])).rows[0].source_ledger_id);
    await db.query("UPDATE public.inventory_ledger SET reference_type='qa_unsupported' WHERE id=$1",[source]);
    // Observe at the same source-update boundary that precedes reference propagation.
    await db.query('CREATE TEMP TABLE receipt_observation(quantity numeric) ON COMMIT DROP');
    await db.query("CREATE FUNCTION pg_temp.receipt_observe_source() RETURNS trigger LANGUAGE plpgsql AS $observe$ BEGIN IF NEW.id="+source+" THEN INSERT INTO pg_temp.receipt_observation SELECT quantity FROM public.raw_material_batches WHERE raw_material_id=NEW.raw_material_id AND source_type='receipt_reuse_qa'; END IF; RETURN NEW; END $observe$");
    await db.query('CREATE TRIGGER receipt_observe_source AFTER UPDATE OF total_cost ON public.inventory_ledger FOR EACH ROW EXECUTE FUNCTION pg_temp.receipt_observe_source()');
    const reference=randomUUID();
    const run=async(variant:Variant)=>{
      await receipt(variant,raw,5,7,reference);
      expect((await db.query('SELECT quantity FROM pg_temp.receipt_observation')).rows.map(r=>Number(r.quantity))).toEqual([3]);
      const result=await state(raw,sale);
      expect(result.settlements.filter(r=>r.reconciliation_status==='error')).toHaveLength(1);
      return {result,writes:await writes(raw)};
    };
    await db.query('SAVEPOINT receipt_propagation');
    const old=await run('baseline');await db.query('ROLLBACK TO receipt_propagation');
    const next=await run('reuse');expect(next.result).toEqual(old.result);
    expect(old.writes).toBe(3);expect(next.writes).toBe(2);
    await db.query('RELEASE receipt_propagation');
    await db.query('DROP TRIGGER receipt_observe_source ON public.inventory_ledger');
  });

  it('retains private invoker candidates and canonical estimate table protections',async()=>{
    for(const signature of ['_raw_fifo_settle_receipt_reuse_candidate(bigint,uuid,uuid)','_raw_add_receipt_reuse_candidate(uuid,uuid,uuid,numeric,numeric,text,date,date,text,text,uuid,text,uuid)']){
      const r=(await db.query("SELECT p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service FROM pg_proc p WHERE p.oid=$1::regprocedure",['public.'+signature])).rows[0];
      expect(r).toEqual({prosecdef:false,anon:false,authenticated:false,service:false});
    }
    for(const name of ['raw_fifo_price_fallback_runs','raw_fifo_price_fallback_plan','raw_fifo_debt_price_estimates']){
      const row=(await db.query("SELECT c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') anon,has_table_privilege('authenticated',c.oid,'SELECT') authenticated FROM pg_class c WHERE c.oid=$1::regclass",['public.'+name])).rows[0];
      expect(row).toEqual({relrowsecurity:true,anon:false,authenticated:false});
    }
  });
});
