import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = { success?: boolean; error?: string; stock_count_id?: string; transfer_id?: string };

describe.skipIf(skip)('V2 operational approval target security', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const branchC = randomUUID();
  const approver = randomUUID();
  const deniedUser = randomUUID();
  const approverRole = `v2_approver_${randomUUID().slice(0, 8)}`;
  const deniedRole = `v2_denied_${randomUUID().slice(0, 8)}`;
  const categoryId = randomUUID();
  const warehouseB1 = randomUUID();
  const warehouseB2 = randomUUID();
  const warehouseC1 = randomUUID();
  const warehouseC2 = randomUUID();
  const productB = randomUUID();
  const wasteA = randomUUID();
  const wasteB = randomUUID();
  const wasteC = randomUUID();
  const countB = randomUUID();
  const countC = randomUUID();
  const transferB = randomUUID();
  const transferC = randomUUID();

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function expectDbError(fn: () => Promise<unknown>): Promise<void> {
    const savepoint = `sp_${randomUUID().replace(/-/g, '')}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    let threw = false;
    try {
      await fn();
    } catch {
      threw = true;
    }
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    expect(threw).toBe(true);
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches (id, name)
       VALUES ($1, 'V2 Approval A'), ($2, 'V2 Approval B'), ($3, 'V2 Approval C')`,
      [branchA, branchB, branchC],
    );
    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, is_active)
       VALUES
         ($1, 'V2 approver', 'V2 approver', '["waste.approve","inventory.manage","inventory.transfers.approve"]'::jsonb, 'global', true),
         ($2, 'V2 denied', 'V2 denied', '[]'::jsonb, 'global', true)`,
      [approverRole, deniedRole],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES
         ($1, $2, 'V2 Approver', $3, $4, true),
         ($5, $6, 'V2 Denied User', $7, $4, true)`,
      [approver, `${randomUUID()}@test.local`, approverRole, branchA, deniedUser, `${randomUUID()}@test.local`, deniedRole],
    );
    await client.query(
      `INSERT INTO public.user_branch_access (user_id, branch_id) VALUES ($1, $2)`,
      [approver, branchB],
    );

    await client.query(`INSERT INTO public.waste_categories (id, name) VALUES ($1, 'V2 test waste')`, [categoryId]);
    await client.query(
      `INSERT INTO public.waste_entries (id, branch_id, waste_category_id, waste_type, quantity, unit_cost, status, created_by)
       VALUES
         ($1, $2, $3, 'finished_good', 1, 0, 'pending', $4),
         ($5, $6, $3, 'finished_good', 1, 0, 'pending', $4),
         ($7, $8, $3, 'finished_good', 1, 0, 'pending', $4)`,
      [wasteA, branchA, categoryId, deniedUser, wasteB, branchB, wasteC, branchC],
    );

    await client.query(
      `INSERT INTO public.warehouses (id, name, branch_id, is_active)
       VALUES
         ($1, 'B from', $2, true), ($3, 'B to', $2, true),
         ($4, 'C from', $5, true), ($6, 'C to', $5, true)`,
      [warehouseB1, branchB, warehouseB2, warehouseC1, branchC, warehouseC2],
    );
    await client.query(
      `INSERT INTO public.products(id,name,cost_price,sale_price,is_active,branch_id) VALUES($1,'V2 Waste Product',2,5,true,$2)`,
      [productB, branchB],
    );
    await client.query(
      `INSERT INTO public.inventory(product_id,warehouse_id,quantity,branch_id) VALUES($1,$2,5,$3)`,
      [productB, warehouseB1, branchB],
    );
    await client.query(`UPDATE public.waste_entries SET product_id=$1,warehouse_id=$2 WHERE id=$3`, [productB, warehouseB1, wasteB]);
    await client.query(
      `INSERT INTO public.stock_counts (id, branch_id, warehouse_id, status, count_type, submitted_by, submitted_at)
       VALUES ($1, $2, $3, 'submitted', 'cycle', $4, now()),
              ($5, $6, $7, 'submitted', 'cycle', $4, now())`,
      [countB, branchB, warehouseB1, approver, countC, branchC, warehouseC1],
    );
    await client.query(
      `INSERT INTO public.warehouse_transfers
         (id, transfer_number, from_warehouse_id, to_warehouse_id, branch_id, status, requested_by)
       VALUES
         ($1, 'V2-TR-B', $2, $3, $4, 'pending', $5),
         ($6, 'V2-TR-C', $7, $8, $9, 'pending', $5)`,
      [transferB, warehouseB1, warehouseB2, branchB, approver, transferC, warehouseC1, warehouseC2, branchC],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('blocks direct waste approval without waste.approve', async () => {
    await expectDbError(() => asUser(deniedUser, () => client.query(
      `SELECT public.approve_waste($1, true, NULL)`,
      [wasteA],
    )));
  });

  it('allows waste approval in an explicitly authorized secondary branch', async () => {
    await asUser(approver, () => client.query(`SELECT public.approve_waste($1, true, NULL)`, [wasteB]));
    const row = await client.query(`SELECT status, approved_by FROM public.waste_entries WHERE id=$1`, [wasteB]);
    expect(row.rows[0]).toMatchObject({ status: 'approved', approved_by: approver });
  });

  it('blocks direct waste approval in an inaccessible branch', async () => {
    await expectDbError(() => asUser(approver, () => client.query(
      `SELECT public.approve_waste($1, true, NULL)`,
      [wasteC],
    )));
  });

  it('allows stock-count approval in the secondary authorized branch only', async () => {
    const allowed = await asUser(approver, async () => {
      const result = await client.query<{ r: RpcResult }>(`SELECT public.approve_stock_count($1) AS r`, [countB]);
      return result.rows[0].r;
    });
    expect(allowed).toMatchObject({ success: true, stock_count_id: countB });

    const denied = await asUser(approver, async () => {
      const result = await client.query<{ r: RpcResult }>(`SELECT public.approve_stock_count($1) AS r`, [countC]);
      return result.rows[0].r;
    });
    expect(denied).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });

  it('allows warehouse-transfer approval in the secondary authorized branch only', async () => {
    const allowed = await asUser(approver, async () => {
      const result = await client.query<{ r: RpcResult }>(`SELECT public.approve_warehouse_transfer($1) AS r`, [transferB]);
      return result.rows[0].r;
    });
    expect(allowed).toMatchObject({ success: true, transfer_id: transferB });

    const denied = await asUser(approver, async () => {
      const result = await client.query<{ r: RpcResult }>(`SELECT public.approve_warehouse_transfer($1) AS r`, [transferC]);
      return result.rows[0].r;
    });
    expect(denied).toMatchObject({ success: false, error: 'TRANSFER_NOT_FOUND' });
  });
});
