import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown): number => Number(v || 0);

describe.skipIf(skip)('Historical FIFO debt settlement rebase', () => {
  let client: pg.Client;
  const branch = randomUUID();
  const warehouse = randomUUID();
  const unit = randomUUID();
  const raw = randomUUID();
  const debtBatch = randomUUID();
  const receiptBatch1 = randomUUID();
  const receiptBatch2 = randomUUID();
  const oldRun = randomUUID();
  const newRun = randomUUID();
  const debtA = randomUUID();
  const debtB = randomUUID();
  const oldSettlementA = randomUUID();
  const oldSettlementB = randomUUID();
  let sourceA = 0;
  let sourceB = 0;
  let receipt1 = 0;
  let receipt2 = 0;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query("INSERT INTO public.branches(id,name) VALUES($1,'Debt Rebase Branch')", [branch]);
    await client.query(
      "INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Debt Rebase WH',$2,true,true)",
      [warehouse, branch],
    );
    await client.query(
      "INSERT INTO public.measurement_units(id,code,name,symbol,is_active) VALUES($1,$2,'Debt Rebase Unit','u',true)",
      [unit, 'DR-' + randomUUID().slice(0, 8)],
    );
    await client.query(
      "INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active) VALUES($1,$2,'Debt Rebase Raw',$3,$4,0,true)",
      [raw, 'DRR-' + randomUUID().slice(0, 6), branch, unit],
    );

    await client.query(
      "INSERT INTO public.raw_material_batches(id,raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,created_at) VALUES($1,$2,$3,$4,'DEBT-BATCH',-15,0,'opening_inventory','2026-09-01T00:00:00Z'),($5,$2,$3,$4,'R1',0,10,'purchase','2026-09-03T00:00:00Z'),($6,$2,$3,$4,'R2',0,20,'purchase','2026-09-04T00:00:00Z')",
      [debtBatch, raw, branch, warehouse, receiptBatch1, receiptBatch2],
    );

    sourceA = Number((await q<{ id: string }>(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_number,created_at) VALUES($1,$2,$3,'DEBT-BATCH',-10,0,0,0,-10,'sale','sale','DEBT-A','2026-09-01T10:00:00Z') RETURNING id::text",
      [raw, branch, warehouse],
    ))[0].id);
    sourceB = Number((await q<{ id: string }>(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_number,created_at) VALUES($1,$2,$3,'DEBT-BATCH',-5,0,0,-10,-15,'sale','sale','DEBT-B','2026-09-02T10:00:00Z') RETURNING id::text",
      [raw, branch, warehouse],
    ))[0].id);
    receipt1 = Number((await q<{ id: string }>(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_number,created_at) VALUES($1,$2,$3,'R1',10,10,100,-15,-5,'purchase','purchase','R1','2026-09-03T10:00:00Z') RETURNING id::text",
      [raw, branch, warehouse],
    ))[0].id);
    receipt2 = Number((await q<{ id: string }>(
      "INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,total_cost,before_qty,after_qty,entry_type,reference_type,reference_number,created_at) VALUES($1,$2,$3,'R2',5,20,100,-5,0,'purchase','purchase','R2','2026-09-04T10:00:00Z') RETURNING id::text",
      [raw, branch, warehouse],
    ))[0].id);

    await client.query(
      "INSERT INTO public.raw_fifo_backfill_runs(id,branch_id,cutoff_ledger_id,status) VALUES($1,$2,$3,'applied'),($4,$2,$3,'prepared')",
      [oldRun, branch, receipt2, newRun],
    );

    await client.query(
      "INSERT INTO public.raw_fifo_debts(id,source_ledger_id,raw_material_id,branch_id,warehouse_id,oversold_batch_id,reference_type,reference_number,debt_quantity,settled_quantity,source_created_at,backfill_run_id) VALUES($1,$2,$3,$4,$5,$6,'sale','DEBT-A',10,10,'2026-09-01T10:00:00Z',$7),($8,$9,$3,$4,$5,$6,'sale','DEBT-B',5,5,'2026-09-02T10:00:00Z',$7)",
      [debtA, sourceA, raw, branch, warehouse, debtBatch, oldRun, debtB, sourceB],
    );

    await client.query(
      "INSERT INTO public.raw_fifo_settlements(id,debt_id,receipt_ledger_id,receipt_batch_id,quantity,unit_cost,total_cost,run_id) VALUES($1,$2,$3,$4,10,10,100,$5),($6,$7,$8,$9,5,20,100,NULL)",
      [oldSettlementA, debtA, receipt1, receiptBatch1, oldRun, oldSettlementB, debtB, receipt2, receiptBatch2],
    );

    await client.query(
      "INSERT INTO public.raw_fifo_backfill_plan(run_id,consumption_ledger_id,raw_material_id,branch_id,warehouse_id,reference_type,reference_number,entry_type,quantity,current_cost,target_cost,debt_quantity,unresolved_quantity,source_created_at) VALUES($1,$2,$3,$4,$5,'sale','DEBT-A','sale',10,0,0,5,0,'2026-09-01T10:00:00Z'),($1,$6,$3,$4,$5,'sale','DEBT-B','sale',5,0,0,5,0,'2026-09-02T10:00:00Z')",
      [newRun, sourceA, raw, branch, warehouse, sourceB],
    );

    await client.query(
      "INSERT INTO public.raw_fifo_backfill_allocations(run_id,consumption_ledger_id,receipt_ledger_id,allocation_type,quantity,unit_cost,total_cost) VALUES($1,$2,$3,'debt_settlement',5,10,50),($1,$4,$3,'debt_settlement',5,10,50)",
      [newRun, sourceA, receipt1, sourceB],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('rebuilds only affected historical settlements and restores them exactly on reverse', async () => {
    const applied = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_apply_backfill($1) r',
      [newRun],
    );
    expect(applied[0].r.success).toBe(true);

    const debts = await q<{ source_ledger_id: string; debt_quantity: string; settled_quantity: string }>(
      'SELECT source_ledger_id::text,debt_quantity::text,settled_quantity::text FROM public.raw_fifo_debts WHERE id IN ($1,$2) ORDER BY source_ledger_id',
      [debtA, debtB],
    );
    expect(num(debts[0].debt_quantity)).toBe(5);
    expect(num(debts[0].settled_quantity)).toBe(5);
    expect(num(debts[1].debt_quantity)).toBe(5);

    const current = await q<{ debt_id: string; receipt_ledger_id: string; quantity: string; run_id: string | null }>(
      'SELECT debt_id::text,receipt_ledger_id::text,quantity::text,run_id::text FROM public.raw_fifo_settlements WHERE debt_id IN ($1,$2) ORDER BY debt_id',
      [debtA, debtB],
    );
    expect(current).toHaveLength(2);
    expect(current.every((x) => Number(x.receipt_ledger_id) === receipt1)).toBe(true);
    expect(current.every((x) => num(x.quantity) === 5)).toBe(true);
    expect(current.every((x) => x.run_id === newRun)).toBe(true);

    const snapshots = await q<{ debts: string; settlements: string }>(
      'SELECT (SELECT count(*)::text FROM public.raw_fifo_debt_rebase_snapshots WHERE run_id=$1) debts,(SELECT count(*)::text FROM public.raw_fifo_debt_rebase_settlement_snapshots WHERE run_id=$1) settlements',
      [newRun],
    );
    expect(num(snapshots[0].debts)).toBe(2);
    expect(num(snapshots[0].settlements)).toBe(2);

    const reversed = await q<{ r: Record<string, unknown> }>(
      'SELECT public.raw_fifo_reverse_backfill($1) r',
      [newRun],
    );
    expect(reversed[0].r.success).toBe(true);

    const restoredDebts = await q<{ id: string; debt_quantity: string; settled_quantity: string }>(
      'SELECT id::text,debt_quantity::text,settled_quantity::text FROM public.raw_fifo_debts WHERE id IN ($1,$2) ORDER BY id',
      [debtA, debtB],
    );
    const a = restoredDebts.find((x) => x.id === debtA)!;
    const b = restoredDebts.find((x) => x.id === debtB)!;
    expect(num(a.debt_quantity)).toBe(10);
    expect(num(a.settled_quantity)).toBe(10);
    expect(num(b.debt_quantity)).toBe(5);
    expect(num(b.settled_quantity)).toBe(5);

    const restored = await q<{ id: string; debt_id: string; receipt_ledger_id: string; quantity: string; run_id: string | null }>(
      'SELECT id::text,debt_id::text,receipt_ledger_id::text,quantity::text,run_id::text FROM public.raw_fifo_settlements WHERE debt_id IN ($1,$2) ORDER BY id',
      [debtA, debtB],
    );
    expect(restored).toHaveLength(2);
    const restoredA = restored.find((x) => x.id === oldSettlementA)!;
    const restoredB = restored.find((x) => x.id === oldSettlementB)!;
    expect(restoredA.debt_id).toBe(debtA);
    expect(Number(restoredA.receipt_ledger_id)).toBe(receipt1);
    expect(num(restoredA.quantity)).toBe(10);
    expect(restoredA.run_id).toBe(oldRun);
    expect(restoredB.debt_id).toBe(debtB);
    expect(Number(restoredB.receipt_ledger_id)).toBe(receipt2);
    expect(num(restoredB.quantity)).toBe(5);
    expect(restoredB.run_id).toBeNull();
  });
});
