import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAs, seedRlsFixture, type RlsIds } from './rls';
import { randomUUID } from 'node:crypto';

const url = getDbUrl();
const local = !!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);

describe.skipIf(!local)('branch online order markup, tax and price snapshot', () => {
  let db: pg.Client;
  let ids: RlsIds;
  const createOrder = async (branchId: string, type: string) => {
    const result = await db.query<{id:string; online_markup_percent:number|null}>(`
      INSERT INTO public.orders (order_number,branch_id,cashier_id,order_type,status)
      VALUES ($1,$2,$3,$4,'open')
      RETURNING id,online_markup_percent
    `, [randomUUID(), branchId, branchId === ids.branchA ? ids.users.cashier : ids.users.cashier_b, type]);
    return result.rows[0];
  };
  const createItem = async (orderId: string, productId: string, qty = 1) => {
    const r = await db.query<{unit_price:number;total:number}>(`
      INSERT INTO public.order_items
        (order_id,product_id,unit_name,quantity,unit_price,discount_amount,bonus_quantity,total)
      VALUES ($1,$2,'piece',$3,1,0,0,1) RETURNING unit_price,total
    `,[orderId,productId,qty]);
    return r.rows[0];
  };

  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN');
    await db.query("SET LOCAL statement_timeout='12s'");
    ids = await seedRlsFixture(db);
    await db.query(`INSERT INTO public.branch_settings (branch_id,tax_enabled,tax_rate)
      VALUES ($1,true,14)
      ON CONFLICT (branch_id) DO UPDATE SET tax_enabled=true,tax_rate=14`, [ids.branchA]);
  });
  afterAll(async () => {
    if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
  });

  it('does not opt in any branch by default and keeps other order prices unchanged', async () => {
    const rows = await db.query('SELECT branch_id FROM public.branch_online_pricing WHERE branch_id IN ($1,$2)',[ids.branchA,ids.branchB]);
    expect(rows.rowCount).toBe(0);
    const normal = await createOrder(ids.branchA,'takeaway');
    const line = await createItem(normal.id,ids.prodA);
    expect(Number(line.unit_price)).toBe(20);
    expect(Number(line.total)).toBe(20);
  });

  it('restricts pricing configuration to authorized own-branch managers', async () => {
    await db.query(`UPDATE public.roles SET permissions=permissions || '["settings.manage"]'::jsonb WHERE role='branch_manager'`);
    const denied = await runAs(db,ids.users.cashier,
      'SELECT public.set_branch_online_pricing($1::uuid,true,26) AS result',[ids.branchA]);
    expect(denied.rows[0].result).toMatchObject({success:false,error:'PERMISSION_DENIED'});

    const foreign = await runAs(db,ids.users.branch_manager,
      'SELECT public.set_branch_online_pricing($1::uuid,true,26) AS result',[ids.branchB]);
    expect(foreign.rows[0].result).toMatchObject({success:false,error:'BRANCH_MISMATCH'});
    const allowed = await runAs(db,ids.users.branch_manager,
      'SELECT public.set_branch_online_pricing($1::uuid,true,26) AS result',[ids.branchA]);
    expect(allowed.rows[0].result).toMatchObject({success:true,enabled:true});

    const direct = await runAs(db,ids.users.cashier,
      'UPDATE public.branch_online_pricing SET markup_percent=90 WHERE branch_id=$1',[ids.branchA]);
    expect(direct.error).toBeTruthy();
  });

  it('applies 26% to online only, then existing branch tax, and freezes the percentage', async () => {
    await db.query(`INSERT INTO public.branch_online_pricing(branch_id,enabled,markup_percent)
      VALUES($1,true,26)`,[ids.branchA]);

    const online = await createOrder(ids.branchA,'online');
    expect(Number(online.online_markup_percent)).toBe(26);
    const first = await createItem(online.id,ids.prodA);
    expect(Number(first.unit_price)).toBe(25.2);
    expect(Number(first.total)).toBe(25.2);
    const totals = await db.query('SELECT subtotal,tax_amount,total FROM public.orders WHERE id=$1',[online.id]);
    expect(Number(totals.rows[0].subtotal)).toBe(25.2);
    expect(Number(totals.rows[0].tax_amount)).toBe(3.53);
    expect(Number(totals.rows[0].total)).toBe(28.73);

    const base = await db.query('SELECT sale_price FROM public.products WHERE id=$1',[ids.prodA]);
    expect(Number(base.rows[0].sale_price)).toBe(20);

    await db.query('UPDATE public.branch_online_pricing SET markup_percent=40 WHERE branch_id=$1',[ids.branchA]);
    const second = await createOrder(ids.branchA,'online');
    expect(Number(second.online_markup_percent)).toBe(40);
    expect(Number((await createItem(second.id,ids.prodA)).unit_price)).toBe(28);

    const existingLine = await db.query<{id:string}>('SELECT id FROM public.order_items WHERE order_id=$1',[online.id]);
    const updated = await db.query('UPDATE public.order_items SET quantity=2 WHERE id=$1 RETURNING unit_price,total',[existingLine.rows[0].id]);
    expect(Number(updated.rows[0].unit_price)).toBe(25.2);
    expect(Number(updated.rows[0].total)).toBe(50.4);
  });

  it('does not expose branch A settings to branch B and blocks disabled online orders', async () => {
    const hidden = await runAs(db,ids.users.cashier_b,
      'SELECT markup_percent FROM public.branch_online_pricing WHERE branch_id=$1',[ids.branchA]);
    expect(hidden.rows).toHaveLength(0);

    await db.query('SAVEPOINT disabled_online');
    let caught = '';
    try { await createOrder(ids.branchB,'online'); }
    catch (e) { caught = String(e); }
    finally { await db.query('ROLLBACK TO SAVEPOINT disabled_online'); await db.query('RELEASE SAVEPOINT disabled_online'); }
    expect(caught).toContain('ONLINE_ORDER_NOT_ENABLED');
  });
});
