import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown): number => Number(v || 0);

describe.skipIf(skip)('Historical raw FIFO backfill', () => {
  let client: pg.Client;

  const branch = randomUUID();
  const warehouse = randomUUID();
  const unit = randomUUID();
  const raw = randomUUID();
  const rawStale = randomUUID();
  const sale = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query("INSERT INTO public.branches(id,name) VALUES($1,'FIFO Historical Branch')", [branch]);
    await client.query(
      "INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'FIFO Historical WH',$2,true,true)",
      [warehouse, branch],
    );
    await client.query(
      "INSERT INTO public.measurement_units(id,code,name,symbol,is_active) VALUES($1,$2,'FIFO Historical Unit','u',true)",
      [unit, 'FHB-' + randomUUID().slice(0, 8)],
    );
    await client.query(
      "INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active) VALUES ($1,$3,'Historical Raw',$2,$5,0,true),($4,$6,'Historical Raw Stale',$2,$5,0,true)",
      [raw, branch, 'HRAW-' + randomUUID().slice(0, 6), rawStale, unit, 'HSTALE-' + randomUUID().slice(0, 6)],
    );
    await client.query(
      "INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type,created_at) VALUES($1,'FIFO-HIST-SALE',$2,$3,100,100,100,'cash','completed','takeaway','2026-09-20T12:00:00Z')",
      [sale, branch, warehouse],
    );

    await client.query(
      "SELECT public._post_journal_entry($1,'sale',$2,'FIFO-HIST-SALE','Historical base sale COGS',jsonb_build_array(jsonb_build_object('account_key','cogs','debit',8,'credit',0),jsonb_build_object('account_key','inventory_fg','debit',0,'credit',8)))",
      [branch, sale],
    );

    await client.query(
      "INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,created_at) VALUES ($1,$2,$3,'H-B1',0,4,'purchase','2026-09-20T08:00:00Z'),($1,$2,$3,'OV-HIST',-3,0,'sale_oversold','2026-09-20T12:00:00Z'),($1,$2,$3,'H-B2',3,10,'purchase','2026-09-21T08:00:00Z')",
      [raw, branch, warehouse],
    );

    await client.query(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_at) VALUES ($1,$2,$3,'H-B1',2,4,8,0,2,'purchase','purchase',NULL,'H-P1','2026-09-20T08:00:00Z'),($1,$2,$3,'H-B1',-2,4,-8,2,0,'sale','sale',$4,'FIFO-HIST-SALE','2026-09-20T12:00:00Z'),($1,$2,$3,'OV-HIST',-3,0,0,0,-3,'sale','sale',$4,'FIFO-HIST-SALE','2026-09-20T12:00:01Z'),($1,$2,$3,'H-B2',3,10,30,-3,0,'purchase','purchase',NULL,'H-P2','2026-09-21T08:00:00Z')",
      [raw, branch, warehouse, sale],
    );
    await client.query(
      "INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES($1,$2,0,0)",
      [raw, branch],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('prepares and applies historical FIFO without changing net stock or double-applying cost', async () => {
    const prepared = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_prepare_backfill($1) r',
      [branch],
    );
    const runId = String(prepared[0].r.run_id);
    expect(num(prepared[0].r.changed_rows)).toBe(1);
    expect(num(prepared[0].r.net_cost_delta)).toBe(30);
    expect(num(prepared[0].r.unresolved_quantity)).toBe(0);

    const before = await q<{ qty: string }>(
      'SELECT COALESCE(sum(quantity),0)::text qty FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3',
      [raw, branch, warehouse],
    );
    expect(num(before[0].qty)).toBe(0);

    const applied = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_apply_backfill($1) r',
      [runId],
    );
    expect(applied[0].r.success).toBe(true);

    const after = await q<{ qty: string }>(
      'SELECT COALESCE(sum(quantity),0)::text qty FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3',
      [raw, branch, warehouse],
    );
    expect(num(after[0].qty)).toBe(0);

    const debt = await q<{ debt_quantity: string; settled_quantity: string }>(
      'SELECT debt_quantity::text,settled_quantity::text FROM public.raw_fifo_debts WHERE raw_material_id=$1 AND reference_id=$2',
      [raw, sale],
    );
    expect(num(debt[0].debt_quantity)).toBe(3);
    expect(num(debt[0].settled_quantity)).toBe(3);

    const oversoldLedger = await q<{ unit_cost: string; total_cost: string }>(
      "SELECT unit_cost::text,total_cost::text FROM public.inventory_ledger WHERE raw_material_id=$1 AND batch_number='OV-HIST'",
      [raw],
    );
    expect(num(oversoldLedger[0].unit_cost)).toBe(10);
    expect(num(oversoldLedger[0].total_cost)).toBe(-30);

    const adj = await q<{ exact_delta: string; posted_delta: string }>(
      'SELECT exact_delta::text,posted_delta::text FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',
      [sale],
    );
    expect(num(adj[0].exact_delta)).toBe(30);
    expect(num(adj[0].posted_delta)).toBe(30);

    const margin = await q<{ cogs: string }>(
      'SELECT cogs::text FROM public.get_order_margin($1,NULL,NULL) WHERE sale_id=$2',
      [branch, sale],
    );
    expect(num(margin[0].cogs)).toBe(38);

    const again = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_apply_backfill($1) r',
      [runId],
    );
    expect(again[0].r.success).toBe(true);
    expect(again[0].r.already_applied).toBe(true);

    const adjAgain = await q<{ exact_delta: string }>(
      'SELECT exact_delta::text FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',
      [sale],
    );
    expect(num(adjAgain[0].exact_delta)).toBe(30);

    const reversed = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_reverse_backfill($1) r',
      [runId],
    );
    expect(reversed[0].r.success).toBe(true);
    expect(reversed[0].r.reversed).toBe(true);

    const restoredBatches = await q<{ batch_number: string; quantity: string }>(
      'SELECT batch_number,quantity::text FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3 ORDER BY batch_number',
      [raw, branch, warehouse],
    );
    const restoredByBatch = new Map(
      restoredBatches.map((r) => [r.batch_number, num(r.quantity)]),
    );
    expect(restoredByBatch.get('H-B1')).toBe(0);
    expect(restoredByBatch.get('H-B2')).toBe(3);
    expect(restoredByBatch.get('OV-HIST')).toBe(-3);

    const restoredLedger = await q<{ unit_cost: string; total_cost: string }>(
      "SELECT unit_cost::text,total_cost::text FROM public.inventory_ledger WHERE raw_material_id=$1 AND batch_number='OV-HIST'",
      [raw],
    );
    expect(num(restoredLedger[0].unit_cost)).toBe(0);
    expect(num(restoredLedger[0].total_cost)).toBe(0);

    const debtAfterReverse = await q<{ count: string }>(
      'SELECT count(*)::text count FROM public.raw_fifo_debts WHERE raw_material_id=$1 AND reference_id=$2',
      [raw, sale],
    );
    expect(num(debtAfterReverse[0].count)).toBe(0);

    const adjustmentAfterReverse = await q<{ count: string }>(
      'SELECT count(*)::text count FROM public.raw_fifo_sale_cogs_adjustments WHERE sale_id=$1',
      [sale],
    );
    expect(num(adjustmentAfterReverse[0].count)).toBe(0);

    const fifoJournalAfterReverse = await q<{ count: string }>(
      "SELECT count(*)::text count FROM public.journal_entries WHERE reference_type='fifo_cogs_reconcile' AND reference_id=$1",
      [sale],
    );
    expect(num(fifoJournalAfterReverse[0].count)).toBe(0);

    const restoredMargin = await q<{ cogs: string }>(
      'SELECT cogs::text FROM public.get_order_margin($1,NULL,NULL) WHERE sale_id=$2',
      [branch, sale],
    );
    expect(num(restoredMargin[0].cogs)).toBe(8);

    const reverseAgain = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_reverse_backfill($1) r',
      [runId],
    );
    expect(reverseAgain[0].r.success).toBe(true);
    expect(reverseAgain[0].r.already_reversed).toBe(true);
  });

  it('rejects a prepared plan after a new raw ledger movement makes it stale', async () => {
    const prepared = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_prepare_backfill($1) r',
      [branch],
    );
    const runId = String(prepared[0].r.run_id);

    const ref = randomUUID();
    const added = await q<{ r: Record<string, unknown> }>(
      "SELECT public._raw_add($1,$2,$3,1,2,NULL,NULL,NULL,'purchase','purchase',$4,'FIFO-STALE',NULL) r",
      [rawStale, branch, warehouse, ref],
    );
    expect(added[0].r.success).toBe(true);

    const applied = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_apply_backfill($1) r',
      [runId],
    );
    expect(applied[0].r.success).toBe(false);
    expect(applied[0].r.error).toBe('FIFO_BACKFILL_STALE_PLAN');
  });
  it('preserves FIFO debts created by live traffic before backfill apply and reversal', async () => {
    const rawLive = randomUUID();
    const liveSale = randomUUID();

    await client.query(
      "INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active) VALUES($1,$2,'FIFO Live Debt Raw',$3,$4,0,true)",
      [rawLive, 'FLIVE-' + randomUUID().slice(0, 6), branch, unit],
    );
    await client.query(
      "INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,created_at) VALUES($1,$2,$3,'OV-LIVE-PRE',-1,0,'sale_oversold','2026-09-21T09:00:00Z')",
      [rawLive, branch, warehouse],
    );
    const liveLedger = await q<{ id: string }>(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_at) VALUES($1,$2,$3,'OV-LIVE-PRE',-1,0,0,0,-1,'sale','sale',$4,'FIFO-LIVE-PRE','2026-09-21T09:00:00Z') RETURNING id::text",
      [rawLive, branch, warehouse, liveSale],
    );
    const liveBatch = await q<{ id: string }>(
      "SELECT id::text FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3 AND batch_number='OV-LIVE-PRE'",
      [rawLive, branch, warehouse],
    );

    await client.query(
      "INSERT INTO public.raw_fifo_debts(source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,reference_type,reference_id,reference_number,debt_quantity,settled_quantity,source_created_at) VALUES($1,$2,$3,$4,$5,'sale',$6,'FIFO-LIVE-PRE',1,0,'2026-09-21T09:00:00Z')",
      [liveLedger[0].id, rawLive, branch, warehouse, liveBatch[0].id, liveSale],
    );

    const prepared = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_prepare_backfill($1) r',
      [branch],
    );
    const runId = String(prepared[0].r.run_id);

    const applied = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_apply_backfill($1) r',
      [runId],
    );
    expect(applied[0].r.success).toBe(true);

    const liveAfterApply = await q<{ count: string; backfill_run_id: string | null }>(
      'SELECT count(*)::text count,max(backfill_run_id::text) backfill_run_id FROM public.raw_fifo_debts WHERE source_ledger_id=$1',
      [liveLedger[0].id],
    );
    expect(num(liveAfterApply[0].count)).toBe(1);
    expect(liveAfterApply[0].backfill_run_id).toBeNull();

    const reversed = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_reverse_backfill($1) r',
      [runId],
    );
    expect(reversed[0].r.success).toBe(true);

    const liveAfterReverse = await q<{ count: string; debt_quantity: string; settled_quantity: string }>(
      'SELECT count(*)::text count,max(debt_quantity)::text debt_quantity,max(settled_quantity)::text settled_quantity FROM public.raw_fifo_debts WHERE source_ledger_id=$1',
      [liveLedger[0].id],
    );
    expect(num(liveAfterReverse[0].count)).toBe(1);
    expect(num(liveAfterReverse[0].debt_quantity)).toBe(1);
    expect(num(liveAfterReverse[0].settled_quantity)).toBe(0);
  });

  it('safely handles orphan historical kitchen and purchase-return references', async () => {
    const orphanKitchenRef = randomUUID();
    const orphanReturnRef = randomUUID();
    const kitchenRefNo = 'FIFO-ORPH-K-' + randomUUID().slice(0, 8);
    const returnRefNo = 'FIFO-ORPH-R-' + randomUUID().slice(0, 8);

    await client.query(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_id,reference_number,created_at) VALUES ($1,$2,$3,'ORPH-K',-1,5,-5,0,-1,'kitchen_send','kitchen_send',$4,$5,'2026-09-21T10:00:00Z'),($1,$2,$3,'ORPH-R',-1,5,-5,0,-1,'purchase_return','purchase_return',$6,$7,'2026-09-21T10:01:00Z')",
      [rawStale, branch, warehouse, orphanKitchenRef, kitchenRefNo, orphanReturnRef, returnRefNo],
    );

    const kitchen = await q<{ r: Record<string, unknown> }>(
      "SELECT public._fifo_adjust_reference_delta('kitchen_send',$1,$2,$3,'raw_material',$4,-5,0) r",
      [orphanKitchenRef, branch, warehouse, rawStale],
    );
    expect(kitchen[0].r.success).toBe(true);
    expect(kitchen[0].r.orphan_reference).toBe(true);
    expect(kitchen[0].r.ledger_only).toBe(true);

    const purchase = await q<{ r: Record<string, unknown> }>(
      "SELECT public._fifo_adjust_reference_delta('purchase_return',$1,$2,$3,'raw_material',$4,5,0) r",
      [orphanReturnRef, branch, warehouse, rawStale],
    );
    expect(purchase[0].r.success).toBe(true);

    const adjustment = await q<{ exact_delta: string; journal_entry_id: string | null }>(
      "SELECT exact_delta::text,journal_entry_id::text FROM public.raw_fifo_stock_adjustments WHERE branch_id=$1 AND reference_type='purchase_return' AND reference_id=$2",
      [branch, orphanReturnRef],
    );
    expect(num(adjustment[0].exact_delta)).toBe(5);
    expect(adjustment[0].journal_entry_id).toBeTruthy();

    const reversed = await q<{ r: Record<string, unknown> }>(
      "SELECT public._fifo_adjust_reference_delta('purchase_return',$1,$2,$3,'raw_material',$4,-5,0) r",
      [orphanReturnRef, branch, warehouse, rawStale],
    );
    expect(reversed[0].r.success).toBe(true);

    const adjustmentAfter = await q<{ count: string }>(
      "SELECT count(*)::text count FROM public.raw_fifo_stock_adjustments WHERE branch_id=$1 AND reference_type='purchase_return' AND reference_id=$2",
      [branch, orphanReturnRef],
    );
    expect(num(adjustmentAfter[0].count)).toBe(0);

    const journalAfter = await q<{ count: string }>(
      "SELECT count(*)::text count FROM public.journal_entries WHERE reference_type='fifo_stock_reconcile' AND reference_id=$1",
      [orphanReturnRef],
    );
    expect(num(journalAfter[0].count)).toBe(0);
  });

  it('clamps only sub-cent kitchen FIFO rounding drift', async () => {
    const orderId = randomUUID();
    const itemId = randomUUID();
    const eventId = randomUUID();
    const orderNo = 'FIFO-KROUND-' + randomUUID().slice(0, 8);

    await client.query(
      "INSERT INTO public.orders(id,order_number,branch_id,order_type,status,inventory_warehouse_id) VALUES($1,$2,$3,'takeaway','completed',$4)",
      [orderId, orderNo, branch, warehouse],
    );
    await client.query(
      "INSERT INTO public.order_items(id,order_id,product_id,quantity,unit_price,total) VALUES($1,$2,NULL,1,0,0)",
      [itemId, orderId],
    );
    await client.query(
      "INSERT INTO public.order_kitchen_inventory_events(id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity,voided_quantity,total_cost) VALUES($1,$2,$3,$4,$5,1,0,5.7888)",
      [eventId, branch, warehouse, orderId, itemId],
    );
    await client.query(
      "INSERT INTO public.order_kitchen_inventory_effects(event_id,branch_id,warehouse_id,target_type,target_id,quantity,total_cost) VALUES($1,$2,$3,'raw_material',$4,0.12,5.7888)",
      [eventId, branch, warehouse, rawStale],
    );

    const adjusted = await q<{ r: Record<string, unknown> }>(
      "SELECT public._fifo_adjust_kitchen_effect_delta($1,'raw_material',$2,-5.79) r",
      [eventId, rawStale],
    );
    expect(adjusted[0].r.success).toBe(true);
    expect(num(adjusted[0].r.effect_delta)).toBeCloseTo(-5.7888, 6);
    expect(num(adjusted[0].r.event_delta)).toBeCloseTo(-5.7888, 6);

    const after = await q<{ event_cost: string; effect_cost: string }>(
      "SELECT e.total_cost::text event_cost,ef.total_cost::text effect_cost FROM public.order_kitchen_inventory_events e JOIN public.order_kitchen_inventory_effects ef ON ef.event_id=e.id WHERE e.id=$1 AND ef.target_type='raw_material' AND ef.target_id=$2",
      [eventId, rawStale],
    );
    expect(num(after[0].event_cost)).toBe(0);
    expect(num(after[0].effect_cost)).toBe(0);

    const tooLarge = await q<{ r: Record<string, unknown> }>(
      "SELECT public._fifo_adjust_kitchen_effect_delta($1,'raw_material',$2,-0.01) r",
      [eventId, rawStale],
    );
    expect(tooLarge[0].r.success).toBe(false);
    expect(tooLarge[0].r.error).toBe('FIFO_KITCHEN_EFFECT_COST_NEGATIVE');
  });

});
