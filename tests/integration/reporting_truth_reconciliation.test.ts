import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('reporting truth and financial reconciliation', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const userId = randomUUID();
  const shiftId = randomUUID();
  const nowIso = new Date().toISOString();

  const sales = {
    cash: randomUUID(),
    card: randomUUID(),
    credit: randomUUID(),
    split: randomUUID(),
    legacy: randomUUID(),
  };

  async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await client.query(sql, params)).rows as T[];
  }

  async function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE service_role`);
    try { return await fn(); }
    finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function postSaleJournal(saleId: string, invoice: string, lines: Record<string, unknown>[]) {
    await q(
      `SELECT public._post_journal_entry($1,'sale',$2,$3,$4,$5::jsonb)`,
      [branchId, saleId, invoice, `Test sale ${invoice}`, JSON.stringify(lines)],
    );
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await q(`INSERT INTO public.branches (id,name) VALUES ($1,'Reporting Truth Branch')`, [branchId]);
    await q(
      `INSERT INTO auth.users (id,email,role,aud,instance_id,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
       VALUES ($1,$2,'authenticated','authenticated',gen_random_uuid(),'{}'::jsonb,'{}'::jsonb,now(),now())`,
      [userId, `reporting-truth-${userId}@example.test`],
    );
    await q(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Reporting Truth Admin','super_admin',$3,true)`,
      [userId, `reporting-truth-${userId}@example.test`, branchId],
    );
    await q(`SELECT public.ensure_chart_of_accounts($1)`, [branchId]);
    await q(`SELECT public.seed_account_mappings($1)`, [branchId]);

    await q(
      `INSERT INTO public.treasury_accounts
        (branch_id,account_id,account_type,account_name,is_active,scope,kind,is_primary)
       SELECT $1,id,'cash','Branch Cash',true,'branch','branch_cash',true
       FROM public.chart_of_accounts WHERE branch_id=$1 AND code='1000'
       UNION ALL
       SELECT $1,id,'bank','Bank',true,'branch','bank',true
       FROM public.chart_of_accounts WHERE branch_id=$1 AND code='1010'`,
      [branchId],
    );

    const openedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await q(
      `INSERT INTO public.shifts (id,branch_id,cashier_id,opened_at,opening_amount,status)
       VALUES ($1,$2,$3,$4,10,'open')`,
      [shiftId, branchId, userId, openedAt],
    );

    const createdAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await q(
      `INSERT INTO public.sales
        (id,invoice_number,branch_id,cashier_id,subtotal,discount_amount,tax_amount,total,paid_amount,payment_method,status,created_at)
       VALUES
        ($1,'RT-CASH',$6,$7,100,0,0,100,100,'cash','completed',$8),
        ($2,'RT-CARD',$6,$7,50,0,0,50,50,'card','completed',$8),
        ($3,'RT-CREDIT',$6,$7,25,0,0,25,0,'credit','completed',$8),
        ($4,'RT-SPLIT',$6,$7,100,0,0,100,100,'split','completed',$8),
        ($5,'RT-LEGACY',$6,$7,100,0,0,100,80,'split','completed',$8)`,
      [sales.cash, sales.card, sales.credit, sales.split, sales.legacy, branchId, userId, createdAt],
    );

    await q(
      `INSERT INTO public.sale_payments (sale_id,branch_id,payment_method,amount,created_by,created_at)
       VALUES
        ($1,$3,'cash',40,$4,$5),
        ($1,$3,'card',60,$4,$5)`,
      [sales.split, null, branchId, userId, createdAt],
    );

    await postSaleJournal(sales.cash, 'RT-CASH', [
      { account_key: 'cash', debit: 100, credit: 0 },
      { account_key: 'revenue', debit: 0, credit: 100 },
    ]);
    await postSaleJournal(sales.card, 'RT-CARD', [
      { account_key: 'bank', debit: 50, credit: 0 },
      { account_key: 'revenue', debit: 0, credit: 50 },
    ]);
    await postSaleJournal(sales.credit, 'RT-CREDIT', [
      { account_key: 'ar', debit: 25, credit: 0 },
      { account_key: 'revenue', debit: 0, credit: 25 },
    ]);
    await postSaleJournal(sales.split, 'RT-SPLIT', [
      { account_key: 'cash', debit: 40, credit: 0 },
      { account_key: 'bank', debit: 60, credit: 0 },
      { account_key: 'revenue', debit: 0, credit: 100 },
    ]);
    await postSaleJournal(sales.legacy, 'RT-LEGACY', [
      { account_key: 'cash', debit: 30, credit: 0 },
      { account_key: 'bank', debit: 50, credit: 0 },
      { account_key: 'ar', debit: 20, credit: 0 },
      { account_key: 'revenue', debit: 0, credit: 100 },
    ]);

    // Shift membership only. Deliberately misleading operation amounts/methods prove
    // expected cash comes from the canonical settlement helper, not these sale rows.
    await q(
      `INSERT INTO public.shift_operations
        (shift_id,operation_type,amount,payment_method,reference_type,reference_id,created_by,created_at)
       VALUES
        ($1,'sale',1,'card','sale',$2,$7,$8),
        ($1,'sale',1,'cash','sale',$3,$7,$8),
        ($1,'sale',1,'cash','sale',$4,$7,$8),
        ($1,'sale',999,'cash','sale',$5,$7,$8),
        ($1,'sale',999,'cash','sale',$6,$7,$8)`,
      [shiftId, sales.cash, sales.card, sales.credit, sales.split, sales.legacy, userId, createdAt],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('classifies canonical and legacy split settlement without calling credit bank', async () => {
    await asAdmin(async () => {
      const canonical = await q<{ method: string; amount: string; source: string }>(
        `SELECT method,amount::text,source FROM private.report_sale_settlement_lines($1) ORDER BY method`,
        [sales.split],
      );
      expect(canonical.map((row) => [row.method, Number(row.amount), row.source])).toEqual([
        ['card', 60, 'sale_payments'],
        ['cash', 40, 'sale_payments'],
      ]);

      const legacy = await q<{ method: string; amount: string; source: string }>(
        `SELECT method,amount::text,source FROM private.report_sale_settlement_lines($1) ORDER BY method`,
        [sales.legacy],
      );
      expect(legacy.map((row) => [row.method, Number(row.amount), row.source])).toEqual([
        ['bank_legacy', 50, 'journal_legacy_split'],
        ['cash', 30, 'journal_legacy_split'],
        ['credit', 20, 'receivable'],
      ]);

      const credit = await q<{ method: string; amount: string }>(
        `SELECT method,amount::text FROM private.report_sale_settlement_lines($1)`,
        [sales.credit],
      );
      expect(credit.map((row) => [row.method, Number(row.amount)])).toEqual([['credit', 25]]);
    });
  });

  it('keeps sales-by-payment total equal to net sales and invoice count distinct', async () => {
    await asAdmin(async () => {
      const from = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const result = await q<{ r: Record<string, unknown> }>(
        `SELECT public.get_sales_by_payment_report($1,$2,$3,NULL,NULL,NULL,NULL,NULL) AS r`,
        [branchId, from, to],
      );
      const report = result[0].r as { success: boolean; summary: { invoice_count: number; sales_total: number }; rows: Array<Record<string, unknown>> };
      expect(report.success).toBe(true);
      expect(Number(report.summary.invoice_count)).toBe(5);
      expect(Number(report.summary.sales_total)).toBe(375);

      const amounts = new Map(report.rows.map((row) => [String(row.method), Number(row.sales_total)]));
      expect(amounts.get('cash')).toBe(170);
      expect(amounts.get('card')).toBe(110);
      expect(amounts.get('bank_legacy')).toBe(50);
      expect(amounts.get('credit')).toBe(45);
    });
  });

  it('reports zero treasury/bank mismatch when journals agree with payment truth', async () => {
    await asAdmin(async () => {
      const from = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const to = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const result = await q<{ r: Record<string, unknown> }>(
        `SELECT public.get_financial_reconciliation_report($1,$2,$3) AS r`,
        [branchId, from, to],
      );
      const report = result[0].r as { success: boolean; summary: Record<string, unknown>; rows: Array<Record<string, unknown>> };
      expect(report.success).toBe(true);
      expect(Number(report.summary.cash_difference)).toBe(0);
      expect(Number(report.summary.bank_difference)).toBe(0);
      expect(Number(report.summary.mismatch_count)).toBe(0);
      expect(Number(report.summary.cash_sales)).toBe(170);
      expect(Number(report.summary.card_sales)).toBe(110);
      expect(Number(report.summary.legacy_bank_sales)).toBe(50);
      expect(Number(report.summary.bank_gl)).toBe(160);
    });
  });

  it('computes shift expected cash from canonical settlement, not misleading sale operations', async () => {
    await asAdmin(async () => {
      const result = await q<{ amount: string }>(
        `SELECT public._compute_shift_expected_cash($1)::text AS amount`,
        [shiftId],
      );
      // opening 10 + canonical cash (100 + 40 + 30)
      expect(Number(result[0].amount)).toBe(180);

      const tenders = await q<{ r: Record<string, unknown> }>(
        `SELECT public.get_shift_sale_tenders($1) AS r`,
        [shiftId],
      );
      const report = tenders[0].r as { success: boolean; payment_methods: Array<Record<string, unknown>> };
      expect(report.success).toBe(true);
      const methods = new Map(report.payment_methods.map((row) => [String(row.method), Number(row.total)]));
      expect(methods.get('cash')).toBe(170);
      expect(methods.get('card')).toBe(110);
      expect(methods.get('bank_legacy')).toBe(50);
      expect(methods.get('credit')).toBe(45);
    });
  });

  it('uses canonical payment truth in the live day closing report', async () => {
    await asAdmin(async () => {
      const date = await q<{ d: string }>(
        `SELECT (now() AT TIME ZONE 'Africa/Cairo')::date::text AS d`,
      );
      const result = await q<{ r: Record<string, unknown> }>(
        `SELECT public._build_day_closing_report($1,$2::date) AS r`,
        [branchId, date[0].d],
      );
      const report = result[0].r as { success: boolean; cash_sales: number; payment_methods: Array<Record<string, unknown>> };
      expect(report.success).toBe(true);
      expect(Number(report.cash_sales)).toBe(170);
      const methods = new Map(report.payment_methods.map((row) => [String(row.method), Number(row.sales_total)]));
      expect(methods.get('cash')).toBe(170);
      expect(methods.get('card')).toBe(110);
      expect(methods.get('bank_legacy')).toBe(50);
      expect(methods.get('credit')).toBe(45);
    });
  });

  it('keeps reporting RPCs permission-gated and unavailable to anon', async () => {
    const acl = await q<{
      auth_payment: boolean;
      anon_payment: boolean;
      auth_reconcile: boolean;
      anon_reconcile: boolean;
    }>(
      `SELECT
        has_function_privilege('authenticated','public.get_sales_by_payment_report(uuid,timestamptz,timestamptz,text,text,uuid,uuid,text)','EXECUTE') auth_payment,
        has_function_privilege('anon','public.get_sales_by_payment_report(uuid,timestamptz,timestamptz,text,text,uuid,uuid,text)','EXECUTE') anon_payment,
        has_function_privilege('authenticated','public.get_financial_reconciliation_report(uuid,timestamptz,timestamptz)','EXECUTE') auth_reconcile,
        has_function_privilege('anon','public.get_financial_reconciliation_report(uuid,timestamptz,timestamptz)','EXECUTE') anon_reconcile`,
    );
    expect(acl[0]).toEqual({
      auth_payment: true,
      anon_payment: false,
      auth_reconcile: true,
      anon_reconcile: false,
    });
  });
});
