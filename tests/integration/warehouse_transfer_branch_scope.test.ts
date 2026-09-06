import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('warehouse transfer branch scope', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const userA = randomUUID();
  const role = `qa_transfer_${randomUUID().slice(0, 8)}`;
  const whA1 = randomUUID();
  const whA2 = randomUUID();
  const whB1 = randomUUID();
  const whB2 = randomUUID();
  const productA = randomUUID();
  const productB = randomUUID();
  const transferA = randomUUID();
  const transferB = randomUUID();

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

    await client.query(
      `INSERT INTO public.branches (id, name) VALUES ($1,'QA Transfer A'),($2,'QA Transfer B')`,
      [branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.roles (role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'تحويل QA','QA Transfer','["inventory.transfer.create","inventory.transfer.approve"]'::jsonb,'global',true)`,
      [role],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'QA Transfer User',$3,$4,true)`,
      [userA, `${randomUUID()}@test.local`, role, branchA],
    );
    await client.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.warehouses (id,name,branch_id,is_active) VALUES
       ($1,'A1',$5,true),($2,'A2',$5,true),($3,'B1',$6,true),($4,'B2',$6,true)`,
      [whA1, whA2, whB1, whB2, branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.products (id,name,sale_price,branch_id,is_active) VALUES
       ($1,'QA Product A',10,$3,true),($2,'QA Product B',10,$4,true)`,
      [productA, productB, branchA, branchB],
    );
    await client.query(
      `INSERT INTO public.warehouse_transfers
       (id,transfer_number,from_warehouse_id,to_warehouse_id,branch_id,status)
       VALUES
       ($1,$3,$4,$5,$6,'pending'),
       ($2,$7,$8,$9,$10,'pending')`,
      [
        transferA, transferB,
        `QA-A-${randomUUID()}`, whA1, whA2, branchA,
        `QA-B-${randomUUID()}`, whB1, whB2, branchB,
      ],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('hardens all transfer mutation RPC search paths', async () => {
    const rows = await client.query<{ proname: string; cfg: string[] | null }>(
      `SELECT p.proname, p.proconfig AS cfg
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public'
         AND p.proname IN ('create_warehouse_transfer','approve_warehouse_transfer','reject_warehouse_transfer')`,
    );
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) expect(row.cfg ?? []).toContain('search_path=public, pg_temp');
  });

  it('rejects a forged branch id before warehouse lookup', async () => {
    const result = await asUser(userA, async () => {
      const r = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.create_warehouse_transfer($1,$2,$3,$4::jsonb,NULL,NULL) AS r`,
        [whB1, whB2, branchB, JSON.stringify([{ product_id: productB, quantity: 1 }])],
      );
      return r.rows[0].r;
    });
    expect(result).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
  });

  it('rejects warehouses from another branch even when p_branch_id is accessible', async () => {
    const result = await asUser(userA, async () => {
      const r = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.create_warehouse_transfer($1,$2,$3,$4::jsonb,NULL,NULL) AS r`,
        [whB1, whB2, branchA, JSON.stringify([{ product_id: productA, quantity: 1 }])],
      );
      return r.rows[0].r;
    });
    expect(result).toMatchObject({ success: false, error: 'WAREHOUSE_BRANCH_MISMATCH' });
  });

  it('rejects a product from another branch', async () => {
    const result = await asUser(userA, async () => {
      const r = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.create_warehouse_transfer($1,$2,$3,$4::jsonb,NULL,NULL) AS r`,
        [whA1, whA2, branchA, JSON.stringify([{ product_id: productB, quantity: 1 }])],
      );
      return r.rows[0].r;
    });
    expect(result).toMatchObject({ success: false, error: 'PRODUCT_BRANCH_MISMATCH' });
  });

  it('does not expose or approve a transfer from another branch', async () => {
    const result = await asUser(userA, async () => {
      const r = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.approve_warehouse_transfer($1) AS r`,
        [transferB],
      );
      return r.rows[0].r;
    });
    expect(result).toMatchObject({ success: false, error: 'TRANSFER_NOT_FOUND' });

    const status = await client.query<{ status: string }>(
      `SELECT status FROM public.warehouse_transfers WHERE id=$1`, [transferB],
    );
    expect(status.rows[0].status).toBe('pending');
  });

  it('does not expose or reject a transfer from another branch', async () => {
    const result = await asUser(userA, async () => {
      const r = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.reject_warehouse_transfer($1,$2) AS r`,
        [transferB, 'cross-branch probe'],
      );
      return r.rows[0].r;
    });
    expect(result).toMatchObject({ success: false, error: 'TRANSFER_NOT_FOUND' });

    const status = await client.query<{ status: string }>(
      `SELECT status FROM public.warehouse_transfers WHERE id=$1`, [transferB],
    );
    expect(status.rows[0].status).toBe('pending');
  });

  it('allows rejection inside the authorized branch', async () => {
    const result = await asUser(userA, async () => {
      const r = await client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.reject_warehouse_transfer($1,$2) AS r`,
        [transferA, 'same branch'],
      );
      return r.rows[0].r;
    });
    expect(result).toMatchObject({ success: true, transfer_id: transferA });

    const status = await client.query<{ status: string; rejection_reason: string | null }>(
      `SELECT status,rejection_reason FROM public.warehouse_transfers WHERE id=$1`, [transferA],
    );
    expect(status.rows[0]).toMatchObject({ status: 'rejected', rejection_reason: 'same branch' });
  });
});
