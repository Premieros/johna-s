import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl,openDb } from './db';

// Synthetic scale reproduction only, never real customer records or production.
const url=getDbUrl();
let local=false;
try { const u=new URL(url);local=['127.0.0.1','localhost','[::1]'].includes(u.hostname) && ['postgres:','postgresql:'].includes(u.protocol); }
catch {}
const script=readFileSync('scripts/db/candidates/fifo_receipt_reduce_batch_writes_20261031.sql','utf8');
const patch=script.slice(script.indexOf('DO $patch_fifo_receipt_writes$'),script.lastIndexOf('COMMIT;')).trim();

describe.skipIf(!local)('receipt settlement, 717 kitchen FIFO debts benchmark',()=>{
  let db:pg.Client;
  const branch=randomUUID(),wh=randomUUID(),raw=randomUUID();
  const order=randomUUID(),orderItem=randomUUID();
  const saleIds=Array.from({length:473},()=>randomUUID());
  let seeded=0;
  beforeAll(async()=>{
    db=openDb(url);await db.connect();await db.query('BEGIN');
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'FIFO kitchen-load test')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'FIFO load WH',$2,true,true)",[wh,branch]);
    await db.query('SELECT public.ensure_chart_of_accounts($1)',[branch]);
    await db.query('SELECT public.seed_account_mappings($1)',[branch]);
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Kitchen load raw',$3,0,true)",[raw,'RAW-'+raw,branch]);
    await db.query("INSERT INTO public.orders(id,order_number,branch_id,status) VALUES ($1,$2,$3,'completed')",[order,'ORD-'+order,branch]);
    await db.query('INSERT INTO public.order_items(id,order_id,quantity,unit_price) VALUES ($1,$2,1,1)',[orderItem,order]);
    for(let i=0;i<saleIds.length;i++){
      await db.query("INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type) VALUES($1,$2,$3,$4,100,100,100,'cash','completed','takeaway')",[saleIds[i],'K-'+saleIds[i],branch,wh]);
    }
    for(let i=0;i<717;i++){
      const event=randomUUID(),sale=saleIds[i%saleIds.length];
      await db.query("INSERT INTO public.order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity,settled_sale_id,total_cost) VALUES($1,$2,$3,$4,$5,1,$6,0)",[event,branch,wh,order,orderItem,sale]);
      await db.query("INSERT INTO public.order_kitchen_inventory_effects(event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost) VALUES($1,$2,$3,'raw_material',$4,0.01,0)",[event,branch,wh,raw]);
      const d=(await db.query<{r:{success:boolean}}>("SELECT public._raw_remove_fifo($1,$2,$3,0.01,'kitchen_send','kitchen_send',$4,$5,NULL,true) r",[raw,branch,wh,event,'KI-'+i])).rows[0].r;
      expect(d.success,JSON.stringify(d)).toBe(true);
      seeded++;
    }
    await db.query(patch);
  },150000);
  afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});

  it('keeps 717 kitchen debts and 473 settled sale references consistent; records runtime',async()=>{
    expect(seeded).toBe(717);
    const started=performance.now();
    const result=(await db.query<{r:{success:boolean,detail?:string,fifo_settled_quantity:string}}>(
      "SELECT public._raw_add($1,$2,$3,13.285,1200,NULL,NULL,NULL,'transfer','warehouse_transfer',$4,'TRANSFER-LOAD',NULL) r",
      [raw,branch,wh,randomUUID()])).rows[0].r;
    const ms=Math.round(performance.now()-started);
    expect(result.success,JSON.stringify(result)).toBe(true);
    expect(Number(result.fifo_settled_quantity)).toBeCloseTo(7.17,4);
    const x=(await db.query<{settled:string,settlement_count:number,events:number,effects:number,sales:number}>(
      `SELECT (SELECT sum(settled_quantity)::text FROM public.raw_fifo_debts WHERE raw_material_id=$1) settled,
              (SELECT count(*)::int FROM public.raw_fifo_settlements s JOIN public.raw_fifo_debts d ON d.id=s.debt_id WHERE d.raw_material_id=$1) settlement_count,
              (SELECT count(*)::int FROM public.order_kitchen_inventory_events WHERE order_id=$2 AND total_cost>0) events,
              (SELECT count(*)::int FROM public.order_kitchen_inventory_effects WHERE target_id=$1 AND total_cost>0) effects,
              (SELECT count(*)::int FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=ANY($3::uuid[])) sales`,
      [raw,order,saleIds])).rows[0];
    expect(Number(x.settled)).toBeCloseTo(7.17,4);
    expect(x.settlement_count).toBe(717);
    expect(x.events).toBe(717);expect(x.effects).toBe(717);expect(x.sales).toBe(473);
    const journals=(await db.query<{count:number,unbalanced:number}>(`
      SELECT count(*)::int count, COUNT(*) FILTER (WHERE abs(debits-credits)>0.000001)::int unbalanced
      FROM (SELECT je.id,sum(jl.debit)::numeric debits,sum(jl.credit)::numeric credits
            FROM public.journal_entries je JOIN public.journal_entry_lines jl ON jl.journal_entry_id=je.id
            WHERE je.reference_type='fifo_cogs_reconcile' AND je.reference_id=ANY($1::uuid[])
            GROUP BY je.id) js`,[saleIds])).rows[0];
    expect(journals.count).toBe(473);
    expect(journals.unbalanced).toBe(0);
    console.info('FIFO_KITCHEN_717_DISPOSABLE_BENCHMARK_MS',JSON.stringify({ms,debts:717,kitchen_events:717,sales:473,journals:journals.count,source:'single isolated CI runner, not production p95'}));
    // Run duration is evidence, not a production SLO guarantee; CI runner hardware
    // and SQL concurrency vary. The 30-second API gate requires staged load proof.
  },150000);
});
