import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('history.unlimited database guard', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const limitedUserId = randomUUID();
  const unlimitedUserId = randomUUID();
  const limitedRole = `qa_history_limited_${randomUUID().slice(0, 8)}`;
  const unlimitedRole = `qa_history_unlimited_${randomUUID().slice(0, 8)}`;

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

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`INSERT INTO public.branches (id, name) VALUES ($1, 'QA History Branch')`, [branchId]);
    await client.query(
      `INSERT INTO public.roles (role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'محدود','Limited','[]'::jsonb,'global',true),
              ($2,'كامل','Unlimited','["history.unlimited"]'::jsonb,'global',true)`,
      [limitedRole, unlimitedRole],
    );
    await client.query(`SET LOCAL session_replication_role = 'replica'`);
    await client.query(
      `INSERT INTO public.users(id,email,username,full_name,role,branch_id,is_active)
       VALUES ($1,$2,$3,'Limited History',$4,$5,true),
              ($6,$7,$8,'Unlimited History',$9,$5,true)`,
      [
        limitedUserId, `${randomUUID()}@test.local`, `hl_${randomUUID().slice(0,8)}`, limitedRole, branchId,
        unlimitedUserId, `${randomUUID()}@test.local`, `hu_${randomUUID().slice(0,8)}`, unlimitedRole,
      ],
    );
    await client.query(`SET LOCAL session_replication_role = 'origin'`);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('does not auto-grant history.unlimited to owner', async () => {
    const r = await client.query<{ granted: boolean }>(
      `SELECT COALESCE(permissions, '[]'::jsonb) ? 'history.unlimited' AS granted
       FROM public.roles WHERE role='owner'`,
    );
    expect(r.rows[0]?.granted ?? false).toBe(false);
  });

  it('uses Cairo date and clamps restricted users to seven calendar days', async () => {
    const limited = await asUser(limitedUserId, async () => client.query<{ days: number; from_date: string }>(
      `SELECT (public.history_business_date() - public.history_min_date())::int AS days,
              public.history_clamp_from(DATE '2020-01-01')::text AS from_date`,
    ));
    expect(limited.rows[0].days).toBe(6);
    expect(limited.rows[0].from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const unlimited = await asUser(unlimitedUserId, async () => client.query<{ min_date: string | null; from_date: string }>(
      `SELECT public.history_min_date()::text AS min_date,
              public.history_clamp_from(DATE '2020-01-01')::text AS from_date`,
    ));
    expect(unlimited.rows[0]).toEqual({ min_date: null, from_date: '2020-01-01' });
  });

  it('keeps current aging balances cumulative while clamping the requested as-of date', async () => {
    const defs = await client.query<{ proname: string; def: string }>(
      `SELECT p.proname, pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname = ANY($1::text[])`,
      [['get_ar_aging','get_ap_aging','get_aging_summary','get_party_statement']],
    );
    for (const row of defs.rows) {
      expect(row.def, row.proname).toContain('history_clamp_');
      expect(row.def, row.proname).not.toContain('created_at AT TIME ZONE \'Africa/Cairo\')::date >= public.history_min_date()');
      expect(row.def, row.proname).not.toContain('j.entry_date >= public.history_min_date()');
    }
  });

  it('wires database-side history guards into historical RPCs', async () => {
    const names = ["get_journals","get_general_ledger","get_income_statement","get_cash_flow","get_party_statement","get_trial_balance","get_trial_balance_summary","get_balance_sheet","get_ar_aging","get_ap_aging","get_aging_summary","get_order_margin","get_costing_sales_summary","get_waste_report","get_cost_history","get_raw_material_cost_history","get_supplier_price_impact"];
    const r = await client.query<{ proname: string; def: string }>(
      `SELECT p.proname, pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname = ANY($1::text[])`,
      [names],
    );
    expect(r.rows).toHaveLength(names.length);
    for (const row of r.rows) {
      expect(row.def, row.proname).toMatch(/history_(clamp|min_)/);
    }
  });
});
