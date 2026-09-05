import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('purchase UOM -> raw stock -> availability -> auto production -> sale', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const userId = randomUUID();
  const gramUnitId = randomUUID();
  const rawId = randomUUID();
  const manufacturedUnitId = randomUUID();
  const productId = randomUUID();
  const supplierId = randomUUID();

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

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.branches (id,name) VALUES ($1,'Purchase UOM Branch')`, [branchId]);
    await client.query(
      `INSERT INTO auth.users (id,email,role,aud,instance_id,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
       VALUES ($1,$2,'authenticated','authenticated',gen_random_uuid(),'{}'::jsonb,'{}'::jsonb,now(),now())`,
      [userId, `purchase-uom-${userId}@example.test`],
    );
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Purchase UOM Super Admin','super_admin',$3,true)`,
      [userId, `purchase-uom-${userId}@example.test`, branchId],
    );
    await client.query(`INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES ($1,'Purchase UOM WH',$2,true)`, [warehouseId, branchId]);
    await client.query(`INSERT INTO public.suppliers (id,name,branch_id) VALUES ($1,'Purchase UOM Supplier',$2)`, [supplierId, branchId]);
    await client.query(`INSERT INTO public.units (id,code,name,symbol,is_active) VALUES ($1,$2,'Gram','جم',true)`, [gramUnitId, `G-${randomUUID()}`]);
    await client.query(
      `INSERT INTO public.raw_materials (id,code,name,unit_id,min_stock,default_cost,is_active,branch_id)
       VALUES ($1,$2,'Purchase Flour',$3,0,0,true,$4)`,
      [rawId, `RM-${randomUUID()}`, gramUnitId, branchId],
    );
    await client.query(
      `INSERT INTO public.inventory_units (id,code,name,unit_type,branch_id,cost_price,sale_price,is_active)
       VALUES ($1,$2,'Purchase Dough','manufactured',$3,0,0,true)`,
      [manufacturedUnitId, `UNIT-${randomUUID()}`, branchId],
    );
    await client.query(
      `INSERT INTO public.inventory_unit_recipes (unit_id,raw_material_id,quantity,wastage_percent)
       VALUES ($1,$2,150,0)`,
      [manufacturedUnitId, rawId],
    );
    await client.query(
      `INSERT INTO public.products (id,name,branch_id,product_type,sale_price,cost_price,is_active)
       VALUES ($1,'Purchase Pizza',$2,'ready',50,0,true)`,
      [productId, branchId],
    );
    await client.query(`INSERT INTO public.product_unit_links (product_id,unit_id,quantity) VALUES ($1,$2,1)`, [productId, manufacturedUnitId]);
    await client.query(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await client.query(`SELECT public.seed_account_mappings($1)`, [branchId]);
    await client.query(`UPDATE public.settings SET tax_enabled=false`);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('stores 1 kg invoice as 1000 g inventory at 0.12 per gram without changing invoice values', async () => {
    await asAdmin(async () => {
      const items = JSON.stringify([{ raw_material_id: rawId, unit_name: 'kg', quantity: 1, unit_cost: 120 }]);
      const purchase = await q<{ r: { success: boolean; purchase_id?: string; error?: string; detail?: string } }>(
        `SELECT public.process_purchase($1,NULL,$2,$3,120,0,0,120,120,'cash','completed',NULL,$4::jsonb) AS r`,
        [`PUR-${randomUUID()}`, branchId, warehouseId, items],
      );
      expect(purchase[0].r.success).toBe(true);
      if (!purchase[0].r.success) throw new Error(JSON.stringify(purchase[0].r));

      const inv = await q<{ quantity: string; avg_cost: string }>(
        `SELECT quantity::text,avg_cost::text FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2`,
        [rawId, branchId],
      );
      expect(Number(inv[0].quantity)).toBe(1000);
      expect(Number(inv[0].avg_cost)).toBeCloseTo(0.12, 6);

      const line = await q<{ quantity: string; unit_cost: string; unit_name: string }>(
        `SELECT quantity::text,unit_cost::text,unit_name FROM public.purchase_items WHERE purchase_id=$1 AND raw_material_id=$2`,
        [purchase[0].r.purchase_id, rawId],
      );
      expect(Number(line[0].quantity)).toBe(1);
      expect(Number(line[0].unit_cost)).toBe(120);
      expect(line[0].unit_name.toLowerCase()).toBe('kg');

      const batch = await q<{ quantity: string; unit_cost: string }>(
        `SELECT quantity::text,unit_cost::text FROM public.raw_material_batches WHERE raw_material_id=$1 AND branch_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [rawId, branchId],
      );
      expect(Number(batch[0].quantity)).toBe(1000);
      expect(Number(batch[0].unit_cost)).toBeCloseTo(0.12, 6);
    });
  });

  it('derives six sellable products, auto-produces two on sale, and leaves four sellable', async () => {
    await asAdmin(async () => {
      const before = await q<{ available_quantity: string }>(
        `SELECT available_quantity::text FROM public.get_pos_product_availability($1,$2,100) WHERE product_id=$3`,
        [branchId, warehouseId, productId],
      );
      expect(Number(before[0].available_quantity)).toBe(6);

      const sale = await q<{ r: { success: boolean; error?: string; detail?: string } }>(
        `SELECT public.process_sale($1,$2,$3,NULL,NULL,100,0,'amount',0,0,100,100,'cash','completed',$4::jsonb,NULL,'takeaway',NULL,NULL,NULL) AS r`,
        [
          `SALE-${randomUUID()}`,
          branchId,
          warehouseId,
          JSON.stringify([{ product_id: productId, unit_name: 'piece', quantity: 2, unit_price: 50, discount_amount: 0, bonus_quantity: 0, total: 100 }]),
        ],
      );
      expect(sale[0].r.success).toBe(true);
      if (!sale[0].r.success) throw new Error(JSON.stringify(sale[0].r));

      const inv = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2`,
        [rawId, branchId],
      );
      expect(Number(inv[0].quantity)).toBe(700);

      const produced = await q<{ unit_cost: string; quantity: string }>(
        `SELECT unit_cost::text,quantity::text FROM public.inventory_unit_batches
         WHERE unit_id=$1 AND branch_id=$2 AND warehouse_id=$3 ORDER BY created_at DESC LIMIT 1`,
        [manufacturedUnitId, branchId, warehouseId],
      );
      expect(Number(produced[0].quantity)).toBe(0);
      expect(Number(produced[0].unit_cost)).toBeCloseTo(18, 2);

      const after = await q<{ available_quantity: string }>(
        `SELECT available_quantity::text FROM public.get_pos_product_availability($1,$2,100) WHERE product_id=$3`,
        [branchId, warehouseId, productId],
      );
      expect(Number(after[0].available_quantity)).toBe(4);
    });
  });

  it('rejects incompatible purchase units instead of corrupting stock', async () => {
    await asAdmin(async () => {
      const r = await q<{ r: { success: boolean; error?: string } }>(
        `SELECT public._normalize_raw_purchase_uom($1,1,10,'liter') AS r`,
        [rawId],
      );
      expect(r[0].r.success).toBe(false);
      expect(r[0].r.error).toBe('INCOMPATIBLE_PURCHASE_UNIT');
    });
  });

  it('normalizes each partial raw receipt and posts the full order value on completion', async () => {
    await asAdmin(async () => {
      const before = await q<{ quantity: string }>(
        `SELECT quantity::text FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2`,
        [rawId, branchId],
      );
      const beforeQty = Number(before[0].quantity);
      const items = JSON.stringify([{ raw_material_id: rawId, unit_name: 'kg', quantity: 2, unit_cost: 120 }]);
      const created = await q<{ r: { success: boolean; purchase_id?: string; error?: string; detail?: string } }>(
        `SELECT public.create_purchase_order($1,$2,$3,'credit','partial raw UOM',$4::jsonb,NULL) AS r`,
        [branchId, supplierId, warehouseId, items],
      );
      expect(created[0].r.success).toBe(true);
      if (!created[0].r.purchase_id) throw new Error(JSON.stringify(created[0].r));
      const purchaseId = created[0].r.purchase_id;

      const header = await q<{ subtotal: string; total: string }>(
        `SELECT subtotal::text,total::text FROM public.purchases WHERE id=$1`, [purchaseId],
      );
      expect(Number(header[0].subtotal)).toBe(240);
      expect(Number(header[0].total)).toBe(240);

      await q(`SELECT public.update_purchase_order_status($1,'submitted')`, [purchaseId]);
      await q(`SELECT public.update_purchase_order_status($1,'approved')`, [purchaseId]);
      const line = await q<{ id: string }>(
        `SELECT id FROM public.purchase_items WHERE purchase_id=$1 AND raw_material_id=$2`, [purchaseId, rawId],
      );

      const first = await q<{ r: { success: boolean; status?: string } }>(
        `SELECT public.receive_purchase_order($1,$2::jsonb) AS r`,
        [purchaseId, JSON.stringify([{ purchase_item_id: line[0].id, quantity_received: 0.5 }])],
      );
      expect(first[0].r.success).toBe(true);
      expect(first[0].r.status).toBe('partial');
      const afterFirst = await q<{ quantity: string; received_quantity: string }>(
        `SELECT rmi.quantity::text,pi.received_quantity::text
         FROM public.raw_material_inventory rmi
         JOIN public.purchase_items pi ON pi.purchase_id=$3 AND pi.raw_material_id=rmi.raw_material_id
         WHERE rmi.raw_material_id=$1 AND rmi.branch_id=$2`,
        [rawId, branchId, purchaseId],
      );
      expect(Number(afterFirst[0].quantity) - beforeQty).toBe(500);
      expect(Number(afterFirst[0].received_quantity)).toBe(0.5);

      const second = await q<{ r: { success: boolean; status?: string } }>(
        `SELECT public.receive_purchase_order($1,$2::jsonb) AS r`,
        [purchaseId, JSON.stringify([{ purchase_item_id: line[0].id, quantity_received: 1.5 }])],
      );
      expect(second[0].r.success).toBe(true);
      expect(second[0].r.status).toBe('completed');

      const after = await q<{ quantity: string; avg_cost: string }>(
        `SELECT quantity::text,avg_cost::text FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2`,
        [rawId, branchId],
      );
      expect(Number(after[0].quantity) - beforeQty).toBe(2000);
      expect(Number(after[0].avg_cost)).toBeCloseTo(0.12, 6);

      const receipts = await q<{ quantity: string; unit_cost: string; reference_type: string }>(
        `SELECT quantity::text,unit_cost::text,reference_type
         FROM public.inventory_ledger WHERE raw_material_id=$1 AND reference_type='purchase_receipt'
         ORDER BY created_at DESC LIMIT 2`,
        [rawId],
      );
      expect(receipts.map((row) => Number(row.quantity)).sort((a, b) => a - b)).toEqual([500, 1500]);
      expect(receipts.every((row) => Number(row.unit_cost) === 0.12)).toBe(true);

      const journal = await q<{ dr: string; cr: string }>(
        `SELECT COALESCE(SUM(l.debit),0)::text AS dr,COALESCE(SUM(l.credit),0)::text AS cr
         FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id
         WHERE j.reference_id=$1`,
        [purchaseId],
      );
      expect(Number(journal[0].dr)).toBe(240);
      expect(Number(journal[0].cr)).toBe(240);
    });
  });
});
