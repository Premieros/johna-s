import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { attachRawComponentToUnit } from './componentTestFixtures';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type SaleResult = {
  success?: boolean;
  error?: string;
  sale_id?: string;
  invoice_number?: string;
  idempotent_replay?: boolean;
  split?: boolean;
  payment_count?: number;
};

describe.skipIf(skip)('POS durable sale idempotency', () => {
  let admin: pg.Client;
  let sessionA: pg.Client;
  let sessionB: pg.Client;

  const orgId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const productId = randomUUID();
  const unitId = randomUUID();
  const cashierId = randomUUID();
  let shiftId = '';
  let rawId = '';
  let normalOperationKey = '';
  let normalSaleId = '';

  const items = JSON.stringify([{
    product_id: productId,
    unit_name: 'piece',
    quantity: 1,
    unit_price: 100,
    discount_amount: 0,
    bonus_quantity: 0,
    total: 100,
    modifier_option_ids: [],
  }]);

  async function beginAsCashier(client: pg.Client): Promise<void> {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [cashierId]);
    await client.query('SET LOCAL ROLE authenticated');
  }

  async function normalSale(
    client: pg.Client,
    operationKey: string,
    invoice: string,
    total = 100,
  ): Promise<SaleResult> {
    const result = await client.query(
      `SELECT public.process_sale_idempotent(
         p_client_operation_key := $1,
         p_invoice_number := $2,
         p_branch_id := $3,
         p_warehouse_id := $4,
         p_customer_id := NULL,
         p_salesperson_id := NULL,
         p_subtotal := $5,
         p_discount_amount := 0,
         p_discount_type := 'amount',
         p_tax_amount := 0,
         p_bonus_amount := 0,
         p_total := $5,
         p_paid_amount := $5,
         p_payment_method := 'cash',
         p_status := 'completed',
         p_items := $6::jsonb,
         p_shift_id := $7,
         p_order_type := 'takeaway',
         p_table_id := NULL,
         p_order_id := NULL,
         p_guest_count := NULL
       ) AS r`,
      [operationKey, invoice, branchId, warehouseId, total, items, shiftId],
    );
    return (result.rows[0]?.r || {}) as SaleResult;
  }

  async function splitSale(
    client: pg.Client,
    operationKey: string,
    invoice: string,
  ): Promise<SaleResult> {
    const payments = JSON.stringify([
      { payment_method: 'cash', amount: 40 },
      { payment_method: 'card', amount: 60 },
    ]);
    const result = await client.query(
      `SELECT public.process_sale_split_idempotent(
         p_client_operation_key := $1,
         p_invoice_number := $2,
         p_branch_id := $3,
         p_warehouse_id := $4,
         p_customer_id := NULL,
         p_salesperson_id := NULL,
         p_subtotal := 100,
         p_discount_amount := 0,
         p_discount_type := 'amount',
         p_tax_amount := 0,
         p_bonus_amount := 0,
         p_total := 100,
         p_payments := $5::jsonb,
         p_status := 'completed',
         p_items := $6::jsonb,
         p_shift_id := $7,
         p_order_type := 'takeaway',
         p_table_id := NULL,
         p_order_id := NULL,
         p_guest_count := NULL
       ) AS r`,
      [operationKey, invoice, branchId, warehouseId, payments, items, shiftId],
    );
    return (result.rows[0]?.r || {}) as SaleResult;
  }

  beforeAll(async () => {
    admin = openDb(dbUrl!);
    sessionA = openDb(dbUrl!);
    sessionB = openDb(dbUrl!);
    await Promise.all([admin.connect(), sessionA.connect(), sessionB.connect()]);

    await admin.query('BEGIN');
    try {
      await admin.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
      await admin.query(
        `INSERT INTO public.organizations (id,name,slug) VALUES ($1,$2,$3)`,
        [orgId, 'Sale idempotency org', `sale-idempotency-${randomUUID().slice(0, 8)}`],
      );
      await admin.query(
        `INSERT INTO public.branches (id,name,organization_id) VALUES ($1,$2,$3)`,
        [branchId, 'Sale idempotency branch', orgId],
      );
      await admin.query(
        `INSERT INTO public.warehouses (id,name,branch_id,is_active,is_default)
         VALUES ($1,$2,$3,true,true)`,
        [warehouseId, 'Sale idempotency warehouse', branchId],
      );
      await admin.query(
        `INSERT INTO public.products (id,name,branch_id,sale_price,cost_price,is_active)
         VALUES ($1,$2,$3,100,50,true)`,
        [productId, 'Sale idempotency product', branchId],
      );
      await admin.query(
        `INSERT INTO public.inventory_units
         (id,code,name,unit_type,branch_id,cost_price,sale_price,is_active)
         VALUES ($1,$2,$3,'ready',$4,50,100,true)`,
        [unitId, `SIDEMP-${randomUUID()}`, 'Sale idempotency unit', branchId],
      );
      await admin.query(
        `INSERT INTO public.product_unit_links(product_id,unit_id,quantity)
         VALUES ($1,$2,1)`,
        [productId, unitId],
      );
      await admin.query(
        `INSERT INTO public.inventory_unit_batches(unit_id,branch_id,warehouse_id,quantity,unit_cost)
         VALUES ($1,$2,$3,100,50)`,
        [unitId, branchId, warehouseId],
      );
      rawId = await attachRawComponentToUnit(admin, unitId, branchId, warehouseId, 100, 50);
      await admin.query(
        `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
         VALUES ($1,$2,$3,'cashier',$4,true)`,
        [cashierId, `sale-idempotency-${randomUUID()}@test.local`, 'Sale idempotency cashier', branchId],
      );
      await admin.query(
        `INSERT INTO public.organization_members(organization_id,user_id,membership_role,is_active)
         VALUES ($1,$2,'member',true)`,
        [orgId, cashierId],
      );
      const shift = await admin.query<{ id: string }>(
        `INSERT INTO public.shifts(branch_id,cashier_id,opening_amount,status)
         VALUES ($1,$2,0,'open') RETURNING id`,
        [branchId, cashierId],
      );
      shiftId = shift.rows[0].id;
      await admin.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
      await admin.query(`SELECT public.seed_account_mappings($1)`, [branchId]);
      await admin.query(`UPDATE public.settings SET tax_enabled=false, tax_rate=0`);
      await admin.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });

  afterAll(async () => {
    for (const client of [sessionA, sessionB]) {
      if (!client) continue;
      await client.query('ROLLBACK').catch(() => {});
    }

    if (admin) {
      await admin.query(`DELETE FROM private.pos_sale_idempotency WHERE branch_id=$1`, [branchId]).catch(() => {});
      await admin.query(
        `DELETE FROM public.sale_payments WHERE sale_id IN (SELECT id FROM public.sales WHERE branch_id=$1)`,
        [branchId],
      ).catch(() => {});
      await admin.query(
        `DELETE FROM public.sale_items WHERE sale_id IN (SELECT id FROM public.sales WHERE branch_id=$1)`,
        [branchId],
      ).catch(() => {});
      await admin.query(`DELETE FROM public.shift_operations WHERE shift_id=$1`, [shiftId]).catch(() => {});
      await admin.query(
        `DELETE FROM public.journal_entry_lines WHERE journal_entry_id IN (SELECT id FROM public.journal_entries WHERE branch_id=$1)`,
        [branchId],
      ).catch(() => {});
      await admin.query(`DELETE FROM public.journal_entries WHERE branch_id=$1`, [branchId]).catch(() => {});
      await admin.query(`DELETE FROM public.sales WHERE branch_id=$1`, [branchId]).catch(() => {});
      await admin.query(`DELETE FROM public.shifts WHERE id=$1`, [shiftId]).catch(() => {});
      await admin.query(`DELETE FROM public.organization_members WHERE organization_id=$1 AND user_id=$2`, [orgId, cashierId]).catch(() => {});
      await admin.query(`DELETE FROM public.users WHERE id=$1`, [cashierId]).catch(() => {});
      await admin.query(`DELETE FROM public.inventory_unit_batches WHERE unit_id=$1`, [unitId]).catch(() => {});
      await admin.query(`DELETE FROM public.product_unit_links WHERE product_id=$1`, [productId]).catch(() => {});
      await admin.query(`DELETE FROM public.inventory_units WHERE id=$1`, [unitId]).catch(() => {});
      if (rawId) {
        await admin.query(`DELETE FROM public.raw_material_batches WHERE raw_material_id=$1`, [rawId]).catch(() => {});
        await admin.query(`DELETE FROM public.raw_materials WHERE id=$1`, [rawId]).catch(() => {});
      }
      await admin.query(`DELETE FROM public.products WHERE id=$1`, [productId]).catch(() => {});
      await admin.query(`DELETE FROM public.warehouses WHERE id=$1`, [warehouseId]).catch(() => {});
      await admin.query(`DELETE FROM public.branches WHERE id=$1`, [branchId]).catch(() => {});
      await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => {});
    }

    await Promise.all(
      [sessionA, sessionB, admin].filter(Boolean).map((client) => client.end().catch(() => {})),
    );
  });

  it('serializes the same logical sale across two sessions and writes it exactly once', async () => {
    normalOperationKey = `sale:${randomUUID()}`;

    await beginAsCashier(sessionA);
    await beginAsCashier(sessionB);

    const first = await normalSale(
      sessionA,
      normalOperationKey,
      `IDEMP-A-${randomUUID().slice(0, 8)}`,
    );
    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(first.idempotent_replay).toBe(false);
    normalSaleId = String(first.sale_id || '');
    expect(normalSaleId).toBeTruthy();

    let secondSettled = false;
    const secondPending = normalSale(
      sessionB,
      normalOperationKey,
      `IDEMP-B-${randomUUID().slice(0, 8)}`,
    ).then((result) => {
      secondSettled = true;
      return result;
    });

    await pause(100);
    expect(secondSettled).toBe(false);

    await sessionA.query('COMMIT');
    const second = await secondPending;
    await sessionB.query('COMMIT');

    expect(second.success, JSON.stringify(second)).toBe(true);
    expect(second.idempotent_replay).toBe(true);
    expect(second.sale_id).toBe(normalSaleId);
    expect(second.invoice_number).toBe(first.invoice_number);

    const counts = await admin.query<{
      sales: number;
      idempotency: number;
      journals: number;
      shift_ops: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM public.sales WHERE id=$1) AS sales,
         (SELECT count(*)::int FROM private.pos_sale_idempotency WHERE branch_id=$2 AND operation_key=$3) AS idempotency,
         (SELECT count(*)::int FROM public.journal_entries WHERE reference_type='sale' AND reference_id=$1) AS journals,
         (SELECT count(*)::int FROM public.shift_operations WHERE reference_type='sale' AND reference_id=$1) AS shift_ops`,
      [normalSaleId, branchId, normalOperationKey],
    );
    expect(counts.rows[0]).toEqual({
      sales: 1,
      idempotency: 1,
      journals: 1,
      shift_ops: 1,
    });
  });

  it('fails closed if the same operation key is reused with a different financial payload', async () => {
    await beginAsCashier(sessionA);
    const mismatch = await normalSale(
      sessionA,
      normalOperationKey,
      `IDEMP-MISMATCH-${randomUUID().slice(0, 8)}`,
      99,
    );
    await sessionA.query('COMMIT');

    expect(mismatch.success).toBe(false);
    expect(mismatch.error).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');

    const count = await admin.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM public.sales WHERE branch_id=$1`,
      [branchId],
    );
    expect(count.rows[0].c).toBe(1);
  });

  it('replays a split-tender sale without duplicating tenders or shift operations', async () => {
    const operationKey = `sale:${randomUUID()}`;

    await beginAsCashier(sessionA);
    const first = await splitSale(
      sessionA,
      operationKey,
      `IDEMP-SPLIT-A-${randomUUID().slice(0, 8)}`,
    );
    await sessionA.query('COMMIT');

    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(first.idempotent_replay).toBe(false);
    expect(first.split).toBe(true);
    const saleId = String(first.sale_id || '');
    expect(saleId).toBeTruthy();

    await beginAsCashier(sessionB);
    const replay = await splitSale(
      sessionB,
      operationKey,
      `IDEMP-SPLIT-B-${randomUUID().slice(0, 8)}`,
    );
    await sessionB.query('COMMIT');

    expect(replay.success, JSON.stringify(replay)).toBe(true);
    expect(replay.idempotent_replay).toBe(true);
    expect(replay.sale_id).toBe(saleId);
    expect(replay.invoice_number).toBe(first.invoice_number);

    const payments = await admin.query<{ c: number; total: string }>(
      `SELECT count(*)::int AS c, COALESCE(sum(amount),0)::text AS total
       FROM public.sale_payments WHERE sale_id=$1`,
      [saleId],
    );
    expect(payments.rows[0].c).toBe(2);
    expect(Number(payments.rows[0].total)).toBe(100);

    const shiftOps = await admin.query<{ c: number; total: string }>(
      `SELECT count(*)::int AS c, COALESCE(sum(amount),0)::text AS total
       FROM public.shift_operations
       WHERE reference_type='sale' AND reference_id=$1`,
      [saleId],
    );
    expect(shiftOps.rows[0].c).toBe(2);
    expect(Number(shiftOps.rows[0].total)).toBe(100);
  });
});
