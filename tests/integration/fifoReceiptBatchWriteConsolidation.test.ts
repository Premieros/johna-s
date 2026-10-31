import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const url = getDbUrl();
let local = false;
try {
  const u = new URL(url);
  local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    && ['postgres:', 'postgresql:'].includes(u.protocol);
} catch { /* no disposable postgres */ }

const candidate = readFileSync('scripts/db/candidates/fifo_receipt_reduce_batch_writes_20261031.sql', 'utf8');
const patch = candidate.slice(candidate.indexOf('DO $patch_fifo_receipt_writes$'), candidate.lastIndexOf('COMMIT;')).trim();

describe.skipIf(!local)('canonical receipt batch-write consolidation, rollback-only', () => {
  let db: pg.Client;
  const branch = randomUUID(), wh = randomUUID();
  let raw = '', sale = '';
  const receipt = randomUUID();

  beforeAll(async () => {
    db = openDb(url);
    await db.connect();
    await db.query('BEGIN');
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Receipt cost benchmark')", [branch]);
    await db.query("INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'FIFO QA',$2,true,true)", [wh,branch]);
    await db.query('SELECT public.ensure_chart_of_accounts($1)', [branch]);
    await db.query('SELECT public.seed_account_mappings($1)', [branch]);
    raw = randomUUID(); sale = randomUUID();
    await db.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'FIFO bench',$3,0,true)",[raw,'RB-'+raw,branch]);
    await db.query("INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type) VALUES($1,$2,$3,$4,100,100,100,'cash','completed','takeaway')",[sale,'S-'+sale,branch,wh]);
    for(let i=0;i<120;i++) {
      const r=(await db.query<{r:{success:boolean}}>("SELECT public._raw_remove_fifo($1,$2,$3,1,'sale','sale',$4,$5,NULL,true) r",[raw,branch,wh,sale,'benchmark-'+i])).rows[0].r;
      expect(r.success).toBe(true);
    }
    await db.query('CREATE TEMP TABLE receipt_writes(raw_id uuid,qty numeric) ON COMMIT DROP');
    await db.query("CREATE FUNCTION pg_temp.audit_fifo_receipt() RETURNS trigger LANGUAGE plpgsql AS $t$ BEGIN IF NEW.source_type='receipt_write_bench' THEN INSERT INTO pg_temp.receipt_writes VALUES(NEW.raw_material_id,NEW.quantity); END IF; RETURN NEW; END $t$");
    await db.query('CREATE TRIGGER receipt_audit AFTER UPDATE OF quantity ON public.raw_material_batches FOR EACH ROW EXECUTE FUNCTION pg_temp.audit_fifo_receipt()');
  }, 90000);

  afterAll(async () => {
    if(db) { await db.query('ROLLBACK').catch(()=>{}); await db.end(); }
  });

  async function readState() {
    const q=async(sql:string)=>(await db.query(sql,[raw])).rows;
    return {
      inventory: await q('SELECT quantity,avg_cost FROM public.raw_material_inventory WHERE raw_material_id=$1'),
      batches: await q('SELECT quantity,unit_cost,source_type FROM public.raw_material_batches WHERE raw_material_id=$1 ORDER BY source_type,quantity,unit_cost'),
      debts: await q('SELECT debt_quantity,settled_quantity FROM public.raw_fifo_debts WHERE raw_material_id=$1 ORDER BY source_ledger_id'),
      settlements: await q('SELECT s.quantity,s.unit_cost,s.total_cost,s.reconciliation_status FROM public.raw_fifo_settlements s JOIN public.raw_fifo_debts d ON d.id=s.debt_id WHERE d.raw_material_id=$1 ORDER BY d.source_ledger_id'),
      issues: await q('SELECT quantity,unit_cost,total_cost FROM public.inventory_ledger WHERE raw_material_id=$1 AND quantity<0 ORDER BY id'),
      sale_adjustment: (await db.query('SELECT exact_delta,posted_delta FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',[sale])).rows,
      posted: (await db.query("SELECT jl.debit,jl.credit FROM public.journal_entries je JOIN public.journal_entry_lines jl ON jl.journal_entry_id=je.id WHERE je.reference_id=$1 AND je.reference_type='fifo_cogs_reconcile' ORDER BY jl.debit,jl.credit",[sale])).rows
    };
  }
  async function settle() {
    const r=(await db.query<{r:{success:boolean,fifo_settled_quantity:string,detail?:string}}>(
      "SELECT public._raw_add($1,$2,$3,120,7,NULL,NULL,NULL,'purchase','receipt_write_bench',$4,'BENCH-RECEIPT',NULL) r",
      [raw,branch,wh,receipt])).rows[0].r;
    expect(r.success,JSON.stringify(r)).toBe(true);
    expect(Number(r.fifo_settled_quantity)).toBe(120);
    return {
      state: await readState(),
      receiptWrites: Number((await db.query('SELECT count(*) n FROM pg_temp.receipt_writes WHERE raw_id=$1',[raw])).rows[0].n)
    };
  }

  it('preserves FIFO settlement/COGS/journal state and reduces receipt batch writes', async () => {
    await db.query('SAVEPOINT compare');
    const before = await settle();
    await db.query('ROLLBACK TO SAVEPOINT compare');

    await db.query(patch);
    const after = await settle();
    expect(after.state).toEqual(before.state);
    expect(before.receiptWrites).toBe(120);
    expect(after.receiptWrites).toBe(1);

    const def=(await db.query<{def:string}>("SELECT pg_get_functiondef('public._raw_fifo_settle_receipt(bigint,uuid,uuid)'::regprocedure) def")).rows[0].def;
    expect(def).toContain('FIFO_RECEIPT_BATCH_WRITE_ONCE_V1');
    expect(def).toContain('SECURITY DEFINER');
    const settleRow=(await db.query<{id:string,receipt_batch_id:string,receipt_ledger_id:string}>(
      'SELECT id,receipt_batch_id,receipt_ledger_id FROM public.raw_fifo_settlements ORDER BY id LIMIT 1')).rows[0];
    const repeated=(await db.query<{r:{success:boolean,settled_quantity:number}}>(
      'SELECT public._raw_fifo_settle_receipt($1,$2,NULL) r',
      [settleRow.receipt_ledger_id,settleRow.receipt_batch_id])).rows[0].r;
    expect(repeated).toMatchObject({success:true});
    expect(Number(repeated.settled_quantity)).toBe(0);
  }, 120000);
});
