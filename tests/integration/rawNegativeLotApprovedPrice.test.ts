import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getDbUrl, openDb } from './db';

const url = getDbUrl();
it.skipIf(!url)('prices a new negative lot from the approved source, freezes it, and does not invent a price', async () => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url!).hostname)) throw new Error('Owned localhost only');
  const db = openDb(url!);
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(readFileSync('scripts/db/candidates/raw_negative_lot_approved_price_20261103.sql', 'utf8'));
    const branch = randomUUID(), warehouse = randomUUID(), raw = randomUUID(), missing = randomUUID();
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Approved lot fixture')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,branch_id,name) VALUES($1,$2,'Fixture')",[warehouse,branch]);
    await db.query("INSERT INTO public.raw_materials(id,branch_id,code,name,default_cost) VALUES($1,$3,$1::uuid::text,'Priced',0),($2,$3,$2::uuid::text,'Missing',0)",[raw,missing,branch]);
    await db.query("INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type) VALUES($1,$2,$3,'OLD-PRICE',4,999,'opening')",[raw,branch,warehouse]);
    await db.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,17,'pricing','QA-17',clock_timestamp())",[raw,branch]);
    const inserted = await db.query("INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type) VALUES($1,$3,$4,'OV-PRICED',-2,0,'sale_oversold'),($2,$3,$4,'OV-UNPRICED',-1,0,'sale_oversold') RETURNING id,unit_cost",[raw,missing,branch,warehouse]);
    expect(inserted.rows.map(row => Number(row.unit_cost))).toEqual([17,0]);
    await db.query("INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) VALUES($1,$2,30,'pricing','QA-30',clock_timestamp()),($3,$2,40,'pricing','QA-40',clock_timestamp())",[raw,branch,missing]);
    const frozen = await db.query("UPDATE public.raw_material_batches SET quantity=quantity-1 WHERE id=ANY($1::uuid[]) RETURNING batch_number,unit_cost",[inserted.rows.map(row => row.id)]);
    expect(Object.fromEntries(frozen.rows.map(row => [row.batch_number,Number(row.unit_cost)]))).toEqual({'OV-PRICED':17,'OV-UNPRICED':0});
    const privateAccess = await db.query("SELECT has_function_privilege('authenticated','public._raw_last_known_fifo_cost(uuid,uuid,uuid)','EXECUTE') allowed");
    expect(privateAccess.rows[0].allowed).toBe(false);
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
