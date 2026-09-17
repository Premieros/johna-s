import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type CloseResult = {
  success?: boolean;
  error?: string;
  shift_id?: string;
  open_order_count?: number;
  open_table_count?: number;
  open_orders_preserved?: boolean;
};

describe.skipIf(skip)('shift close open-order guard', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const closeOnlyUser = randomUUID();
  const overrideUser = randomUUID();
  const branchBUser = randomUUID();
  const closeRole = `qa_shift_close_${randomUUID().slice(0, 8)}`;
  const overrideRole = `qa_shift_override_${randomUUID().slice(0, 8)}`;
  const tableA = randomUUID();
  const productA = randomUUID();
  const orderA = randomUUID();
  const shiftA = randomUUID();
  const shiftB = randomUUID();

  async function asUser(userId: string, sql: string, params: unknown[] = []) {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await client.query(sql, params);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches (id,name) VALUES ($1,'QA Shift Open A'),($2,'QA Shift Open B')`,
      [branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.products (id,name,branch_id,cost_price,sale_price,is_active)
       VALUES ($1,'QA Shift Product',$2,10,25,true)`,
      [productA, branchA],
    );

    await client.query(
      `INSERT INTO public.roles (role,name_ar,name_en,permissions,scope,is_active) VALUES
       ($1,'إغلاق فقط','Close only','["shifts.close"]'::jsonb,'global',true),
       ($2,'إغلاق مع طلبات مفتوحة','Close with open orders','["shifts.close","shifts.close_with_open_orders"]'::jsonb,'global',true)`,
      [closeRole, overrideRole],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active) VALUES
       ($1,$2,'Close Only',$3,$4,true),
       ($5,$6,'Override Close',$7,$4,true),
       ($8,$9,'Branch B Close',$3,$10,true)`,
      [
        closeOnlyUser, `${closeOnlyUser}@test.local`, closeRole, branchA,
        overrideUser, `${overrideUser}@test.local`, overrideRole, branchA,
        branchBUser, `${branchBUser}@test.local`, closeRole, branchB,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.dining_tables(id,branch_id,name,capacity,status,is_active)
       VALUES ($1,$2,'QA Open Table',4,'vacant',true)`,
      [tableA, branchA],
    );
    await client.query(
      `INSERT INTO public.orders(id,order_number,branch_id,order_type,status,table_id,cashier_id,subtotal,total)
       VALUES ($1,$2,$3,'dine_in','open',$4,$5,25,25)`,
      [orderA, `QA-${randomUUID()}`, branchA, tableA, closeOnlyUser],
    );
    await client.query(
      `INSERT INTO public.order_items(order_id,product_id,unit_name,quantity,unit_price,total)
       VALUES ($1,$2,'piece',1,25,25)`,
      [orderA, productA],
    );

    await client.query(
      `INSERT INTO public.shifts(id,branch_id,cashier_id,opening_amount,status)
       VALUES ($1,$2,$3,100,'open')`,
      [shiftA, branchA, closeOnlyUser],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('normal close fails closed and reports effective open orders/tables', async () => {
    const result = await asUser(
      closeOnlyUser,
      `SELECT public.close_shift($1,100,NULL) AS r`,
      [shiftA],
    );
    const r = result.rows[0].r as CloseResult;
    expect(r).toMatchObject({
      success: false,
      error: 'OPEN_ORDERS_BLOCK_SHIFT_CLOSE',
      open_order_count: 1,
      open_table_count: 1,
    });

    const state = await client.query<{ status: string }>('SELECT status FROM public.shifts WHERE id=$1', [shiftA]);
    expect(state.rows[0].status).toBe('open');
  });

  it('requires both base close and explicit open-order override permissions', async () => {
    const result = await asUser(
      closeOnlyUser,
      `SELECT public.close_shift_with_open_orders($1,100,NULL) AS r`,
      [shiftA],
    );
    expect(result.rows[0].r).toMatchObject({ success: false, error: 'SHIFT_CLOSE_OPEN_ORDERS_DENIED' });
  });

  it('override closes only the shift and preserves the open order and occupied table', async () => {
    await client.query('UPDATE public.shifts SET cashier_id=$1 WHERE id=$2', [overrideUser, shiftA]);

    const result = await asUser(
      overrideUser,
      `SELECT public.close_shift_with_open_orders($1,100,'handover with open table') AS r`,
      [shiftA],
    );
    const r = result.rows[0].r as CloseResult;
    expect(r).toMatchObject({
      success: true,
      shift_id: shiftA,
      open_orders_preserved: true,
      open_order_count: 1,
      open_table_count: 1,
    });

    const order = await client.query<{ status: string }>('SELECT status FROM public.orders WHERE id=$1', [orderA]);
    expect(order.rows[0].status).toBe('open');

    const table = await client.query<{ status: string }>('SELECT status FROM public.dining_tables WHERE id=$1', [tableA]);
    expect(table.rows[0].status).toBe('occupied');

    const shift = await client.query<{ status: string }>('SELECT status FROM public.shifts WHERE id=$1', [shiftA]);
    expect(shift.rows[0].status).toBe('closed');
  });

  it('is retry-safe after the shift has already closed', async () => {
    const result = await asUser(
      overrideUser,
      `SELECT public.close_shift_with_open_orders($1,100,NULL) AS r`,
      [shiftA],
    );
    expect(result.rows[0].r).toMatchObject({ success: false, error: 'SHIFT_CLOSED' });
  });

  it('does not let another branch open order block normal close', async () => {
    await client.query(
      `INSERT INTO public.shifts(id,branch_id,cashier_id,opening_amount,status)
       VALUES ($1,$2,$3,50,'open')`,
      [shiftB, branchB, branchBUser],
    );

    const result = await asUser(
      branchBUser,
      `SELECT public.close_shift($1,50,NULL) AS r`,
      [shiftB],
    );
    expect(result.rows[0].r).toMatchObject({ success: true, shift_id: shiftB });
  });
});