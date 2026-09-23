import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('historical credit purchase bank reconciliation', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const supplierId = randomUUID();
  const userId = randomUUID();
  const rawId = randomUUID();
  const unitId = randomUUID();

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

  async function seedCreditPurchase(opts: {
    status?: string;
    amount: number;
    withJournal?: boolean;
    invoicePrefix: string;
  }): Promise<{ purchaseId: string; originalJournalId?: string; invoice: string }> {
    const purchaseId = randomUUID();
    const invoice = `${opts.invoicePrefix}-${randomUUID()}`;
    const createdAt = '2026-09-11T19:00:00.000Z';

    await q(
      `INSERT INTO public.purchases
        (id,invoice_number,supplier_id,branch_id,warehouse_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,0,0,$6,$6,'credit',$7,$8)`,
      [purchaseId, invoice, supplierId, branchId, warehouseId, opts.amount, opts.status || 'completed', createdAt],
    );
    await q(
      `INSERT INTO public.purchase_items
        (purchase_id,raw_material_id,unit_name,quantity,unit_cost,total,created_at)
       VALUES ($1,$2,'piece',1,$3,$3,$4)`,
      [purchaseId, rawId, opts.amount, createdAt],
    );

    if (opts.withJournal === false) return { purchaseId, invoice };

    const originalJournalId = randomUUID();
    await q(
      `INSERT INTO public.journal_entries
        (id,entry_number,branch_id,entry_date,reference_type,reference_id,reference_number,description,created_by,created_at)
       VALUES ($1,$2,$3,'2026-09-11','purchase',$4,$5,$6,$7,$8)`,
      [
        originalJournalId,
        `JRN-${randomUUID()}`,
        branchId,
        purchaseId,
        invoice,
        `Historical purchase ${invoice}`,
        userId,
        createdAt,
      ],
    );
    await q(
      `INSERT INTO public.journal_entry_lines
        (journal_entry_id,account_id,debit,credit,supplier_id,note)
       VALUES
        ($1,public.resolve_account_key($2,'inventory_rm'),$3,0,NULL,$4),
        ($1,public.resolve_account_key($2,'bank'),0,$3,NULL,$4)`,
      [originalJournalId, branchId, opts.amount, invoice],
    );

    return { purchaseId, originalJournalId, invoice };
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await q(`INSERT INTO public.branches (id,name) VALUES ($1,'Historical Credit Reconciliation Branch')`, [branchId]);
    await q(
      `INSERT INTO auth.users (id,email,role,aud,instance_id,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
       VALUES ($1,$2,'authenticated','authenticated',gen_random_uuid(),'{}'::jsonb,'{}'::jsonb,now(),now())`,
      [userId, `historical-credit-${userId}@example.test`],
    );
    await q(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Historical Credit Super Admin','super_admin',$3,true)`,
      [userId, `historical-credit-${userId}@example.test`, branchId],
    );
    await q(`INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES ($1,'Historical Credit WH',$2,true)`, [warehouseId, branchId]);
    await q(`INSERT INTO public.suppliers (id,name,branch_id) VALUES ($1,'Historical Credit Supplier',$2)`, [supplierId, branchId]);
    await q(`INSERT INTO public.units (id,code,name,symbol,is_active) VALUES ($1,$2,'Piece','pc',true)`, [unitId, `U-${randomUUID()}`]);
    await q(
      `INSERT INTO public.raw_materials (id,code,name,unit_id,min_stock,default_cost,is_active,branch_id)
       VALUES ($1,$2,'Historical Credit Raw',$3,0,0,true,$4)`,
      [rawId, `RM-${randomUUID()}`, unitId, branchId],
    );
    await q(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await q(`SELECT public.seed_account_mappings($1)`, [branchId]);
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('posts a dated compensating journal, recognizes AP, and preserves the original journal', async () => {
    await asAdmin(async () => {
      const seeded = await seedCreditPurchase({
        amount: 100,
        invoicePrefix: 'HIST-CREDIT',
      });

      const result = await q<{ r: { success: boolean; corrected: number; corrected_amount: number } }>(
        `SELECT private.reconcile_credit_purchase_bank_history($1) AS r`,
        [seeded.purchaseId],
      );
      expect(result[0].r).toMatchObject({ success: true, corrected: 1 });
      expect(Number(result[0].r.corrected_amount)).toBe(100);

      const purchase = await q<{ paid_amount: string; payment_method: string }>(
        `SELECT paid_amount::text,payment_method FROM public.purchases WHERE id=$1`,
        [seeded.purchaseId],
      );
      expect(purchase).toEqual([{ paid_amount: '0.00', payment_method: 'credit' }]);

      const original = await q<{ bank_credit: string }>(
        `SELECT ROUND(COALESCE(SUM(CASE WHEN a.code='1010' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS bank_credit
         FROM public.journal_entry_lines l
         JOIN public.chart_of_accounts a ON a.id=l.account_id
         WHERE l.journal_entry_id=$1`,
        [seeded.originalJournalId],
      );
      expect(Number(original[0].bank_credit)).toBe(100);

      const correction = await q<{ entry_date: string; bank_net: string; ap_net: string; supplier_id: string | null }>(
        `SELECT je.entry_date::text,
                ROUND(COALESCE(SUM(CASE WHEN a.code='1010' THEN l.debit-l.credit ELSE 0 END),0),2)::text AS bank_net,
                ROUND(COALESCE(SUM(CASE WHEN a.code='2000' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS ap_net,
                MAX(l.supplier_id::text) FILTER (WHERE a.code='2000') AS supplier_id
         FROM public.journal_entries je
         JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
         JOIN public.chart_of_accounts a ON a.id=l.account_id
         WHERE je.reference_type='purchase_payment_reconciliation'
           AND je.reference_id=$1
         GROUP BY je.id`,
        [seeded.purchaseId],
      );
      expect(correction).toHaveLength(1);
      expect(correction[0].entry_date).toBe('2026-09-11');
      expect(Number(correction[0].bank_net)).toBe(100);
      expect(Number(correction[0].ap_net)).toBe(100);
      expect(correction[0].supplier_id).toBe(supplierId);

      const net = await q<{ bank_net: string; ap_net: string }>(
        `SELECT
           ROUND(COALESCE(SUM(CASE WHEN a.code='1010' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS bank_net,
           ROUND(COALESCE(SUM(CASE WHEN a.code='2000' THEN l.credit-l.debit ELSE 0 END),0),2)::text AS ap_net
         FROM public.journal_entries je
         JOIN public.journal_entry_lines l ON l.journal_entry_id=je.id
         JOIN public.chart_of_accounts a ON a.id=l.account_id
         WHERE je.reference_id=$1
           AND je.reference_type IN ('purchase','purchase_payment_reconciliation')`,
        [seeded.purchaseId],
      );
      expect(Number(net[0].bank_net)).toBe(0);
      expect(Number(net[0].ap_net)).toBe(100);

      const again = await q<{ r: { success: boolean; corrected: number; already_corrected: number } }>(
        `SELECT private.reconcile_credit_purchase_bank_history($1) AS r`,
        [seeded.purchaseId],
      );
      expect(again[0].r).toMatchObject({ success: true, corrected: 0 });
      const count = await q<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.journal_entries
         WHERE reference_type='purchase_payment_reconciliation' AND reference_id=$1`,
        [seeded.purchaseId],
      );
      expect(Number(count[0].count)).toBe(1);
    });
  });

  it('does not reclassify returned purchases whose historical reversals are outside this repair', async () => {
    await asAdmin(async () => {
      const seeded = await seedCreditPurchase({
        amount: 50,
        status: 'returned',
        invoicePrefix: 'HIST-RETURNED',
      });
      const result = await q<{ r: { success: boolean; corrected: number } }>(
        `SELECT private.reconcile_credit_purchase_bank_history($1) AS r`,
        [seeded.purchaseId],
      );
      expect(result[0].r).toMatchObject({ success: true, corrected: 0 });

      const purchase = await q<{ paid_amount: string }>(
        `SELECT paid_amount::text FROM public.purchases WHERE id=$1`,
        [seeded.purchaseId],
      );
      expect(Number(purchase[0].paid_amount)).toBe(50);
      const correction = await q<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.journal_entries
         WHERE reference_type='purchase_payment_reconciliation' AND reference_id=$1`,
        [seeded.purchaseId],
      );
      expect(Number(correction[0].count)).toBe(0);
    });
  });

  it('flags a credit purchase with no direct purchase journal instead of fabricating history', async () => {
    await asAdmin(async () => {
      const seeded = await seedCreditPurchase({
        amount: 30,
        withJournal: false,
        invoicePrefix: 'HIST-ORPHAN',
      });
      const result = await q<{ r: { success: boolean; corrected: number; manual_review: number } }>(
        `SELECT private.reconcile_credit_purchase_bank_history($1) AS r`,
        [seeded.purchaseId],
      );
      expect(result[0].r).toMatchObject({ success: true, corrected: 0, manual_review: 1 });

      const purchase = await q<{ paid_amount: string }>(
        `SELECT paid_amount::text FROM public.purchases WHERE id=$1`,
        [seeded.purchaseId],
      );
      expect(Number(purchase[0].paid_amount)).toBe(30);

      const audit = await q<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.audit_log
         WHERE action='purchase_credit_reconciliation_review'
           AND entity='purchase'
           AND entity_id=$1`,
        [seeded.purchaseId],
      );
      expect(Number(audit[0].count)).toBe(1);
    });
  });
});
