import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
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
      `INSERT INTO public.raw_material_batches(raw_material_id,branch_id,batch_number,quantity,unit_cost,source_type)
       VALUES ($1,$2,'RAW-TRANSFER-QA',20,4,'opening')`,
      [rawA, branchA],
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
});
