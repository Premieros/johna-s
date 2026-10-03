import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = {
  success?: boolean;
  shortage?: number | string;
  oversold?: number | string;
  [key: string]: unknown;
};

type DebtHealthRow = {
  raw_material_id: string;
  current_quantity: number | string;
  outstanding_fifo_debt_quantity: number | string;
  outstanding_fifo_debt_rows: number | string;
  unpriced_fifo_debt_quantity: number | string;
  estimated_fifo_debt_value: number | string;
  fifo_debt_pricing_coverage_pct: number | string;
  oldest_outstanding_debt_at: string | null;
  last_purchase_receipt_at: string | null;
  fifo_debt_status: string;
};

const num = (value: unknown): number => Number(value || 0);

async function asUser(client: pg.Client, userId: string, sql: string, params: unknown[] = []) {
  const savepoint = 'sp_' + randomUUID().replace(/-/g, '');
  await client.query('SAVEPOINT ' + savepoint);
  try {
    await client.query('SET LOCAL ROLE authenticated');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return await client.query(sql, params);
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT ' + savepoint);
    await client.query('RELEASE SAVEPOINT ' + savepoint);
  }
}

describe.skipIf(skip)('raw FIFO debt health valuation report', () => {
  let client: pg.Client;

  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const unitId = randomUUID();
  const userId = randomUUID();
  const role = 'qa_fifo_debt_report_' + randomUUID().slice(0, 8);
  const pricedRawId = randomUUID();
  const unpricedRawId = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  async function reportRows(): Promise<DebtHealthRow[]> {
    const result = await asUser(
      client,
      userId,
      'SELECT public.get_current_raw_material_valuation($1) AS rows',
      [branchId],
    );
    return (result.rows[0]?.rows || []) as DebtHealthRow[];
  }

  async function oversell(rawMaterialId: string, quantity: number): Promise<RpcResult> {
    const result = await q<{ r: RpcResult }>(
      "SELECT public._raw_remove_fifo($1,$2,$3,$4,'sale','sale',$5,$6,$7,true) AS r",
      [
        rawMaterialId,
        branchId,
        warehouseId,
        quantity,
        randomUUID(),
        'SALE-' + randomUUID().slice(0,8),
        userId,
      ],
    );
    return result[0].r;
  }

  async function receive(rawMaterialId: string, quantity: number, cost: number): Promise<RpcResult> {
    const result = await q<{ r: RpcResult }>(
      "SELECT public._raw_add($1,$2,$3,$4,$5,NULL,NULL,NULL,'purchase_receipt','purchase_receipt',$6,$7,$8) AS r",
      [
        rawMaterialId,
        branchId,
        warehouseId,
        quantity,
        cost,
        randomUUID(),
        'RCV-' + randomUUID().slice(0,8),
        userId,
      ],
    );
    return result[0].r;
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      "INSERT INTO public.branches(id,name) VALUES($1,'FIFO Debt Report Branch')",
      [branchId],
    );
    await client.query(
      "INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES($1,'FIFO Debt Report Warehouse',$2,true)",
      [warehouseId, branchId],
    );
    await client.query(
      "INSERT INTO public.measurement_units(id,code,name,symbol,is_active) VALUES($1,$2,'Unit','u',true)",
      [unitId, 'U-' + randomUUID().slice(0,8)],
    );
    await client.query(
      "INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES($1,'تقارير FIFO','FIFO Reports','[\"reports.costing\"]'::jsonb,'branch',true)",
      [role],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      "INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES($1,$2,'FIFO Report User',$3,$4,true)",
      [userId, userId + '@example.test', role, branchId],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

    await client.query(
      "INSERT INTO public.raw_materials(id,code,name,branch_id,unit_id,default_cost,is_active) VALUES($1,$2,'Priced Debt Raw',$3,$4,5,true),($5,$6,'Unpriced Debt Raw',$3,$4,0,true)",
      [
        pricedRawId,
        'P-' + randomUUID().slice(0,8),
        branchId,
        unitId,
        unpricedRawId,
        'U-' + randomUUID().slice(0,8),
      ],
    );

    expect((await oversell(pricedRawId, 3)).success).toBe(true);
    expect((await oversell(unpricedRawId, 2)).success).toBe(true);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK');
    await client.end();
  });

  it('reports tracked priced and unpriced FIFO debt without changing stock', async () => {
    const before = await q<{ quantity: string }>(
      'SELECT COALESCE(SUM(quantity),0)::text AS quantity FROM public.raw_material_batches WHERE branch_id=$1 AND warehouse_id=$2',
      [branchId, warehouseId],
    );

    const rows = await reportRows();
    const priced = rows.find((row) => row.raw_material_id === pricedRawId)!;
    const unpriced = rows.find((row) => row.raw_material_id === unpricedRawId)!;

    expect(num(priced.current_quantity)).toBe(-3);
    expect(num(priced.outstanding_fifo_debt_quantity)).toBe(3);
    expect(num(priced.outstanding_fifo_debt_rows)).toBe(1);
    expect(num(priced.unpriced_fifo_debt_quantity)).toBe(0);
    expect(num(priced.estimated_fifo_debt_value)).toBe(15);
    expect(num(priced.fifo_debt_pricing_coverage_pct)).toBe(100);
    expect(priced.last_purchase_receipt_at).toBeNull();
    expect(priced.fifo_debt_status).toBe('NO_RECEIPT_HISTORY');

    expect(num(unpriced.current_quantity)).toBe(-2);
    expect(num(unpriced.outstanding_fifo_debt_quantity)).toBe(2);
    expect(num(unpriced.unpriced_fifo_debt_quantity)).toBe(2);
    expect(num(unpriced.estimated_fifo_debt_value)).toBe(0);
    expect(num(unpriced.fifo_debt_pricing_coverage_pct)).toBe(0);
    expect(unpriced.fifo_debt_status).toBe('UNPRICED_NO_RECEIPT');

    const after = await q<{ quantity: string }>(
      'SELECT COALESCE(SUM(quantity),0)::text AS quantity FROM public.raw_material_batches WHERE branch_id=$1 AND warehouse_id=$2',
      [branchId, warehouseId],
    );
    expect(num(after[0].quantity)).toBe(num(before[0].quantity));
  });

  it('reflects real receipt settlement and receipt history without inventing quantities', async () => {
    expect((await receive(pricedRawId, 2, 4)).success).toBe(true);

    let rows = await reportRows();
    let priced = rows.find((row) => row.raw_material_id === pricedRawId)!;

    expect(num(priced.current_quantity)).toBe(-1);
    expect(num(priced.outstanding_fifo_debt_quantity)).toBe(1);
    expect(priced.last_purchase_receipt_at).toBeTruthy();
    expect(priced.fifo_debt_status).toBe('OUTSTANDING');
    expect(num(priced.estimated_fifo_debt_value)).toBe(4);

    expect((await receive(pricedRawId, 1, 4)).success).toBe(true);

    rows = await reportRows();
    priced = rows.find((row) => row.raw_material_id === pricedRawId)!;
    expect(num(priced.current_quantity)).toBe(0);
    expect(num(priced.outstanding_fifo_debt_quantity)).toBe(0);
    expect(priced.fifo_debt_status).toBe('OK');
  });
});
