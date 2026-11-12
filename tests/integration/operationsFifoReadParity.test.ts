import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
describe.skipIf(!dbUrl)('last-known FIFO read precedence and rollback', () => {
  let client: pg.Client;
  const branch = randomUUID(), otherBranch = randomUUID(), warehouse = randomUUID(), otherWarehouse = randomUUID();
  const material = randomUUID();
  const restore = readFileSync('scripts/rollback/operations_stability_original_functions_20261015.sql', 'utf8');

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query('INSERT INTO public.branches(id,name) VALUES($1,$3),($2,$4)', [branch, otherBranch, 'FIFO parity', 'Other FIFO']);
    await client.query('INSERT INTO public.warehouses(id,name,branch_id) VALUES($1,$3,$4),($2,$5,$4)', [warehouse, otherWarehouse, 'FIFO W1', branch, 'FIFO W2']);
    await client.query("INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost) VALUES($1,$2,'FIFO raw',$3,7.25)", [material, randomUUID(), branch]);
  });
  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });

  async function cost(b = branch, w = warehouse) {
    return (await client.query('SELECT public._raw_last_known_fifo_cost($1,$2,$3)::text cost', [material,b,w])).rows[0].cost;
  }
  async function parity(expected: string) {
    const optimized = await cost();
    expect(Number(optimized)).toBe(Number(expected));
    await client.query('SAVEPOINT original_functions');
    try {
      await client.query(restore);
      expect(await cost()).toBe(optimized);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT original_functions');
      await client.query('RELEASE SAVEPOINT original_functions');
    }
    expect(await cost()).toBe(optimized);
  }

  it('retains fallback, warehouse/branch boundaries, real-batch/receipt/issue precedence and timestamp ties', async () => {
    await parity('7.25');
    expect(Number(await cost(otherBranch))).toBe(0);
    await client.query(`INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,source_type)
      VALUES($1,$2,$3,0,11.50,'purchase'),($1,$2,$4,0,99,'purchase'),($1,$2,$3,0,99,'pos_oversold')`, [material,branch,warehouse,otherWarehouse]);
    await parity('11.5');
    await client.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,created_at)
      VALUES($1,$2,$3,1,13.25,13.25,'purchase','purchase',now()-interval '1 day'),
            ($1,$2,$3,-1,0,0,'sale','sale',now())`, [material,branch,warehouse]);
    await parity('13.25');
    await client.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,batch_number,created_at)
      VALUES($1,$2,$3,-1,15.75,-15.75,'sale','REAL',now()-interval '2 days'),
            ($1,$2,$3,-1,99,-99,'sale','OV-EXCLUDE',now())`, [material,branch,warehouse]);
    await parity('15.75');
    await client.query(`INSERT INTO public.inventory_ledger(raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,batch_number,created_at)
      VALUES($1,$2,$3,-1,16.25,-16.25,'sale',null,now()),
            ($1,$2,$3,-1,17.25,-17.25,'sale','TIE',now())`, [material,branch,warehouse]);
    await parity('17.25');
    // Rollback restores both original functions, not only the pricing reader.
    const defs = (await client.query("SELECT pg_get_functiondef('public.enforce_pos_permission_mutation()'::regprocedure) AS def")).rows[0].def;
    expect(defs).toContain('A repeated authorized KDS status');
  });
});
