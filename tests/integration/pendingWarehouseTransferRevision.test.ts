import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, uniq, type RlsIds } from './rls';

// This test is isolated to a local disposable database. Never connect to production.
const dbUrl = getDbUrl();
let localDb = false;
try { localDb = ['localhost','127.0.0.1','[::1]'].includes(new URL(dbUrl).hostname); }
catch { /* no database configured */ }

describe.skipIf(!localDb)('pending transfer edits before approval', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let transferId = '';
  let line1 = '';
  let line2 = '';
  let baselineLedger = 0;

  beforeAll(async () => {
    client = openDb(dbUrl);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    await client.query("SELECT set_config('app.user_id',$1,true)",[ids.users.super_admin]);
    const a = (await client.query<{id:string}>(
      "INSERT INTO public.raw_materials (code,name,branch_id,is_active) VALUES ($1,'A', $2,true) RETURNING id",
      [uniq('TRANSFER-A'),ids.branchA])).rows[0].id;
    const b = (await client.query<{id:string}>(
      "INSERT INTO public.raw_materials (code,name,branch_id,is_active) VALUES ($1,'B', $2,true) RETURNING id",
      [uniq('TRANSFER-B'),ids.branchA])).rows[0].id;
    const ad = (await client.query<{id:string}>(
      "INSERT INTO public.raw_materials (code,name,branch_id,is_active) VALUES ($1,'A', $2,true) RETURNING id",
      [uniq('TRANSFER-AD'),ids.branchB])).rows[0].id;
    const bd = (await client.query<{id:string}>(
      "INSERT INTO public.raw_materials (code,name,branch_id,is_active) VALUES ($1,'B', $2,true) RETURNING id",
      [uniq('TRANSFER-BD'),ids.branchB])).rows[0].id;
    transferId = (await client.query<{id:string}>(
      "INSERT INTO public.warehouse_transfers (transfer_number,branch_id,to_branch_id,from_warehouse_id,to_warehouse_id,requested_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [uniq('TR'),ids.branchA,ids.branchB,ids.whA,ids.whB,ids.users.super_admin])).rows[0].id;
    line1=(await client.query<{id:string}>(
      "INSERT INTO public.warehouse_transfer_items (transfer_id,raw_material_id,destination_raw_material_id,quantity,unit_cost) VALUES ($1,$2,$3,2.86,270) RETURNING id",
      [transferId,a,ad])).rows[0].id;
    line2=(await client.query<{id:string}>(
      "INSERT INTO public.warehouse_transfer_items (transfer_id,raw_material_id,destination_raw_material_id,quantity,unit_cost) VALUES ($1,$2,$3,6.66,200) RETURNING id",
      [transferId,b,bd])).rows[0].id;
    baselineLedger=Number((await client.query('SELECT count(*)::int n FROM public.inventory_ledger')).rows[0].n);
  });
  afterAll(async () => { if(client){ await client.query('ROLLBACK'); await client.end(); } });

  const call = async (original: unknown[], next: unknown[]) => {
    const {rows} = await client.query<{ result: {success:boolean,error?:string,items_saved?:number} }>(
      'SELECT public.revise_pending_warehouse_transfer($1,$2::jsonb,$3::jsonb) AS result',
      [transferId,JSON.stringify(original),JSON.stringify(next)]);
    return rows[0].result;
  };
  it('changes quantity, removes a line without posting stock', async () => {
    const original=[{id:line1,quantity:2.86},{id:line2,quantity:6.66}].sort((a,b)=>a.id.localeCompare(b.id));
    expect(await call(original,[{id:line1,quantity:3.25}])).toMatchObject({success:true,items_saved:1});
    const rows=(await client.query<{id:string,quantity:string}>(
      'SELECT id,quantity FROM public.warehouse_transfer_items WHERE transfer_id=$1',[transferId])).rows;
    expect(rows.map(r=>r.id)).toEqual([line1]);
    expect(Number(rows[0].quantity)).toBe(3.25);
    expect(Number((await client.query('SELECT count(*)::int n FROM public.inventory_ledger')).rows[0].n)).toBe(baselineLedger);
  });
  it('rejects stale edits and duplicate line IDs', async () => {
    const stale=[{id:line1,quantity:2.86}];
    expect((await call(stale,[{id:line1,quantity:4}])).error).toBe('TRANSFER_ITEMS_CHANGED');
    const current=[{id:line1,quantity:3.25}];
    expect((await call(current,[{id:line1,quantity:1},{id:line1,quantity:2}])).error).toBe('INVALID_TRANSFER_ITEMS');
  });
  it('does not revise an already approved header', async () => {
    await client.query("UPDATE public.warehouse_transfers SET status='approved' WHERE id=$1",[transferId]);
    expect((await call([{id:line1,quantity:3.25}],[{id:line1,quantity:1}])).error).toBe('INVALID_STATUS');
  });
});
