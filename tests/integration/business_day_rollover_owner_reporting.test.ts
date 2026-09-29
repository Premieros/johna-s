import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('business day rollover + owner-attributed shift reporting', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let oldBusinessDate = '';
  let activeBusinessDate = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);

    const dateRow = await client.query<{ current_d: string; old_d: string }>(
      `SELECT
         private.current_fixed_business_date($1,now())::text AS current_d,
         (private.current_fixed_business_date($1,now())-1)::text AS old_d`,
      [ids.branchA],
    );
    activeBusinessDate = dateRow.rows[0].current_d;
    oldBusinessDate = dateRow.rows[0].old_d;

    await client.query(
      `UPDATE public.shifts
       SET opened_at=now()-interval '1 hour', closed_at=NULL, status='open'
       WHERE id=$1`,
      [ids.shiftA],
    );

    await client.query(
      `INSERT INTO public.daily_closes(branch_id,business_date,status,closed_at,closed_by,report_snapshot)
       VALUES($1,$2::date,'closed',now()-interval '2 hours',$3,'{"sentinel":"previous-day"}'::jsonb)`,
      [ids.branchA, oldBusinessDate, ids.users.super_admin],
    );

    await client.query(`DELETE FROM public.business_day_state WHERE branch_id=$1`, [ids.branchA]);

    const state = await client.query<{ d: string }>(
      `SELECT (public._ensure_business_day_state($1)->>'business_date')::text AS d`,
      [ids.branchA],
    );
    expect(state.rows[0].d).toBe(activeBusinessDate);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('moves a newer open shift onto the next unused business date after an existing close', async () => {
    expect(activeBusinessDate).not.toBe(oldBusinessDate);

    const state = await client.query<{ business_date: string; shift_id: string }>(
      `SELECT business_date::text, $2::uuid::text AS shift_id
       FROM public.business_day_state
       WHERE branch_id=$1`,
      [ids.branchA, ids.shiftA],
    );
    expect(state.rows[0].business_date).toBe(activeBusinessDate);

    const shift = await client.query<{ status: string }>(
      `SELECT status FROM public.shifts WHERE id=$1`,
      [ids.shiftA],
    );
    expect(shift.rows[0].status).toBe('open');
  });

  it('uses the active rollover boundary for purchases instead of the previous snapshot', async () => {
    const preInvoice = `PRE-${randomUUID()}`;
    const currentInvoice = `CUR-${randomUUID()}`;

    await client.query(
      `INSERT INTO public.purchases
        (invoice_number,supplier_id,branch_id,warehouse_id,buyer_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,created_at)
       VALUES
        ($1,$3,$4,$5,$6,33,0,0,33,33,'cash','completed',now()-interval '90 minutes'),
        ($2,$3,$4,$5,$6,44,0,0,44,44,'cash','completed',now()-interval '30 minutes')`,
      [preInvoice, currentInvoice, ids.suppA, ids.branchA, ids.whA, ids.users.super_admin],
    );

    const report = await client.query<{ r: Record<string, unknown> }>(
      `SELECT public._build_day_closing_report($1,$2::date) AS r`,
      [ids.branchA, activeBusinessDate],
    );
    const details = report.rows[0].r.cash_purchase_details as Array<{ invoice_number: string }>;

    expect(details.some((x) => x.invoice_number === preInvoice)).toBe(false);
    expect(details.some((x) => x.invoice_number === currentInvoice)).toBe(true);
    expect(Number(report.rows[0].r.cash_purchases)).toBe(44);
  });

  it('attributes shift sales to the order/table owner while preserving the payment collector audit actor', async () => {
    const saleId = randomUUID();
    const invoice = `OWNER-${randomUUID()}`;

    await client.query(
      `INSERT INTO public.sales
        (id,invoice_number,branch_id,warehouse_id,cashier_id,salesperson_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,created_at)
       VALUES($1,$2,$3,$4,$5,$5,120,0,0,120,120,'cash','completed',now())`,
      [saleId, invoice, ids.branchA, ids.whA, ids.users.cashier],
    );

    await client.query(
      `INSERT INTO public.shift_operations
        (shift_id,operation_type,amount,payment_method,reference_type,reference_id,created_by,created_at)
       VALUES($1,'sale',120,'cash','sale',$2,$3,now())`,
      [ids.shiftA, saleId, ids.users.super_admin],
    );

    const result = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.get_shift_closing_report($1) AS r`,
      [ids.shiftA],
    );
    expect(result.error).toBeUndefined();

    const report = result.rows[0].r as Record<string, unknown>;
    const sales = report.sales_details as Array<{ sale_id: string; user_id: string }>;
    const row = sales.find((x) => x.sale_id === saleId);
    expect(row?.user_id).toBe(ids.users.cashier);

    const audit = await client.query<{ created_by: string }>(
      `SELECT created_by FROM public.shift_operations
       WHERE shift_id=$1 AND reference_id=$2 AND reference_type='sale'`,
      [ids.shiftA, saleId],
    );
    expect(audit.rows[0].created_by).toBe(ids.users.super_admin);
  });

  it('closes only a due business day, advances one day, and blocks an immediate second rollover', async () => {
    const due = await client.query<{ d: string }>(
      `WITH candidates AS (
         SELECT gs::date AS d
         FROM generate_series(
           (private.current_fixed_business_date($1,now()) - 3),
           private.current_fixed_business_date($1,now()),
           interval '1 day'
         ) gs
       )
       SELECT c.d::text AS d
       FROM candidates c
       WHERE private.business_day_fixed_cutoff($1,c.d) <= now()
       ORDER BY c.d DESC
       LIMIT 1`,
      [ids.branchA],
    );
    expect(due.rows[0]?.d).toBeTruthy();
    const closedDate = due.rows[0].d;

    await client.query(
      `DELETE FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, closedDate],
    );
    await client.query(
      `UPDATE public.business_day_state
       SET business_date=$2::date,
           started_at=(SELECT opened_at FROM public.shifts WHERE id=$3),
           updated_at=now()
       WHERE branch_id=$1`,
      [ids.branchA, closedDate, ids.shiftA],
    );

    const result = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.day_close($1,$2::date) AS r`,
      [ids.branchA, closedDate],
    );
    expect(result.error).toBeUndefined();

    const payload = result.rows[0].r as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.rolled_over).toBe(true);
    expect(payload.shift_preserved).toBe(true);
    expect(String(payload.closed_business_date)).toBe(closedDate);

    const shift = await client.query<{ status: string }>(
      `SELECT status FROM public.shifts WHERE id=$1`,
      [ids.shiftA],
    );
    expect(shift.rows[0].status).toBe('open');

    const next = await client.query<{ d: string; started_at: string }>(
      `SELECT business_date::text AS d,started_at::text
       FROM public.business_day_state WHERE branch_id=$1`,
      [ids.branchA],
    );
    const expectedNext = await client.query<{ d: string }>(
      `SELECT ($1::date + 1)::text AS d`,
      [closedDate],
    );
    expect(next.rows[0].d).toBe(expectedNext.rows[0].d);

    const repeated = await runAsPersist(
      client,
      ids.users.super_admin,
      `SELECT public.day_close($1,$2::date) AS r`,
      [ids.branchA, next.rows[0].d],
    );
    expect(repeated.error).toBeUndefined();
    const repeatedPayload = repeated.rows[0].r as Record<string, unknown>;
    expect(repeatedPayload.success).toBe(false);
    expect(repeatedPayload.error).toBe('BUSINESS_DAY_NOT_FINISHED');

    const repeatedClose = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c
       FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, next.rows[0].d],
    );
    expect(Number(repeatedClose.rows[0].c)).toBe(0);

    const newInvoice = `NEXT-${randomUUID()}`;
    await client.query(
      `INSERT INTO public.purchases
        (invoice_number,supplier_id,branch_id,warehouse_id,buyer_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,created_at)
       VALUES($1,$2,$3,$4,$5,55,0,0,55,55,'cash','completed',now())`,
      [newInvoice, ids.suppA, ids.branchA, ids.whA, ids.users.super_admin],
    );

    const live = await client.query<{ r: Record<string, unknown> }>(
      `SELECT public._build_day_closing_report($1,$2::date) AS r`,
      [ids.branchA, next.rows[0].d],
    );
    const details = live.rows[0].r.cash_purchase_details as Array<{ invoice_number: string }>;
    expect(details.some((x) => x.invoice_number === newInvoice)).toBe(true);
    expect(Number(live.rows[0].r.cash_purchases)).toBe(55);

    const snapshot = await client.query<{ snap: Record<string, unknown> }>(
      `SELECT report_snapshot AS snap FROM public.daily_closes
       WHERE branch_id=$1 AND business_date=$2::date`,
      [ids.branchA, closedDate],
    );
    expect(snapshot.rowCount).toBe(1);
  });
});
