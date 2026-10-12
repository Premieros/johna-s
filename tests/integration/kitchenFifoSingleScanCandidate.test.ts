import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const local = !!dbUrl && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(dbUrl).hostname);

describe.skipIf(!local)('experimental FIFO single-scan balance parity (rollback-only local DB)', () => {
  let client: pg.Client;
  const branch = randomUUID();
  const foreignBranch = randomUUID();
  const warehouse = randomUUID();
  const otherWarehouse = randomUUID();
  const foreignWarehouse = randomUUID();
  const raw = randomUUID();

  beforeAll(async () => {
    if (!local) throw new Error('Disposable loopback DB required');
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(readFileSync('scripts/experiments/kitchen_fifo_single_scan_candidate_20261012.sql', 'utf8'));
    await client.query("INSERT INTO public.branches(id,name) VALUES ($1,'Single scan'),($2,'Foreign')", [branch, foreignBranch]);
    await client.query("INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES ($1,'A',$4,true),($2,'B',$4,true),($3,'Foreign',$5,true)", [warehouse, otherWarehouse, foreignWarehouse, branch, foreignBranch]);
    await client.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,'Single scan raw',$3,3,true)", [raw, 'single-'+raw, branch]);
    await client.query(
      "INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type,created_at) VALUES ($1,$2,$3,'ss-one',1.5,0.123456,'fixture',now()-interval '3 days'),($1,$2,$3,'ss-two',2.5,11.987654,'fixture',now()-interval '2 days'),($1,$2,$3,'ss-old-debt',-2,3,'fixture_oversold',now()-interval '1 day'),($1,$2,$4,'ss-other',5,20,'fixture',now())",
      [raw, branch, warehouse, otherWarehouse],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  async function run(candidate: boolean, quantities: number[], allowNegative: boolean, wh = warehouse) {
    await client.query('SAVEPOINT single_scan_case');
    try {
      const results: Record<string, unknown>[] = [];
      for (const qty of quantities) {
        const name = candidate ? '_raw_remove_fifo_single_scan_candidate' : '_raw_remove_fifo';
        const r = await client.query(
          'SELECT public.'+name+'($1::uuid,$2::uuid,$3::uuid,$4::numeric,$5::text,$5::text,$6::uuid,$7::text,NULL::uuid,$8::boolean) result',
          [raw, branch, wh, qty, 'kitchen_send', randomUUID(), 'single-scan-fixture', allowNegative],
        );
        const { debt_batch_number: _batch, fifo_debt_ledger_id: _ledger, ...stable } = r.rows[0].result;
        void _batch;
        void _ledger;
        results.push(stable);
      }
      const inventory = (await client.query('SELECT quantity::text,avg_cost::text FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2', [raw, branch])).rows;
      const batches = (await client.query('SELECT warehouse_id::text,quantity::text,unit_cost::text FROM public.raw_material_batches WHERE raw_material_id=$1 ORDER BY warehouse_id,quantity,unit_cost', [raw])).rows;
      const ledger = (await client.query('SELECT quantity::text,unit_cost::text,total_cost::text,before_qty::text,after_qty::text,warehouse_id::text FROM public.inventory_ledger WHERE raw_material_id=$1 ORDER BY id', [raw])).rows;
      const debts = (await client.query('SELECT debt_quantity::text,settled_quantity::text,warehouse_id::text FROM public.raw_fifo_debts WHERE raw_material_id=$1 ORDER BY debt_quantity', [raw])).rows;
      return { results, inventory, batches, ledger, debts };
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT single_scan_case');
      await client.query('RELEASE SAVEPOINT single_scan_case');
    }
  }

  for (const scenario of [
    { name: 'no-op', quantities: [0], negative: false },
    { name: 'fractional deduction', quantities: [1.2345], negative: false },
    { name: 'multiple FIFO batches', quantities: [3], negative: false },
    { name: 'shortage without oversell', quantities: [7], negative: false },
    { name: 'shortage with trigger-priced debt', quantities: [7], negative: true },
    { name: 'repeated same-material deductions', quantities: [1, 2, 3], negative: true },
  ]) {
    it('matches canonical balances, cost, ledger and debts for '+scenario.name, async () => {
      const canonical = await run(false, scenario.quantities, scenario.negative);
      const candidate = await run(true, scenario.quantities, scenario.negative);
      expect(candidate).toEqual(canonical);
    });
  }

  it('preserves warehouse/branch mismatch rejection', async () => {
    expect(await run(true, [1], true, foreignWarehouse)).toEqual(await run(false, [1], true, foreignWarehouse));
  });

  it('does not grant execution to public application roles', async () => {
    const r = await client.query("SELECT has_function_privilege('anon','public._raw_remove_fifo_single_scan_candidate(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)','EXECUTE') anon, has_function_privilege('authenticated','public._raw_remove_fifo_single_scan_candidate(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)','EXECUTE') authenticated");
    expect(r.rows[0]).toEqual({ anon: false, authenticated: false });
  });
});
