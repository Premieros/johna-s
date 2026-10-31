import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';

// Synthetic scale reproduction only, never real customer records or production.
const url=getDbUrl();
let local=false;
try { const u=new URL(url);local=['127.0.0.1','localhost','[::1]'].includes(u.hostname) && ['postgres:','postgresql:'].includes(u.protocol); }
catch { /* No disposable local database configured. */ }
const script=readFileSync('scripts/db/candidates/fifo_receipt_reduce_batch_writes_20261031.sql','utf8');
const patch=script.slice(script.indexOf('DO $patch_fifo_receipt_writes$'),script.lastIndexOf('COMMIT;')).trim();

describe.skipIf(!local)('receipt settlement, 717 kitchen FIFO debts benchmark',()=>{
  let db:pg.Client;
  const branch=randomUUID(),wh=randomUUID(),raw=randomUUID();
  const order=randomUUID(),orderItem=randomUUID(),product=randomUUID();
  const saleIds=Array.from({length:473},()=>randomUUID());
  let seeded=0;
  const priorEstimateRun=randomUUID();
  const priceEstimatedCount=94; // read-only production shape: 94 priced, 623 unpriced
  beforeAll(async()=>{
    db=openDb(url);await db.connect();await db.query('BEGIN');
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'FIFO kitchen-load test')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'FIFO load WH',$2,true,true)",[wh,branch]);
    await db.query('SELECT public.ensure_chart_of_accounts($1)',[branch]);
    await db.query('SELECT public.seed_account_mappings($1)',[branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Kitchen load raw',$3,0,true)",[raw,'RAW-'+raw,branch]);
    await db.query("INSERT INTO public.orders(id,order_number,branch_id,status) VALUES ($1,$2,$3,'completed')",[order,'ORD-'+order,branch]);
    await db.query("INSERT INTO public.products(id,name,branch_id,product_type,sale_price,cost_price,is_active) VALUES($1,'FIFO kitchen synthetic item',$2,'ready',1,0,true)",[product,branch]);
    await db.query('INSERT INTO public.order_items(id,order_id,product_id,quantity,unit_price) VALUES ($1,$2,$3,1,1)',[orderItem,order,product]);
    for(let i=0;i<saleIds.length;i++){
      await db.query("INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type) VALUES($1,$2,$3,$4,100,100,100,'cash','completed','takeaway')",[saleIds[i],'K-'+saleIds[i],branch,wh]);
    }
    // Synthetic price fallback snapshots for the 94 already-valued debts.
    // Both source ledger and its kitchen/sale COGS are valued at 1200
    // BEFORE receipt. The other 623 still need real historical reconciliation.
    await db.query(
      "INSERT INTO public.raw_fifo_price_fallback_runs(id,branch_id,status) VALUES($1,$2,'applied')",
      [priorEstimateRun,branch]);
    for(let i=0;i<717;i++){
      const event=randomUUID(),sale=saleIds[i%saleIds.length];
      await db.query("INSERT INTO public.order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity,settled_sale_id,total_cost) VALUES($1,$2,$3,$4,$5,1,$6,0)",[event,branch,wh,order,orderItem,sale]);
      await db.query("INSERT INTO public.order_kitchen_inventory_effects(event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost) VALUES($1,$2,$3,'raw_material',$4,0.01,0)",[event,branch,wh,raw]);
      const d=(await db.query<{r:{success:boolean}}>("SELECT public._raw_remove_fifo($1,$2,$3,0.01,'kitchen_send','kitchen_send',$4,$5,NULL,true) r",[raw,branch,wh,event,'KI-'+i])).rows[0].r;
      expect(d.success,JSON.stringify(d)).toBe(true);
      if(i<priceEstimatedCount){
        const priced=(await db.query<{id:string,source_ledger_id:string,source_created_at:string}>(
          'SELECT id,source_ledger_id,source_created_at FROM public.raw_fifo_debts WHERE reference_id=$1 AND raw_material_id=$2',
          [event,raw])).rows[0];
        expect(priced?.id).toBeTruthy();
        // Match the actual approved-price fallback posting lifecycle rather
        // than attaching an estimate to a still-unpriced source.
        const cost=(await db.query<{r:{success:boolean,error?:string}}>(
          "SELECT public._fifo_adjust_reference_delta('kitchen_send',$1,$2,$3,'raw_material',$4,12,0) r",
          [event,branch,wh,raw])).rows[0].r;
        expect(cost.success,JSON.stringify(cost)).toBe(true);
        await db.query(
          'UPDATE public.inventory_ledger SET unit_cost=1200,total_cost=-12 WHERE id=$1',
          [priced.source_ledger_id]);
        await db.query(`
          INSERT INTO public.raw_fifo_debt_price_estimates (
            debt_id,source_ledger_id,run_id,branch_id,raw_material_id,
            estimated_unit_cost,original_estimated_quantity,remaining_estimated_quantity,
            candidate_source,candidate_event_id,candidate_at
          ) VALUES($1,$2,$3,$4,$5,1200,0.01,0.01,'pricing',$6,$7)`,
          [priced.id,priced.source_ledger_id,priorEstimateRun,branch,raw,
           'synthetic-approved-'+i,priced.source_created_at]);
      }
      seeded++;
    }
  },150000);
  afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});


  async function snapshot() {
    const row=(await db.query<{
      debt_count:number,settled:string,settlement_count:number,
      events:number,effects:number,sales:number,estimate_remaining:string,
      estimate_replaced:string,priced_sources:number
    }>(`
      SELECT
        (SELECT count(*)::int FROM public.raw_fifo_debts WHERE raw_material_id=$1) debt_count,
        (SELECT sum(settled_quantity)::text FROM public.raw_fifo_debts WHERE raw_material_id=$1) settled,
        (SELECT count(*)::int FROM public.raw_fifo_settlements s
          JOIN public.raw_fifo_debts d ON d.id=s.debt_id WHERE d.raw_material_id=$1) settlement_count,
        (SELECT count(*)::int FROM public.order_kitchen_inventory_events
          WHERE order_id=$2 AND total_cost>0) events,
        (SELECT count(*)::int FROM public.order_kitchen_inventory_effects
          WHERE target_id=$1 AND total_cost>0) effects,
        (SELECT count(*)::int FROM public.raw_fifo_sale_cogs_adjustments
          WHERE sale_id=ANY($3::uuid[])) sales,
        (SELECT COALESCE(sum(e.remaining_estimated_quantity),0)::text
         FROM public.raw_fifo_debt_price_estimates e WHERE e.raw_material_id=$1) estimate_remaining,
        (SELECT COALESCE(sum(e.replaced_quantity),0)::text
         FROM public.raw_fifo_debt_price_estimates e WHERE e.raw_material_id=$1) estimate_replaced,
        (SELECT count(*)::int FROM public.raw_fifo_debt_price_estimates e
         WHERE e.raw_material_id=$1 AND e.estimated_unit_cost=1200) priced_sources`,
      [raw,order,saleIds])).rows[0];
    const journals=(await db.query<{
      count:number,unbalanced:number,debit_total:string,credit_total:string
    }>(`
      SELECT count(*)::int count,
        count(*) FILTER (WHERE abs(debits-credits)>0.000001)::int unbalanced,
        sum(debits)::text debit_total,sum(credits)::text credit_total
      FROM (SELECT je.id,sum(jl.debit)::numeric debits,sum(jl.credit)::numeric credits
            FROM public.journal_entries je JOIN public.journal_entry_lines jl
              ON jl.journal_entry_id=je.id
            WHERE je.reference_type='fifo_cogs_reconcile'
              AND je.reference_id=ANY($1::uuid[])
            GROUP BY je.id) js`,[saleIds])).rows[0];
    const stock=(await db.query<{q:string}>(
      'SELECT COALESCE(quantity,0)::text q FROM public.raw_material_warehouse_inventory WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3',
      [raw,branch,wh])).rows[0]?.q;
    return {row,journals,stock};
  }

  async function receipt(ref:string) {
    const start=performance.now();
    const result=(await db.query<{r:{success:boolean,detail?:string,fifo_settled_quantity:string}}>(
      "SELECT public._raw_add($1,$2,$3,13.285,1200,NULL,NULL,NULL,'transfer','warehouse_transfer',$4,$5,NULL) r",
      [raw,branch,wh,randomUUID(),ref])).rows[0].r;
    const ms=Math.round(performance.now()-start);
    expect(result.success,JSON.stringify(result)).toBe(true);
    expect(Number(result.fifo_settled_quantity)).toBeCloseTo(7.17,4);
    return {ms,data:await snapshot()};
  }

  it('compares original vs optimized 717 kitchen debts with 94 priced estimates and 623 pending',async()=>{
    expect(seeded).toBe(717);
    const initial=await snapshot();
    expect(initial.row.debt_count).toBe(717);
    expect(initial.row.priced_sources).toBe(priceEstimatedCount);
    expect(Number(initial.row.estimate_remaining)).toBeCloseTo(0.94,4);
    expect(initial.row.sales).toBeLessThanOrEqual(473);

    await db.query('SAVEPOINT before_comparison');
    const before=await receipt('BENCH-ORIGINAL');
    await db.query('ROLLBACK TO SAVEPOINT before_comparison');

    await db.query(patch);
    const after=await receipt('BENCH-OPTIMIZED');

    expect(after.data).toEqual(before.data);
    expect(after.data.row.settlement_count).toBe(717);
    expect(after.data.row.events).toBe(717);
    expect(after.data.row.effects).toBe(717);
    expect(after.data.row.sales).toBe(473);
    expect(after.data.row.priced_sources).toBe(priceEstimatedCount);
    expect(Number(after.data.row.estimate_remaining)).toBe(0);
    expect(Number(after.data.row.estimate_replaced)).toBeCloseTo(0.94,4);
    expect(after.data.journals.count).toBe(473);
    expect(after.data.journals.unbalanced).toBe(0);
    expect(Number(after.data.row.settled)).toBeCloseTo(7.17,4);
    expect(Number(after.data.stock)).toBeCloseTo(6.115,4);

    console.info('FIFO_KITCHEN_REAL_SHAPE_COMPARISON_MS',JSON.stringify({
      baseline_ms:before.ms,optimized_ms:after.ms,
      debts:717,estimated_debts:94,unpriced_debts:623,sales:473,
      journals:after.data.journals.count,accounting_parity:true,
      source:'same transaction synthetic fixture; no production traffic, not production p95'
    }));
    // The 30s PostgREST incident still requires production-shaped concurrency,
    // lock/contention and end-to-end approval tests before deployment.
  },150000);
});
