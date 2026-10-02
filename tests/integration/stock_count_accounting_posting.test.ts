import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = {
  success?: boolean;
  error?: string;
  detail?: string;
  stock_count_id?: string;
  items_applied?: number;
  journal_entry_id?: string | null;
};

describe.skipIf(skip)('ERP-04 stock-count accounting posting', () => {
  let client: pg.Client;

  const orgId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const rollbackBranchId = randomUUID();
  const rollbackWarehouseId = randomUUID();
  const adminId = randomUUID();
  const productId = randomUUID();
  const rollbackProductId = randomUUID();
  const rawId = randomUUID();

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [adminId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function createCount(
    branch: string,
    warehouse: string,
    items: Record<string, unknown>[],
  ): Promise<string> {
    const result = await asAdmin(() => client.query<{ result: RpcResult }>(
      `SELECT public.create_stock_count($1,$2,'cycle',$3,$4::jsonb) AS result`,
      [branch, warehouse, 'ERP-04 accounting test', JSON.stringify(items)],
    ));
    expect(result.rows[0].result.success).toBe(true);
    expect(result.rows[0].result.stock_count_id).toBeTruthy();
    return result.rows[0].result.stock_count_id!;
  }

  async function applyCount(stockCountId: string): Promise<RpcResult> {
    const result = await asAdmin(() => client.query<{ result: RpcResult }>(
      `SELECT public.apply_stock_count($1) AS result`,
      [stockCountId],
    ));
    return result.rows[0].result;
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.organizations(id,name,slug) VALUES ($1,'ERP04 Org',$2)`,
      [orgId, 'erp04-' + randomUUID().slice(0, 8)],
    );
    await client.query(
      `INSERT INTO public.branches(id,name,organization_id)
       VALUES ($1,'ERP04 Branch',$3),($2,'ERP04 Rollback Branch',$3)`,
      [branchId, rollbackBranchId, orgId],
    );
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default)
       VALUES
       ($1,'ERP04 Warehouse',$3,true,true),
       ($2,'ERP04 Rollback Warehouse',$4,true,true)`,
      [warehouseId, rollbackWarehouseId, branchId, rollbackBranchId],
    );
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'ERP04 Admin','super_admin',$3,true)`,
      [adminId, 'erp04-' + randomUUID() + '@test.local', branchId],
    );
    await client.query(
      `INSERT INTO public.organization_members(organization_id,user_id,membership_role,is_active)
       VALUES ($1,$2,'owner',true)`,
      [orgId, adminId],
    );

    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.products(id,name,sku,barcode,sale_price,cost_price,branch_id,is_active)
       VALUES
       ($1,'ERP04 Product',$3,$4,10,5,$5,true),
       ($2,'ERP04 Rollback Product',$6,$7,10,5,$8,true)`,
      [
        productId,
        rollbackProductId,
        'ERP04-P-' + randomUUID(),
        'ERP04-B-' + randomUUID(),
        branchId,
        'ERP04-RP-' + randomUUID(),
        'ERP04-RB-' + randomUUID(),
        rollbackBranchId,
      ],
    );
    await client.query(
      `INSERT INTO public.inventory(product_id,warehouse_id,branch_id,quantity)
       VALUES ($1,$3,$5,5),($2,$4,$6,5)`,
      [
        productId,
        rollbackProductId,
        warehouseId,
        rollbackWarehouseId,
        branchId,
        rollbackBranchId,
      ],
    );
    await client.query(
      `INSERT INTO public.inventory_batches(
         product_id,warehouse_id,branch_id,batch_number,quantity,unit_cost,source_type
       )
       VALUES
       ($1,$3,$5,'ERP04-P-OPEN',5,5,'opening'),
       ($2,$4,$6,'ERP04-RP-OPEN',5,5,'opening')`,
      [
        productId,
        rollbackProductId,
        warehouseId,
        rollbackWarehouseId,
        branchId,
        rollbackBranchId,
      ],
    );

    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active)
       VALUES ($1,$2,'ERP04 Raw',$3,4,true)`,
      [rawId, 'ERP04-R-' + randomUUID(), branchId],
    );
    await client.query(
      `INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost,min_stock)
       VALUES ($1,$2,10,4,0)`,
      [rawId, branchId],
    );
    await client.query(
      `INSERT INTO public.raw_material_batches(
         raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type
       )
       VALUES ($1,$2,$3,'ERP04-R-OPEN',10,4,'opening')`,
      [rawId, branchId, warehouseId],
    );

    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);

    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [rollbackBranchId]);
    await client.query(
      `INSERT INTO public.account_mappings(branch_id,semantic_key,account_id)
       SELECT $1,'inventory_fg',id
       FROM public.chart_of_accounts
       WHERE branch_id=$1 AND code='1200'`,
      [rollbackBranchId],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('posts one balanced journal for mixed product/raw stock-count variance and stays terminal on retry', async () => {
    const stockCountId = await createCount(branchId, warehouseId, [
      { product_id: productId, counted_quantity: 7, reason: 'product increase' },
      { raw_material_id: rawId, counted_quantity: 7, reason: 'raw decrease' },
    ]);

    await client.query(`UPDATE public.stock_counts SET status='approved' WHERE id=$1`, [stockCountId]);

    const applied = await applyCount(stockCountId);
    expect(applied).toMatchObject({ success: true, items_applied: 2 });
    expect(applied.journal_entry_id).toBeTruthy();

    const journal = await client.query<{ id: string }>(
      `SELECT id::text
       FROM public.journal_entries
       WHERE reference_type='stock_count' AND reference_id=$1`,
      [stockCountId],
    );
    expect(journal.rowCount).toBe(1);
    expect(journal.rows[0].id).toBe(applied.journal_entry_id);

    const lines = await client.query<{ semantic_key: string; debit: string; credit: string }>(
      `SELECT am.semantic_key,
              round(sum(jel.debit)::numeric,2)::text AS debit,
              round(sum(jel.credit)::numeric,2)::text AS credit
       FROM public.journal_entry_lines jel
       JOIN public.account_mappings am
         ON am.account_id=jel.account_id
        AND am.branch_id=$2
       WHERE jel.journal_entry_id=$1
         AND am.semantic_key IN ('inventory_fg','inventory_rm','stock_variance')
       GROUP BY am.semantic_key
       ORDER BY am.semantic_key`,
      [journal.rows[0].id, branchId],
    );

    const byKey = new Map(lines.rows.map((row) => [
      row.semantic_key,
      { debit: Number(row.debit), credit: Number(row.credit) },
    ]));

    expect(byKey.get('inventory_fg')).toEqual({ debit: 10, credit: 0 });
    expect(byKey.get('inventory_rm')).toEqual({ debit: 0, credit: 12 });
    expect(byKey.get('stock_variance')).toEqual({ debit: 12, credit: 10 });

    const totals = lines.rows.reduce(
      (acc, row) => ({
        debit: acc.debit + Number(row.debit),
        credit: acc.credit + Number(row.credit),
      }),
      { debit: 0, credit: 0 },
    );
    expect(totals).toEqual({ debit: 22, credit: 22 });

    const product = await client.query<{ quantity: string }>(
      `SELECT quantity::text FROM public.inventory
       WHERE product_id=$1 AND warehouse_id=$2`,
      [productId, warehouseId],
    );
    expect(Number(product.rows[0].quantity)).toBe(7);

    const raw = await client.query<{ quantity: string }>(
      `SELECT quantity::text FROM public.raw_material_inventory
       WHERE raw_material_id=$1 AND branch_id=$2`,
      [rawId, branchId],
    );
    expect(Number(raw.rows[0].quantity)).toBe(7);

    const retry = await applyCount(stockCountId);
    expect(retry).toMatchObject({ success: false, error: 'COUNT_NOT_APPROVED' });

    const journalCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.journal_entries
       WHERE reference_type='stock_count' AND reference_id=$1`,
      [stockCountId],
    );
    expect(Number(journalCount.rows[0].count)).toBe(1);
  });

  it('rolls back inventory and leaves the count approved when a required account mapping is absent', async () => {
    const stockCountId = await createCount(rollbackBranchId, rollbackWarehouseId, [
      { product_id: rollbackProductId, counted_quantity: 7, reason: 'rollback probe' },
    ]);
    await client.query(`UPDATE public.stock_counts SET status='approved' WHERE id=$1`, [stockCountId]);

    const failed = await applyCount(stockCountId);
    expect(failed.success).toBe(false);
    expect(failed.error).toBe('TRANSACTION_FAILED');
    expect(failed.detail).toContain('ACCOUNT_NOT_FOUND');

    const stock = await client.query<{ quantity: string }>(
      `SELECT quantity::text FROM public.inventory
       WHERE product_id=$1 AND warehouse_id=$2`,
      [rollbackProductId, rollbackWarehouseId],
    );
    expect(Number(stock.rows[0].quantity)).toBe(5);

    const batchTotal = await client.query<{ quantity: string }>(
      `SELECT COALESCE(sum(quantity),0)::text AS quantity
       FROM public.inventory_batches
       WHERE product_id=$1 AND warehouse_id=$2`,
      [rollbackProductId, rollbackWarehouseId],
    );
    expect(Number(batchTotal.rows[0].quantity)).toBe(5);

    const state = await client.query<{ status: string }>(
      `SELECT status FROM public.stock_counts WHERE id=$1`,
      [stockCountId],
    );
    expect(state.rows[0].status).toBe('approved');

    const journalCount = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.journal_entries
       WHERE reference_type='stock_count' AND reference_id=$1`,
      [stockCountId],
    );
    expect(Number(journalCount.rows[0].count)).toBe(0);
  });
});
