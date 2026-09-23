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

      const originalCreatedAt = '2026-09-01T09:30:00.000Z';
      const originalEntryDate = '2026-09-01';
      const originalPurchaseId = created[0].r.purchase_id;

      // Simulate editing an invoice from a prior business day.
      await q(`UPDATE public.purchases SET created_at=$2 WHERE id=$1`, [originalPurchaseId, originalCreatedAt]);
      await q(`UPDATE public.purchase_items SET created_at=$2 WHERE purchase_id=$1`, [originalPurchaseId, originalCreatedAt]);
      await q(
        `UPDATE public.inventory_ledger SET created_at=$2
         WHERE reference_type='purchase' AND reference_id=$1`,
        [originalPurchaseId, originalCreatedAt],
      );
      await q(
        `UPDATE public.raw_material_batches SET created_at=$2
         WHERE source_type='purchase' AND source_id=$1`,
        [originalPurchaseId, originalCreatedAt],
      );
      await q(
        `UPDATE public.inventory_batches SET created_at=$2
         WHERE source_type='purchase' AND source_id=$1`,
        [originalPurchaseId, originalCreatedAt],
      );
      await q(
        `UPDATE public.journal_entry_lines jel
         SET created_at=$2
         WHERE jel.journal_entry_id IN (
           SELECT id FROM public.journal_entries
           WHERE reference_type='purchase' AND reference_id=$1
         )`,
        [originalPurchaseId, originalCreatedAt],
      );
      await q(
        `UPDATE public.journal_entries
         SET created_at=$2, entry_date=$3::date
         WHERE reference_type='purchase' AND reference_id=$1`,
        [originalPurchaseId, originalCreatedAt, originalEntryDate],
      );

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

      const correctedDates = await q<{ created_at: string }>(
        `SELECT created_at::text
         FROM public.purchases
         WHERE id IN ($1,$2)
         ORDER BY id`,
        [created[0].r.purchase_id, corrected[0].r.purchase_id],
      );
      expect(new Set(correctedDates.map((row) => new Date(row.created_at).toISOString()))).toEqual(
        new Set([new Date(originalCreatedAt).toISOString()]),
      );

      const correctionItems = await q<{ created_at: string }>(
        `SELECT created_at::text FROM public.purchase_items WHERE purchase_id=$1`,
        [corrected[0].r.purchase_id],
      );
      expect(correctionItems.every((row) => new Date(row.created_at).toISOString() === new Date(originalCreatedAt).toISOString())).toBe(true);

      const correctionLedger = await q<{ created_at: string; reference_type: string }>(
        `SELECT created_at::text,reference_type
         FROM public.inventory_ledger
         WHERE (reference_type='purchase' AND reference_id=$1)
            OR (reference_type='purchase_return' AND reference_id=$2)`,
        [corrected[0].r.purchase_id, created[0].r.purchase_id],
      );
      expect(correctionLedger.length).toBeGreaterThan(0);
      expect(correctionLedger.every((row) => new Date(row.created_at).toISOString() === new Date(originalCreatedAt).toISOString())).toBe(true);

      const correctionBatches = await q<{ created_at: string }>(
        `SELECT created_at::text FROM public.raw_material_batches
         WHERE source_type='purchase' AND source_id=$1`,
        [corrected[0].r.purchase_id],
      );
      expect(correctionBatches.length).toBeGreaterThan(0);
      expect(correctionBatches.every((row) => new Date(row.created_at).toISOString() === new Date(originalCreatedAt).toISOString())).toBe(true);

      const correctionJournals = await q<{ created_at: string; entry_date: string; reference_type: string }>(
        `SELECT created_at::text,entry_date::text,reference_type
         FROM public.journal_entries
         WHERE branch_id=$1
           AND (
             (reference_type='purchase' AND reference_id=$2)
             OR (reference_type='purchase_return' AND reference_number=$3)
           )
         ORDER BY reference_type`,
        [branchId, corrected[0].r.purchase_id, invoiceNumber],
      );
      expect(correctionJournals.length).toBeGreaterThanOrEqual(2);
      expect(correctionJournals.every((row) => new Date(row.created_at).toISOString() === new Date(originalCreatedAt).toISOString())).toBe(true);
      expect(correctionJournals.every((row) => row.entry_date === originalEntryDate)).toBe(true);

      const auditRows = await q<{ created_at: string }>(
        `SELECT created_at::text FROM public.audit_log
         WHERE entity='purchase'
           AND entity_id=$1
           AND COALESCE((details->>'transactional_reversal')::boolean,false)
         ORDER BY created_at DESC LIMIT 1`,
        [corrected[0].r.purchase_id],
      );
      expect(auditRows.length).toBe(1);
      expect(new Date(auditRows[0].created_at).getTime()).toBeGreaterThan(new Date(originalCreatedAt).getTime());

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
          p_payment_method => 'credit',
          p_notes => 'replace raw material',
          p_items => $4::jsonb
        ) AS r`,
        [corrected[0].r.purchase_id, supplierId, warehouseId, JSON.stringify([
          { raw_material_id: rawBId, unit_name: 'kg', quantity: 1.3, unit_cost: 100 },
        ])],
      );
      expect(replaced[0].r.success).toBe(true);
      if (!replaced[0].r.purchase_id) throw new Error(JSON.stringify(replaced[0].r));

      const revisionDates = await q<{ created_at: string }>(
        `SELECT created_at::text
         FROM public.purchases
         WHERE branch_id=$1
           AND (invoice_number=$2 OR left(invoice_number,length($2)+5)=$2 || '-REV-')`,
        [branchId, invoiceNumber],
      );
      expect(revisionDates.length).toBeGreaterThanOrEqual(3);
      expect(revisionDates.every((row) => new Date(row.created_at).toISOString() === new Date(originalCreatedAt).toISOString())).toBe(true);

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
        paid_amount: '0.00',
        payment_method: 'credit',
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
        ap: -130,
        bank: 0,
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

  it('enforces cash/credit routing in the database and never infers bank', async () => {
    await asAdmin(async () => {
      const items = JSON.stringify([
        { raw_material_id: rawBId, unit_name: 'kg', quantity: 1, unit_cost: 40 },
      ]);

      const creditInvoice = `PUR-CREDIT-ROUTE-${randomUUID()}`;
      const creditCreated = await q<{ r: { success: boolean; purchase_id?: string; error?: string } }>(
        `SELECT public.process_purchase($1,$2,$3,$4,40,0,0,40,40,'credit','completed',NULL,$5::jsonb) AS r`,
        [creditInvoice, supplierId, branchId, warehouseId, items],
      );
      expect(creditCreated[0].r.success).toBe(true);
      if (!creditCreated[0].r.purchase_id) throw new Error(JSON.stringify(creditCreated[0].r));

      const creditRow = await q<{ paid_amount: string; payment_method: string }>(
        `SELECT paid_amount::text,payment_method FROM public.purchases WHERE id=$1`,
        [creditCreated[0].r.purchase_id],
      );
      expect(creditRow).toEqual([{ paid_amount: '0.00', payment_method: 'credit' }]);

      const creditPosting = await q<{ cash_credit: string; bank_credit: string; ap_credit: string }>(
        `SELECT
           ROUND(COALESCE(SUM(CASE WHEN a.code='1000' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS cash_credit,
           ROUND(COALESCE(SUM(CASE WHEN a.code='1010' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS bank_credit,
           ROUND(COALESCE(SUM(CASE WHEN a.code='2000' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS ap_credit
         FROM public.journal_entries je
         JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
         JOIN public.chart_of_accounts a ON a.id=l.account_id
         WHERE je.reference_type='purchase' AND je.reference_id=$1`,
        [creditCreated[0].r.purchase_id],
      );
      expect({
        cash: Number(creditPosting[0].cash_credit),
        bank: Number(creditPosting[0].bank_credit),
        ap: Number(creditPosting[0].ap_credit),
      }).toEqual({ cash: 0, bank: 0, ap: 40 });

      const cashInvoice = `PUR-CASH-ROUTE-${randomUUID()}`;
      const cashCreated = await q<{ r: { success: boolean; purchase_id?: string; error?: string } }>(
        `SELECT public.process_purchase($1,$2,$3,$4,25,0,0,25,0,'cash','completed',NULL,$5::jsonb) AS r`,
        [cashInvoice, supplierId, branchId, warehouseId, JSON.stringify([
          { raw_material_id: rawBId, unit_name: 'kg', quantity: 1, unit_cost: 25 },
        ])],
      );
      expect(cashCreated[0].r.success).toBe(true);
      if (!cashCreated[0].r.purchase_id) throw new Error(JSON.stringify(cashCreated[0].r));

      const cashRow = await q<{ paid_amount: string; payment_method: string }>(
        `SELECT paid_amount::text,payment_method FROM public.purchases WHERE id=$1`,
        [cashCreated[0].r.purchase_id],
      );
      expect(cashRow).toEqual([{ paid_amount: '25.00', payment_method: 'cash' }]);

      const cashPosting = await q<{ cash_credit: string; bank_credit: string; ap_credit: string }>(
        `SELECT
           ROUND(COALESCE(SUM(CASE WHEN a.code='1000' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS cash_credit,
           ROUND(COALESCE(SUM(CASE WHEN a.code='1010' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS bank_credit,
           ROUND(COALESCE(SUM(CASE WHEN a.code='2000' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS ap_credit
         FROM public.journal_entries je
         JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
         JOIN public.chart_of_accounts a ON a.id=l.account_id
         WHERE je.reference_type='purchase' AND je.reference_id=$1`,
        [cashCreated[0].r.purchase_id],
      );
      expect({
        cash: Number(cashPosting[0].cash_credit),
        bank: Number(cashPosting[0].bank_credit),
        ap: Number(cashPosting[0].ap_credit),
      }).toEqual({ cash: 25, bank: 0, ap: 0 });

      const unsupportedInvoice = `PUR-NO-IMPLICIT-BANK-${randomUUID()}`;
      const unsupported = await q<{ r: { success: boolean; error?: string } }>(
        `SELECT public.process_purchase($1,$2,$3,$4,30,0,0,30,30,'card','completed',NULL,$5::jsonb) AS r`,
        [unsupportedInvoice, supplierId, branchId, warehouseId, JSON.stringify([
          { raw_material_id: rawBId, unit_name: 'kg', quantity: 1, unit_cost: 30 },
        ])],
      );
      expect(unsupported[0].r).toMatchObject({ success: false, error: 'TREASURY_ACCOUNT_REQUIRED' });
      const unsupportedRows = await q<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.purchases WHERE invoice_number=$1`,
        [unsupportedInvoice],
      );
      expect(Number(unsupportedRows[0].count)).toBe(0);

      const legacyBankGuess = await q<{ r: { success: boolean; error?: string } }>(
        `SELECT public.pay_supplier($1,$2,10,'transfer',$3,NULL) AS r`,
        [supplierId, branchId, creditCreated[0].r.purchase_id],
      );
      expect(legacyBankGuess[0].r).toMatchObject({
        success: false,
        error: 'TREASURY_ACCOUNT_REQUIRED',
      });
    });
  });

  it('normalizes purchase-order receipt settlement without posting credit to bank', async () => {
    await asAdmin(async () => {
      const po = await q<{ r: { success: boolean; purchase_id?: string; error?: string } }>(
        `SELECT public.create_purchase_order($1,$2,$3,'credit',NULL,$4::jsonb,NULL) AS r`,
        [branchId, supplierId, warehouseId, JSON.stringify([
          { raw_material_id: rawBId, unit_name: 'kg', quantity: 0.5, unit_cost: 40 },
        ])],
      );
      expect(po[0].r.success).toBe(true);
      if (!po[0].r.purchase_id) throw new Error(JSON.stringify(po[0].r));

      const poId = po[0].r.purchase_id;
      const submitted = await q<{ r: { success: boolean; error?: string } }>(
        `SELECT public.update_purchase_order_status($1,'submitted') AS r`,
        [poId],
      );
      expect(submitted[0].r.success).toBe(true);
      const approved = await q<{ r: { success: boolean; error?: string } }>(
        `SELECT public.update_purchase_order_status($1,'approved') AS r`,
        [poId],
      );
      expect(approved[0].r.success).toBe(true);

      // Simulate the historical inconsistent state that used to route credit to 1010.
      await q(`UPDATE public.purchases SET paid_amount=total WHERE id=$1`, [poId]);

      const poItem = await q<{ id: string; quantity: string }>(
        `SELECT id,quantity::text FROM public.purchase_items WHERE purchase_id=$1 ORDER BY id LIMIT 1`,
        [poId],
      );
      const received = await q<{ r: { success: boolean; error?: string; fully_received?: boolean } }>(
        `SELECT public.receive_purchase_order($1,$2::jsonb) AS r`,
        [poId, JSON.stringify([
          { purchase_item_id: poItem[0].id, quantity_received: Number(poItem[0].quantity) },
        ])],
      );
      expect(received[0].r.success).toBe(true);
      expect(received[0].r.fully_received).toBe(true);

      const settled = await q<{ paid_amount: string; payment_method: string; total: string }>(
        `SELECT paid_amount::text,payment_method,total::text FROM public.purchases WHERE id=$1`,
        [poId],
      );
      expect(settled[0].payment_method).toBe('credit');
      expect(Number(settled[0].paid_amount)).toBe(0);

      const posting = await q<{ bank_credit: string; ap_credit: string }>(
        `SELECT
           ROUND(COALESCE(SUM(CASE WHEN a.code='1010' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS bank_credit,
           ROUND(COALESCE(SUM(CASE WHEN a.code='2000' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS ap_credit
         FROM public.journal_entries je
         JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
         JOIN public.chart_of_accounts a ON a.id=l.account_id
         WHERE je.reference_type='purchase' AND je.reference_id=$1`,
        [poId],
      );
      expect(Number(posting[0].bank_credit)).toBe(0);
      expect(Number(posting[0].ap_credit)).toBe(Number(settled[0].total));
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
