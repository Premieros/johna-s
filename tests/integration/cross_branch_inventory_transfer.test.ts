import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = { success?: boolean; error?: string; transfer_id?: string; status?: string };

describe.skipIf(skip)('cross-branch inventory transfer', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const branchC = randomUUID();
  const whA1 = randomUUID();
  const whA2 = randomUUID();
  const whB = randomUUID();
  const whC = randomUUID();
  const userSingle = randomUUID();
  const userMulti = randomUUID();
  const userC = randomUUID();
  const role = `qa_cross_transfer_${randomUUID().slice(0, 8)}`;
  const productA = randomUUID();
  const productB = randomUUID();
  const productBDecoy = randomUUID();
  const productC = randomUUID();
  const rawA = randomUUID();
  const rawB = randomUUID();
  const rawBDecoy = randomUUID();

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function createTransfer(
    userId: string,
    fromWarehouse: string,
    toWarehouse: string,
    sourceBranch: string,
    items: Record<string, unknown>[],
  ): Promise<RpcResult> {
    return asUser(userId, async () => {
      const result = await client.query<{ result: RpcResult }>(
        `SELECT public.create_warehouse_transfer($1,$2,$3,$4::jsonb,NULL,NULL) AS result`,
        [fromWarehouse, toWarehouse, sourceBranch, JSON.stringify(items)],
      );
      return result.rows[0].result;
    });
  }

  async function approve(userId: string, transferId: string): Promise<RpcResult> {
    return asUser(userId, async () => {
      const result = await client.query<{ result: RpcResult }>(
        `SELECT public.approve_warehouse_transfer($1) AS result`,
        [transferId],
      );
      return result.rows[0].result;
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO public.branches(id,name) VALUES ($1,'Transfer A'),($2,'Transfer B'),($3,'Transfer C')`,
      [branchA, branchB, branchC],
    );
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'تحويل متعدد الفروع','Cross branch transfer',
         '["inventory.transfer.create","inventory.transfer.approve"]'::jsonb,'global',true)`,
      [role],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES
       ($1,$4,'Single A',$7,$5,true),($2,$8,'Multi A B',$7,$5,true),($3,$9,'Single C',$7,$6,true)`,
      [
        userSingle, userMulti, userC,
        `${randomUUID()}@test.local`, branchA, branchC, role,
        `${randomUUID()}@test.local`, `${randomUUID()}@test.local`,
      ],
    );
    await client.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.user_branch_access(user_id,branch_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [userMulti, branchB],
    );
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES
       ($1,'A1',$5,true),($2,'A2',$5,true),($3,'B1',$6,true),($4,'C1',$7,true)`,
      [whA1, whA2, whB, whC, branchA, branchB, branchC],
    );
    await client.query(
      `INSERT INTO public.products(id,name,sku,barcode,sale_price,cost_price,branch_id,is_active) VALUES
       ($1,'Same product','SKU-A','BAR-A',10,5,$5,true),
       ($2,'Same product','SKU-B-CHOSEN','BAR-B-CHOSEN',10,5,$6,true),
       ($3,'Same product','SKU-B-DECOY','BAR-B-DECOY',10,5,$6,true),
       ($4,'Same product','SKU-C','BAR-C',10,5,$7,true)`,
      [productA, productB, productBDecoy, productC, branchA, branchB, branchC],
    );
    await client.query(
      `INSERT INTO public.inventory(product_id,warehouse_id,branch_id,quantity) VALUES ($1,$2,$3,10)`,
      [productA, whA1, branchA],
    );
    await client.query(
      `INSERT INTO public.inventory_batches(product_id,warehouse_id,branch_id,batch_number,quantity,unit_cost,source_type)
       VALUES ($1,$2,$3,'TRANSFER-QA',10,5,'opening')`,
      [productA, whA1, branchA],
    );
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES
       ($1,$4,'Same raw',$6,4,true),($2,$5,'Same raw',$7,4,true),($3,$8,'Same raw',$7,4,true)`,
      [rawA, rawB, rawBDecoy, `RAW-A-${randomUUID()}`, `RAW-B-${randomUUID()}`, branchA, branchB, `RAW-B2-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES ($1,$2,20,4)`,
      [rawA, branchA],
    );
    await client.query(
      `INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type)
       VALUES ($1,$2,$3,'RAW-TRANSFER-QA',20,4,'opening')`,
      [rawA, branchA, whA1],
    );
  });

  beforeEach(async () => {
    await client.query('SAVEPOINT cross_branch_case');
  });

  afterEach(async () => {
    await client.query('ROLLBACK TO SAVEPOINT cross_branch_case');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('allows same-branch product movement for a single-branch user', async () => {
    const created = await createTransfer(userSingle, whA1, whA2, branchA, [
      { item_type: 'product', item_id: productA, destination_item_id: productA, quantity: 2, unit_cost: 5 },
    ]);
    expect(created.success).toBe(true);
    expect((await approve(userSingle, created.transfer_id!)).success).toBe(true);
    const rows = await client.query<{ warehouse_id: string; quantity: string }>(
      `SELECT warehouse_id,quantity FROM public.inventory WHERE product_id=$1 ORDER BY warehouse_id`,
      [productA],
    );
    expect(Object.fromEntries(rows.rows.map((row) => [row.warehouse_id, Number(row.quantity)]))).toMatchObject({ [whA1]: 8, [whA2]: 2 });
  });

  it('requires access to both branches for create and approve', async () => {
    const denied = await createTransfer(userSingle, whA1, whB, branchA, [
      { item_type: 'product', item_id: productA, destination_item_id: productB, quantity: 1, unit_cost: 5 },
    ]);
    expect(denied).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });

    const created = await createTransfer(userMulti, whA1, whB, branchA, [
      { item_type: 'product', item_id: productA, destination_item_id: productB, quantity: 1, unit_cost: 5 },
    ]);
    expect(created.success).toBe(true);
    expect(await approve(userSingle, created.transfer_id!)).toMatchObject({ success: false, error: 'TRANSFER_NOT_FOUND' });
  });

  it('uses the explicit destination product and never a same-name decoy', async () => {
    const missing = await createTransfer(userMulti, whA1, whB, branchA, [
      { item_type: 'product', item_id: productA, destination_item_id: '', quantity: 3, unit_cost: 5 },
    ]);
    expect(missing).toMatchObject({ success: false, error: 'DESTINATION_ITEM_REQUIRED' });

    const wrongBranch = await createTransfer(userMulti, whA1, whB, branchA, [
      { item_type: 'product', item_id: productA, destination_item_id: productC, quantity: 3, unit_cost: 5 },
    ]);
    expect(wrongBranch).toMatchObject({ success: false, error: 'DESTINATION_ITEM_BRANCH_MISMATCH' });

    const created = await createTransfer(userMulti, whA1, whB, branchA, [
      { item_type: 'product', item_id: productA, destination_item_id: productB, quantity: 3, unit_cost: 5 },
    ]);
    expect((await approve(userMulti, created.transfer_id!)).success).toBe(true);
    expect(await approve(userMulti, created.transfer_id!)).toMatchObject({ success: false, error: 'INVALID_STATUS' });

    const stock = await client.query<{ product_id: string; quantity: string }>(
      `SELECT product_id,quantity FROM public.inventory WHERE warehouse_id=$1 AND product_id=ANY($2::uuid[])`,
      [whB, [productB, productBDecoy]],
    );
    expect(Object.fromEntries(stock.rows.map((row) => [row.product_id, Number(row.quantity)]))).toEqual({ [productB]: 3 });
    const source = await client.query<{ quantity: string }>(`SELECT quantity FROM public.inventory WHERE product_id=$1 AND warehouse_id=$2`, [productA, whA1]);
    expect(Number(source.rows[0].quantity)).toBe(7);
  });

  it('moves raw material once to the explicit destination identity', async () => {
    const created = await createTransfer(userMulti, whA1, whB, branchA, [
      { item_type: 'raw_material', item_id: rawA, destination_item_id: rawB, quantity: 4, unit_cost: 4 },
    ]);
    expect(created.success).toBe(true);
    expect((await approve(userMulti, created.transfer_id!)).success).toBe(true);
    expect(await approve(userMulti, created.transfer_id!)).toMatchObject({ success: false, error: 'INVALID_STATUS' });

    const balances = await client.query<{ raw_material_id: string; quantity: string }>(
      `SELECT raw_material_id,quantity FROM public.raw_material_inventory WHERE raw_material_id=ANY($1::uuid[]) ORDER BY raw_material_id`,
      [[rawA, rawB, rawBDecoy]],
    );
    expect(Object.fromEntries(balances.rows.map((row) => [row.raw_material_id, Number(row.quantity)]))).toEqual({ [rawA]: 16, [rawB]: 4 });
  });

  it('rejects mismatched raw units before creating a header', async () => {
    const unit=(await client.query(`SELECT id FROM public.units ORDER BY code LIMIT 1`)).rows[0].id;
    await client.query('UPDATE public.raw_materials SET unit_id=$1 WHERE id=$2',[unit,rawB]);
    const before=(await client.query('SELECT count(*) n FROM public.warehouse_transfers WHERE branch_id=$1',[branchA])).rows[0].n;
    const result=await createTransfer(userMulti,whA1,whB,branchA,[{item_type:'raw_material',item_id:rawA,destination_item_id:rawB,quantity:4,unit_cost:4}]);
    expect(result).toMatchObject({success:false,error:'TRANSFER_UNIT_MISMATCH'});
    expect((await client.query('SELECT count(*) n FROM public.warehouse_transfers WHERE branch_id=$1',[branchA])).rows[0].n).toBe(before);
  });

  it('rechecks pending raw units before any stock movement', async () => {
    const created=await createTransfer(userMulti,whA1,whB,branchA,[{item_type:'raw_material',item_id:rawA,destination_item_id:rawB,quantity:4,unit_cost:4}]);
    expect(created.success).toBe(true);
    const unit=(await client.query(`SELECT id FROM public.units ORDER BY code LIMIT 1`)).rows[0].id;
    await client.query('UPDATE public.raw_materials SET unit_id=$1 WHERE id=$2',[unit,rawB]);
    expect(await approve(userMulti,created.transfer_id!)).toMatchObject({success:false,error:'TRANSFER_UNIT_MISMATCH'});
    expect(Number((await client.query('SELECT quantity FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2',[rawA,branchA])).rows[0].quantity)).toBe(20);
    expect((await client.query('SELECT status FROM public.warehouse_transfers WHERE id=$1',[created.transfer_id])).rows[0].status).toBe('pending');
  });

  it('keeps direct table writes closed so approval cannot bypass stock movement', async () => {
    const created = await createTransfer(userMulti, whA1, whB, branchA, [
      { item_type: 'product', item_id: productA, destination_item_id: productB, quantity: 1, unit_cost: 5 },
    ]);
    const direct = await asUser(userMulti, () => client.query(
      `UPDATE public.warehouse_transfers SET status='approved' WHERE id=$1`,
      [created.transfer_id],
    ));
    expect(direct.rowCount).toBe(0);
    const status = await client.query<{ status: string }>(`SELECT status FROM public.warehouse_transfers WHERE id=$1`, [created.transfer_id]);
    expect(status.rows[0].status).toBe('pending');
  });

  it('shows a transfer only to users who can access at least one side', async () => {
    const created = await createTransfer(userMulti, whA1, whB, branchA, [
      { item_type: 'product', item_id: productA, destination_item_id: productB, quantity: 1, unit_cost: 5 },
    ]);
    const sourceSide = await asUser(userSingle, () => client.query(`SELECT id FROM public.warehouse_transfers WHERE id=$1`, [created.transfer_id]));
    const unrelated = await asUser(userC, () => client.query(`SELECT id FROM public.warehouse_transfers WHERE id=$1`, [created.transfer_id]));
    expect(sourceSide.rowCount).toBe(1);
    expect(unrelated.rowCount).toBe(0);
  });
  async function publishReceiverPrice(value:number) {
    await client.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,priced_at,reference_number) VALUES($1,$2,$3,'pricing',clock_timestamp()+interval '1 second','TRANSFER-RECEIVER-PRICE')`,[rawB,branchB,value]);
  }
  async function rawTransfer() {
    return createTransfer(userMulti,whA1,whB,branchA,[{item_type:'raw_material',item_id:rawA,destination_item_id:rawB,quantity:4,unit_cost:999}]);
  }
  it('quotes the receiver price and refreshes it at approval without source-price contamination',async()=>{
    await publishReceiverPrice(7.123456);
    const created=await rawTransfer();expect(created.success).toBe(true);
    const readLine=()=>client.query('SELECT unit_cost FROM public.warehouse_transfer_items WHERE transfer_id=$1',[created.transfer_id]);
    expect(Number((await readLine()).rows[0].unit_cost)).toBe(7.123456);
    await publishReceiverPrice(9.654321);
    expect(await approve(userMulti,created.transfer_id!)).toMatchObject({success:true});
    expect(Number((await readLine()).rows[0].unit_cost)).toBe(9.654321);
    const ledgers=await client.query(`SELECT branch_id,quantity,unit_cost FROM public.inventory_ledger WHERE reference_type='warehouse_transfer' AND reference_id=$1 ORDER BY quantity`,[created.transfer_id]);
    expect(ledgers.rows).toHaveLength(2);expect(Number(ledgers.rows[0].unit_cost)).toBe(4);expect(Number(ledgers.rows[1].unit_cost)).toBe(9.654321);
    const snapshot=await client.query('SELECT unit_cost,destination_branch_id FROM private.raw_transfer_receipt_prices WHERE transfer_id=$1',[created.transfer_id]);
    expect(Number(snapshot.rows[0].unit_cost)).toBe(9.654321);expect(snapshot.rows[0].destination_branch_id).toBe(branchB);
    const current=await client.query('SELECT unit_cost FROM public.get_raw_material_current_prices($1,$2)',[branchB,[rawB]]);
    expect(Number(current.rows[0].unit_cost)).toBe(9.654321);
    expect(await approve(userMulti,created.transfer_id!)).toMatchObject({success:false,error:'INVALID_STATUS'});
  });
  it('uses zero for a receiver with no price and never falls back to the source or client price',async()=>{
    await client.query('UPDATE public.raw_materials SET default_cost=0 WHERE id=$1',[rawB]);
    await client.query('DELETE FROM private.raw_approved_price_read_model WHERE raw_material_id=$1',[rawB]);
    const created=await rawTransfer();expect(created.success).toBe(true);expect((await approve(userMulti,created.transfer_id!)).success).toBe(true);
    const result=await client.query(`SELECT unit_cost FROM public.inventory_ledger WHERE reference_id=$1 AND raw_material_id=$2 AND quantity>0`,[created.transfer_id,rawB]);
    expect(Number(result.rows[0].unit_cost)).toBe(0);
  });
  it('does not reprice a frozen receiver receipt during a source valuation repair',async()=>{
    await publishReceiverPrice(8);const created=await rawTransfer();expect((await approve(userMulti,created.transfer_id!)).success).toBe(true);
    const repaired=await client.query(`SELECT public._fifo_adjust_warehouse_transfer_delta($1,$2,$3,'raw_material',$4,10) result`,[created.transfer_id,branchA,whA1,rawA]);
    expect(repaired.rows[0].result).toMatchObject({success:true,delta:0,destination_price_frozen:true});
    expect(Number((await client.query('SELECT unit_cost FROM public.warehouse_transfer_items WHERE transfer_id=$1',[created.transfer_id])).rows[0].unit_cost)).toBe(8);
  });
  it('keeps snapshot state private and rolls it back when destination receipt fails',async()=>{
    const created=await rawTransfer();await client.query('UPDATE public.raw_materials SET is_active=false WHERE id=$1',[rawB]);
    expect(await approve(userMulti,created.transfer_id!)).toMatchObject({success:false,error:'TRANSACTION_FAILED'});
    expect((await client.query('SELECT 1 FROM private.raw_transfer_receipt_prices WHERE transfer_id=$1',[created.transfer_id])).rowCount).toBe(0);
    expect(Number((await client.query('SELECT quantity FROM public.raw_material_inventory WHERE raw_material_id=$1',[rawA])).rows[0].quantity)).toBe(20);
    expect((await client.query("SELECT has_table_privilege('authenticated','private.raw_transfer_receipt_prices','SELECT,INSERT,UPDATE,DELETE') allowed")).rows[0].allowed).toBe(false);
  });

  it('restores exact function bodies and security on rollback/reapply without losing receipt prices',async()=>{
    await publishReceiverPrice(7.123456);const created=await rawTransfer();expect((await approve(userMulti,created.transfer_id!)).success).toBe(true);
    const read=()=>client.query("SELECT p.proname,pg_get_functiondef(p.oid) definition,p.prosecdef,p.proowner,p.proacl,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('create_warehouse_transfer','approve_warehouse_transfer','_fifo_adjust_warehouse_transfer_delta') ORDER BY p.proname");
    const before=(await read()).rows;expect(before).toHaveLength(3);
    await client.query('SAVEPOINT destination_price_rollback');
    try {
      await client.query(readFileSync('scripts/rollback/destination_raw_transfer_price_20261029.sql','utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
      expect(Number((await client.query('SELECT unit_cost FROM private.raw_transfer_receipt_prices WHERE transfer_id=$1',[created.transfer_id])).rows[0].unit_cost)).toBe(7.123456);
      const migration=readdirSync('supabase/migrations').find(p=>p.endsWith('_destination_raw_transfer_price.sql'))!;
      await client.query(readFileSync(`supabase/migrations/${migration}`,'utf8').replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''));
      expect((await read()).rows).toEqual(before);
      expect(Number((await client.query('SELECT unit_cost FROM public.warehouse_transfer_items WHERE transfer_id=$1',[created.transfer_id])).rows[0].unit_cost)).toBe(7.123456);
    } finally {await client.query('ROLLBACK TO SAVEPOINT destination_price_rollback');}
  });

});
