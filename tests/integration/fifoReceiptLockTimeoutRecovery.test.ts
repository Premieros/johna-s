import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// Concurrent row locks require committed fixtures visible to two PostgreSQL
// sessions. Run ONLY on CI's disposable localhost PostgreSQL (never production
// and never on a persistent developer database).
const url = getDbUrl();
let disposable = false;
try {
  const host = new URL(url).hostname;
  disposable = process.env.CI === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(host);
} catch { /* No disposable PostgreSQL URL. */ }

describe.skipIf(!disposable)('FIFO receipt blocked mid-settlement: atomic rollback and safe retry', () => {
  let worker: pg.Client;
  let blocker: pg.Client;
  const branch = randomUUID();
  const warehouse = randomUUID();
  const raw = randomUUID();
  const product = randomUUID();
  const order = randomUUID();
  const item = randomUUID();
  const sale = randomUUID();
  const events = [randomUUID(), randomUUID()];
  const receiptRef = randomUUID();

  beforeAll(async () => {
    worker = openDb(url);
    blocker = openDb(url);
    await worker.connect();
    await blocker.connect();
    await worker.query('BEGIN');
    await worker.query("INSERT INTO public.branches(id,name) VALUES($1,'Concurrent FIFO receipt QA')", [branch]);
    await worker.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Concurrent FIFO WH',$2,true,true)", [warehouse,branch]);
    await worker.query('SELECT public.ensure_chart_of_accounts($1)', [branch]);
    await worker.query('SELECT public.seed_account_mappings($1)', [branch]);
    await worker.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Concurrent raw',$3,0,true)", [raw,'LOCK-'+raw,branch]);
    await worker.query("INSERT INTO public.products(id,name,branch_id,product_type,sale_price,cost_price,is_active) VALUES($1,'Concurrent ready item',$2,'ready',1,0,true)", [product,branch]);
    await worker.query("INSERT INTO public.orders(id,order_number,branch_id,status) VALUES($1,$2,$3,'completed')", [order,'LOCK-ORD-'+order,branch]);
    await worker.query('INSERT INTO public.order_items(id,order_id,product_id,quantity,unit_price) VALUES($1,$2,$3,1,1)', [item,order,product]);
    await worker.query("INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type) VALUES($1,$2,$3,$4,100,100,100,'cash','completed','takeaway')", [sale,'LOCK-S-'+sale,branch,warehouse]);

    for (let i=0; i<events.length; i++) {
      await worker.query(
        'INSERT INTO public.order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity,settled_sale_id,total_cost) VALUES($1,$2,$3,$4,$5,1,$6,0)',
        [events[i],branch,warehouse,order,item,sale]
      );
      await worker.query(
        "INSERT INTO public.order_kitchen_inventory_effects(event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost) VALUES($1,$2,$3,'raw_material',$4,0.01,0)",
        [events[i],branch,warehouse,raw]
      );
      const issue = (await worker.query<{v:{success:boolean}}>(
        "SELECT public._raw_remove_fifo($1,$2,$3,0.01,'kitchen_send','kitchen_send',$4,$5,NULL,true) v",
        [raw,branch,warehouse,events[i],'FIFO-LOCK-'+i]
      )).rows[0].v;
      expect(issue.success).toBe(true);
    }
    // Visibility across the two connections is necessary for a true
    // conflicting row lock. CI tears this entire database down after the job.
    await worker.query('COMMIT');
  },60000);

  afterAll(async () => {
    if(blocker){await blocker.query('ROLLBACK').catch(()=>{});await blocker.end();}
    if(worker){await worker.query('ROLLBACK').catch(()=>{});await worker.end();}
  });

  async function counts() {
    const r=(await worker.query<{debt_settled:string,settlements:number,receipts:number,effects_priced:number,sale_journals:number}>(
      `SELECT
        (SELECT COALESCE(sum(settled_quantity),0)::text FROM public.raw_fifo_debts WHERE raw_material_id=$1) debt_settled,
        (SELECT count(*)::int FROM public.raw_fifo_settlements s JOIN public.raw_fifo_debts d ON d.id=s.debt_id WHERE d.raw_material_id=$1) settlements,
        (SELECT count(*)::int FROM public.inventory_ledger WHERE raw_material_id=$1 AND quantity>0) receipts,
        (SELECT count(*)::int FROM public.order_kitchen_inventory_effects WHERE target_id=$1 AND total_cost>0) effects_priced,
        (SELECT count(*)::int FROM public.journal_entries WHERE reference_type='fifo_cogs_reconcile' AND reference_id=$2) sale_journals`,
      [raw,sale]
    )).rows[0];
    return {...r,debt_settled:Number(r.debt_settled)};
  }

  it('times out at the second kitchen effect, rolls back first settlement, and posts exactly once on retry',async()=>{
    await blocker.query('BEGIN');
    await blocker.query(
      "SELECT id FROM public.order_kitchen_inventory_effects WHERE event_id=$1 AND target_type='raw_material' AND target_id=$2 FOR UPDATE",
      [events[1],raw]
    );

    await worker.query('BEGIN');
    await worker.query("SET LOCAL lock_timeout='350ms'");
    await expect(worker.query(
      "SELECT public._raw_add($1,$2,$3,0.02,1200,NULL,NULL,NULL,'transfer','warehouse_transfer',$4,'FIFO-LOCK-RECEIPT',NULL) v",
      [raw,branch,warehouse,receiptRef]
    )).rejects.toMatchObject({code:'55P03'});
    await worker.query('ROLLBACK');

    // Atomicity: no first-debt settlement or historical journal survives.
    expect(await counts()).toEqual({
      debt_settled:0,settlements:0,receipts:0,effects_priced:0,sale_journals:0
    });

    await blocker.query('ROLLBACK'); // Releases the deliberately held effect row.

    await worker.query('BEGIN');
    await worker.query("SET LOCAL lock_timeout='3s'");
    const success=(await worker.query<{v:{success:boolean,fifo_settled_quantity:string}}>(
      "SELECT public._raw_add($1,$2,$3,0.02,1200,NULL,NULL,NULL,'transfer','warehouse_transfer',$4,'FIFO-LOCK-RECEIPT',NULL) v",
      [raw,branch,warehouse,receiptRef]
    )).rows[0].v;
    expect(success.success,JSON.stringify(success)).toBe(true);
    expect(Number(success.fifo_settled_quantity)).toBeCloseTo(0.02,6);
    expect(await counts()).toEqual({
      debt_settled:0.02,settlements:2,receipts:1,effects_priced:2,sale_journals:1
    });
    const balanced=(await worker.query<{difference:string}>(
      `SELECT COALESCE(sum(l.debit-l.credit),0)::text difference
       FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
       WHERE j.reference_type='fifo_cogs_reconcile' AND j.reference_id=$1`,[sale]
    )).rows[0].difference;
    expect(Number(balanced)).toBeCloseTo(0,6);

    const receipt=(await worker.query<{receipt_ledger_id:string,receipt_batch_id:string}>(
      'SELECT receipt_ledger_id,receipt_batch_id FROM public.raw_fifo_settlements s JOIN public.raw_fifo_debts d ON d.id=s.debt_id WHERE d.raw_material_id=$1 ORDER BY s.id LIMIT 1',[raw]
    )).rows[0];
    const repeat=(await worker.query<{v:{success:boolean,settled_quantity:number}}>(
      'SELECT public._raw_fifo_settle_receipt($1,$2,NULL) v',[receipt.receipt_ledger_id,receipt.receipt_batch_id]
    )).rows[0].v;
    expect(repeat.success).toBe(true);
    expect(Number(repeat.settled_quantity)).toBe(0);
    expect((await counts()).sale_journals).toBe(1);
    await worker.query('ROLLBACK'); // Keep only ephemeral synthetic fixture.
  },30000);
});
