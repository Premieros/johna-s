import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('purchase invoice edit inventory integrity', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const userId = randomUUID();
  const supplierId = randomUUID();
  const gramUnitId = randomUUID();
  const rawAId = randomUUID();
  const rawBId = randomUUID();
  const invoiceNumber = `PUR-EDIT-${randomUUID()}`;

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE service_role`);
    try { return await fn(); }
    finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function rawQty(rawId: string): Promise<number> {
    const rows = await q<{ quantity: string }>(
      `SELECT COALESCE(quantity,0)::text AS quantity
       FROM public.raw_material_inventory
       WHERE raw_material_id=$1 AND branch_id=$2 AND warehouse_id=$3`,
      [rawId, branchId, warehouseId],
    );
    return rows.length ? Number(rows[0].quantity) : 0;
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.branches (id,name) VALUES ($1,'Purchase Edit Branch')`, [branchId]);
    await client.query(
      `INSERT INTO auth.users (id,email,role,aud,instance_id,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
       VALUES ($1,$2,'authenticated','authenticated',gen_random_uuid(),'{}'::jsonb,'{}'::jsonb,now(),now())`,
      [userId, `purchase-edit-${userId}@example.test`],
    );
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Purchase Edit Super Admin','super_admin',$3,true)`,
      [userId, `purchase-edit-${userId}@example.test`, branchId],
    );
    await client.query(`INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES ($1,'Purchase Edit WH',$2,true)`, [warehouseId, branchId]);
    await client.query(`INSERT INTO public.suppliers (id,name,branch_id) VALUES ($1,'Purchase Edit Supplier',$2)`, [supplierId, branchId]);
    await client.query(`INSERT INTO public.units (id,code,name,symbol,is_active) VALUES ($1,$2,'Gram','جم',true)`, [gramUnitId, `G-${randomUUID()}`]);
    await client.query(
      `INSERT INTO public.raw_materials (id,code,name,unit_id,min_stock,default_cost,is_active,branch_id)
       VALUES ($1,$2,'Purchase Edit Raw A',$3,0,0,true,$4),($5,$6,'Purchase Edit Raw B',$3,0,0,true,$4)`,
      [rawAId, `RM-A-${randomUUID()}`, gramUnitId, branchId, rawBId, `RM-B-${randomUUID()}`],
    );
    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);
    await client.query(`UPDATE public.settings SET tax_enabled=false`);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('replaces, rather than stacks, the prior raw-stock impact across repeated corrections', async () => {
    await asAdmin(async () => {
      const created = await q<{ r: { success: boolean; purchase_id?: string; error?: string; detail?: string } }>(
        `SELECT public.process_purchase($1,$2,$3,$4,100,0,0,100,100,'cash','completed',NULL,$5::jsonb) AS r`,
        [invoiceNumber, supplierId, branchId, warehouseId, JSON.stringify([
          { raw_material_id: rawAId, unit_name: 'kg', quantity: 1, unit_cost: 100 },
        ])],
      );
      expect(created[0].r.success).toBe(true);
      if (!created[0].r.purchase_id) throw new Error(JSON.stringify(created[0].r));
      expect(await rawQty(rawAId)).toBe(1000);
      expect(await rawQty(rawBId)).toBe(0);

      const corrected = await q<{ r: { success: boolean; purchase_id?: string; previous_purchase_id?: string; error?: string; detail?: string } }>(
        `SELECT public.update_purchase_invoice(
          p_purchase_id => $1,
          p_supplier_id => $2,
          p_warehouse_id => $3,
          p_subtotal => 250,
          p_discount_amount => 0,
          p_tax_amount => 0,
          p_total => 250,
          p_paid_amount => 250,
          p_payment_method => 'cash',
          p_notes => 'quantity correction',
          p_items => $4::jsonb
        ) AS r`,
        [created[0].r.purchase_id, supplierId, warehouseId, JSON.stringify([
          { raw_material_id: rawAId, unit_name: 'kg', quantity: 2, unit_cost: 100 },
          { raw_material_id: rawBId, unit_name: 'kg', quantity: 0.5, unit_cost: 100 },
        ])],
      );
      expect(corrected[0].r.success).toBe(true);
      expect(corrected[0].r.previous_purchase_id).toBe(created[0].r.purchase_id);
      if (!corrected[0].r.purchase_id) throw new Error(JSON.stringify(corrected[0].r));

      // Old 1kg must be fully reversed before the corrected 2kg is posted.
      expect(await rawQty(rawAId)).toBe(2000);
      expect(await rawQty(rawBId)).toBe(500);

      const replaced = await q<{ r: { success: boolean; purchase_id?: string; error?: string; detail?: string } }>(
        `SELECT public.update_purchase_invoice(
          p_purchase_id => $1,
          p_supplier_id => $2,
          p_warehouse_id => $3,
          p_subtotal => 100,
          p_discount_amount => 0,
          p_tax_amount => 0,
          p_total => 100,
          p_paid_amount => 100,
          p_payment_method => 'cash',
          p_notes => 'replace raw material',
          p_items => $4::jsonb
        ) AS r`,
        [corrected[0].r.purchase_id, supplierId, warehouseId, JSON.stringify([
          { raw_material_id: rawBId, unit_name: 'kg', quantity: 1, unit_cost: 100 },
        ])],
      );
      expect(replaced[0].r.success).toBe(true);
      if (!replaced[0].r.purchase_id) throw new Error(JSON.stringify(replaced[0].r));

      // The second correction removes Raw A entirely and leaves only the final Raw B quantity.
      expect(await rawQty(rawAId)).toBe(0);
      expect(await rawQty(rawBId)).toBe(1000);

      const current = await q<{ id: string; status: string }>(
        `SELECT id,status FROM public.purchases WHERE invoice_number=$1`,
        [invoiceNumber],
      );
      expect(current).toEqual([{ id: replaced[0].r.purchase_id, status: 'completed' }]);

      const revisions = await q<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM public.purchases
         WHERE invoice_number LIKE $1 AND status='returned'`,
        [`${invoiceNumber}-REV-%`],
      );
      expect(Number(revisions[0].count)).toBe(2);
    });
  });

  it('rejects a warehouse from another branch without changing the invoice', async () => {
    await asAdmin(async () => {
      const otherBranchId = randomUUID();
      const otherWarehouseId = randomUUID();
      await client.query(`INSERT INTO public.branches (id,name) VALUES ($1,'Other Purchase Edit Branch')`, [otherBranchId]);
      await client.query(`INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES ($1,'Other WH',$2,true)`, [otherWarehouseId, otherBranchId]);

      const purchase = await q<{ id: string }>(`SELECT id FROM public.purchases WHERE invoice_number=$1`, [invoiceNumber]);
      const beforeA = await rawQty(rawAId);
      const beforeB = await rawQty(rawBId);
      const rejected = await q<{ r: { success: boolean; error?: string } }>(
        `SELECT public.update_purchase_invoice(
          p_purchase_id => $1,
          p_supplier_id => $2,
          p_warehouse_id => $3,
          p_subtotal => 100,
          p_discount_amount => 0,
          p_tax_amount => 0,
          p_total => 100,
          p_paid_amount => 100,
          p_payment_method => 'cash',
          p_notes => NULL,
          p_items => $4::jsonb
        ) AS r`,
        [purchase[0].id, supplierId, otherWarehouseId, JSON.stringify([
          { raw_material_id: rawBId, unit_name: 'kg', quantity: 1, unit_cost: 100 },
        ])],
      );
      expect(rejected[0].r.success).toBe(false);
      expect(rejected[0].r.error).toBe('WAREHOUSE_BRANCH_MISMATCH');
      expect(await rawQty(rawAId)).toBe(beforeA);
      expect(await rawQty(rawBId)).toBe(beforeB);
    });
  });
});
