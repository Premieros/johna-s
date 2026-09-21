import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown): number => Number(v || 0);

describe.skipIf(skip)('Raw FIFO negative-cost reconciliation', () => {
  let client: pg.Client;

  const branch = randomUUID();
  const warehouse = randomUUID();
  const warehouse2 = randomUUID();
  const unit = randomUUID();
  const cogsAccount = randomUUID();
  const inventoryAccount = randomUUID();

  const rawA = randomUUID();
  const rawB = randomUUID();
  const rawC = randomUUID();

  const saleA = randomUUID();
  const saleB1 = randomUUID();
  const saleB2 = randomUUID();
  const saleC = randomUUID();

  const manufacturedUnit = randomUUID();
  const productionC = randomUUID();
  const productionBatch = 'PRD-' + randomUUID().slice(0, 8);

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  async function addRaw(rawId: string, whId: string, qty: number, cost: number) {
    const ref = randomUUID();
    const rows = await q<{ result: Record<string, unknown> }>(
      `SELECT public._raw_add(
         $1,$2,$3,$4,$5,NULL,NULL,NULL,
         'purchase_receipt','fifo_test_receipt',$6,$7,NULL
       ) AS result`,
      [rawId, branch, whId, qty, cost, ref, 'RCPT-' + ref.slice(0, 8)],
    );
    return rows[0].result;
  }

  async function oversell(rawId: string, whId: string, qty: number, refType: string, refId: string, refNo: string) {
    const rows = await q<{ result: Record<string, unknown> }>(
      `SELECT public._raw_remove_fifo(
         $1,$2,$3,$4,'sale',$5,$6,$7,NULL,true
       ) AS result`,
      [rawId, branch, whId, qty, refType, refId, refNo],
    );
    return rows[0].result;
  }

  async function whBalance(rawId: string, whId = warehouse): Promise<number> {
    const rows = await q<{ qty: string }>(
      `SELECT COALESCE(SUM(quantity),0)::text qty
       FROM public.raw_material_batches
       WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
      [rawId, branch, whId],
    );
    return num(rows[0].qty);
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.branches(id,name) VALUES($1,'FIFO Cost Branch')`, [branch]);
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default)
       VALUES($1,'FIFO WH 1',$3,true,true),($2,'FIFO WH 2',$3,true,false)`,
      [warehouse, warehouse2, branch],
    );
    await client.query(
      `INSERT INTO public.measurement_units(id,code,name,symbol,is_active)
       VALUES($1,$2,'FIFO Unit','u',true)`,
      [unit, 'FU-' + randomUUID().slice(0, 8)],
    );

    for (const [id, code, name] of [
      [rawA, 'FRA', 'FIFO Raw A'],
      [rawB, 'FRB', 'FIFO Raw B'],
      [rawC, 'FRC', 'FIFO Raw C'],
    ]) {
      await client.query(
        `INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active)
         VALUES($1,$2,$3,$4,$5,0,true)`,
        [id, code + '-' + randomUUID().slice(0, 6), name, branch, unit],
      );
    }

    await client.query(
      `INSERT INTO public.chart_of_accounts(id,branch_id,code,name,account_type,is_system,is_active)
       VALUES
       ($1,$3,$4,'FIFO COGS','expense',true,true),
       ($2,$3,$5,'FIFO Inventory','asset',true,true)`,
      [cogsAccount, inventoryAccount, branch, '5' + randomUUID().slice(0, 5), '1' + randomUUID().slice(0, 5)],
    );
    await client.query(
      `INSERT INTO public.account_mappings(branch_id,semantic_key,account_id)
       VALUES($1,'cogs',$2),($1,'inventory_fg',$3)`,
      [branch, cogsAccount, inventoryAccount],
    );

    for (const [id, invoice] of [
      [saleA, 'FIFO-SALE-A'],
      [saleB1, 'FIFO-SALE-B1'],
      [saleB2, 'FIFO-SALE-B2'],
      [saleC, 'FIFO-SALE-C'],
    ]) {
      await client.query(
        `INSERT INTO public.sales(
           id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type
         ) VALUES($1,$2,$3,$4,100,100,100,'cash','completed','takeaway')`,
        [id, invoice, branch, warehouse],
      );
    }

    await client.query(
      `INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,is_active)
       VALUES($1,$2,'FIFO Manufactured','manufactured',$3,true)`,
      [manufacturedUnit, 'FM-' + randomUUID().slice(0, 8), branch],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_productions(
         id,unit_id,branch_id,warehouse_id,quantity,status,total_cost,notes
       ) VALUES($1,$2,$3,$4,2,'completed',0,'AUTO_SALE_PRODUCTION')`,
      [productionC, manufacturedUnit, branch, warehouse],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_batches(
         unit_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,production_date
       ) VALUES($1,$2,$3,$4,1,0,CURRENT_DATE)`,
      [manufacturedUnit, branch, warehouse, productionBatch],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_entries(
         unit_id,branch_id,warehouse_id,quantity,unit_cost,entry_type,
         reference_type,reference_id,reference_number,batch_number
       ) VALUES
       ($1,$2,$3,2,0,'production','production',$4,'FIFO-PROD',$5),
       ($1,$2,$3,-1,0,'sale','sale',$6,'FIFO-SALE-C',$5)`,
      [manufacturedUnit, branch, warehouse, productionC, productionBatch, saleC],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('settles a negative sale debt from later receipts in FIFO receipt order and posts corrected COGS', async () => {
    const sold = await oversell(rawA, warehouse, 5, 'sale', saleA, 'FIFO-SALE-A');
    expect(num(sold.oversold)).toBe(5);
    expect(await whBalance(rawA)).toBe(-5);

    const first = await addRaw(rawA, warehouse, 2, 10);
    expect(num(first.fifo_settled_quantity)).toBe(2);
    expect(num(first.fifo_settled_value)).toBe(20);
    expect(await whBalance(rawA)).toBe(-3);

    const second = await addRaw(rawA, warehouse, 3, 20);
    expect(num(second.fifo_settled_quantity)).toBe(3);
    expect(num(second.fifo_settled_value)).toBe(60);
    expect(await whBalance(rawA)).toBe(0);

    const debt = await q<{ debt_quantity: string; settled_quantity: string }>(
      `SELECT debt_quantity::text,settled_quantity::text
       FROM public.raw_fifo_debts
       WHERE raw_material_id=$1 AND reference_id=$2`,
      [rawA, saleA],
    );
    expect(num(debt[0].debt_quantity)).toBe(5);
    expect(num(debt[0].settled_quantity)).toBe(5);

    const source = await q<{ unit_cost: string; total_cost: string }>(
      `SELECT unit_cost::text,total_cost::text
       FROM public.inventory_ledger
       WHERE raw_material_id=$1 AND reference_type='sale' AND reference_id=$2
         AND quantity<0
       ORDER BY id DESC LIMIT 1`,
      [rawA, saleA],
    );
    expect(num(source[0].total_cost)).toBe(-80);
    expect(num(source[0].unit_cost)).toBe(16);

    const adjustment = await q<{ exact_delta: string; posted_delta: string }>(
      `SELECT exact_delta::text,posted_delta::text
       FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1`,
      [saleA],
    );
    expect(num(adjustment[0].exact_delta)).toBe(80);
    expect(num(adjustment[0].posted_delta)).toBe(80);

    const journal = await q<{ debit: string; credit: string }>(
      `SELECT COALESCE(SUM(l.debit),0)::text debit,COALESCE(SUM(l.credit),0)::text credit
       FROM public.journal_entries j
       JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
       WHERE j.reference_type='fifo_cogs_reconcile' AND j.reference_id=$1`,
      [saleA],
    );
    expect(num(journal[0].debit)).toBe(80);
    expect(num(journal[0].credit)).toBe(80);

    const margin = await q<{ cogs: string }>(
      `SELECT cogs::text FROM public.get_order_margin($1,NULL,NULL) WHERE sale_id=$2`,
      [branch, saleA],
    );
    expect(num(margin[0].cogs)).toBe(80);
  });

  it('settles the oldest debt first and never crosses warehouses', async () => {
    await oversell(rawB, warehouse, 2, 'sale', saleB1, 'FIFO-SALE-B1');
    await oversell(rawB, warehouse, 4, 'sale', saleB2, 'FIFO-SALE-B2');

    const otherWarehouse = await addRaw(rawB, warehouse2, 10, 7);
    expect(num(otherWarehouse.fifo_settled_quantity)).toBe(0);
    expect(await whBalance(rawB, warehouse)).toBe(-6);
    expect(await whBalance(rawB, warehouse2)).toBe(10);

    const receipt = await addRaw(rawB, warehouse, 3, 7);
    expect(num(receipt.fifo_settled_quantity)).toBe(3);
    expect(await whBalance(rawB, warehouse)).toBe(-3);

    const rows = await q<{ reference_id: string; settled_quantity: string }>(
      `SELECT d.reference_id::text, d.settled_quantity::text
       FROM public.raw_fifo_debts d
       WHERE d.raw_material_id=$1 AND d.warehouse_id=$2
       ORDER BY d.source_created_at,d.source_ledger_id`,
      [rawB, warehouse],
    );
    expect(rows.map((r) => [r.reference_id, num(r.settled_quantity)])).toEqual([
      [saleB1, 2],
      [saleB2, 1],
    ]);
  });

  it('propagates a settled raw debt through auto-production into the consuming sale COGS', async () => {
    const produced = await oversell(rawC, warehouse, 2, 'production', productionC, 'FIFO-PROD');
    expect(num(produced.oversold)).toBe(2);
    expect(await whBalance(rawC)).toBe(-2);

    const receipt = await addRaw(rawC, warehouse, 2, 5);
    expect(num(receipt.fifo_settled_value)).toBe(10);
    expect(await whBalance(rawC)).toBe(0);

    const production = await q<{ total_cost: string }>(
      `SELECT total_cost::text FROM public.inventory_unit_productions WHERE id=$1`,
      [productionC],
    );
    expect(num(production[0].total_cost)).toBe(10);

    const output = await q<{ unit_cost: string }>(
      `SELECT unit_cost::text
       FROM public.inventory_unit_entries
       WHERE reference_type='production' AND reference_id=$1 AND quantity>0`,
      [productionC],
    );
    expect(num(output[0].unit_cost)).toBe(5);

    const consumer = await q<{ unit_cost: string }>(
      `SELECT unit_cost::text
       FROM public.inventory_unit_entries
       WHERE reference_type='sale' AND reference_id=$1 AND quantity<0`,
      [saleC],
    );
    expect(num(consumer[0].unit_cost)).toBe(5);

    const saleAdj = await q<{ exact_delta: string }>(
      `SELECT exact_delta::text FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1`,
      [saleC],
    );
    expect(num(saleAdj[0].exact_delta)).toBe(5);
  });
});
