import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type Snapshot = {
  current?: { orders?: number; sales?: number; payments?: number; returns?: number; discounts?: number };
  previous?: { orders?: number; sales?: number; payments?: number; returns?: number; discounts?: number };
  payment_methods?: Array<{ method?: string; total?: number }>;
  recent_sales?: Array<{ invoice_number?: string }>;
};

describe.skipIf(skip)('dashboard bounded aggregate snapshot', () => {
  let client: pg.Client;
  const branch = randomUUID();
  const user = randomUUID();
  const saleA = randomUUID();
  const saleB = randomUUID();
  const previousSale = randomUUID();

  async function asUser<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [user]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');

    await client.query(`INSERT INTO public.branches (id,name) VALUES ($1,'Dashboard Snapshot QA')`, [branch]);
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Dashboard Snapshot Admin','super_admin',$3,true)`,
      [user, `${user}@test.local`, branch],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.sales
         (id, invoice_number, branch_id, cashier_id, total, paid_amount, payment_method, refunded_amount, discount_amount, created_at)
       VALUES
         ($1,'DASH-CURRENT-A',$4,$5,100,100,'cash',10,5,'2026-09-28T10:00:00Z'),
         ($2,'DASH-CURRENT-B',$4,$5,200,200,'split',0,20,'2026-09-28T11:00:00Z'),
         ($3,'DASH-PREVIOUS',$4,$5,80,80,'cash',5,2,'2026-09-27T10:00:00Z')`,
      [saleA, saleB, previousSale, branch, user],
    );

    await client.query(
      `INSERT INTO public.sale_payments (sale_id, branch_id, payment_method, amount, refunded_amount)
       VALUES
         ($1,$3,'cash',120,0),
         ($1,$3,'card',80,0),
         ($2,$3,'cash',80,5)`,
      [saleB, previousSale, branch],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('matches canonical net sales, refunds, discounts and split tender totals', async () => {
    await asUser(async () => {
      const r = await client.query<{ snapshot: Snapshot }>(
        `SELECT public.get_dashboard_sales_snapshot(
           $1::uuid,
           '2026-09-28T00:00:00Z'::timestamptz,
           '2026-09-28T23:59:59Z'::timestamptz,
           '2026-09-27T00:00:00Z'::timestamptz,
           '2026-09-27T23:59:59Z'::timestamptz,
           'day',
           'Africa/Cairo'
         ) AS snapshot`,
        [branch],
      );

      const snapshot = r.rows[0].snapshot;
      expect(Number(snapshot.current?.orders)).toBe(2);
      expect(Number(snapshot.current?.sales)).toBe(290);
      expect(Number(snapshot.current?.returns)).toBe(10);
      expect(Number(snapshot.current?.discounts)).toBe(25);
      expect(Number(snapshot.current?.payments)).toBe(300);

      expect(Number(snapshot.previous?.orders)).toBe(1);
      expect(Number(snapshot.previous?.sales)).toBe(75);
      expect(Number(snapshot.previous?.returns)).toBe(5);
      expect(Number(snapshot.previous?.discounts)).toBe(2);
      expect(Number(snapshot.previous?.payments)).toBe(75);

      const methods = new Map((snapshot.payment_methods || []).map((row) => [row.method, Number(row.total || 0)]));
      expect(methods.get('cash')).toBe(220);
      expect(methods.get('card')).toBe(80);
      expect(snapshot.recent_sales?.[0]?.invoice_number).toBe('DASH-CURRENT-B');
    });
  });

  it('keeps the aggregate unavailable to anon and available to authenticated', async () => {
    const acl = await client.query<{ anon_exec: boolean; auth_exec: boolean }>(
      `SELECT
         has_function_privilege('anon', 'public.get_dashboard_sales_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text)', 'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated', 'public.get_dashboard_sales_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text)', 'EXECUTE') AS auth_exec`,
    );
    expect(acl.rows[0]).toEqual({ anon_exec: false, auth_exec: true });
  });
});
