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
  const otherBranchId = randomUUID();
  const otherWarehouseId = randomUUID();
  const userId = randomUUID();
  const manageUserId = randomUUID();
  const viewUserId = randomUUID();
  const otherBranchManageUserId = randomUUID();
  const supplierId = randomUUID();
  const gramUnitId = randomUUID();
  const rawAId = randomUUID();
  const rawBId = randomUUID();
  const invoiceNumber = `PUR-EDIT-${randomUUID()}`;
  const manageRole = `qa_purchase_manage_${randomUUID().slice(0, 8)}`;
  const viewRole = `qa_purchase_view_${randomUUID().slice(0, 8)}`;

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

  async function asUser<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [actorId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try { return await fn(); }
    finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function rawQty(rawId: string): Promise<number> {
    const rows = await q<{ quantity: string }>(
      `SELECT COALESCE(quantity,0)::text AS quantity
       FROM public.raw_material_warehouse_inventory
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
    await client.query(
      `INSERT INTO public.branches (id,name) VALUES
       ($1,'Purchase Edit Branch'),($2,'Other Purchase Edit Branch')`,
      [branchId, otherBranchId],
    );
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
    await client.query(
      `INSERT INTO public.roles (role,name_ar,name_en,permissions,scope,is_active) VALUES
       ($1,'إدارة تعديل المشتريات','Purchase correction manager','["purchases.manage"]'::jsonb,'branch',true),
       ($2,'عرض المشتريات','Purchase viewer','["purchases.view"]'::jsonb,'branch',true)`,
      [manageRole, viewRole],
    );
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active) VALUES
       ($1,$2,'Permission Purchase Manager',$3,$4,true),
       ($5,$6,'Purchase Viewer',$7,$4,true),
       ($8,$9,'Other Branch Purchase Manager',$3,$10,true)`,
      [
        manageUserId, `${manageUserId}@example.test`, manageRole, branchId,
        viewUserId, `${viewUserId}@example.test`, viewRole,
        otherBranchManageUserId, `${otherBranchManageUserId}@example.test`, otherBranchId,
      ],
    );
    await client.query(`INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES ($1,'Purchase Edit WH',$2,true)`, [warehouseId, branchId]);
    await client.query(`INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES ($1,'Other WH',$2,true)`, [otherWarehouseId, otherBranchId]);
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
          p_subtotal => 130,
          p_discount_amount => 0,
          p_tax_amount => 0,
          p_total => 130,
          p_paid_amount => 30,
          p_payment_method => 'card',
          p_notes => 'replace raw material',
          p_items => $4::jsonb
        ) AS r`,
        [corrected[0].r.purchase_id, supplierId, warehouseId, JSON.stringify([
          { raw_material_id: rawBId, unit_name: 'kg', quantity: 1.3, unit_cost: 100 },
        ])],
      );
      expect(replaced[0].r.success).toBe(true);
      if (!replaced[0].r.purchase_id) throw new Error(JSON.stringify(replaced[0].r));

      // The second correction removes Raw A entirely and leaves only the final Raw B quantity.
      expect(await rawQty(rawAId)).toBe(0);
      expect(await rawQty(rawBId)).toBe(1300);

      const current = await q<{ id: string; status: string; total: string; paid_amount: string; payment_method: string }>(
        `SELECT id,status,total::text,paid_amount::text,payment_method
         FROM public.purchases WHERE invoice_number=$1`,
        [invoiceNumber],
      );
      expect(current).toEqual([{
        id: replaced[0].r.purchase_id,
        status: 'completed',
        total: '130.00',
        paid_amount: '30.00',
        payment_method: 'card',
      }]);

      const finalItems = await q<{ raw_material_id: string; quantity: string }>(
        `SELECT raw_material_id,quantity::text FROM public.purchase_items WHERE purchase_id=$1`,
        [replaced[0].r.purchase_id],
      );
      expect(finalItems.map((row) => ({ ...row, quantity: Number(row.quantity) }))).toEqual([
        { raw_material_id: rawBId, quantity: 1.3 },
      ]);

      const revisions = await q<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM public.purchases
         WHERE invoice_number LIKE $1 AND status='returned'`,
        [`${invoiceNumber}-REV-%`],
      );
      expect(Number(revisions[0].count)).toBe(2);

      // Invoice settlement is represented by paid_amount and the purchase
      // journal. Corrections must not fabricate explicit supplier-payment rows.
      const payments = await q<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.supplier_payments WHERE branch_id=$1`,
        [branchId],
      );
      expect(Number(payments[0].count)).toBe(0);

      const unbalanced = await q<{ id: string }>(
        `SELECT je.id
         FROM public.journal_entries je
         JOIN public.journal_entry_lines jel ON jel.journal_entry_id=je.id
         WHERE je.branch_id=$1 AND je.reference_type IN ('purchase','purchase_return')
         GROUP BY je.id
         HAVING ROUND(SUM(jel.debit),2) <> ROUND(SUM(jel.credit),2)`,
        [branchId],
      );
      expect(unbalanced).toEqual([]);

      const accountNets = await q<{ account_key: string; net: string }>(
        `SELECT m.account_key,ROUND(COALESCE(SUM(jel.debit-jel.credit),0),2)::text AS net
         FROM (VALUES ('inventory_rm'),('cash'),('bank'),('ap')) AS m(account_key)
         LEFT JOIN public.journal_entries je ON je.branch_id=$1
         LEFT JOIN public.journal_entry_lines jel
           ON jel.journal_entry_id=je.id
          AND jel.account_id=public.resolve_account_key($1,m.account_key)
         GROUP BY m.account_key ORDER BY m.account_key`,
        [branchId],
      );
      expect(Object.fromEntries(accountNets.map((row) => [row.account_key, Number(row.net)]))).toEqual({
        ap: -100,
        bank: -30,
        cash: 0,
        inventory_rm: 130,
      });

      const ledger = await q<{ raw_material_id: string; quantity: string }>(
        `SELECT raw_material_id,COALESCE(SUM(quantity),0)::text AS quantity
         FROM public.inventory_ledger
         WHERE branch_id=$1 AND warehouse_id=$2
           AND raw_material_id IN ($3,$4)
           AND reference_type IN ('purchase','purchase_return')
         GROUP BY raw_material_id ORDER BY raw_material_id`,
        [branchId, warehouseId, rawAId, rawBId],
      );
      expect(Object.fromEntries(ledger.map((row) => [row.raw_material_id, Number(row.quantity)]))).toEqual({
        [rawAId]: 0,
        [rawBId]: 1300,
      });
    });
  });

  it('rejects a warehouse from another branch without changing the invoice', async () => {
    await asAdmin(async () => {
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

  it('is Permission-First, branch-scoped, and rejects duplicate correction of a returned revision', async () => {
    const permissionInvoice = `PUR-PERM-${randomUUID()}`;
    const createdId = await asAdmin(async () => {
      const created = await q<{ r: { success: boolean; purchase_id?: string } }>(
        `SELECT public.process_purchase($1,$2,$3,$4,10,0,0,10,0,'cash','completed',NULL,$5::jsonb) AS r`,
        [permissionInvoice, supplierId, branchId, warehouseId, JSON.stringify([
          { raw_material_id: rawBId, unit_name: 'kg', quantity: 0.1, unit_cost: 100 },
        ])],
      );
      expect(created[0].r.success).toBe(true);
      if (!created[0].r.purchase_id) throw new Error(JSON.stringify(created[0].r));
      return created[0].r.purchase_id;
    });

    const correctionArgs = [supplierId, warehouseId, JSON.stringify([
      { raw_material_id: rawBId, unit_name: 'kg', quantity: 0.2, unit_cost: 100 },
    ])];
    const callCorrection = async (purchaseId: string) => (
      await q<{ r: { success: boolean; purchase_id?: string; error?: string } }>(
        `SELECT public.update_purchase_invoice(
          p_purchase_id=>$1,p_supplier_id=>$2,p_warehouse_id=>$3,
          p_subtotal=>20,p_discount_amount=>0,p_tax_amount=>0,p_total=>20,
          p_paid_amount=>0,p_payment_method=>'cash',p_notes=>NULL,p_items=>$4::jsonb
        ) AS r`,
        [purchaseId, ...correctionArgs],
      )
    )[0].r;

    const allowed = await asUser(manageUserId, () => callCorrection(createdId));
    expect(allowed.success).toBe(true);
    if (!allowed.purchase_id) throw new Error(JSON.stringify(allowed));

    const denied = await asUser(viewUserId, () => callCorrection(allowed.purchase_id!));
    expect(denied).toMatchObject({ success: false, error: 'NOT_ALLOWED' });

    const crossBranch = await asUser(otherBranchManageUserId, () => callCorrection(allowed.purchase_id!));
    expect(crossBranch).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });

    const duplicate = await asUser(manageUserId, () => callCorrection(createdId));
    expect(duplicate).toMatchObject({ success: false, error: 'PURCHASE_EDIT_STATUS_NOT_ALLOWED' });
  });
});
